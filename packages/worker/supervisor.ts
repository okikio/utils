/** Bounded restart ownership without request queues, retries or replay. @module */
import { EventBus } from '@okikio/observables/events';
import type { Context } from '@okikio/context';
import { check } from '@okikio/context';
import type { WorkerTerminationType } from './thread/types.ts';

/** A factory transfers one worker generation only after startup has succeeded. */
export interface GenerationType<Request, Response> {
	/** Authoritative terminal receipt after native termination, not an event projection. */
	readonly closed: Promise<WorkerTerminationType>;
	/** Dispatch exactly once; the underlying owner validates payloads and owns transfers. */
	request(ctx: Context, value: Request): Promise<Response>;
	/** Join actual shutdown. Failed termination must be reported by closed. */
	stop(reason?: unknown): Promise<void>;
}

/** Restart budgets do not imply idempotency or external side-effect reconciliation. */
export interface OptionsType {
	/** Total replacement attempts after the initial factory call; zero disables restart. */
	readonly maximumRestarts: number;
	/** Maximum admitted requests across the active generation. No waiting queue exists. */
	readonly maximumRequests: number;
	/** Cancellable fixed delay between attempts, in milliseconds on the owner context clock. */
	readonly backoff: number;
}

/** Small observation values carry no terminal or cancellation authority. */
export interface EventType {
	/** Current phase; late subscribers inspect status instead of receiving replay. */
	readonly status: 'starting' | 'ready' | 'backoff' | 'stopped' | 'exhausted' | 'failed';
	/** Zero-based factory attempt, also the generation identity. */
	readonly generation: number;
}

/** Terminal result is published only after owned startup/shutdown has joined. */
export interface OutcomeType {
	/**
	 * Exhausted means the restart budget ended; failed means cleanup/clock ownership could not complete
	 * normally.
	 */
	readonly status: 'stopped' | 'exhausted' | 'failed';
	/** Number of factory attempts, including startup failures. */
	readonly attempts: number;
	/** Exact final failure or requested stop reason. */
	readonly reason: unknown;
}

/** Dispatch was refused before a request was sent; retry admission is the caller's decision. */
export class UnavailableError extends Error {
	constructor() {
		super('Supervisor has no ready generation or its request capacity is full.');
		this.name = 'UnavailableError';
	}
}

/** A lost generation cannot prove whether a dispatched external side effect committed. */
export class UncertainRequestError extends Error {
	/** Retain the generation so callers can reconcile with their own stable operation identity. */
	readonly generation: number;
	constructor(generation: number, reason: unknown) {
		super('Worker generation ended before a request result; external completion is uncertain.', { cause: reason });
		this.name = 'UncertainRequestError';
		this.generation = generation;
	}
}

/** One explicitly owned generation at a time; use Pool separately for leasing several supervisors. */
export interface SupervisorType<Request, Response> extends AsyncDisposable {
	/** Resolves after the first ready generation, or rejects if supervision ends first. */
	readonly ready: Promise<void>;
	/** Terminal lifecycle receipt, independent of observation subscriptions. */
	readonly closed: Promise<OutcomeType>;
	/** Current phase without event history or secret error data. */
	readonly status: EventType;
	/** Existing Observables EventBus projection; no replay or internal observer queue. */
	readonly events: EventBus<EventType>['events'];
	/** Dispatch once to the current generation, refusing startup/backoff/full capacity. */
	request(ctx: Context, value: Request): Promise<Response>;
	/** Stable joined stop; waits even for an uncooperative in-progress factory. */
	stop(reason?: unknown): Promise<void>;
}

/**
 * Start supervision on a promise turn so observers can attach before startup.
 * Factory cancellation is advisory: a late created generation is stopped and
 * joined before closed settles. Factory rejection must mean it retained no live
 * worker. An unconfirmed native termination stops supervision without replacement.
 * Requests never wait for readiness and are never resent, even after restart.
 */
