/**
 * Activity-job admission, engine registration, placement, and fenced attempts.
 *
 * This module is internal to `@okikio/workflow`. The public Scheduler delegates
 * activity commands here while keeping workflow instruction interpretation in
 * `mod.ts`. `@okikio/queue` remains the authority for logical job identity and
 * temporary attempt claims.
 *
 * @module
 */
import * as context from '@okikio/context';
import * as failures from '@okikio/failure';
import * as faultCore from '@okikio/fault';
import * as queue from '@okikio/queue';
import * as record from '@okikio/record';
import * as schema from '@okikio/schema';
import { retryDelay, type RetryPolicy, type TimeoutPolicy } from '@okikio/resilience';
import { freeze as freezeAffinity, matches as affinityMatches } from './affinity.ts';
import * as durable from './durable.ts';
import type {
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
	ActivityCommand,
	ActivityJobResultType,
	ActivityJobType,
	ActivityReference,
	WorkflowContext,
	EngineAffinityType,
	EngineRegistration,
	EngineProvider,
	EngineRegistrationOptions,
	EngineReference,
	SchedulerOptions,
} from './types.ts';

/** Raised when no live registration can satisfy an activity's declared placement before its context ends. */
export class PlacementError extends Error {
	/** Stable activity ID whose declared engine placement could not be satisfied. */
	readonly activityId: string;
	/** Ordered engine IDs declared by the activity placement that could not be satisfied. */
	readonly engines: readonly string[];

	/** Create one placement error while retaining the activity and declared engine choices. */
	constructor(activityId: string, engines: readonly string[], cause?: unknown) {
		super(
		`No live activity engine can run ${JSON.stringify(activityId)}. ` +
			`Declared engines: ${engines.map((id) => JSON.stringify(id)).join(', ')}.`,
		cause === undefined ? undefined : { cause },
		);
		this.name = 'PlacementError';
		this.activityId = activityId;
		this.engines = Object.freeze([...engines]);
	}
}

/** Raised when one engine id is reused by a different definition object in the same Scheduler. */
export class RegistrationConflictError extends Error {
	/** Engine ID reused by two different definition objects in one Scheduler. */
	readonly engineId: string;

	/** Create one identity-conflict error for two distinct definitions that reuse the same engine ID. */
	constructor(engineId: string) {
		super(`Activity engine id ${JSON.stringify(engineId)} belongs to different definition objects.`);
		this.name = 'RegistrationConflictError';
		this.engineId = engineId;
	}
}

/** Raised when a caller uses a Scheduler after its owned lifetime has ended. */
export class SchedulerClosedError extends Error {
	/** Original shutdown reason retained as the lifecycle error cause. */
	readonly reason: unknown;

	/** Create one lifecycle error for work submitted after Scheduler shutdown begins. */
	constructor(reason?: unknown) {
		super('The workflow Scheduler is closed.', reason === undefined ? undefined : { cause: reason });
		this.name = 'SchedulerClosedError';
		this.reason = reason;
	}
}

/** Live provider behavior captured once for one registration generation. */
interface ProviderRuntime {
	/** Immutable activity membership advertised when the registration was created. */
	readonly activities: readonly ActivityReference[];
	/** Exact provider run method captured at registration and bound to its original owner. */
	readonly run: EngineRegistrationOptions['provider']['run'];
	/** Exact optional cancellation method captured at registration and bound to its original owner. */
	readonly cancel?: NonNullable<EngineRegistrationOptions['provider']['cancel']>;
	/** Optional provider-disposal action captured when ownership transfers to the registration. */
	readonly dispose?: () => void | Promise<void>;
}

