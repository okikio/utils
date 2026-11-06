import type {
	Admission,
	AdmissionCancellation,
	AdmissionLease,
	AdmissionLimits,
	AdmissionRequest,
	AdmissionSnapshot,
} from './types.ts';
import * as recordCore from '@okikio/collection/record';

interface Waiter {
	readonly request: AdmissionRequest;
	readonly resolve: (lease: AdmissionLease) => void;
	readonly reject: (error: unknown) => void;
	readonly signal: AbortSignal | undefined;
	readonly queuedAt: number;
	removeAbortListener: (() => void) | undefined;
	settled: boolean;
}

interface State {
	readonly available: Map<string, number>;
	readonly waiters: Waiter[];
	readonly now: () => number;
	readonly maximumPending: number;
}

const states = new WeakMap<Admission, State>();

/** A local admission pool cannot retain another waiting request. No capacity was acquired. */
export class AdmissionWaitLimitError extends RangeError {
	/** Configured upper bound on blocked acquisition calls. */
	readonly maximumPending: number;
	constructor(maximumPending: number) {
		super(`Admission reached its pending request limit of ${maximumPending}.`);
		this.name = 'AdmissionWaitLimitError';
		this.maximumPending = maximumPending;
	}
}

/** Create an atomic FIFO pool. At most 1,000 requests wait by default; zero disables waiting. */
export function create(
	limits: AdmissionLimits,
	options: Readonly<{ readonly now?: () => number; readonly maximumPending?: number }> = {},
): Admission {
	const maximumPending = options.maximumPending ?? 1000;
	if (!Number.isSafeInteger(maximumPending) || maximumPending < 0) {
		throw new RangeError('Admission maximumPending must be a non-negative safe integer.');
	}
	if (options.now !== undefined && typeof options.now !== 'function') {
		throw new TypeError('Admission now must be a function.');
	}
	const normalized = normalize(limits, 'capacity limit');
	const admission = Object.freeze({ limits: normalized });
	states.set(admission, {
		available: new Map(Object.entries(normalized)),
		waiters: [],
		maximumPending,
		now: options.now ?? (() => performance.now()),
	});
	return admission;
}

/** Return the currently unreserved units for every configured capacity name. */
export function available(admission: Admission): AdmissionLimits {
	const state = stateFor(admission);
	return Object.freeze(Object.fromEntries(state.available));
}

/** Return current limits, availability, and FIFO wait pressure. */
export function snapshot(admission: Admission): AdmissionSnapshot {
	const state = stateFor(admission);
	const oldest = state.waiters[0];
	return Object.freeze({
		capacity: admission.limits,
		available: available(admission),
		queuedRequests: state.waiters.length,
		...(oldest === undefined ? {} : { oldestWaitMs: Math.max(0, state.now() - oldest.queuedAt) }),
	});
}

/**
 * Reserve every requested unit atomically or wait at the FIFO head until the full request fits.
 *
 * The third argument accepts either an `AbortSignal` or any operation object with
 * a `signal`, including `@okikio/context` Context values. Cancellation before
 * admission rejects with the signal's exact reason and reserves no capacity.
 */
export async function acquire(
	admission: Admission,
	request: AdmissionRequest,
	cancellation?: AdmissionCancellation,
): Promise<AdmissionLease> {
	const state = stateFor(admission);
	const normalized = normalize(request, 'capacity request');
	assertPossible(admission, normalized);
	const signal = signalFor(cancellation);
	signal?.throwIfAborted();
	if (state.waiters.length === 0 && canAcquire(state, normalized)) return createLease(admission, normalized);

	if (state.waiters.length >= state.maximumPending) throw new AdmissionWaitLimitError(state.maximumPending);
	return await new Promise<AdmissionLease>((resolve, reject) => {
		const waiter: Waiter = {
			request: normalized,
			resolve,
			reject,
			signal,
			queuedAt: state.now(),
			removeAbortListener: undefined,
			settled: false,
		};
		if (signal !== undefined) {
			const abort = () => rejectWaiter(admission, waiter, signal.reason);
			signal.addEventListener('abort', abort, { once: true });
			waiter.removeAbortListener = () => signal.removeEventListener('abort', abort);
		}
		state.waiters.push(waiter);
		// Abort may race listener registration. Recheck after the waiter is visible.
		if (signal?.aborted) rejectWaiter(admission, waiter, signal.reason);
		else drain(admission);
	});
}

/**
 * Reserve a complete request now or return undefined without queueing.
 * Older waiters always take precedence, even when this smaller request fits.
 * Impossible requests and cancellation retain acquire()'s failure semantics.
 * A successful caller owns the returned lease and must release or dispose it.
 */
export function tryAcquire(
	admission: Admission,
	request: AdmissionRequest,
	cancellation?: AdmissionCancellation,
): AdmissionLease | undefined {
	const state = stateFor(admission);
	const normalized = normalize(request, 'capacity request');
	assertPossible(admission, normalized);
	signalFor(cancellation)?.throwIfAborted();
	if (state.waiters.length !== 0 || !canAcquire(state, normalized)) return undefined;
	return createLease(admission, normalized);
}

/** Read-only reasons a valid capacity request cannot reserve immediately. */
export interface AdmissionInspectionType {
	/** Available is only an observation; another synchronous operation may reserve next. */
	readonly status: 'available' | 'queued' | 'unavailable';
	/** Older FIFO requests that this request must not bypass. */
	readonly queuedRequests: number;
	/** Names of deficient dimensions in authored request order, bounded by maximumReasons. */
	readonly deficient: readonly string[];
	/** More deficient dimensions existed than the report retained. */
	readonly truncated: boolean;
}

