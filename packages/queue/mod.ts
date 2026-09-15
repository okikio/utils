/**
 * Queue contracts for claimed work and a process-local queue.
 *
 * A plain queue often does two things: add work and remove work.
 * Claimed work needs more rules.
 *
 * The queue keeps the item after admission.
 * A worker receives a claim with an owner and an expiry time.
 * Later calls such as `complete()`, `retry()`, `fail()`, `renew()`, and
 * `cancel()` must still present the live claim.
 *
 * The extra state blocks stale work.
 * If one worker loses a lease and another worker claims the same item, the
 * older worker cannot write a late result over the newer attempt.
 *
 * Durable adapters belong in concrete packages.
 * The process-local queue keeps the same ownership, expiry, retry, result, and
 * cancellation rules so tests and local compositions can use the same model.
 *
 * @module
 */
import { EventBus } from '@okikio/observables';
import * as duration from '@okikio/duration';
import * as context from '@okikio/context';
import type { Context } from '@okikio/context';
import type { Encoded as EncodedFailure } from '@okikio/failure';

import type {
	QueueAddOptions,
	QueueClaim,
	QueueClaimOptions,
	QueueEventType,
	MemoryQueueOptions,
	Queue,
	QueueRef,
	QueueRetryOptions,
	QueueStats,
} from './types.ts';

export { fifo } from './fifo.ts';

/** Operation attempted after a queue stopped accepting work. */
export class QueueClosedError extends Error {
	/** Reason recorded when the queue closed, if the caller supplied one. */
	readonly reason: unknown;

	/** Create a queue-closed error with the stored closure reason. */
	constructor(reason?: unknown) {
		super('Queue is closed.', reason === undefined ? undefined : { cause: reason });
		this.name = 'QueueClosedError';
		this.reason = reason;
	}
}

/** Queue active-item capacity was exhausted. */
export class QueueCapacityError extends Error {
	/** Active-item capacity that rejected the new admission. */
	readonly capacity: number;

	/** Create a capacity error that records the configured active-item limit. */
	constructor(capacity: number) {
		super(`Queue reached its active-item capacity of ${capacity}.`);
		this.name = 'QueueCapacityError';
		this.capacity = capacity;
	}
}

/** A queue reference does not identify a known item. */
export class QueueItemNotFoundError extends Error {
	/** Unknown item id supplied by the caller. */
	readonly itemId: string;

	/** Create an item-not-found error for one stable item id. */
	constructor(itemId: string) {
		super(`Queue item ${JSON.stringify(itemId)} was not found.`);
		this.name = 'QueueItemNotFoundError';
		this.itemId = itemId;
	}
}

/** A queue claim no longer owns the referenced item. */
export class StaleClaimError extends Error {
	/** Stable item id that the stale claim tried to mutate. */
	readonly itemId: string;
	/** QueueClaim id that no longer owns the item. */
	readonly claimId: string;

	/** Create a stale-claim error for one item id and claim id pair. */
	constructor(itemId: string, claimId: string) {
		super(`Queue claim ${JSON.stringify(claimId)} no longer owns item ${JSON.stringify(itemId)}.`);
		this.name = 'StaleClaimError';
		this.itemId = itemId;
		this.claimId = claimId;
	}
}

/** Result wait failed because the queue item reached a failed state. */
export class QueueItemFailedError extends Error {
	/** Stable item id that reached failed terminal state. */
	readonly itemId: string;
	/** Encoded failure committed for the item. */
	readonly failure: EncodedFailure;

	/** Create a result error that exposes the encoded item failure. */
	constructor(itemId: string, failure: EncodedFailure) {
		super(`Queue item ${JSON.stringify(itemId)} failed: ${failure.message}`);
		this.name = 'QueueItemFailedError';
		this.itemId = itemId;
		this.failure = failure;
	}
}

/** Result wait failed because the queue item was cancelled. */
export class QueueItemCancelledError extends Error {
	/** Stable item id that reached cancelled terminal state. */
	readonly itemId: string;
	/** Optional cancellation reason recorded on the item. */
	readonly reason: unknown;

	/** Create a result error that exposes the stored cancellation reason. */
	constructor(itemId: string, reason?: unknown) {
		super(`Queue item ${JSON.stringify(itemId)} was cancelled.`, reason === undefined ? undefined : { cause: reason });
		this.name = 'QueueItemCancelledError';
		this.itemId = itemId;
		this.reason = reason;
	}
}