export function create<Request, Response>(
	ctx: Context,
	factory: (
		generation: number,
		signal: AbortSignal,
	) => GenerationType<Request, Response> | PromiseLike<GenerationType<Request, Response>>,
	options: OptionsType,
): SupervisorType<Request, Response> {
	check(ctx);
	const { maximumRestarts, maximumRequests, backoff } = options;
	if (
		!Number.isSafeInteger(maximumRestarts) || maximumRestarts < 0 || !Number.isSafeInteger(maximumRequests) ||
		maximumRequests < 1 || !Number.isFinite(backoff) || backoff < 0
	) throw new RangeError('Invalid supervisor restart, request or delay policy.');
	const lifetime = new AbortController();
	const bus = new EventBus<EventType>();
	const ready = Promise.withResolvers<void>();
	void ready.promise.catch(() => {});
	const terminal = Promise.withResolvers<OutcomeType>();
	let status: EventType = Object.freeze({ status: 'starting', generation: 0 });
	let active: GenerationType<Request, Response> | undefined;
	/** Abort listeners can be removed after each request; terminal promise reactions cannot. */
	let activeLoss: AbortController | undefined;
	let attempts = 0;
	let requests = 0;
	let stopping = false;
	let stopPromise: Promise<void> | undefined;
	let stopReason: unknown;
	/** Publish immutable projections after state mutation, preserving promise authority under reentrancy. */
	const publish = (phase: EventType['status'], generation: number): void => {
		status = Object.freeze({ status: phase, generation });
		bus.emit(status);
	};
	const stop = (reason?: unknown): Promise<void> => {
		if (stopPromise !== undefined) return stopPromise;
		stopPromise = terminal.promise.then((outcome) => {
			if (outcome.status === 'failed') throw outcome.reason;
		});
		stopping = true;
		stopReason = reason;
		lifetime.abort(reason);
		return stopPromise;
	};
	const abort = (): void => {
		void stop(ctx.signal.reason).catch(() => {});
	};
	ctx.signal.addEventListener('abort', abort, { once: true });
	if (ctx.signal.aborted) abort();
	/** A generation is cleared only after its stop and terminal receipt both confirm release. */
	const retire = async (generation: GenerationType<Request, Response>, reason: unknown): Promise<void> => {
		await generation.stop(reason);
		const outcome = await generation.closed;
		if (outcome.status === 'failed') throw outcome.reason;
	};
	// Factory failure consumes a replacement attempt. A created generation must
	// prove termination before another factory call can own a replacement.
	const run = async (): Promise<void> => {
		let outcome: OutcomeType;
		let reason: unknown;
		try {
			while (!stopping) {
				const generation = attempts++;
				publish('starting', generation);
				try {
					active = await factory(generation, lifetime.signal);
				} catch (error) {
					reason = error;
					active = undefined;
				}
				if (active !== undefined) {
					if (stopping) {
						await retire(active, stopReason);
						active = undefined;
						break;
					}
					const selected = active;
					const loss = new AbortController();
					activeLoss = loss;
					void selected.closed.then(
						(outcome) => loss.abort({ reason: outcome.reason }),
						(reason: unknown) => loss.abort({ reason }),
					);
					publish('ready', generation);
					ready.resolve();
					const abortWait = new Promise<'stop'>((resolve) => {
						const onAbort = (): void => resolve('stop');
						lifetime.signal.addEventListener('abort', onAbort, { once: true });
						void selected.closed.then(
							() => lifetime.signal.removeEventListener('abort', onAbort),
							() => lifetime.signal.removeEventListener('abort', onAbort),
						);
						if (lifetime.signal.aborted) onAbort();
					});
					const closed = await Promise.race([selected.closed, abortWait]);
					if (closed === 'stop') {
						await retire(selected, stopReason);
						active = undefined;
						break;
					}
					if (closed.status === 'failed') throw closed.reason;
					reason = closed.reason;
					await selected.stop(reason);
					active = undefined;
				}
				if (stopping) break;
				if (attempts > maximumRestarts) break;
				publish('backoff', generation);
				try {
					await ctx.clock.sleep(backoff, lifetime.signal);
				} catch (error) {
					if (!stopping) throw error;
				}
			}
			outcome = Object.freeze({
				status: stopping ? 'stopped' : 'exhausted',
				attempts,
				reason: stopping ? stopReason : reason,
			});
		} catch (error) {
			outcome = Object.freeze({ status: 'failed', attempts, reason: error });
		} finally {
			ctx.signal.removeEventListener('abort', abort);
		}
		// A failed native termination deliberately retains the generation: no replacement is admitted.
		publish(outcome.status, Math.max(0, attempts - 1));
		ready.reject(outcome.reason);
		bus.close();
		terminal.resolve(outcome);
	};
	void Promise.resolve().then(run);
	return Object.freeze({
		ready: ready.promise,
		closed: terminal.promise,
		get status() {
			return status;
		},
		events: bus.events,
		/**
		 * Bind this request to the current host generation before sending it.
		 * If that host disappears, report an uncertain outcome instead of silently repeating a possibly completed external write.
		 */
		async request(requestCtx: Context, value: Request): Promise<Response> {
			check(requestCtx);
			const selected = active;
			const generation = status.generation;
			const loss = activeLoss;
			if (
				stopping || status.status !== 'ready' || selected === undefined || loss === undefined ||
				requests >= maximumRequests
			) throw new UnavailableError();
			requests++;
			let unlink = (): void => {};
			try {
				const interrupted = new Promise<never>((_resolve, reject) => {
					const onLoss = (): void =>
						reject(new UncertainRequestError(generation, (loss.signal.reason as { reason: unknown }).reason));
					loss.signal.addEventListener('abort', onLoss, { once: true });
					unlink = () => loss.signal.removeEventListener('abort', onLoss);
					if (loss.signal.aborted) onLoss();
				});
				const response = await Promise.race([selected.request(requestCtx, value), interrupted]);
				if (active !== selected || stopping) throw new UncertainRequestError(generation, stopReason);
				return response;
			} finally {
				unlink();
				requests--;
			}
		},
		stop,
		[Symbol.asyncDispose]: () => stop('Supervisor disposed.'),
	});
}