/** Inspect admission without creating a lease, listener or waiter; impossible requests still reject. */
export function inspect(
	admission: Admission,
	request: AdmissionRequest,
	options: Readonly<{ readonly maximumReasons: number }>,
): AdmissionInspectionType {
	if (!Number.isSafeInteger(options.maximumReasons) || options.maximumReasons < 0) {
		throw new RangeError('Admission maximumReasons must be a non-negative safe integer.');
	}
	const state = stateFor(admission);
	const normalized = normalize(request, 'capacity request');
	assertPossible(admission, normalized);
	const deficient: string[] = [];
	let count = 0;
	for (const [name, amount] of Object.entries(normalized)) {
		if ((state.available.get(name) ?? 0) >= amount) continue;
		count++;
		if (deficient.length < options.maximumReasons) deficient.push(name);
	}
	return Object.freeze({
		status: state.waiters.length !== 0 ? 'queued' : count !== 0 ? 'unavailable' : 'available',
		queuedRequests: state.waiters.length,
		deficient: Object.freeze(deficient),
		truncated: count > deficient.length,
	});
}

/** Copy nonnegative integer dimensions before callers can mutate their original request or limits. */
function normalize(value: Readonly<Record<string, number>>, name: string): AdmissionLimits {
	recordCore.assert(value, name);
	const entries: Array<readonly [string, number]> = [];
	for (const [key, amount] of Object.entries(value)) {
		if (key.length === 0) throw new TypeError(`${name} names must not be empty.`);
		if (!Number.isSafeInteger(amount) || amount < 0) {
			throw new TypeError(`${name} ${JSON.stringify(key)} must be a non-negative safe integer.`);
		}
		entries.push([key, amount]);
	}
	return Object.freeze(Object.fromEntries(entries));
}

/** Reject unknown or oversized dimensions before queuing a request that could never fit. */
function assertPossible(admission: Admission, request: AdmissionRequest): void {
	for (const [name, amount] of Object.entries(request)) {
		if (!Object.hasOwn(admission.limits, name)) throw new RangeError(`Unknown resource capacity: ${name}.`);
		const maximum = admission.limits[name]!;
		if (amount > maximum) {
			throw new RangeError(`Resource request for ${name} exceeds capacity: requested ${amount}, capacity ${maximum}.`);
		}
	}
}

/** Test every dimension without reserving a subset; only createLease changes availability. */
function canAcquire(state: State, request: AdmissionRequest): boolean {
	return Object.entries(request).every(([name, amount]) => (state.available.get(name) ?? 0) >= amount);
}

/**
 * Reserve one request from the process-local availability snapshot.
 *
 * The returned lease restores every reserved unit exactly once and then drains
 * queued waiters, so release and async disposal are intentionally idempotent.
 */
function createLease(admission: Admission, request: AdmissionRequest): AdmissionLease {
	const state = stateFor(admission);
	for (const [name, amount] of Object.entries(request)) {
		state.available.set(name, (state.available.get(name) ?? 0) - amount);
	}
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		for (const [name, amount] of Object.entries(request)) {
			state.available.set(name, (state.available.get(name) ?? 0) + amount);
		}
		drain(admission);
	};
	return Object.freeze({
		request,
		release,
		[Symbol.asyncDispose]: async () => release(),
	});
}

/**
 * Grant queued requests in arrival order while the queue head fits.
 *
 * Head-of-line ordering prevents later small requests from starving a larger
 * earlier request. Aborted waiters are removed before capacity checks.
 */
function drain(admission: Admission): void {
	const state = stateFor(admission);
	while (state.waiters.length > 0) {
		const waiter = state.waiters[0]!;
		if (waiter.signal?.aborted) {
			rejectWaiter(admission, waiter, waiter.signal.reason);
			continue;
		}
		// Do not let a small younger request overtake the head. This can leave
		// some capacity idle, but preserves the documented FIFO admission rule.
		if (!canAcquire(state, waiter.request)) return;
		state.waiters.shift();
		settle(waiter, () => waiter.resolve(createLease(admission, waiter.request)));
	}
}

/** Remove a cancelled head before draining, so younger requests do not remain blocked behind it. */
function rejectWaiter(admission: Admission, waiter: Waiter, reason: unknown): void {
	if (waiter.settled) return;
	const state = stateFor(admission);
	const index = state.waiters.indexOf(waiter);
	if (index >= 0) state.waiters.splice(index, 1);
	settle(waiter, () => waiter.reject(reason));
	drain(admission);
}

/** Detach cancellation before notifying user code; repeated wake/abort paths must settle only once. */
function settle(waiter: Waiter, action: () => void): void {
	if (waiter.settled) return;
	waiter.settled = true;
	waiter.removeAbortListener?.();
	action();
}

/** Accept either a borrowed signal or a context-like owner without creating a second cancellation source. */
function signalFor(value: AdmissionCancellation | undefined): AbortSignal | undefined {
	if (value === undefined) return undefined;
	return 'signal' in value ? value.signal : value;
}

/** Accept only pool objects created here; a structurally similar object has no owned counters. */
function stateFor(admission: Admission): State {
	const state = states.get(admission);
	if (state === undefined) throw new TypeError('Admission value was not created by @okikio/capacity.');
	return state;
}
