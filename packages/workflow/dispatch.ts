/**
 * Durable activity dispatch contracts and the process-local reference store.
 *
 * A dispatch owner retains logical activity items, executor registrations,
 * temporary attempt leases, placement decisions, and terminal results. Workflow
 * schedulers and activity executors can therefore run in different hosts while
 * sharing one storage implementation.
 *
 * @module
 */
import * as context from '@okikio/context';
import * as record from '@okikio/record';
import { freeze as freezeAffinity, matches as affinityMatches } from './affinity.ts';
import * as assert from './assert.ts';
import * as compute from './compute.ts';
import * as durable from './durable.ts';
import type {
	ActivityAddOptions,
	ActivityClaimOptions,
	ActivityClaimType,
	ActivityDispatch,
	ActivityDispatchStatsType,
	ActivityJobResultType,
	ActivityJobType,
	ActivityRefType,
	ActivityRetryOptions,
	ExecutorJoinOptions,
	ExecutorLeaseType,
	HistoryValueType,
	MemoryDispatchOptions,
} from './types.ts';

export type {
	ActivityAddOptions,
	ActivityClaimOptions,
	ActivityClaimType,
	ActivityDispatch,
	ActivityDispatchStatsType,
	ActivityJobResultType,
	ActivityJobType,
	ActivityRefType,
	ActivityRetryOptions,
	ComputeType,
	EngineAffinityType,
	ExecutorActivityType,
	ExecutorJoinOptions,
	ExecutorLeaseType,
	HistoryFailureOccurrenceType,
	HistoryValueType,
	MemoryDispatchOptions,
} from './types.ts';

/** Raised after an activity dispatch owner has stopped permanently. */
export class DispatchClosedError extends Error {
	/** Original dispatch shutdown reason. */
	readonly reason: unknown;

	/** Create one lifecycle error for an operation attempted after dispatch shutdown. */
	constructor(reason?: unknown) {
		super('The activity dispatch owner is closed.', reason === undefined ? undefined : { cause: reason });
		this.name = 'DispatchClosedError';
		this.reason = reason;
	}
}

/** Raised when process-local dispatch reaches its configured active-item bound. */
export class DispatchCapacityError extends RangeError {
	/** Maximum active logical items configured for the dispatch owner. */
	readonly capacity: number;

	/** Create one capacity error before another active item is retained. */
	constructor(capacity: number) {
		super(`Activity dispatch reached its configured capacity of ${capacity} active items.`);
		this.name = 'DispatchCapacityError';
		this.capacity = capacity;
	}
}

/** Raised when an executor mutation uses a replaced, expired, or closed generation. */
export class StaleExecutorError extends Error {
	/** Replaced, expired, or closed executor registration identity. */
	readonly executorId: string;

	/** Create one stale-generation error for a rejected executor mutation. */
	constructor(executorId: string) {
		super(`Executor registration ${JSON.stringify(executorId)} no longer owns its generation.`);
		this.name = 'StaleExecutorError';
		this.executorId = executorId;
	}
}

/** Raised when a late activity attempt tries to mutate work owned by another claim. */
export class StaleActivityClaimError extends Error {
	/** Stable logical item identity targeted by the stale claim. */
	readonly itemId: string;
	/** Attempt claim identity that no longer owns the item. */
	readonly claimId: string;

	/** Create one ownership error for a rejected late attempt mutation. */
	constructor(itemId: string, claimId: string) {
		super(`Activity claim ${JSON.stringify(claimId)} no longer owns item ${JSON.stringify(itemId)}.`);
		this.name = 'StaleActivityClaimError';
		this.itemId = itemId;
		this.claimId = claimId;
	}
}

type ItemStatus = 'queued' | 'claimed' | 'completed' | 'cancelled';

/** Mutable state for one logical activity item. */
interface ItemState {
	readonly id: string;
	readonly key: string;
	readonly value: ActivityJobType;
	readonly order: number;
	state: ItemStatus;
	attempt: number;
	availableAt: Temporal.Instant;
	claim?: ActivityClaimType;
	result?: ActivityJobResultType;
}

/** Mutable state for one executor generation. */
interface ExecutorState {
	lease: ExecutorLeaseType;
	active: number;
	draining: boolean;
	closed: boolean;
}