/** Internal mutable state behind one public engine-registration handle. */
interface RegistrationState {
	/** Unique registration ID combining Scheduler, engine, host, and generation. */
	readonly id: string;
	/** Caller-stable key used for deterministic identity or keyed coordination. */
	readonly key: string;
	/** Exact engine definition advertised by this registration generation. */
	readonly engine: EngineReference;
	/** Live provider that accepts fenced attempts for this registration generation. */
	readonly provider: ProviderRuntime;
	/** Provider host ID whose reconnects advance the generation fence. */
	readonly hostId: string;
	/** Host generation used to fence results from a replaced live host. */
	readonly generation: number;
	/** Protocol version advertised for compatibility checks. */
	readonly protocolVersion: number;
	/** Serializable affinity facts that must match before placement. */
	readonly affinity: EngineAffinityType | undefined;
	/** Exact activities advertised by the live provider. */
	readonly activities: EngineRegistrationOptions['provider']['activities'];
	/** Stable local registration order used as the deterministic capacity tie-breaker. */
	readonly order: number;
	/** Whether registration disposal also owns provider disposal. */
	readonly disposeProvider: boolean;
	/** Maximum simultaneous attempts this registration may own. */
	maximum: number;
	/** Attempts currently reserving capacity from this registration. */
	active: number;
	/** Absolute registration lease expiry, when this registration uses a lease. */
	leaseUntil: Temporal.Instant | undefined;
	/** Whether new placement is disabled while existing attempts are allowed to finish. */
	draining: boolean;
	/** Whether this registration has completed its owned close transition. */
	closed: boolean;
	/** Drain continuations resolved after the final active attempt leaves this registration. */
	readonly drained: Set<() => void>;
}

/** One waiter blocked until registration/capacity state changes or its context is cancelled. */
interface PlacementWaiter {
	/** Wake this placement waiter after registration or capacity state changes. */
	readonly resolve: () => void;
	/** Reject this waiter when the Scheduler closes or its owner is cancelled. */
	readonly reject: (reason: unknown) => void;
	/** Remove the waiter-local cancellation listener after settlement. */
	readonly unlink: () => void;
}

/** Options used only by the internal activity-job coordinator. */
export interface ActivityJobsOptions {
	/** Stable Scheduler-local identity used to namespace job coordination state. */
	readonly id: string;
	/** Clock used for deterministic timing and deadline calculations. */
	readonly clock: import('@okikio/context').Clock;
	/** Queue that owns stable logical jobs, temporary claims, retries, and terminal results. */
	readonly queue: queue.Queue<ActivityJobType, ActivityJobResultType>;
	/** Default lease duration for one Scheduler-owned activity attempt claim. */
	readonly claimDuration: Temporal.Duration;
	/** Whether this coordinator owns queue disposal when the Scheduler closes. */
	readonly disposeQueue: boolean;
}

/**
 * Owns activity jobs and live engine registrations for one Scheduler instance.
 *
 * One job key is derived from workflow run identity plus deterministic
 * instruction fingerprint. Queue claims create attempt numbers. Engine
 * registrations only deliver those attempts; they never manufacture retries.
 *
 * @internal
 */
export class ActivityJobs implements AsyncDisposable {
	/** Scheduler-owned context used for authoritative queue mutations after a claim exists. */
	readonly #control: import('@okikio/context').Owned;
	/** Stable Scheduler identity used to namespace local registration and control contexts. */
	readonly #id: string;
	/** Scheduler clock used for claims, leases, deadlines, and retry eligibility. */
	readonly #clock: import('@okikio/context').Clock;
	/** Authoritative logical activity-job store. */
	readonly #queue: queue.Queue<ActivityJobType, ActivityJobResultType>;
	/** Lease duration applied to every new activity attempt claim. */
	readonly #claimDuration: Temporal.Duration;
	/** Whether Scheduler shutdown must also close the injected activity queue. */
	readonly #disposeQueue: boolean;
	/** Stable engine-definition identity table that rejects conflicting objects for one ID. */
	readonly #definitions = new Map<string, EngineReference>();
	/** All live and draining registrations addressable by registration ID. */
	readonly #registrations = new Map<string, RegistrationState>();
	/** Current generation for each engine/host pair. */
	readonly #current = new Map<string, RegistrationState>();
	/** Last assigned generation for each engine/host pair across reconnects. */
	readonly #generations = new Map<string, number>();
	/** Placement waiters blocked until registration or capacity state changes. */
	readonly #waiters = new Set<PlacementWaiter>();
	/** Monotonic local registration order used for deterministic tie-breaking. */
	#order = 0;
	/** Guards new admission after Scheduler shutdown begins. */
	#closed = false;
	/** Caller-provided shutdown reason retained for later lifecycle errors. */
	#closeReason: unknown;
	/** Shared idempotent close operation for concurrent disposal callers. */
	#closePromise: Promise<void> | undefined;

