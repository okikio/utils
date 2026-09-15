/**
 * Activity item admission and independently hosted executor lifecycles.
 *
 * The Scheduler admits durable items and waits for terminal results. Executors
 * claim matching items through the shared dispatch owner, so execution does not
 * depend on a provider callback retained by the Scheduler process.
 *
 * @module
 */
import * as context from '@okikio/context';
import * as failures from '@okikio/failure';
import * as faultCore from '@okikio/fault';
import * as record from '@okikio/record';
import * as schema from '@okikio/schema';
import { retryDelay, type RetryPolicy, type TimeoutPolicy } from '@okikio/resilience';
import { freeze as freezeAffinity } from './affinity.ts';
import * as assert from './assert.ts';
import * as compute from './compute.ts';
import * as dispatch from './dispatch.ts';
import * as durable from './durable.ts';
import * as retry from './retry.ts';
import type {
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
	ActivityClaimType,
	ActivityCommand,
	ActivityDispatch,
	ActivityJobResultType,
	ActivityJobType,
	ActivityReference,
	EngineProvider,
	EngineRegistration,
	EngineRegistrationOptions,
	ExecutorLeaseType,
	ExecutorOptions,
	HistoryFailureOccurrenceType,
	SchedulerOptions,
	WorkflowContext,
} from './types.ts';

/** Raised when a caller uses a Scheduler after its owned lifetime has ended. */
export class SchedulerClosedError extends Error {
	/** Original Scheduler shutdown reason. */
	readonly reason: unknown;

	/** Create one lifecycle error for work submitted after Scheduler shutdown. */
	constructor(reason?: unknown) {
		super('The workflow Scheduler is closed.', reason === undefined ? undefined : { cause: reason });
		this.name = 'SchedulerClosedError';
		this.reason = reason;
	}
}

/** Live provider behavior captured once for one executor generation. */
interface ProviderRuntime {
	readonly activities: readonly ActivityReference[];
	readonly run: EngineProvider['run'];
	readonly cancel?: NonNullable<EngineProvider['cancel']>;
	readonly dispose?: () => void | Promise<void>;
}

/** Inputs used by the Scheduler-owned activity admission facade. */
export interface ActivityJobsOptions {
	readonly id: string;
	readonly clock: context.Clock;
	readonly dispatch: ActivityDispatch;
	readonly claimDuration: Temporal.Duration;
	readonly disposeDispatch: boolean;
}

/** Scheduler-side activity item admission and terminal result lookup. */
export class ActivityJobs implements AsyncDisposable {
	readonly #control: context.Owned;
	readonly #dispatch: ActivityDispatch;
	readonly #claimDuration: Temporal.Duration;
	readonly #disposeDispatch: boolean;
	readonly #executors = new Set<EngineRegistration>();
	#closed = false;
	#reason: unknown;
	#closePromise: Promise<void> | undefined;

	constructor(options: ActivityJobsOptions) {
		this.#control = context.create({ id: `${options.id}:activity-jobs`, clock: options.clock });
		this.#dispatch = options.dispatch;
		this.#claimDuration = options.claimDuration;
		this.#disposeDispatch = options.disposeDispatch;
	}

	/** Start one attached executor through the same dispatch path as an independent host. */
	async register(options: EngineRegistrationOptions): Promise<EngineRegistration> {
		this.#assertOpen();
		record.assert(options, 'engine registration options');
		const registration = await executor({
			...options,
			dispatch: this.#dispatch,
			ctx: this.#control,
			claimDuration: this.#claimDuration,
		});
		this.#executors.add(registration);
		return registration;
	}