/** One blocked dispatch caller. */
interface Waiter {
	readonly resolve: () => void;
	readonly reject: (reason: unknown) => void;
	readonly unlink: () => void;
}

/**
 * Create a bounded process-local activity dispatch owner.
 *
 * The implementation exercises the same item, registration, placement, lease,
 * and stale-completion contract required from SQL, OPFS, or remote adapters.
 * Process exit still loses every record.
 */
export function memory(options: MemoryDispatchOptions = {}): ActivityDispatch {
	return new Runtime(options).dispatch;
}

/** Mutable process-local owner behind the immutable dispatch facade. */
class Runtime {
	readonly #capacity: number;
	readonly #clock: context.Clock;
	readonly #id: () => string;
	readonly #items = new Map<string, ItemState>();
	readonly #keys = new Map<string, string>();
	readonly #executors = new Map<string, ExecutorState>();
	readonly #current = new Map<string, ExecutorState>();
	readonly #generations = new Map<string, number>();
	readonly #claimWaiters = new Set<Waiter>();
	readonly #resultWaiters = new Map<string, Set<Waiter>>();
	readonly #stateWaiters = new Set<Waiter>();
	readonly #dispatch: ActivityDispatch;
	#order = 0;
	#closed = false;
	#reason: unknown;

	constructor(options: MemoryDispatchOptions) {
		this.#capacity = options.capacity === undefined ? Number.POSITIVE_INFINITY : assert.positive(options.capacity, 'dispatch capacity');
		this.#clock = options.clock ?? context.SystemClock;
		this.#id = options.id ?? (() => crypto.randomUUID());
		this.#dispatch = Object.freeze({
			add: (ctx, value, addOptions) => this.#add(ctx, value, addOptions),
			result: (ctx, ref) => this.#result(ctx, ref),
			cancel: (ctx, ref, reason) => this.#cancel(ctx, ref, reason),
			join: (ctx, joinOptions) => this.#join(ctx, joinOptions),
			renewExecutor: (ctx, lease, duration) => this.#renewExecutor(ctx, lease, duration),
			resize: (ctx, lease, capacity) => this.#resize(ctx, lease, capacity),
			drain: (ctx, lease) => this.#drain(ctx, lease),
			leave: (ctx, lease) => this.#leave(ctx, lease),
			claim: (ctx, lease, claimOptions) => this.#claim(ctx, lease, claimOptions),
			watch: (ctx, claim) => this.#watch(ctx, claim),
			renew: (ctx, claim, duration) => this.#renew(ctx, claim, duration),
			complete: (ctx, claim, result) => this.#complete(ctx, claim, result),
			retry: (ctx, claim, retryOptions) => this.#retry(ctx, claim, retryOptions),
			stats: () => this.#stats(),
			close: (reason) => this.#close(reason),
			[Symbol.asyncDispose]: () => this.#close('Activity dispatch was disposed.'),
		} satisfies ActivityDispatch);
	}

	get dispatch(): ActivityDispatch {
		return this.#dispatch;
	}

	async #add(ctx: context.Context, value: ActivityJobType, options: ActivityAddOptions): Promise<ActivityRefType> {
		context.check(ctx);
		this.#open();
		record.assert(options, 'activity add options');
		assert.id(options.key, 'activity item key');
		const existing = this.#keys.get(options.key);
		if (existing !== undefined) return Object.freeze({ id: existing } satisfies ActivityRefType);
		if (this.#activeItems() >= this.#capacity) throw new DispatchCapacityError(this.#capacity);
		const id = unique(this.#id, this.#items);
		const snapshot = durable.snapshot(value, 'activity item') as unknown as ActivityJobType;
		const item: ItemState = {
			id,
			key: options.key,
			value: snapshot,
			order: this.#order++,
			state: 'queued',
			attempt: 0,
			availableAt: this.#clock.now(),
		};
		this.#items.set(id, item);
		this.#keys.set(options.key, id);
		this.#wake(this.#claimWaiters);
		return Object.freeze({ id } satisfies ActivityRefType);
	}

	async #result(ctx: context.Context, ref: ActivityRefType): Promise<ActivityJobResultType> {
		while (true) {
			context.check(ctx);
			this.#expire();
			const item = this.#item(ref.id);
			if (terminal(item)) return item.result!;
			this.#open();
			let waiters = this.#resultWaiters.get(item.id);
			if (waiters === undefined) {
				waiters = new Set();
				this.#resultWaiters.set(item.id, waiters);
			}
			await wait(ctx, waiters, this.#clock, this.#delay(this.#next(item)));
		}
	}

	async #cancel(ctx: context.Context, ref: ActivityRefType, reason?: HistoryValueType): Promise<void> {
		context.check(ctx);
		const item = this.#item(ref.id);
		if (terminal(item)) return;
		this.#release(item);
		item.state = 'cancelled';
		item.claim = undefined;
		item.result = Object.freeze({
			type: 'cancelled',
			reason: reason === undefined
				? Object.freeze({ kind: 'undefined' })
				: durable.snapshot(reason, 'activity cancellation') as unknown as HistoryValueType,
		} satisfies ActivityJobResultType);
		this.#settle(item);
	}

	async #join(ctx: context.Context, options: ExecutorJoinOptions): Promise<ExecutorLeaseType> {
		context.check(ctx);
		this.#open();
		record.assert(options, 'executor join options');
		assert.id(options.engineId, 'executor engine');
		assert.id(options.hostId, 'executor host');
		assert.positive(options.capacity, 'executor capacity');
		assert.positive(options.protocolVersion, 'executor protocolVersion');
		if (options.activities.length === 0) throw new TypeError('Executor must advertise at least one activity.');
		const advertised = durable.snapshot(options.activities, 'executor activities') as unknown as ExecutorJoinOptions['activities'];
		const activities = Object.freeze(advertised.map((activity) => {
			assert.id(activity.id, 'executor activity');
			assert.id(activity.version, 'executor activity version');
			return Object.freeze({ id: activity.id, version: activity.version });
		}));
		const affinity = options.affinity === undefined ? undefined : freezeAffinity(options.affinity, 'executor affinity');
		const computeValue = options.compute === undefined ? undefined : compute.freeze(options.compute);
		const duration = options.duration === undefined ? undefined : assert.duration(options.duration, 'executor lease duration');
		const key = executorKey(options.engineId, options.hostId);
		const previous = this.#current.get(key);
		if (previous !== undefined) this.#revoke(previous);
		const generation = (this.#generations.get(key) ?? 0) + 1;
		this.#generations.set(key, generation);
		const lease = Object.freeze({
			id: unique(this.#id, this.#executors),
			engineId: options.engineId,
			hostId: options.hostId,
			generation,
			protocolVersion: options.protocolVersion,
			activities,
			...(affinity === undefined ? {} : { affinity }),
			...(computeValue === undefined ? {} : { compute: computeValue }),
			capacity: options.capacity,
			...(duration === undefined ? {} : { expiresAt: this.#clock.now().add(duration) }),
		} satisfies ExecutorLeaseType);
		const state: ExecutorState = { lease, active: 0, draining: false, closed: false };
		this.#executors.set(lease.id, state);
		this.#current.set(key, state);
		this.#wake(this.#claimWaiters);
		return lease;
	}

	async #renewExecutor(
		ctx: context.Context,
		lease: ExecutorLeaseType,
		duration: Temporal.Duration | Temporal.DurationLike | string,
	): Promise<ExecutorLeaseType> {
		context.check(ctx);
		const state = this.#executor(lease);
		state.lease = Object.freeze({
			...state.lease,
			expiresAt: this.#clock.now().add(assert.duration(duration, 'executor lease renewal duration')),
		} satisfies ExecutorLeaseType);
		return state.lease;
	}

	async #resize(ctx: context.Context, lease: ExecutorLeaseType, capacity: number): Promise<ExecutorLeaseType> {
		context.check(ctx);
		const state = this.#executor(lease);
		state.lease = Object.freeze({ ...state.lease, capacity: assert.positive(capacity, 'executor capacity') } satisfies ExecutorLeaseType);
		this.#wake(this.#claimWaiters);
		return state.lease;
	}

	async #drain(ctx: context.Context, lease: ExecutorLeaseType): Promise<void> {
		const state = this.#executor(lease);
		state.draining = true;
		this.#wake(this.#claimWaiters);
		while (state.active > 0) {
			context.check(ctx);
			await wait(ctx, this.#stateWaiters, this.#clock, this.#delay(this.#soonest()));
			this.#expire();
		}
	}

	async #leave(ctx: context.Context, lease: ExecutorLeaseType): Promise<void> {
		context.check(ctx);
		const state = this.#executor(lease);
		if (state.active > 0) throw new Error('Executor must drain active attempts before leaving.');
		this.#revoke(state);
	}

	async #claim(
		ctx: context.Context,
		lease: ExecutorLeaseType,
		options: ActivityClaimOptions,
	): Promise<readonly ActivityClaimType[]> {
		const limit = assert.positive(options.limit ?? 1, 'activity claim limit');
		const duration = assert.duration(options.duration, 'activity claim duration');
		while (true) {
			context.check(ctx);
			this.#open();
			this.#expire();
			const executor = this.#executor(lease);
			if (executor.draining) return Object.freeze([]);
			const available = Math.max(0, executor.lease.capacity - executor.active);
			const items = [...this.#items.values()]
				.filter((item) => item.state === 'queued' && Temporal.Instant.compare(item.availableAt, this.#clock.now()) <= 0)
				.filter((item) => this.#selects(item, executor))
				.sort((left, right) => left.order - right.order)
				.slice(0, Math.min(limit, available));
			if (items.length > 0) return Object.freeze(items.map((item) => this.#take(item, executor, duration)));
			if (options.wait !== true) return Object.freeze([]);
			await wait(ctx, this.#claimWaiters, this.#clock, this.#delay(this.#soonest()));
		}
	}

	async #renew(
		ctx: context.Context,
		claim: ActivityClaimType,
		duration: Temporal.Duration | Temporal.DurationLike | string,
	): Promise<ActivityClaimType> {
		context.check(ctx);
		const item = this.#claimed(claim);
		const renewed = Object.freeze({
			...claim,
			expiresAt: this.#clock.now().add(assert.duration(duration, 'activity claim renewal duration')),
		} satisfies ActivityClaimType);
		item.claim = renewed;
		return renewed;
	}

	async #watch(ctx: context.Context, claim: ActivityClaimType): Promise<'cancelled' | 'lost'> {
		while (true) {
			context.check(ctx);
			this.#expire();
			const item = this.#item(claim.itemId);
			if (item.state === 'cancelled') return 'cancelled';
			if (item.state !== 'claimed' || item.claim?.id !== claim.id || item.claim.executorId !== claim.executorId) return 'lost';
			await wait(ctx, this.#stateWaiters, this.#clock, this.#delay(this.#next(item)));
		}
	}

	async #complete(ctx: context.Context, claim: ActivityClaimType, result: ActivityJobResultType): Promise<void> {
		context.check(ctx);
		const item = this.#claimed(claim);
		const snapshot = durable.snapshot(result, 'activity result') as unknown as ActivityJobResultType;
		this.#release(item);
		item.state = snapshot.type === 'cancelled' ? 'cancelled' : 'completed';
		item.claim = undefined;
		item.result = snapshot;
		this.#settle(item);
	}

	async #retry(ctx: context.Context, claim: ActivityClaimType, options: ActivityRetryOptions = {}): Promise<void> {
		context.check(ctx);
		const item = this.#claimed(claim);
		this.#release(item);
		item.state = 'queued';
		item.claim = undefined;
		item.availableAt = this.#clock.now().add(nonNegativeDuration(options.delay ?? 'PT0S', 'activity retry delay'));
		this.#wake(this.#claimWaiters);
	}

	async #stats(): Promise<ActivityDispatchStatsType> {
		this.#expire();
		let queued = 0;
		let claimed = 0;
		let completed = 0;
		let cancelled = 0;
		for (const item of this.#items.values()) {
			if (item.state === 'queued') queued += 1;
			else if (item.state === 'claimed') claimed += 1;
			else if (item.state === 'completed') completed += 1;
			else cancelled += 1;
		}
		return Object.freeze({
			queued,
			claimed,
			completed,
			cancelled,
			executors: this.#executors.size,
			waitingClaims: this.#claimWaiters.size,
			waitingResults: [...this.#resultWaiters.values()].reduce((total, waiters) => total + waiters.size, 0),
		} satisfies ActivityDispatchStatsType);
	}

	async #close(reason?: unknown): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#reason = reason;
		const error = new DispatchClosedError(reason);
		reject(this.#claimWaiters, error);
		reject(this.#stateWaiters, error);
		for (const waiters of this.#resultWaiters.values()) reject(waiters, error);
		this.#resultWaiters.clear();
	}

	#selects(item: ItemState, executor: ExecutorState): boolean {
		for (const choice of item.value.placement) {
			const candidates = [...this.#executors.values()].filter((state) => this.#matches(item, state, choice.engine));
			if (candidates.length > 0) return choice.engine === executor.lease.engineId && candidates.includes(executor);
			if (choice.mode === 'required') return false;
		}
		return false;
	}

	#matches(item: ItemState, executor: ExecutorState, engineId: string): boolean {
		if (executor.closed || executor.draining || executor.lease.engineId !== engineId) return false;
		if (executor.active >= executor.lease.capacity) return false;
		if (executor.lease.expiresAt !== undefined && Temporal.Instant.compare(this.#clock.now(), executor.lease.expiresAt) >= 0) return false;
		if (!affinityMatches(item.value.affinity, executor.lease.affinity)) return false;
		return executor.lease.activities.some((activity) =>
			activity.id === item.value.activityId && activity.version === item.value.activityVersion
		);
	}

	#take(item: ItemState, executor: ExecutorState, duration: Temporal.Duration): ActivityClaimType {
		const claimedAt = this.#clock.now();
		const claim = Object.freeze({
			id: uniqueClaim(this.#id, this.#items),
			itemId: item.id,
			executorId: executor.lease.id,
			attempt: item.attempt + 1,
			value: item.value,
			claimedAt,
			expiresAt: claimedAt.add(duration),
		} satisfies ActivityClaimType);
		item.state = 'claimed';
		item.attempt = claim.attempt;
		item.claim = claim;
		executor.active += 1;
		return claim;
	}

	#claimed(claim: ActivityClaimType): ItemState {
		this.#expire();
		const item = this.#item(claim.itemId);
		if (item.state !== 'claimed' || item.claim?.id !== claim.id || item.claim.executorId !== claim.executorId) {
			throw new StaleActivityClaimError(claim.itemId, claim.id);
		}
		return item;
	}

	#executor(lease: ExecutorLeaseType): ExecutorState {
		this.#expire();
		const state = this.#executors.get(lease.id);
		if (state === undefined || state.closed || state.lease.generation !== lease.generation) throw new StaleExecutorError(lease.id);
		return state;
	}

	#release(item: ItemState): void {
		const executorId = item.claim?.executorId;
		if (executorId !== undefined) {
			const executor = this.#executors.get(executorId);
			if (executor !== undefined) executor.active = Math.max(0, executor.active - 1);
		}
		this.#wake(this.#stateWaiters);
		this.#wake(this.#claimWaiters);
	}

	#revoke(executor: ExecutorState): void {
		if (executor.closed) return;
		executor.closed = true;
		executor.draining = true;
		this.#executors.delete(executor.lease.id);
		const key = executorKey(executor.lease.engineId, executor.lease.hostId);
		if (this.#current.get(key) === executor) this.#current.delete(key);
		for (const item of this.#items.values()) {
			if (item.state !== 'claimed' || item.claim?.executorId !== executor.lease.id) continue;
			this.#release(item);
			item.state = 'queued';
			item.claim = undefined;
			item.availableAt = this.#clock.now();
		}
		this.#wake(this.#stateWaiters);
		this.#wake(this.#claimWaiters);
	}

	#expire(): void {
		const now = this.#clock.now();
		for (const executor of [...this.#executors.values()]) {
			if (executor.lease.expiresAt !== undefined && Temporal.Instant.compare(now, executor.lease.expiresAt) >= 0) this.#revoke(executor);
		}
		for (const item of this.#items.values()) {
			if (item.state !== 'claimed' || item.claim === undefined) continue;
			if (Temporal.Instant.compare(now, item.claim.expiresAt) < 0) continue;
			this.#release(item);
			item.state = 'queued';
			item.claim = undefined;
			item.availableAt = now;
		}
	}

	#settle(item: ItemState): void {
		const waiters = this.#resultWaiters.get(item.id);
		if (waiters !== undefined) {
			this.#resultWaiters.delete(item.id);
			this.#wake(waiters);
		}
		this.#wake(this.#claimWaiters);
	}

	#soonest(): Temporal.Instant | undefined {
		let next: Temporal.Instant | undefined;
		for (const item of this.#items.values()) {
			const candidate = this.#next(item);
			if (candidate !== undefined && (next === undefined || Temporal.Instant.compare(candidate, next) < 0)) next = candidate;
		}
		for (const executor of this.#executors.values()) {
			const candidate = executor.lease.expiresAt;
			if (candidate !== undefined && (next === undefined || Temporal.Instant.compare(candidate, next) < 0)) next = candidate;
		}
		return next;
	}

	#next(item: ItemState): Temporal.Instant | undefined {
		if (item.state === 'queued') return item.availableAt;
		if (item.state === 'claimed') return item.claim?.expiresAt;
		return undefined;
	}

	#delay(instant: Temporal.Instant | undefined): number | undefined {
		if (instant === undefined) return undefined;
		const delay = instant.epochMilliseconds - this.#clock.now().epochMilliseconds;
		return delay > 0 ? delay : undefined;
	}

	#item(id: string): ItemState {
		const item = this.#items.get(id);
		if (item === undefined) throw new Error(`Unknown activity item ${JSON.stringify(id)}.`);
		return item;
	}

	#activeItems(): number {
		let active = 0;
		for (const item of this.#items.values()) if (!terminal(item)) active += 1;
		return active;
	}

	#open(): void {
		if (this.#closed) throw new DispatchClosedError(this.#reason);
	}

	#wake(waiters: Set<Waiter>): void {
		for (const waiter of [...waiters]) {
			waiters.delete(waiter);
			waiter.unlink();
			waiter.resolve();
		}
	}
}