/**
 * Lifecycle state for one queue item.
 *
 * `queued` means the item may become claimable now or later.
 * `claimed` means one worker currently owns the item through a claim token.
 * The remaining states are terminal and keep stable item identity for result
 * lookup and idempotent key reuse.
 */
type ItemState = 'queued' | 'claimed' | 'completed' | 'failed' | 'cancelled';

/**
 * Process-local record for one queue item.
 *
 * One item keeps one stable id across retries and re-claims.
 * One claim id belongs to one lease attempt.
 * The `claim` field changes each time a worker gets a new lease.
 */
interface Item<Input, Output> {
	readonly id: string;
	readonly key?: string;
	readonly input: Input;
	readonly order: number;
	state: ItemState;
	priority: number;
	availableAt: Temporal.Instant;
	attempt: number;
	claim?: QueueClaim<Input> | undefined;
	output?: Output;
	failure?: EncodedFailure;
	cancellation?: unknown;
}

/**
 * One blocked caller waiting for a queue state change.
 *
 * Two wait groups exist:
 * - claim waiters block until eligible work exists;
 * - result waiters block until one item reaches terminal state.
 *
 * `unlink()` removes external listeners and timers so the waiter does not leak
 * resources after it settles.
 */
interface Waiter {
	readonly resolve: () => void;
	readonly reject: (reason: unknown) => void;
	readonly unlink: () => void;
}

/**
 * Create a process-local queue that implements the same ownership contract as durable adapters.
 *
 * State stays in local process memory.
 * Ownership rules match the stronger queue model that durable adapters must
 * also follow.
 *
 * Each worker receives a claim with an owner, an attempt number, and an expiry
 * time.
 * Later mutations must prove that the claim still owns the item.
 *
 * Three identities stay separate:
 * - item identity: the stable reference returned from `add()`;
 * - claim identity: the temporary lease returned from `claim()`;
 * - terminal outcome: completed output, encoded failure, or cancellation.
 *
 * One caller can add work.
 * Another caller can process work.
 * A third caller can wait for the final result.
 * No caller needs shared mutable state.
 *
 * ```text
 * add(input)
 *    |
 *    v
 * ready --claim(owner, lease)--> claimed
 *   ^                              |
 *   |                              +-- complete(output) --> completed
 *   |                              +-- fail(failure) -----> failed
 *   |                              +-- cancel(reason) ----> cancelled
 *   `---------- retry(delay) <-----+
 *
 * expired claim -> ready for a new owner
 * stale owner   -> completion is rejected
 * ```
 *
 * The memory queue keeps claim identity, expiry, and stale-owner rules that
 * durable adapters also need.
 */
export function memory<Input, Output>(options: MemoryQueueOptions = {}): Queue<Input, Output> {
	return new Runtime<Input, Output>(options).queue;
}

/**
 * Mutable process-local owner behind one immutable `Queue` facade.
 *
 * One runtime owns all logical item records, temporary claim authority, and
 * blocked waiters. Keeping those transitions on named methods makes the two
 * important fences visible: terminal item state is durable for lookup, while a
 * claim may mutate an item only while its exact claim id and owner still match.
 */
class Runtime<Input, Output> {
	/** Maximum number of queued or claimed items admitted at one time. */
	readonly #capacity: number;
	/** Clock used for availability, claim expiry, retry delay, and renewal. */
	readonly #clock: Context['clock'];
	/** Caller-supplied or default source for item and claim identifiers. */
	readonly #id: () => string;
	/** Lease duration used when a claim does not override it. */
	readonly #duration: Temporal.Duration;
	/** Lifecycle event source disposed when the queue closes. */
	readonly #events = new EventBus<QueueEventType>();
	/** Authoritative record for every admitted logical item, including terminals. */
	readonly #items = new Map<string, Item<Input, Output>>();
	/** Stable idempotency key to logical item identity. Terminal mappings remain reusable. */
	readonly #keys = new Map<string, string>();
	/** Callers blocked until global claimability may have changed. */
	readonly #claimWaiters = new Set<Waiter>();
	/** Callers waiting for one exact item to reach a terminal state. */
	readonly #resultWaiters = new Map<string, Set<Waiter>>();
	/** Immutable caller-facing queue facade. */
	readonly #queue: Queue<Input, Output>;
	/** FIFO tie-breaker assigned once when each logical item is admitted. */
	#order = 0;
	/** Whether admission and claiming have stopped permanently. */
	#closed = false;
	/** Caller-supplied closure reason retained for later rejected operations. */
	#reason: unknown;