	/** Admit one logical activity item and wait for its authoritative stored result. */
	async run(
		ctx: WorkflowContext,
		command: ActivityCommand,
		path: string,
		fingerprint: string,
	): Promise<ActivityAttemptResultType> {
		this.#assertOpen();
		const activity = command.activity;
		const item = Object.freeze({
			activityId: activity.id,
			activityVersion: activity.version,
			input: durable.snapshot(command.input, 'activity item input'),
			origin: Object.freeze({
				workflowId: ctx.workflow.id,
				workflowVersion: ctx.version,
				runId: ctx.runId,
				instructionPath: path,
				instructionFingerprint: fingerprint,
			}),
			context: context.snapshot(ctx),
			...(command.options.affinity === undefined ? {} : {
				affinity: freezeAffinity(command.options.affinity, 'activity item affinity'),
			}),
			placement: Object.freeze(activity.placement.choices.map((choice) => Object.freeze({
				engine: choice.engine.id,
				mode: choice.mode,
			}))),
		} satisfies ActivityJobType);
		const ref = await this.#dispatch.add(ctx, item, { key: `${ctx.runId}:${fingerprint}` });
		try {
			return await decode(await this.#dispatch.result(ctx, ref), activity);
		} catch (error) {
			if (!context.cancelled(error) && !ctx.signal.aborted) throw error;
			const reason = durable.value(faultCore.encode(ctx.signal.aborted ? ctx.signal.reason : error), 'activity cancellation');
			await this.#dispatch.cancel(this.#control, ref, reason);
			return Object.freeze({ type: 'cancelled', reason: durable.restore(reason) });
		}
	}

	/** Stop attached executors and release Scheduler-owned dispatch state. */
	close(reason?: unknown): Promise<void> {
		if (this.#closePromise !== undefined) return this.#closePromise;
		this.#closed = true;
		this.#reason = reason;
		this.#closePromise = (async () => {
			const errors: unknown[] = [];
			for (const executor of [...this.#executors]) {
				try { await executor[Symbol.asyncDispose](); }
				catch (error) { errors.push(error); }
			}
			this.#executors.clear();
			if (this.#disposeDispatch) {
				try { await this.#dispatch.close(reason); }
				catch (error) { errors.push(error); }
			}
			await this.#control[Symbol.asyncDispose]();
			if (errors.length > 0) throw new AggregateError(errors, 'Activity job shutdown failed.');
		})();
		return this.#closePromise;
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.close();
	}

	#assertOpen(): void {
		if (this.#closed) throw new SchedulerClosedError(this.#reason);
	}
}

/**
 * Start an activity executor that can run independently from a Scheduler.
 *
 * The executor compiles live provider behavior in its own host, advertises only
 * serializable capabilities to dispatch storage, and claims no more than its
 * registered capacity.
 */
export async function executor(options: ExecutorOptions): Promise<EngineRegistration> {
	const runtime = new ExecutorRuntime(options);
	await runtime.open();
	return runtime.registration;
}

/** Runtime owner for one executor generation and its active activity attempts. */
class ExecutorRuntime {
	readonly #dispatch: ActivityDispatch;
	readonly #engine: EngineRegistrationOptions['engine'];
	readonly #provider: ProviderRuntime;
	readonly #hostId: string;
	readonly #affinity: EngineRegistrationOptions['affinity'];
	readonly #compute: EngineRegistrationOptions['compute'];
	readonly #protocolVersion: number;
	readonly #disposeProvider: boolean;
	readonly #claimDuration: Temporal.Duration;
	readonly #registrationDuration: Temporal.Duration;
	readonly #control: context.Owned;
	readonly #claimCtx: context.Owned;
	readonly #active = new Set<Promise<void>>();
	readonly #registration: EngineRegistration;
	#lease: ExecutorLeaseType | undefined;
	#capacity: number;
	#draining = false;
	#closed = false;
	#loop: Promise<void> | undefined;
	#renewal: ReturnType<typeof setInterval> | undefined;
	#fault: unknown;

	constructor(options: ExecutorOptions) {
		record.assert(options, 'executor options');
		assertEngine(options.engine);
		assert.id(options.hostId, 'executor host');
		this.#dispatch = options.dispatch;
		this.#engine = options.engine;
		this.#provider = normalizeProvider(options.provider, options.disposeProvider ?? false);
		this.#hostId = options.hostId;
		this.#capacity = assert.positive(options.capacity ?? 1, 'executor capacity');
		this.#affinity = options.affinity === undefined ? undefined : freezeAffinity(options.affinity, 'executor affinity');
		this.#compute = options.compute === undefined ? undefined : compute.freeze(options.compute);
		this.#protocolVersion = assert.positive(options.protocolVersion ?? 1, 'executor protocolVersion');
		this.#disposeProvider = options.disposeProvider ?? false;
		this.#claimDuration = assert.duration(options.claimDuration ?? { seconds: 45 }, 'activity claim duration');
		this.#registrationDuration = assert.duration(options.lease ?? { seconds: 30 }, 'executor lease duration');
		this.#control = options.ctx === undefined
			? context.create({ id: `executor:${options.engine.id}:${options.hostId}` })
			: context.child(options.ctx, { id: `executor:${options.engine.id}:${options.hostId}` });
		this.#claimCtx = context.child(this.#control, { id: `${this.#control.id}:claims` });
		const owner = this;
		this.#registration = Object.freeze({
			get id() { return owner.#requiredLease().id; },
			get engine() { return owner.#engine; },
			get hostId() { return owner.#hostId; },
			get generation() { return owner.#requiredLease().generation; },
			get protocolVersion() { return owner.#protocolVersion; },
			get affinity() { return owner.#affinity; },
			get compute() { return owner.#compute; },
			get activities() { return owner.#provider.activities; },
			get capacity() {
				return Object.freeze({
					maximum: owner.#capacity,
					active: owner.#active.size,
					available: Math.max(0, owner.#capacity - owner.#active.size),
				});
			},
			get leaseUntil() { return owner.#requiredLease().expiresAt; },
			get draining() { return owner.#draining || owner.#closed; },
			renew: (duration) => owner.#renewExecutor(duration),
			resize: (capacity) => owner.#resize(capacity),
			drain: () => owner.#drain(),
			[Symbol.asyncDispose]: () => owner.#close(),
		} satisfies EngineRegistration);
	}

	get registration(): EngineRegistration {
		return this.#registration;
	}

	async open(): Promise<void> {
		this.#lease = await this.#dispatch.join(this.#control, {
			engineId: this.#engine.id,
			hostId: this.#hostId,
			activities: Object.freeze(this.#provider.activities.map((activity) => Object.freeze({
				id: activity.id,
				version: activity.version,
			}))),
			capacity: this.#capacity,
			...(this.#affinity === undefined ? {} : { affinity: this.#affinity }),
			...(this.#compute === undefined ? {} : { compute: this.#compute }),
			protocolVersion: this.#protocolVersion,
			duration: this.#registrationDuration,
		});
		this.#renewal = setInterval(
			() => void this.#renewLease(),
			Math.max(1, Math.floor(milliseconds(this.#registrationDuration) / 3)),
		);
		this.#loop = this.#serve();
	}

	async #serve(): Promise<void> {
		try {
			while (!this.#draining && !this.#claimCtx.signal.aborted) {
				if (this.#active.size >= this.#capacity) {
					await Promise.race(this.#active);
					continue;
				}
				const claims = await this.#dispatch.claim(this.#claimCtx, this.#requiredLease(), {
					limit: this.#capacity - this.#active.size,
					duration: this.#claimDuration,
					wait: true,
				});
				for (const claim of claims) {
					let running!: Promise<void>;
					running = this.#run(claim).finally(() => this.#active.delete(running));
					this.#active.add(running);
				}
			}
		} catch (error) {
			if (
				!this.#claimCtx.signal.aborted &&
				!(error instanceof dispatch.StaleExecutorError) &&
				!(error instanceof dispatch.DispatchClosedError)
			) {
				this.#fault = error;
				context.cancel(this.#control, error);
			}
		}
	}

	async #run(initial: ActivityClaimType): Promise<void> {
		let claim = initial;
		const activity = this.#provider.activities.find((candidate) =>
			candidate.id === claim.value.activityId && candidate.version === claim.value.activityVersion
		);
		if (activity === undefined) {
			await this.#commit(claim, Object.freeze({
				type: 'fault',
				fault: durable.value(
					faultCore.encode(new Error(`Executor cannot resolve activity ${JSON.stringify(`${claim.value.activityId}@${claim.value.activityVersion}`)}.`)),
					'activity fault',
				),
			}));
			return;
		}

		await using restored = context.restore(claim.value.context, { signal: this.#control.signal, clock: this.#control.clock });
		const timeout = activity.resilience.find((entry): entry is TimeoutPolicy => entry.type === 'timeout');
		const deadline = timeout === undefined ? undefined : this.#control.clock.now().add(timeout.duration);
		await using attemptCtx = context.child(restored, {
			id: `${claim.itemId}:attempt:${claim.attempt}`,
			...(deadline === undefined ? {} : { deadline }),
		});
		const attempt = this.#attempt(claim, attemptCtx);
		let renewal = Promise.resolve();
		const control = Object.freeze({
			heartbeat: async () => {
				context.check(attemptCtx);
				renewal = renewal.then(async () => {
					claim = await this.#dispatch.renew(this.#control, claim, this.#claimDuration);
				});
				await renewal;
			},
		} satisfies ActivityAttemptControl);
		const cancel = (): void => {
			try { void this.#provider.cancel?.(attempt, attemptCtx.signal.reason); }
			catch { /* The attempt lease remains authoritative. */ }
		};
		attemptCtx.signal.addEventListener('abort', cancel, { once: true });

		const provider = this.#provider.run(attemptCtx, attempt, control)
			.catch((error): ActivityAttemptResultType => Object.freeze({ type: 'fault', fault: error }));
		const watchCtx = context.child(this.#control, { id: `${claim.id}:watch` });
		const settled = await Promise.race([
			provider.then((result) => Object.freeze({ type: 'result' as const, result })),
			this.#dispatch.watch(watchCtx, claim).then((state) => Object.freeze({ type: 'state' as const, state })),
		]);
		if (settled.type === 'state') {
			context.cancel(attemptCtx, new context.ContextCancelledError(`Activity attempt ${settled.state}.`));
			attemptCtx.signal.removeEventListener('abort', cancel);
			await watchCtx[Symbol.asyncDispose]();
			// Dispatch already fenced this claim. Do not let an uncooperative provider
			// consume this executor's capacity after another host can recover the item.
			return;
		}
		const result = settled.result;
		attemptCtx.signal.removeEventListener('abort', cancel);
		await watchCtx[Symbol.asyncDispose]();

		try {
			await renewal;
			if (result.type === 'success') {
				try {
					const value = await schema.parse(activity.result, result.value);
					await this.#commit(claim, Object.freeze({ type: 'success', value: durable.value(value, 'activity result') }));
				} catch (error) {
					if (retryFault(activity, claim.attempt)) {
						await this.#dispatch.retry(this.#control, claim, { delay: delay(activity, claim.attempt, claim.itemId) });
					} else {
						await this.#commit(claim, Object.freeze({ type: 'fault', fault: durable.value(faultCore.encode(error), 'activity fault') }));
					}
				}
				return;
			}
			if (result.type === 'failure' && declaredFailure(activity, result.failure)) {
				if (retryFailure(activity, result.failure, claim.attempt)) {
					await this.#dispatch.retry(this.#control, claim, { delay: delay(activity, claim.attempt, claim.itemId) });
					return;
				}
				const encoded = await failures.encode(result.failure);
				await this.#commit(claim, Object.freeze({ type: 'failure', failure: storedFailure(encoded) }));
				return;
			}
			if (result.type === 'cancelled') {
				await this.#commit(claim, Object.freeze({
					type: 'cancelled',
					reason: durable.value(faultCore.encode(result.reason), 'activity cancellation'),
				}));
				return;
			}
			if (retryFault(activity, claim.attempt)) {
				await this.#dispatch.retry(this.#control, claim, { delay: delay(activity, claim.attempt, claim.itemId) });
				return;
			}
			const reason = result.type === 'failure'
				? new TypeError(`Activity ${JSON.stringify(activity.id)} returned an undeclared failure.`)
				: result.type === 'lost' ? result.reason : result.fault;
			await this.#commit(claim, Object.freeze({ type: 'fault', fault: durable.value(faultCore.encode(reason), 'activity fault') }));
		} catch (error) {
			if (!(error instanceof dispatch.StaleActivityClaimError) && !(error instanceof dispatch.StaleExecutorError)) throw error;
		}
	}

	#attempt(claim: ActivityClaimType, ctx: context.Context): ActivityAttemptType {
		const lease = this.#requiredLease();
		return Object.freeze({
			jobId: claim.itemId,
			attempt: claim.attempt,
			claimId: claim.id,
			activityId: claim.value.activityId,
			activityVersion: claim.value.activityVersion,
			engineId: lease.engineId,
			registrationId: lease.id,
			hostId: lease.hostId,
			generation: lease.generation,
			origin: claim.value.origin,
			context: context.snapshot(ctx),
			input: claim.value.input,
			admitted: true,
		});
	}

	async #commit(claim: ActivityClaimType, result: ActivityJobResultType): Promise<void> {
		await this.#dispatch.complete(this.#control, claim, result);
	}

	async #renewLease(): Promise<void> {
		if (this.#closed || this.#draining || this.#lease === undefined) return;
		try { this.#lease = await this.#dispatch.renewExecutor(this.#control, this.#lease, this.#registrationDuration); }
		catch (error) {
			if (!(error instanceof dispatch.StaleExecutorError) && !(error instanceof dispatch.DispatchClosedError)) this.#fault = error;
			this.#draining = true;
			context.cancel(this.#control, error);
		}
	}

	async #renewExecutor(duration: Temporal.Duration | Temporal.DurationLike | string): Promise<void> {
		this.#lease = await this.#dispatch.renewExecutor(this.#control, this.#requiredLease(), duration);
	}

	async #resize(capacity: number): Promise<void> {
		this.#capacity = assert.positive(capacity, 'executor capacity');
		this.#lease = await this.#dispatch.resize(this.#control, this.#requiredLease(), capacity);
	}

	async #drain(): Promise<void> {
		if (this.#draining) {
			await Promise.allSettled([...this.#active]);
			return;
		}
		this.#draining = true;
		await this.#claimCtx[Symbol.asyncDispose]();
		await this.#loop;
		await this.#dispatch.drain(this.#control, this.#requiredLease());
		await Promise.all([...this.#active]);
	}

	async #close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		if (this.#renewal !== undefined) clearInterval(this.#renewal);
		const errors: unknown[] = [];
		try { await this.#drain(); }
		catch (error) {
			if (!(error instanceof dispatch.StaleExecutorError) && !(error instanceof dispatch.DispatchClosedError)) errors.push(error);
		}
		try { await this.#dispatch.leave(this.#control, this.#requiredLease()); }
		catch (error) {
			if (!(error instanceof dispatch.StaleExecutorError) && !(error instanceof dispatch.DispatchClosedError)) errors.push(error);
		}
		if (this.#disposeProvider) {
			try { await this.#provider.dispose?.(); }
			catch (error) { errors.push(error); }
		}
		await this.#control[Symbol.asyncDispose]();
		if (this.#fault !== undefined) errors.push(this.#fault);
		if (errors.length > 0) throw new AggregateError(errors, 'Executor shutdown failed.');
	}

	#requiredLease(): ExecutorLeaseType {
		if (this.#lease === undefined) throw new Error('Executor has not joined activity dispatch.');
		return this.#lease;
	}
}

/** Create the dispatch and admission facade used by `workflow.scheduler()`. */
export function createActivityJobs(options: SchedulerOptions, clock: context.Clock): ActivityJobs {
	const id = options.id ?? 'workflow-scheduler';
	assert.id(id, 'Scheduler');
	const owner = options.activityDispatch ?? dispatch.memory({ capacity: options.activityCapacity ?? 10_000, clock });
	return new ActivityJobs({
		id,
		clock,
		dispatch: owner,
		claimDuration: assert.duration(options.claimDuration ?? { seconds: 45 }, 'activity claim duration'),
		disposeDispatch: options.activityDispatch === undefined || options.disposeActivityDispatch === true,
	});
}

/** Decode one stored terminal item result through the replayed activity definition. */
async function decode(result: ActivityJobResultType, activity: ActivityReference): Promise<ActivityAttemptResultType> {
	if (result.type === 'failure') {
		return Object.freeze({ type: 'failure', failure: await failures.decode(result.failure, activity.failures) });
	}
	if (result.type === 'success') return Object.freeze({ type: 'success', value: durable.restore(result.value) });
	if (result.type === 'fault') return Object.freeze({ type: 'fault', fault: durable.restore(result.fault) });
	return Object.freeze({ type: 'cancelled', reason: durable.restore(result.reason) });
}

/** Return the activity retry policy when exactly one was compiled. */
function retryPolicy(input: readonly import('@okikio/resilience').ResiliencePolicy[]): RetryPolicy | undefined {
	return input.find((entry): entry is RetryPolicy => entry.type === 'retry');
}

/** Determine whether an unexpected provider result can create another attempt. */
function retryFault(activity: ActivityReference, attempt: number): boolean {
	const retry = retryPolicy(activity.resilience);
	return retry !== undefined && attempt < retry.maximumAttempts;
}

/** Determine whether one expected failure identity is explicitly retryable. */
function retryFailure(activity: ActivityReference, value: unknown, attempt: number): boolean {
	const policy = retryPolicy(activity.resilience);
	if (policy === undefined || attempt >= policy.maximumAttempts) return false;
	const id = failureId(value);
	return id !== undefined && policy.retryOn?.includes(id) === true;
}

/** Compute deterministic retry timing from activity policy and stable item identity. */
function delay(activity: ActivityReference, failedAttempt: number, seed: string): Temporal.Duration {
	const policy = retryPolicy(activity.resilience);
	if (policy === undefined) return Temporal.Duration.from('PT0S');
	return retryDelay(policy, failedAttempt, policy.jitter ? { jitter: retry.unit(`${seed}:${failedAttempt}`) } : undefined);
}

/** Extract an expected-failure identity without importing an activity implementation package. */
function failureId(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const direct = (value as { readonly id?: unknown }).id;
	if (typeof direct === 'string') return direct;
	const definition = (value as { readonly definition?: { readonly id?: unknown } }).definition;
	return typeof definition?.id === 'string' ? definition.id : undefined;
}

/** Return whether one provider failure belongs to the exact activity contract. */
function declaredFailure(activity: ActivityReference, value: unknown): value is failures.Occurrence {
	return failures.isOccurrence(value) && activity.failures.includes(value.definition);
}

/** Validate one encoded failure before it enters activity dispatch storage. */
function storedFailure(value: failures.Encoded): HistoryFailureOccurrenceType {
	return Object.freeze({
		id: value.id,
		data: durable.snapshot(value.data, 'activity failure data'),
		message: value.message,
	});
}

/** Capture provider behavior without invoking accessors or retaining mutable metadata. */
function normalizeProvider(provider: EngineProvider, disposeProvider: boolean): ProviderRuntime {
	if (typeof provider !== 'object' || provider === null) throw new TypeError('Engine provider must be an object.');
	const activities = snapshotActivities(dataProperty(provider, 'activities', 'Engine provider activities'));
	const run = methodProperty<EngineProvider['run']>(provider, 'run', 'Engine provider run');
	const cancel = optionalMethodProperty<NonNullable<EngineProvider['cancel']>>(provider, 'cancel', 'Engine provider cancel');
	const dispose = disposeProvider ? providerDisposer(provider) : undefined;
	return Object.freeze({
		activities,
		run: (ctx, attempt, control) => run.call(provider, ctx, attempt, control),
		...(cancel === undefined ? {} : { cancel: (attempt, reason) => cancel.call(provider, attempt, reason) }),
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

/** Read one data property through the prototype chain without executing getters. */
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
	return method as Method;
}

/** Capture a provider's disposal method only when ownership transfers. */
function providerDisposer(provider: EngineProvider): (() => void | Promise<void>) | undefined {
	const asyncDispose = optionalMethodProperty<() => Promise<void>>(provider, Symbol.asyncDispose, 'Engine provider asyncDispose');
	if (asyncDispose !== undefined) return () => asyncDispose.call(provider);
	const dispose = optionalMethodProperty<() => void>(provider, Symbol.dispose, 'Engine provider dispose');
	return dispose === undefined ? undefined : () => dispose.call(provider);
}

/** Reject malformed engine identity before an executor joins dispatch. */
function assertEngine(value: EngineRegistrationOptions['engine']): void {
	if (typeof value !== 'object' || value === null || value.kind !== 'activity-engine') {
		throw new TypeError('Executor requires an activity-engine definition.');
	}
	assert.id(value.id, 'activity engine');
}

/** Convert a non-calendar lease duration to a host timer interval. */
function milliseconds(value: Temporal.Duration): number {
	if (value.years !== 0 || value.months !== 0 || value.weeks !== 0) {
		throw new TypeError('Executor lease duration cannot contain calendar units.');
	}
	return value.total({ unit: 'milliseconds' });
}