	/** Create one Scheduler-local activity-job and engine-registration authority. */
	constructor(options: ActivityJobsOptions) {
		this.#control = context.create({ id: `${options.id}:activity-jobs`, clock: options.clock });
		this.#id = options.id;
		this.#clock = options.clock;
		this.#queue = options.queue;
		this.#claimDuration = options.claimDuration;
		this.#disposeQueue = options.disposeQueue;
	}

	/** Register one exact engine provider and create a new host generation. */
	async register(options: EngineRegistrationOptions): Promise<EngineRegistration> {
		this.#assertOpen();
		record.assert(options, 'engine registration options');
		const engine = options.engine;
		const hostId = options.hostId;
		const maximum = options.capacity ?? 1;
		const protocolVersion = options.protocolVersion ?? 1;
		const disposeProvider = options.disposeProvider ?? false;
		const affinity = options.affinity === undefined ? undefined : freezeAffinity(options.affinity, 'engine registration affinity');
		const provider = normalizeProvider(options.provider, disposeProvider);
		const lease = options.lease === undefined ? undefined : Temporal.Duration.from(options.lease);

		assertEngine(engine);
		assertId(hostId, 'engine host');
		assertPositive(maximum, 'engine capacity');
		if (!Number.isSafeInteger(protocolVersion) || protocolVersion < 1) {
			throw new TypeError('Engine protocolVersion must be a positive safe integer.');
		}
		if (typeof disposeProvider !== 'boolean') throw new TypeError('Engine disposeProvider must be a boolean.');

		const known = this.#definitions.get(engine.id);
		if (known !== undefined && known !== engine) throw new RegistrationConflictError(engine.id);
		this.#definitions.set(engine.id, engine);

		const key = registrationKey(engine, hostId);
		const generation = (this.#generations.get(key) ?? 0) + 1;
		this.#generations.set(key, generation);
		const previous = this.#current.get(key);
		if (previous !== undefined) {
			previous.draining = true;
			this.#settleDrained(previous);
		}

		const state: RegistrationState = {
			id: `${this.#id}:${engine.id}:${hostId}:${generation}`,
			key,
			engine,
			provider,
			hostId,
			generation,
			protocolVersion,
			affinity,
			activities: provider.activities,
			order: this.#order++,
			disposeProvider,
			maximum,
			active: 0,
			leaseUntil: lease === undefined ? undefined : this.#clock.now().add(lease),
			draining: false,
			closed: false,
			drained: new Set(),
		};
		this.#registrations.set(state.id, state);
		this.#current.set(key, state);
		this.#wake();
		return this.#handle(state);
	}

	/**
	 * Admit or find one logical activity job, then drive its current attempt.
	 *
	 * Duplicate replay observes the same queue reference. If another Scheduler
	 * replica already owns that job, this call waits for the queue's terminal
	 * result rather than creating a second attempt.
	 */
	async run(
		ctx: WorkflowContext,
		command: ActivityCommand,
		path: string,
		fingerprint: string,
	): Promise<ActivityAttemptResultType> {
		this.#assertOpen();
		const key = `${ctx.runId}:${fingerprint}`;
		const activity = command.activity;
		const job: ActivityJobType = Object.freeze({
			activityId: activity.id,
			activityVersion: activity.version,
			input: durable.snapshot(command.input, 'activity job input'),
			origin: Object.freeze({
				workflowId: ctx.workflow.id,
				workflowVersion: ctx.version,
				runId: ctx.runId,
				instructionPath: path,
				instructionFingerprint: fingerprint,
			}),
			context: context.snapshot(ctx),
			...(command.options.affinity === undefined ? {} : { affinity: freezeAffinity(command.options.affinity, 'activity job affinity') }),
		});
		const ref = await this.#queue.add(ctx, job, { key });

		while (true) {
			context.check(ctx);
			// Observe terminal replay before reserving engine capacity. A completed
			// durable job must be replayable even when no compatible engine is live.
			const state = await this.#queue.wait(ctx, ref);
			if (state === 'terminal') return await this.#result(ctx, ref, activity);

			const registration = await this.#takeRegistration(ctx, activity, job.affinity);
			let claims: readonly queue.QueueClaim<ActivityJobType>[];
			try {
				claims = await this.#queue.claim(ctx, {
					ref,
					owner: registration.id,
					limit: 1,
					duration: this.#claimDuration,
				});
			} catch (error) {
				this.#release(registration);
				throw error;
			}
			if (claims.length === 0) {
				this.#release(registration);
				const state = await this.#queue.wait(ctx, ref);
				if (state === 'terminal') return await this.#result(ctx, ref, activity);
				continue;
			}

			let claim = claims[0]!;
			const attemptCtx = this.#attemptContext(ctx, activity, claim);
			const attempt = this.#attempt(job, claim, registration, attemptCtx);
			let renewal = Promise.resolve();
			const control: ActivityAttemptControl = Object.freeze({
				heartbeat: async () => {
					context.check(attemptCtx);
					// Serialize renewals so an older renewal response cannot replace a
					// newer claim token inside this attempt.
					renewal = renewal.then(async () => {
						claim = await this.#queue.renew(this.#control, claim, this.#claimDuration);
					});
					await renewal;
				},
			});

			const cancel = (): void => {
				try {
					void registration.provider.cancel?.(attempt, attemptCtx.signal.reason);
				} catch {
					// Cancellation delivery is best effort. The queue claim and context
					// remain authoritative even when provider cancellation itself faults.
				}
			};
			attemptCtx.signal.addEventListener('abort', cancel, { once: true });

			let result: ActivityAttemptResultType;
			try {
				result = await registration.provider.run(attemptCtx, attempt, control);
			} catch (error) {
				result = Object.freeze({ type: 'fault', fault: error });
			} finally {
				attemptCtx.signal.removeEventListener('abort', cancel);
			}

			try {
				await renewal;
				if (attemptCtx.signal.aborted) {
					await this.#queue.cancel(this.#control, claim, attemptCtx.signal.reason);
					return Object.freeze({ type: 'cancelled', reason: attemptCtx.signal.reason });
				}
				if (!this.#owns(registration)) {
					result = Object.freeze({ type: 'lost', reason: new Error('Engine registration generation changed before completion.') });
				}

				if (result.type === 'success') {
					const value = await schema.parse(activity.result, result.value);
					const persisted = Object.freeze({ type: 'success', value: jobValue(value, 'activity result') }) satisfies ActivityJobResultType;
					await this.#queue.complete(this.#control, claim, persisted);
					return Object.freeze({ type: 'success', value });
				}
				if (result.type === 'failure') {
					if (!declaredFailure(activity, result.failure)) {
						result = Object.freeze({ type: 'fault', fault: new TypeError(`Activity ${JSON.stringify(activity.id)} returned an undeclared failure.`) });
					} else if (this.#retryFailure(activity, result.failure, claim.attempt)) {
						await this.#queue.retry(this.#control, claim, { delay: this.#delay(activity, claim.attempt, ref.id) });
						continue;
					} else {
						const encoded = await failures.encode(result.failure);
						const persisted = Object.freeze({ type: 'failure', failure: storedFailure(encoded) }) satisfies ActivityJobResultType;
						await this.#queue.complete(this.#control, claim, persisted);
						return result;
					}
				}
				if (result.type === 'cancelled') {
					await this.#queue.cancel(this.#control, claim, result.reason);
					return result;
				}
				if (this.#retryFault(activity, claim.attempt)) {
					await this.#queue.retry(this.#control, claim, { delay: this.#delay(activity, claim.attempt, ref.id) });
					continue;
				}
				const details = encodeFault(result.type === 'lost' ? result.reason : result.fault);
				const persisted = Object.freeze({ type: 'fault', fault: jobValue(details, 'activity fault') }) satisfies ActivityJobResultType;
				await this.#queue.complete(this.#control, claim, persisted);
				return Object.freeze({ type: 'fault', fault: details });
			} finally {
				await attemptCtx[Symbol.asyncDispose]();
				this.#release(registration);
			}
		}
	}

	/** Decode one persisted terminal job result through the replayed exact activity definition. */
	async #result(
		ctx: WorkflowContext,
		ref: queue.QueueRef,
		activity: ActivityReference,
	): Promise<ActivityAttemptResultType> {
		try {
			const result = await this.#queue.result(ctx, ref);
			if (result.type === 'failure') {
				return Object.freeze({ type: 'failure', failure: await failures.decode(result.failure, activity.failures) });
			}
			if (result.type === 'success') return Object.freeze({ type: 'success', value: jobValueOutput(result.value) });
			if (result.type === 'fault') return Object.freeze({ type: 'fault', fault: jobValueOutput(result.fault) });
			return Object.freeze({ type: 'cancelled', reason: jobValueOutput(result.reason) });
		} catch (error) {
			if (error instanceof queue.QueueItemCancelledError) {
				return Object.freeze({ type: 'cancelled', reason: encodeFault(error.reason) });
			}
			throw error;
		}
	}

	/** Stop placement, invalidate registrations, and release Scheduler-owned queue state. */
	close(reason?: unknown): Promise<void> {
		if (this.#closePromise !== undefined) return this.#closePromise;
		this.#closed = true;
		this.#closeReason = reason;
		this.#wake(reason ?? new SchedulerClosedError(reason));
		this.#closePromise = (async () => {
			try {
				const registrations = [...this.#registrations.values()];
				for (const registration of registrations) await this.#closeRegistration(registration);
				if (this.#disposeQueue) await this.#queue.close(reason);
			} finally {
				await this.#control[Symbol.asyncDispose]();
			}
		})();
		return this.#closePromise;
	}

	/** Dispose this coordinator by running the same idempotent shutdown path as `close()`. */
	[Symbol.asyncDispose](): Promise<void> {
		return this.close();
	}

	/** Create one public handle backed by private mutable registration state. */
	#handle(state: RegistrationState): EngineRegistration {
		const owner = this;
		return Object.freeze({
			get id() { return state.id; },
			get engine() { return state.engine; },
			get hostId() { return state.hostId; },
			get generation() { return state.generation; },
			get protocolVersion() { return state.protocolVersion; },
			get affinity() { return state.affinity; },
			get activities() { return state.activities; },
			get capacity() { return capacity(state); },
			get leaseUntil() { return state.leaseUntil; },
			get draining() { return state.draining || state.closed; },
			/** Extend this exact registration lease without replacing its host generation. */
			renew(duration: Temporal.Duration | Temporal.DurationLike | string) {
				owner.#assertRegistration(state);
				state.leaseUntil = owner.#clock.now().add(Temporal.Duration.from(duration));
				owner.#wake();
			},
			/** Change this registration's future admission capacity. */
			resize(maximum: number) {
				owner.#assertRegistration(state);
				assertPositive(maximum, 'engine capacity');
				state.maximum = maximum;
				owner.#wake();
			},
			/** Stop new placement and wait until this registration has no active attempts. */
			async drain() {
				owner.#assertRegistration(state);
				state.draining = true;
				owner.#wake();
				if (state.active === 0) return;
				await new Promise<void>((resolve) => state.drained.add(resolve));
			},
			/** Close only this registration and fence its generation from future completion. */
			async [Symbol.asyncDispose]() {
				await owner.#closeRegistration(state);
			},
		});
	}

	/** Select and reserve one compatible registration, waiting under caller cancellation when all are busy. */
	async #takeRegistration(ctx: WorkflowContext, activity: ActivityReference, affinity: EngineAffinityType | undefined): Promise<RegistrationState> {
		while (true) {
			this.#assertOpen();
			context.check(ctx);
			const selected = this.#select(activity, affinity);
			if (selected !== undefined) {
				selected.active += 1;
				return selected;
			}
			await this.#wait(ctx);
		}
	}

	/** Pick a deterministic compatible registration without mutating capacity. */
	#select(activity: ActivityReference, affinity: EngineAffinityType | undefined): RegistrationState | undefined {
		const now = this.#clock.now();
		for (const choice of activity.placement.choices) {
			const candidates = [...this.#registrations.values()]
				.filter((state) => state.engine === choice.engine)
				.filter((state) => this.#live(state, now))
				.filter((state) => state.activities.includes(activity))
				.filter((state) => affinityMatches(affinity, state.affinity))
				.filter((state) => state.active < state.maximum)
				.sort((left, right) => left.order - right.order);
			if (candidates.length > 0) return candidates[0];
			if (choice.mode === 'required') return undefined;
		}
		return undefined;
	}

	/** Build a child attempt context with the activity timeout bounded by its workflow parent deadline. */
	#attemptContext(
		ctx: WorkflowContext,
		activity: ActivityReference,
		claim: queue.QueueClaim<ActivityJobType>,
	): import('@okikio/context').Owned {
		const timeout = activity.resilience.find((entry): entry is TimeoutPolicy => entry.type === 'timeout');
		const deadline = timeout === undefined ? undefined : this.#clock.now().add(timeout.duration);
		return context.child(ctx, {
			id: `${claim.itemId}:attempt:${claim.attempt}`,
			...(deadline === undefined ? {} : { deadline }),
		});
	}

	/** Create the serializable fenced attempt sent to one registered provider. */
	#attempt(
		job: ActivityJobType,
		claim: queue.QueueClaim<ActivityJobType>,
		registration: RegistrationState,
		ctx: import('@okikio/context').Context,
	): ActivityAttemptType {
		return Object.freeze({
			jobId: claim.itemId,
			attempt: claim.attempt,
			claimId: claim.id,
			activityId: job.activityId,
			activityVersion: job.activityVersion,
			engineId: registration.engine.id,
			registrationId: registration.id,
			hostId: registration.hostId,
			generation: registration.generation,
			origin: job.origin,
			context: context.snapshot(ctx),
			input: job.input,
			admitted: true,
		});
	}

	/** Return whether a late provider result still belongs to the live host generation. */
	#owns(state: RegistrationState): boolean {
		return !state.closed && this.#current.get(state.key) === state && this.#live(state, this.#clock.now());
	}

	/** Return whether this registration can still receive or complete work. */
	#live(state: RegistrationState, now: Temporal.Instant): boolean {
		if (state.closed || state.draining) return false;
		if (state.leaseUntil !== undefined && Temporal.Instant.compare(now, state.leaseUntil) >= 0) {
			state.draining = true;
			this.#settleDrained(state);
			return false;
		}
		return this.#current.get(state.key) === state;
	}

	/** Release one locally reserved provider slot and wake blocked placement. */
	#release(state: RegistrationState): void {
		state.active = Math.max(0, state.active - 1);
		this.#settleDrained(state);
		this.#wake();
	}

	/** Resolve drain waiters only after no attempt remains attached to the registration. */
	#settleDrained(state: RegistrationState): void {
		if (state.active !== 0 || (!state.draining && !state.closed)) return;
		for (const resolve of state.drained) resolve();
		state.drained.clear();
	}

	/** Close one registration once, stop placement, and optionally dispose its provider. */
	async #closeRegistration(state: RegistrationState): Promise<void> {
		if (state.closed) return;
		state.draining = true;
		this.#wake();
		if (state.active !== 0) await new Promise<void>((resolve) => state.drained.add(resolve));
		state.closed = true;
		this.#registrations.delete(state.id);
		if (this.#current.get(state.key) === state) this.#current.delete(state.key);
		this.#settleDrained(state);
		this.#wake();
		if (state.disposeProvider) await state.provider.dispose?.();
	}

	/** Wait for registration/capacity state to change under the caller's cancellation lifetime. */
	#wait(ctx: import('@okikio/context').Context): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (ctx.signal.aborted) {
				reject(ctx.signal.reason);
				return;
			}
			let settled = false;
			const finish = (error?: unknown): void => {
				if (settled) return;
				settled = true;
				waiter.unlink();
				this.#waiters.delete(waiter);
				if (error === undefined) resolve();
				else reject(error);
			};
			const abort = (): void => finish(ctx.signal.reason);
			const waiter: PlacementWaiter = {
				resolve: () => finish(),
				reject: (reason) => finish(reason),
				unlink: () => ctx.signal.removeEventListener('abort', abort),
			};
			ctx.signal.addEventListener('abort', abort, { once: true });
			this.#waiters.add(waiter);
		});
	}

	/** Wake every placement waiter after a registration, capacity, or close transition. */
	#wake(reason?: unknown): void {
		for (const waiter of [...this.#waiters]) {
			if (reason === undefined) waiter.resolve();
			else waiter.reject(reason);
		}
	}

	/** Determine whether an unexpected provider result can create another queue attempt. */
	#retryFault(activity: ActivityReference, attempt: number): boolean {
		const retry = retryPolicy(activity.resilience);
		return retry !== undefined && attempt < retry.maximumAttempts;
	}

	/** Determine whether an expected failure id is explicitly retryable. */
	#retryFailure(activity: ActivityReference, failure: unknown, attempt: number): boolean {
		const retry = retryPolicy(activity.resilience);
		if (retry === undefined || attempt >= retry.maximumAttempts || retry.retryOn === undefined) return false;
		const id = failureId(failure);
		return id !== undefined && retry.retryOn.includes(id);
	}

	/** Compute deterministic retry delay for the next queue claim. */
	#delay(activity: ActivityReference, failedAttempt: number, seed: string): Temporal.Duration {
		const retry = retryPolicy(activity.resilience);
		if (retry === undefined) return Temporal.Duration.from({ milliseconds: 0 });
		return retryDelay(
			retry,
			failedAttempt,
			retry.jitter ? { jitter: deterministicUnit(`${seed}:${failedAttempt}`) } : undefined,
		);
	}

	/** Reject operations after Scheduler shutdown begins. */
	#assertOpen(): void {
		if (this.#closed) throw new SchedulerClosedError(this.#closeReason);
	}

	/** Reject mutation through an expired, replaced, or closed registration handle. */
	#assertRegistration(state: RegistrationState): void {
		this.#assertOpen();
		if (state.closed || this.#registrations.get(state.id) !== state) throw new SchedulerClosedError('Engine registration is closed.');
	}
}