	/** Validate queue policy once and construct the frozen caller-facing facade. */
	constructor(options: MemoryQueueOptions) {
		this.#capacity = options.capacity === undefined
			? Number.POSITIVE_INFINITY
			: positiveInteger(options.capacity, 'queue capacity');
		this.#clock = options.clock ?? context.SystemClock;
		this.#id = options.id ?? defaultId;
		this.#duration = positiveDuration(options.defaultClaimDuration ?? { seconds: 30 }, 'default claim duration');
		this.#queue = Object.freeze({
			events: this.#events.events,
			add: (ctx: Context, input: Input, addOptions?: QueueAddOptions) => this.#add(ctx, input, addOptions),
			claim: (ctx: Context, claimOptions?: QueueClaimOptions) => this.#claim(ctx, claimOptions),
			wait: (ctx: Context, ref: QueueRef) => this.#wait(ctx, ref),
			complete: (ctx: Context, claim: QueueClaim<Input>, output: Output) => this.#complete(ctx, claim, output),
			fail: (ctx: Context, claim: QueueClaim<Input>, failure: EncodedFailure) => this.#fail(ctx, claim, failure),
			retry: (ctx: Context, claim: QueueClaim<Input>, retryOptions?: QueueRetryOptions) => this.#retry(ctx, claim, retryOptions),
			cancel: (ctx: Context, owner: QueueRef | QueueClaim<Input>, reason?: unknown) => this.#cancel(ctx, owner, reason),
			result: (ctx: Context, ref: QueueRef) => this.#result(ctx, ref),
			renew: (ctx: Context, claim: QueueClaim<Input>, duration: Temporal.Duration | Temporal.DurationLike | string) =>
				this.#renew(ctx, claim, duration),
			stats: async () => this.#stats(),
			close: (reason?: unknown) => this.#close(reason),
			[Symbol.asyncDispose]: () => this.#close('Queue was disposed.'),
		});
	}

	/** Immutable queue facade backed by this runtime owner. */
	get queue(): Queue<Input, Output> {
		return this.#queue;
	}

	/** Admit one logical item after idempotency and active-capacity checks. */
	async #add(ctx: Context, input: Input, options: QueueAddOptions = {}): Promise<QueueRef> {
		context.check(ctx);
		this.#open();
		if (options.key !== undefined) {
			assertKey(options.key);
			const existingId = this.#keys.get(options.key);
			if (existingId !== undefined) return Object.freeze({ id: existingId });
		}
		if (this.#active() >= this.#capacity) throw new QueueCapacityError(this.#capacity);
		const id = uniqueId(this.#id, this.#items);
		const item: Item<Input, Output> = {
			id,
			...(options.key === undefined ? {} : { key: options.key }),
			input,
			order: this.#order++,
			state: 'queued',
			priority: integer(options.priority ?? 0, 'queue priority'),
			availableAt: options.availableAt ?? this.#clock.now(),
			attempt: 0,
		};
		this.#items.set(id, item);
		if (item.key !== undefined) this.#keys.set(item.key, id);
		this.#events.emit(Object.freeze({ type: 'added', itemId: id, ...(item.key === undefined ? {} : { key: item.key }) }));
		this.#wake();
		return Object.freeze({ id });
	}

	/**
	 * Claim eligible work in deterministic priority/FIFO order.
	 *
	 * Waiting never transfers ownership. Each wake re-runs expiry and eligibility
	 * checks, so a caller cannot rely on stale state observed before suspension.
	 */
	async #claim(ctx: Context, options: QueueClaimOptions = {}): Promise<readonly QueueClaim<Input>[]> {
		const owner = options.owner ?? ctx.id;
		assertOwner(owner);
		const limit = positiveInteger(options.limit ?? 1, 'claim limit');
		if (options.ref !== undefined && limit !== 1) throw new TypeError('A specific queue ref claim limit must be 1.');
		const duration = positiveDuration(options.duration ?? this.#duration, 'claim duration');
		while (true) {
			context.check(ctx);
			this.#open();
			this.#expire();
			const now = this.#clock.now();
			const candidates = options.ref === undefined ? [...this.#items.values()] : [this.#item(options.ref.id)];
			const available = candidates
				.filter((item) => item.state === 'queued' && Temporal.Instant.compare(item.availableAt, now) <= 0)
				.sort(compareItems)
				.slice(0, limit);
			if (available.length > 0) return Object.freeze(available.map((item) => this.#take(item, owner, duration)));
			if (options.ref !== undefined) {
				const item = this.#item(options.ref.id);
				if (terminal(item)) return Object.freeze([]);
			}
			if (options.wait !== true) return Object.freeze([]);
			const wakeAt = options.ref === undefined ? this.#soonest() : this.#next(this.#item(options.ref.id));
			await waitForChange(ctx, this.#clock, this.#claimWaiters, wakeAt === undefined ? undefined : millisecondsUntil(wakeAt, this.#clock.now()));
		}
	}

	/** Wait for one exact item to become claimable or terminal without taking ownership. */
	async #wait(ctx: Context, ref: QueueRef): Promise<'claimable' | 'terminal'> {
		while (true) {
			context.check(ctx);
			this.#open();
			this.#expire();
			const item = this.#item(ref.id);
			if (terminal(item)) return 'terminal';
			const now = this.#clock.now();
			if (item.state === 'queued' && Temporal.Instant.compare(item.availableAt, now) <= 0) return 'claimable';
			const wakeAt = this.#next(item);
			await waitForChange(ctx, this.#clock, this.#claimWaiters, wakeAt === undefined ? undefined : millisecondsUntil(wakeAt, this.#clock.now()));
		}
	}

	/** Commit successful output only while the supplied claim still owns the item. */
	async #complete(ctx: Context, claim: QueueClaim<Input>, output: Output): Promise<void> {
		context.check(ctx);
		const item = this.#claimed(claim);
		item.state = 'completed';
		item.output = output;
		item.claim = undefined;
		this.#events.emit(Object.freeze({ type: 'completed', itemId: item.id, claimId: claim.id }));
		this.#settle(item);
		this.#wake();
	}

	/** Commit an encoded failure only while the supplied claim still owns the item. */
	async #fail(ctx: Context, claim: QueueClaim<Input>, failure: EncodedFailure): Promise<void> {
		context.check(ctx);
		const item = this.#claimed(claim);
		item.state = 'failed';
		item.failure = Object.freeze({ ...failure });
		item.claim = undefined;
		this.#events.emit(Object.freeze({ type: 'failed', itemId: item.id, claimId: claim.id, failureId: failure.id }));
		this.#settle(item);
		this.#wake();
	}

	/** Return the current claim to queued state while preserving logical item identity. */
	async #retry(ctx: Context, claim: QueueClaim<Input>, options: QueueRetryOptions = {}): Promise<void> {
		context.check(ctx);
		if (options.availableAt !== undefined && options.delay !== undefined) {
			throw new TypeError('Queue retry accepts either availableAt or delay, not both.');
		}
		const item = this.#claimed(claim);
		const now = this.#clock.now();
		const delay = nonNegativeDuration(options.delay ?? 'PT0S', 'retry delay');
		item.state = 'queued';
		item.claim = undefined;
		item.availableAt = options.availableAt ?? now.add(delay);
		if (options.priority !== undefined) item.priority = integer(options.priority, 'queue priority');
		this.#events.emit(Object.freeze({ type: 'retried', itemId: item.id, claimId: claim.id, availableAt: item.availableAt.toString() }));
		this.#wake();
	}

	/** Cancel one logical item using producer authority or one still-live consumer claim. */
	async #cancel(ctx: Context, owner: QueueRef | QueueClaim<Input>, reason?: unknown): Promise<void> {
		context.check(ctx);
		const item = 'itemId' in owner ? this.#claimed(owner) : this.#item(owner.id);
		if (item.state === 'cancelled' || item.state === 'completed' || item.state === 'failed') return;
		item.state = 'cancelled';
		item.claim = undefined;
		item.cancellation = reason;
		this.#events.emit(Object.freeze({ type: 'cancelled', itemId: item.id }));
		this.#settle(item);
		this.#wake();
	}

	/** Wait for terminal output without acquiring or extending consumer ownership. */
	async #result(ctx: Context, ref: QueueRef): Promise<Output> {
		while (true) {
			context.check(ctx);
			const item = this.#item(ref.id);
			if (item.state === 'completed') return item.output as Output;
			if (item.state === 'failed') throw new QueueItemFailedError(item.id, item.failure!);
			if (item.state === 'cancelled') throw new QueueItemCancelledError(item.id, item.cancellation);
			if (this.#closed) throw new QueueClosedError(this.#reason);
			let waiters = this.#resultWaiters.get(item.id);
			if (waiters === undefined) {
				waiters = new Set();
				this.#resultWaiters.set(item.id, waiters);
			}
			await waitForChange(ctx, this.#clock, waiters);
		}
	}

	/** Extend one live claim without changing its claim id or attempt number. */
	async #renew(
		ctx: Context,
		claim: QueueClaim<Input>,
		duration: Temporal.Duration | Temporal.DurationLike | string,
	): Promise<QueueClaim<Input>> {
		context.check(ctx);
		const item = this.#claimed(claim);
		const renewed = Object.freeze({ ...claim, expiresAt: this.#clock.now().add(positiveDuration(duration, 'claim renewal duration')) });
		item.claim = renewed;
		this.#events.emit(Object.freeze({ type: 'renewed', itemId: item.id, claimId: claim.id, expiresAt: renewed.expiresAt.toString() }));
		return renewed;
	}

	/** Snapshot item states and blocked-waiter pressure after expiring stale claims. */
	#stats(): QueueStats {
		this.#expire();
		const counts: Record<ItemState, number> = { queued: 0, claimed: 0, completed: 0, failed: 0, cancelled: 0 };
		for (const item of this.#items.values()) counts[item.state] += 1;
		return Object.freeze({
			...counts,
			waitingClaims: this.#claimWaiters.size,
			waitingResults: [...this.#resultWaiters.values()].reduce((total, waiters) => total + waiters.size, 0),
		});
	}

	/** Permanently stop admission and reject every waiter that can no longer make progress. */
	async #close(reason?: unknown): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#reason = reason;
		const error = new QueueClosedError(reason);
		rejectWaiters(this.#claimWaiters, error);
		for (const waiters of this.#resultWaiters.values()) rejectWaiters(waiters, error);
		this.#resultWaiters.clear();
		this.#events.emit(Object.freeze({ type: 'closed' }));
		const dispose = (this.#events as { [Symbol.dispose]?: () => void })[Symbol.dispose];
		dispose?.call(this.#events);
	}

	/** Reject new admission and claiming after the permanent close transition. */
	#open(): void {
		if (this.#closed) throw new QueueClosedError(this.#reason);
	}

	/** Count queued and claimed items; terminal identities do not consume active capacity. */
	#active(): number {
		let count = 0;
		for (const item of this.#items.values()) if (item.state === 'queued' || item.state === 'claimed') count += 1;
		return count;
	}

	/** Return the authoritative mutable record for one stable logical item id. */
	#item(id: string): Item<Input, Output> {
		const item = this.#items.get(id);
		if (item === undefined) throw new QueueItemNotFoundError(id);
		return item;
	}

	/**
	 * Require exact current claim ownership before a consumer-scoped mutation.
	 *
	 * Expiry runs first. Item id, claim id, owner, and claimed state must all still
	 * match, so a late worker cannot complete, fail, retry, renew, or cancel work
	 * that a newer attempt owns.
	 */
	#claimed(claim: QueueClaim<Input>): Item<Input, Output> {
		this.#expire();
		const item = this.#item(claim.itemId);
		if (item.state !== 'claimed' || item.claim?.id !== claim.id || item.claim.owner !== claim.owner) {
			throw new StaleClaimError(claim.itemId, claim.id);
		}
		return item;
	}

	/** Move one eligible logical item into a new temporary ownership attempt. */
	#take(item: Item<Input, Output>, owner: string, duration: Temporal.Duration): QueueClaim<Input> {
		const claimedAt = this.#clock.now();
		const claim = Object.freeze({
			id: uniqueClaimId(this.#id, this.#items),
			itemId: item.id,
			owner,
			value: item.input,
			attempt: item.attempt + 1,
			claimedAt,
			expiresAt: claimedAt.add(duration),
		});
		item.state = 'claimed';
		item.attempt = claim.attempt;
		item.claim = claim;
		this.#events.emit(Object.freeze({ type: 'claimed', itemId: item.id, claimId: claim.id, owner, attempt: claim.attempt }));
		return claim;
	}

	/** Return every expired live claim to queued state before ownership is observed. */
	#expire(): void {
		const now = this.#clock.now();
		for (const item of this.#items.values()) {
			if (item.state !== 'claimed' || item.claim === undefined) continue;
			if (Temporal.Instant.compare(item.claim.expiresAt, now) > 0) continue;
			const expired = item.claim;
			item.state = 'queued';
			item.claim = undefined;
			item.availableAt = now;
			this.#events.emit(Object.freeze({ type: 'claim-expired', itemId: item.id, claimId: expired.id }));
		}
	}

	/** Return the next instant that can change claimability for one known item. */
	#next(item: Item<Input, Output>): Temporal.Instant | undefined {
		if (item.state === 'queued') return item.availableAt;
		if (item.state === 'claimed') return item.claim?.expiresAt;
		return undefined;
	}

	/** Return the earliest delayed-availability or claim-expiry instant across the queue. */
	#soonest(): Temporal.Instant | undefined {
		let next: Temporal.Instant | undefined;
		for (const item of this.#items.values()) {
			const candidate = this.#next(item);
			if (candidate !== undefined && (next === undefined || Temporal.Instant.compare(candidate, next) < 0)) next = candidate;
		}
		return next;
	}

	/** Release every observer waiting for this exact logical item to settle. */
	#settle(item: Item<Input, Output>): void {
		const waiters = this.#resultWaiters.get(item.id);
		if (waiters === undefined) return;
		this.#resultWaiters.delete(item.id);
		for (const waiter of waiters) {
			waiter.unlink();
			waiter.resolve();
		}
	}

	/** Broadcast a possible claimability change; each waiter re-checks authoritative state after waking. */
	#wake(): void {
		for (const waiter of this.#claimWaiters) {
			this.#claimWaiters.delete(waiter);
			waiter.unlink();
			waiter.resolve();
		}
	}
}