/** Return whether one activity item can no longer create another attempt. */
function terminal(item: ItemState): boolean {
	return item.state === 'completed' || item.state === 'cancelled';
}

/** Build a stable host-generation key without constraining compute topology. */
function executorKey(engineId: string, hostId: string): string {
	return `${engineId}\u0000${hostId}`;
}

/** Create one collision-free identifier from a caller-provided source. */
function unique<Value>(create: () => string, values: ReadonlyMap<string, Value>): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = create();
		assert.id(id, 'dispatch');
		if (!values.has(id)) return id;
	}
	throw new Error('Activity dispatch ID source produced too many collisions.');
}

/** Create one collision-free claim identity across live activity attempts. */
function uniqueClaim(create: () => string, items: ReadonlyMap<string, ItemState>): string {
	const active = new Set([...items.values()].flatMap((item) => item.claim === undefined ? [] : [item.claim.id]));
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = create();
		assert.id(id, 'activity claim');
		if (!active.has(id)) return id;
	}
	throw new Error('Activity dispatch claim ID source produced too many collisions.');
}

/** Suspend until a dispatch mutation, cancellation, or lease boundary can change state. */
function wait(ctx: context.Context, waiters: Set<Waiter>, clock: context.Clock, delay?: number): Promise<void> {
	return new Promise<void>((resolve, rejectValue) => {
		let waiter!: Waiter;
		const unlink = () => {
			ctx.signal.removeEventListener('abort', abort);
		};
		const settle = (action: () => void) => {
			if (!waiters.delete(waiter)) return;
			unlink();
			action();
		};
		const abort = () => settle(() => rejectValue(ctx.signal.reason ?? new context.ContextCancelledError()));
		waiter = { resolve, reject: rejectValue, unlink };
		if (ctx.signal.aborted) {
			rejectValue(ctx.signal.reason ?? new context.ContextCancelledError());
			return;
		}
		waiters.add(waiter);
		ctx.signal.addEventListener('abort', abort, { once: true });
		if (delay !== undefined) {
			void clock.sleep(delay, ctx.signal).then(
				() => settle(resolve),
				(reason) => settle(() => rejectValue(reason)),
			);
		}
	});
}

/** Reject every waiter when the dispatch owner can no longer make progress. */
function reject(waiters: Set<Waiter>, reason: unknown): void {
	for (const waiter of [...waiters]) {
		waiters.delete(waiter);
		waiter.unlink();
		waiter.reject(reason);
	}
}

/** Validate a retry delay that may be zero. */
function nonNegativeDuration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	const duration = Temporal.Duration.from(value);
	if (duration.sign < 0) throw new TypeError(`${label} must not be negative.`);
	return duration;
}