/** Create the process-local queue and activity coordinator used by `workflow.scheduler()`. */
export function createActivityJobs(options: SchedulerOptions, clock: import('@okikio/context').Clock): ActivityJobs {
	const id = options.id ?? 'workflow-scheduler';
	assertId(id, 'Scheduler');
	const activityQueue = options.activityQueue ?? queue.memory<ActivityJobType, ActivityJobResultType>({
		capacity: options.activityCapacity ?? 10_000,
		clock,
		defaultClaimDuration: options.claimDuration ?? { seconds: 45 },
	});
	return new ActivityJobs({
		id,
		clock,
		queue: activityQueue,
		claimDuration: Temporal.Duration.from(options.claimDuration ?? { seconds: 45 }),
		disposeQueue: options.activityQueue === undefined || options.disposeActivityQueue === true,
	});
}

/** Return an immutable capacity snapshot for one registration. */
function capacity(state: RegistrationState): import('./types.ts').EngineCapacityType {
	return Object.freeze({
		maximum: state.maximum,
		active: state.active,
		available: Math.max(0, state.maximum - state.active),
	});
}

/** Return the activity retry policy when exactly one was compiled. */
function retryPolicy(input: readonly import('@okikio/resilience').ResiliencePolicy[]): RetryPolicy | undefined {
	return input.find((entry): entry is RetryPolicy => entry.type === 'retry');
}