/** Return whether an item has reached a terminal state that can no longer be claimed. */
function terminal<Input, Output>(item: Item<Input, Output>): boolean {
	return item.state === 'completed' || item.state === 'failed' || item.state === 'cancelled';
}

/**
 * Waits for queue state to change without transferring ownership.
 *
 * A waiter can settle in three ways:
 * - another queue operation wakes it;
 * - the context is cancelled;
 * - the queue clock reaches a delayed item or claim expiry.
 *
 * The helper only suspends the caller.
 * The helper does not change item ownership.
 * The helper does not expose mutable queue state while the caller sleeps.
 *
 * @internal
 */
function waitForChange(
	ctx: context.Context,
	clock: context.Clock,
	waiters: Set<Waiter>,
	delayMilliseconds?: number,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let waiter!: Waiter;
		const timer = delayMilliseconds === undefined ? undefined : new AbortController();
		const unlink = () => {
			ctx.signal.removeEventListener('abort', abort);
			timer?.abort();
		};
		const settle = (action: () => void) => {
			if (!waiters.delete(waiter)) return;
			unlink();
			action();
		};
		const abort = () => settle(() => reject(ctx.signal.reason ?? new context.ContextCancelledError()));
		waiter = { resolve, reject, unlink };
		if (ctx.signal.aborted) {
			reject(ctx.signal.reason ?? new context.ContextCancelledError());
			return;
		}
		waiters.add(waiter);
		ctx.signal.addEventListener('abort', abort, { once: true });
		if (timer !== undefined) {
			void clock.sleep(Math.max(0, delayMilliseconds!), timer.signal).then(() => settle(resolve), () => {});
		}
	});
}

/**
 * Rejects every waiter in one waiter set with the same reason.
 *
 * @internal
 */
function rejectWaiters(waiters: Set<Waiter>, reason: unknown): void {
	for (const waiter of waiters) {
		waiters.delete(waiter);
		waiter.unlink();
		waiter.reject(reason);
	}
}

/**
 * Orders eligible queued items for deterministic claim selection.
 *
 * Higher priority sorts first.
 * FIFO insertion order breaks ties.
 * Availability is already filtered before the comparator runs.
 *
 * @internal
 */
function compareItems<Input, Output>(left: Item<Input, Output>, right: Item<Input, Output>): number {
	return right.priority - left.priority || left.order - right.order;
}

/**
 * Creates the fallback id source when the caller does not supply one.
 *
 * @internal
 */
function defaultId(): string {
	return crypto.randomUUID();
}

/**
 * Generates a unique item id that does not collide with current queue items.
 *
 * @internal
 */
function uniqueId<Input, Output>(createId: () => string, items: ReadonlyMap<string, Item<Input, Output>>): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = createId();
		assertKey(id);
		if (!items.has(id)) return id;
	}
	throw new Error('Queue ID source produced too many collisions.');
}

/**
 * Generates a unique claim id that does not collide with active claims.
 *
 * Only active claims matter here.
 * Queued and terminal states do not retain claim ownership.
 *
 * @internal
 */