/** Extract one expected-failure identity without depending on an activity implementation package. */
function failureId(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const direct = (value as { readonly id?: unknown }).id;
	if (typeof direct === 'string') return direct;
	const definition = (value as { readonly definition?: { readonly id?: unknown } }).definition;
	return typeof definition?.id === 'string' ? definition.id : undefined;
}

/** Return whether one provider failure is an occurrence from the exact activity contract. */
function declaredFailure(activity: ActivityReference, value: unknown): value is failures.Occurrence {
	return failures.isOccurrence(value) && activity.failures.includes(value.definition);
}

/** Validate one encoded failure as JSON-safe data before it enters a durable job store. */
function storedFailure(value: failures.Encoded): import('./types.ts').HistoryFailureOccurrenceType {
	return Object.freeze({
		id: value.id,
		data: durable.snapshot(value.data, 'activity failure data'),
		message: value.message,
	});
}

/** Encode an explicit undefined result while keeping every other activity value JSON-safe. */
function jobValue(value: unknown, label: string): import('./types.ts').HistoryValueType {
	if (value === undefined) return Object.freeze({ kind: 'undefined' });
	return Object.freeze({ kind: 'value', value: durable.snapshot(value, label) });
}

/** Restore the explicit undefined marker retained by the activity job store. */
function jobValueOutput(value: import('./types.ts').HistoryValueType): unknown {
	return value.kind === 'undefined' ? undefined : value.value;
}

/** Convert an unexpected runtime reason to bounded JSON-safe diagnostic data. */
function encodeFault(value: unknown): faultCore.FaultValue {
	return faultCore.encode(value);
}

/** Deterministic pseudo-random unit interval used for replay-stable retry jitter. */
function deterministicUnit(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0xffff_ffff;
}

/** Return the stable host-generation key for one engine registration. */
function registrationKey(engine: EngineReference, hostId: string): string {
	return `${engine.id}\u0000${hostId}`;
}

/** Reject malformed engine identity before it enters live registration state. */
function assertEngine(value: EngineReference): void {
	if (typeof value !== 'object' || value === null || value.kind !== 'activity-engine') {
		throw new TypeError('Scheduler registration requires an activity-engine definition.');
	}
	assertId(value.id, 'activity engine');
}

/** Reject malformed stable ids used in live registration and Scheduler state. */
function assertId(value: string, label: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) throw new TypeError(`Invalid ${label} id ${JSON.stringify(value)}.`);
}

/** Reject invalid bounded registration capacity. */
function assertPositive(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
}

/** Capture provider behavior without invoking accessors or retaining mutable advertised metadata. */
function normalizeProvider(provider: EngineRegistrationOptions['provider'], disposeProvider: boolean): ProviderRuntime {
	if (typeof provider !== 'object' || provider === null) throw new TypeError('Engine provider must be an object.');
	const activities = snapshotActivities(dataProperty(provider, 'activities', 'Engine provider activities'));
	const run = methodProperty<EngineProvider['run']>(provider, 'run', 'Engine provider run');
	const cancel = optionalMethodProperty<NonNullable<EngineProvider['cancel']>>(provider, 'cancel', 'Engine provider cancel');
	const dispose = disposeProvider ? providerDisposer(provider) : undefined;
	return Object.freeze({
		activities,
		run: (ctx, attempt, control) => run.call(provider, ctx, attempt, control) as Promise<ActivityAttemptResultType>,
		...(cancel === undefined ? {} : { cancel: (attempt, reason) => cancel.call(provider, attempt, reason) as void | Promise<void> }),
		...(dispose === undefined ? {} : { dispose }),
	} satisfies ProviderRuntime);
}