function uniqueClaimId<Input, Output>(createId: () => string, items: ReadonlyMap<string, Item<Input, Output>>): string {
	const active = new Set([...items.values()].flatMap((item) => item.claim === undefined ? [] : [item.claim.id]));
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = createId();
		assertKey(id);
		if (!active.has(id)) return id;
	}
	throw new Error('Queue claim ID source produced too many collisions.');
}

/**
 * Rejects an empty claim owner before queue state records it.
 *
 * @internal
 */
function assertOwner(value: string): void {
	if (value.trim().length === 0) throw new TypeError('Queue claim owner must not be empty.');
}

/**
 * Rejects invalid item ids and deduplication keys before queue state records them.
 *
 * @internal
 */
function assertKey(value: string): void {
	if (value.trim().length === 0) throw new TypeError('Queue keys and identifiers must not be empty.');
	if (value.length > 512) throw new TypeError('Queue keys and identifiers must not exceed 512 characters.');
}

/**
 * Validates a positive safe integer used in queue policy.
 *
 * @internal
 */
function positiveInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
	return value;
}

/**
 * Validates a safe integer used in queue policy.
 *
 * @internal
 */
function integer(value: number, label: string): number {
	if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer.`);
	return value;
}

/**
 * Validates and normalizes a positive duration used by queue leases.
 *
 * @internal
 */
function positiveDuration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	const parsed = getDuration(value, label);
	if (duration.milliseconds(parsed) <= 0) throw new TypeError(`${label} must be positive.`);
	return parsed;
}

/**
 * Validates and normalizes a non-negative duration used by retry delays.
 *
 * @internal
 */
function nonNegativeDuration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	const parsed = getDuration(value, label);
	if (duration.milliseconds(parsed) < 0) throw new TypeError(`${label} must not be negative.`);
	return parsed;
}

/**
 * Reads one duration value and normalizes Temporal parsing failures.
 *
 * Queue validation reports queue-specific labels instead of raw Temporal
 * parsing errors so callers get the same message shape from all timing checks.
 *
 * @internal
 */
function getDuration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	try {
		return Temporal.Duration.from(value);
	} catch (error) {
		throw new TypeError(`${label} must be positive.`, error === undefined ? undefined : { cause: error });
	}
}

/**
 * Calculates the bounded clock wait until one instant from another.
 *
 * The upper bound matches the supported `Clock.sleep()` range.
 * Delayed work and claim expiry can then schedule safe wake-ups.
 *
 * @internal
 */
function millisecondsUntil(instant: Temporal.Instant, now: Temporal.Instant): number {
	return Math.max(0, Math.min(instant.epochMilliseconds - now.epochMilliseconds, 2_147_483_647));
}

export type {
	Context,
	EncodedFailure,
	QueueRef,
	QueueClaim,
	QueueAddOptions,
	QueueClaimOptions,
	QueueTakeOptions,
	FifoQueueOptions,
	QueueRetryOptions,
	QueueEventType,
	QueueStats,
	QueueWaitStateType,
	Queue,
	QueueClaimHandle,
	FifoQueue,
	MemoryQueueOptions,
} from './types.ts';