/** Snapshot the provider's advertised activity membership without executing array accessors. */
function snapshotActivities(value: unknown): readonly ActivityReference[] {
	if (!Array.isArray(value) || value.length === 0) throw new TypeError('Engine provider must advertise at least one activity definition.');
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const activities: ActivityReference[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined || !('value' in descriptor)) {
			throw new TypeError('Engine provider activities must be a dense data array without accessors.');
		}
		const activity = descriptor.value;
		if (typeof activity !== 'object' || activity === null || (activity as { readonly kind?: unknown }).kind !== 'activity') {
			throw new TypeError(`Engine provider activity at index ${index} must be an activity definition.`);
		}
		activities.push(activity as ActivityReference);
	}
	return Object.freeze(activities);
}

/** Read one data property through the provider's prototype chain without executing getters. */
function dataProperty(value: object, key: PropertyKey, name: string): unknown {
	for (let current: object | null = value; current !== null; current = Object.getPrototypeOf(current)) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor === undefined) continue;
		if (!('value' in descriptor)) throw new TypeError(`${name} must be a data property, not an accessor.`);
		return descriptor.value;
	}
	return undefined;
}

/** Read one required provider method without executing accessors. */
function methodProperty<Method extends (...args: never[]) => unknown>(value: object, key: PropertyKey, name: string): Method {
	const method = dataProperty(value, key, name);
	if (typeof method !== 'function') throw new TypeError(`${name} must be a function.`);
	// The descriptor check proves the runtime value is callable. The generic type
	// reconnects that proven callable to the provider contract selected by the caller.
	return method as Method;
}

/** Read one optional provider method without executing accessors. */
function optionalMethodProperty<Method extends (...args: never[]) => unknown>(
	value: object,
	key: PropertyKey,
	name: string,
): Method | undefined {
	const method = dataProperty(value, key, name);
	if (method === undefined) return undefined;
	if (typeof method !== 'function') throw new TypeError(`${name} must be a function when provided.`);
	// See methodProperty(): this assertion is localized after the same callable proof.
	return method as Method;
}

/** Capture provider disposal at registration time so later mutation cannot change ownership cleanup. */
function providerDisposer(provider: object): (() => void | Promise<void>) | undefined {
	const asyncDispose = optionalMethodProperty<() => void | PromiseLike<void>>(provider, Symbol.asyncDispose, 'Engine provider async disposal');
	if (asyncDispose !== undefined) return () => asyncDispose.call(provider) as Promise<void> | void;
	const dispose = optionalMethodProperty<() => void>(provider, Symbol.dispose, 'Engine provider disposal');
	return dispose === undefined ? undefined : () => dispose.call(provider) as void;
}
