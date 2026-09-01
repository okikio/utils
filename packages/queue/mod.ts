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
import * as contextCore from '@okikio/context';
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
	const capacity = options.capacity === undefined ? Number.POSITIVE_INFINITY : positiveInteger(options.capacity, 'queue capacity');
	const clock = options.clock ?? contextCore.SystemClock;
	const createId = options.id ?? defaultId;
	const defaultClaimDuration = positiveDuration(options.defaultClaimDuration ?? { seconds: 30 }, 'default claim duration');
	const events = new EventBus<QueueEventType>();
	// One map stores item records.
	// Small side maps track idempotent keys and blocked waiters.
	// The split keeps result lookup and wake-up checks cheap.
	const items = new Map<string, Item<Input, Output>>();
	const itemIdsByKey = new Map<string, string>();
	const claimWaiters = new Set<Waiter>();
	const resultWaiters = new Map<string, Set<Waiter>>();
	let order = 0;
	let closed = false;
	let closeReason: unknown;

	const queue: Queue<Input, Output> = Object.freeze({
		events: events.events,
		/**
		 * Adds one logical work item and returns its stable reference.
		 *
		 * `add()` does more than append to a list.
		 * The call checks whether the queue is open, optionally deduplicates by
		 * key, enforces active capacity, records delayed availability, emits an
		 * event, and wakes workers blocked in `claim({ wait: true })`.
		 *
		 * The returned `QueueRef` identifies the logical item, not a specific claim
		 * attempt.
		 * Stable identity lets callers wait for results even when the item is
		 * retried or reclaimed later.
		 *
		 * @internal
		 */
		async add(ctx: Context, input: Input, addOptions: QueueAddOptions = {}) {
			contextCore.check(ctx);
			assertOpen();
			if (addOptions.key !== undefined) {
				assertKey(addOptions.key);
				const existingId = itemIdsByKey.get(addOptions.key);
				if (existingId !== undefined) return Object.freeze({ id: existingId });
			}
			if (activeCount() >= capacity) throw new QueueCapacityError(capacity);
			const id = uniqueId(createId, items);
			const item: Item<Input, Output> = {
				id,
				...(addOptions.key === undefined ? {} : { key: addOptions.key }),
				input,
				order: order++,
				state: 'queued',
				priority: integer(addOptions.priority ?? 0, 'queue priority'),
				availableAt: addOptions.availableAt ?? clock.now(),
				attempt: 0,
			};
			items.set(id, item);
			if (item.key !== undefined) itemIdsByKey.set(item.key, id);
			events.emit(Object.freeze({ type: 'added', itemId: id, ...(item.key === undefined ? {} : { key: item.key }) }));
			wakeClaimWaiters();
			return Object.freeze({ id });
		},
		/**
		 * Claims up to `limit` eligible items and returns temporary ownership tokens.
		 *
		 * Three rules control eligibility:
		 * - the item must still be in `queued` state;
		 * - its `availableAt` time must be in the past;
		 * - expired claims must be returned to `queued` first.
		 *
		 * QueueClaim order is deterministic.
		 * Higher priority wins.
		 * Equal priority falls back to FIFO insertion order.
		 *
		 * When `wait` is true, the caller blocks until one of these conditions
		 * changes the answer: new work arrives, delayed work becomes available, a
		 * claim expires, the caller is cancelled, or the queue closes.
		 *
		 * @internal
		 */
		async claim(ctx: Context, claimOptions: QueueClaimOptions = {}) {
			const owner = claimOptions.owner ?? ctx.id;
			assertOwner(owner);
			const limit = positiveInteger(claimOptions.limit ?? 1, 'claim limit');
			if (claimOptions.ref !== undefined && limit !== 1) {
				throw new TypeError('A specific queue ref claim limit must be 1.');
			}
			const duration = positiveDuration(claimOptions.duration ?? defaultClaimDuration, 'claim duration');
			while (true) {
				contextCore.check(ctx);
				assertOpen();
				expireClaims();
				const now = clock.now();
				const candidates = claimOptions.ref === undefined
					? [...items.values()]
					: [getEntry(claimOptions.ref.id)];
				const available = candidates
					.filter((item) => item.state === 'queued' && Temporal.Instant.compare(item.availableAt, now) <= 0)
					.sort(compareItems)
					.slice(0, limit);
				if (available.length > 0) {
					return Object.freeze(available.map((item) => claimEntry(item, owner, duration)));
				}
				if (claimOptions.ref !== undefined) {
					const item = getEntry(claimOptions.ref.id);
					if (item.state === 'completed' || item.state === 'failed' || item.state === 'cancelled') return Object.freeze([]);
				}
				if (claimOptions.wait !== true) return Object.freeze([]);
				const wakeAt = claimOptions.ref === undefined
					? nextClaimWakeAt()
					: nextWakeAt(getEntry(claimOptions.ref.id));
				await waitForChange(ctx, claimWaiters, wakeAt === undefined ? undefined : millisecondsUntil(wakeAt, clock.now()));
			}
		},
		/**
		 * Waits for one exact item to become claimable or terminal without taking a claim.
		 *
		 * This is intentionally separate from `claim({ wait: true })`. A scheduler
		 * can release provider capacity while an item is delayed or owned by another
		 * consumer, then compete for capacity and ownership again when state changes.
		 *
		 * @internal
		 */
		async wait(ctx: Context, ref: QueueRef) {
			while (true) {
				contextCore.check(ctx);
				assertOpen();
				expireClaims();
				const item = getEntry(ref.id);
				if (item.state === 'completed' || item.state === 'failed' || item.state === 'cancelled') return 'terminal' as const;
				const now = clock.now();
				if (item.state === 'queued' && Temporal.Instant.compare(item.availableAt, now) <= 0) return 'claimable' as const;
				const wakeAt = nextWakeAt(item);
				await waitForChange(ctx, claimWaiters, wakeAt === undefined ? undefined : millisecondsUntil(wakeAt, clock.now()));
			}
		},
		/**
		 * Commits successful output for the current claim owner.
		 *
		 * The queue first checks whether the supplied claim still owns the item.
		 * The stale-claim check prevents an older worker from overwriting work that
		 * a newer worker already reclaimed and completed.
		 *
		 * @internal
		 */
		async complete(ctx: Context, claim: QueueClaim<Input>, output: Output) {
			contextCore.check(ctx);
			const item = currentClaim(claim);
			item.state = 'completed';
			item.output = output;
			item.claim = undefined;
			events.emit(Object.freeze({ type: 'completed', itemId: item.id, claimId: claim.id }));
			settleResultWaiters(item);
			wakeClaimWaiters();
		},
		/**
		 * Commits a declared failure for the current claim owner.
		 *
		 * `fail()` uses the same fence as `complete()`.
		 * A stale worker cannot publish a failure after ownership moved to a newer
		 * attempt.
		 *
		 * @internal
		 */
		async fail(ctx: Context, claim: QueueClaim<Input>, failure: EncodedFailure) {
			contextCore.check(ctx);
			const item = currentClaim(claim);
			item.state = 'failed';
			item.failure = Object.freeze({ ...failure });
			item.claim = undefined;
			events.emit(Object.freeze({ type: 'failed', itemId: item.id, claimId: claim.id, failureId: failure.id }));
			settleResultWaiters(item);
			wakeClaimWaiters();
		},
		/**
		 * Returns claimed work to `queued` state for a later attempt.
		 *
		 * Retry keeps the same logical item id but clears the current claim. The
		 * next claim receives a new claim id and a higher attempt number.
		 *
		 * The caller may delay the next availability or set an absolute
		 * availability time. Backoff can change without losing the item record.
		 *
		 * @internal
		 */
		async retry(ctx: Context, claim: QueueClaim<Input>, retryOptions: QueueRetryOptions = {}) {
			contextCore.check(ctx);
			if (retryOptions.availableAt !== undefined && retryOptions.delay !== undefined) {
				throw new TypeError('Queue retry accepts either availableAt or delay, not both.');
			}
			const item = currentClaim(claim);
			const now = clock.now();
			const delay = nonNegativeDuration(retryOptions.delay ?? 'PT0S', 'retry delay');
			item.state = 'queued';
			item.claim = undefined;
			item.availableAt = retryOptions.availableAt ?? now.add(delay);
			if (retryOptions.priority !== undefined) item.priority = integer(retryOptions.priority, 'queue priority');
			events.emit(Object.freeze({ type: 'retried', itemId: item.id, claimId: claim.id, availableAt: item.availableAt.toString() }));
			wakeClaimWaiters();
		},
		/**
		 * Cancels a non-terminal item by stable reference.
		 *
		 * Cancellation acts on the logical item, not on one claim.
		 * The queue keeps terminal identity and wakes callers waiting for new work
		 * or for the cancelled result.
		 *
		 * @internal
		 */
		async cancel(ctx: Context, owner: QueueRef | QueueClaim<Input>, reason?: unknown) {
			contextCore.check(ctx);
			const item = 'itemId' in owner ? currentClaim(owner) : getEntry(owner.id);
			if (item.state === 'cancelled') return;
			if (item.state === 'completed' || item.state === 'failed') return;
			item.state = 'cancelled';
			item.claim = undefined;
			item.cancellation = reason;
			events.emit(Object.freeze({ type: 'cancelled', itemId: item.id }));
			settleResultWaiters(item);
			wakeClaimWaiters();
		},
		/**
		 * Waits for one item to reach terminal state without taking ownership.
		 *
		 * `result()` helps observers, producers, and higher-level orchestration code
		 * that need the final outcome but must not interfere with worker
		 * ownership.
		 * `result()` returns completed output, throws a typed error for a failed or
		 * cancelled item, or waits until the item settles.
		 *
		 * @internal
		 */
		async result(ctx: Context, ref: QueueRef) {
			while (true) {
				contextCore.check(ctx);
				const item = getEntry(ref.id);
				if (item.state === 'completed') return item.output as Output;
				if (item.state === 'failed') throw new QueueItemFailedError(item.id, item.failure!);
				if (item.state === 'cancelled') throw new QueueItemCancelledError(item.id, item.cancellation);
				if (closed) throw new QueueClosedError(closeReason);
				let waiters = resultWaiters.get(item.id);
				if (waiters === undefined) {
					waiters = new Set();
					resultWaiters.set(item.id, waiters);
				}
				await waitForChange(ctx, waiters);
			}
		},
		/**
		 * Extends the expiry time of the current claim owner.
		 *
		 * Renewal does not create a new claim id.
		 * Renewal keeps the same ownership attempt and only moves the expiry time.
		 *
		 * @internal
		 */
		async renew(ctx: Context, claim: QueueClaim<Input>, duration: Temporal.Duration | Temporal.DurationLike | string) {
			contextCore.check(ctx);
			const item = currentClaim(claim);
			const renewed = Object.freeze({ ...claim, expiresAt: clock.now().add(positiveDuration(duration, 'claim renewal duration')) });
			item.claim = renewed;
			events.emit(Object.freeze({ type: 'renewed', itemId: item.id, claimId: claim.id, expiresAt: renewed.expiresAt.toString() }));
			return renewed;
		},
		/**
		 * Returns a state snapshot without exposing mutable queue internals.
		 *
		 * The snapshot includes item counts and blocked waiter counts.
		 * Stale claims expire first so the numbers match current ownership.
		 *
		 * @internal
		 */
		async stats() {
			expireClaims();
			const counts: Record<ItemState, number> = { queued: 0, claimed: 0, completed: 0, failed: 0, cancelled: 0 };
			for (const item of items.values()) counts[item.state] += 1;
			return Object.freeze({
				...counts,
				waitingClaims: claimWaiters.size,
				waitingResults: [...resultWaiters.values()].reduce((total, waiters) => total + waiters.size, 0),
			});
		},
		/**
		 * Closes the queue and rejects blocked waiters.
		 *
		 * After closure, the queue stops admitting and claiming work.
		 * Blocked claim and result waiters receive `QueueClosedError` because no
		 * later state can satisfy their wait.
		 *
		 * @internal
		 */
		async close(reason?: unknown) {
			if (closed) return;
			closed = true;
			closeReason = reason;
			const error = new QueueClosedError(reason);
			rejectWaiters(claimWaiters, error);
			for (const waiters of resultWaiters.values()) rejectWaiters(waiters, error);
			resultWaiters.clear();
			events.emit(Object.freeze({ type: 'closed' }));
			const dispose = (events as { [Symbol.dispose]?: () => void })[Symbol.dispose];
			dispose?.call(events);
		},
		/**
		 * Async disposal closes the queue with a stable disposal reason.
		 *
		 * @internal
		 */
		async [Symbol.asyncDispose]() {
			await queue.close('Queue was disposed.');
		},
	});
	return queue;

	/**
	 * Rejects new queue work after closure.
	 *
	 * All mutating entry points use the same queue-open check.
	 * All failures use the same error shape and stored closure reason.
	 *
	 * @internal
	 */
	function assertOpen(): void {
		if (closed) throw new QueueClosedError(closeReason);
	}

	/**
	 * Counts only non-terminal items for active-capacity enforcement.
	 *
	 * Terminal items keep stable identity for result lookup and key-based
	 * idempotency.
	 * Terminal items no longer consume active capacity.
	 *
	 * @internal
	 */
	function activeCount(): number {
		let count = 0;
		for (const item of items.values()) if (item.state === 'queued' || item.state === 'claimed') count += 1;
		return count;
	}

	/**
	 * Gets the authoritative item record for a stable item id.
	 *
	 * Callers outside the queue never receive the record directly.
	 * Callers receive immutable references and claims instead.
	 *
	 * @internal
	 */
	function getEntry(id: string): Item<Input, Output> {
		const item = items.get(id);
		if (item === undefined) throw new QueueItemNotFoundError(id);
		return item;
	}

	/**
	 * Requires exact live ownership before a claim-scoped mutation proceeds.
	 *
	 * All claim-driven mutations use the same fence.
	 * QueueClaim id, item id, owner, and current claimed state must still match after
	 * expired claims are cleaned up.
	 * Any mismatch means the caller holds a stale claim.
	 *
	 * @internal
	 */
	function currentClaim(claim: QueueClaim<Input>): Item<Input, Output> {
		expireClaims();
		const item = getEntry(claim.itemId);
		if (item.state !== 'claimed' || item.claim?.id !== claim.id || item.claim.owner !== claim.owner) {
			throw new StaleClaimError(claim.itemId, claim.id);
		}
		return item;
	}

	/**
	 * Transitions one eligible item into a new claimed attempt.
	 *
	 * The item id stays stable.
	 * The claim id is new.
	 * Logical work identity stays separate from temporary ownership identity.
	 *
	 * @internal
	 */
	function claimEntry(item: Item<Input, Output>, owner: string, duration: Temporal.Duration): QueueClaim<Input> {
		const claimedAt = clock.now();
		const claim = Object.freeze({
			id: uniqueClaimId(createId, items),
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
		events.emit(Object.freeze({ type: 'claimed', itemId: item.id, claimId: claim.id, owner, attempt: claim.attempt }));
		return claim;
	}

	/**
	 * Returns expired claims to queued state before other operations observe ownership.
	 *
	 * `expireClaims()` recovers abandoned work.
	 * Without the check, a worker that crashes or stalls forever could hold the
	 * item indefinitely.
	 *
	 * @internal
	 */
	function expireClaims(): void {
		const now = clock.now();
		for (const item of items.values()) {
			if (item.state !== 'claimed' || item.claim === undefined) continue;
			if (Temporal.Instant.compare(item.claim.expiresAt, now) > 0) continue;
			const expired = item.claim;
			item.state = 'queued';
			item.claim = undefined;
			item.availableAt = now;
			events.emit(Object.freeze({ type: 'claim-expired', itemId: item.id, claimId: expired.id }));
		}
	}

	/**
	 * Finds the earliest future instant that may make `claim()` return a different answer.
	 *
	 * The next wake-up can come from delayed queued work becoming eligible or
	 * from an active claim expiring and returning to `queued`.
	 *
	 * @internal
	 */
	/** Return the next instant that can change claimability for one known item. */
	function nextWakeAt(item: Item<Input, Output>): Temporal.Instant | undefined {
		if (item.state === 'queued') return item.availableAt;
		if (item.state === 'claimed') return item.claim?.expiresAt;
		return undefined;
	}

	/** Return the next eligibility or claim-expiry instant that can change this exact item's claimability. */
function nextClaimWakeAt(): Temporal.Instant | undefined {
		let next: Temporal.Instant | undefined;
		for (const item of items.values()) {
			let candidate: Temporal.Instant | undefined;
			if (item.state === 'queued') candidate = item.availableAt;
			else if (item.state === 'claimed') candidate = item.claim?.expiresAt;
			if (candidate !== undefined && (next === undefined || Temporal.Instant.compare(candidate, next) < 0)) next = candidate;
		}
		return next;
	}

	/**
	 * Wakes callers waiting for one item to reach terminal state.
	 *
	 * @internal
	 */
	function settleResultWaiters(item: Item<Input, Output>): void {
		const waiters = resultWaiters.get(item.id);
		if (waiters === undefined) return;
		resultWaiters.delete(item.id);
		for (const waiter of waiters) {
			waiter.unlink();
			waiter.resolve();
		}
	}

	/**
	 * Wakes blocked claimers after queue state changes may have made work eligible.
	 *
	 * The queue uses a broadcast wake-up model. Each awakened claimer re-checks
	 * queue state and either claims work, waits again, or observes closure.
	 *
	 * @internal
	 */
	function wakeClaimWaiters(): void {
		for (const waiter of claimWaiters) {
			claimWaiters.delete(waiter);
			waiter.unlink();
			waiter.resolve();
		}
	}
}

/**
 * Waits for queue state to change without transferring ownership.
 *
 * A waiter can settle in three ways:
 * - another queue operation wakes it;
 * - the context is cancelled;
 * - an optional timer fires because delayed work or claim expiry may now matter.
 *
 * The helper only suspends the caller.
 * The helper does not change item ownership.
 * The helper does not expose mutable queue state while the caller sleeps.
 *
 * @internal
 */
function waitForChange(ctx: contextCore.Context, waiters: Set<Waiter>, delayMilliseconds?: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let waiter!: Waiter;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unlink = () => {
			ctx.signal.removeEventListener('abort', abort);
			if (timer !== undefined) clearTimeout(timer);
		};
		const settle = (action: () => void) => {
			if (!waiters.delete(waiter)) return;
			unlink();
			action();
		};
		const abort = () => settle(() => reject(ctx.signal.reason ?? new contextCore.ContextCancelledError()));
		waiter = { resolve, reject, unlink };
		if (ctx.signal.aborted) {
			reject(ctx.signal.reason ?? new contextCore.ContextCancelledError());
			return;
		}
		waiters.add(waiter);
		ctx.signal.addEventListener('abort', abort, { once: true });
		if (delayMilliseconds !== undefined) timer = setTimeout(() => settle(resolve), Math.max(0, delayMilliseconds));
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
	const duration = getDuration(value, label);
	if (durationMilliseconds(duration) <= 0) throw new TypeError(`${label} must be positive.`);
	return duration;
}

/**
 * Validates and normalizes a non-negative duration used by retry delays.
 *
 * @internal
 */
function nonNegativeDuration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	const duration = getDuration(value, label);
	if (durationMilliseconds(duration) < 0) throw new TypeError(`${label} must not be negative.`);
	return duration;
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
 * Converts a duration into milliseconds for validation and timer math.
 *
 * @internal
 */
function durationMilliseconds(value: Temporal.Duration): number {
	return value.total({ unit: 'milliseconds', relativeTo: Temporal.PlainDate.from('2000-01-01') });
}

/**
 * Calculates the bounded timer delay until one instant from another.
 *
 * The upper bound matches the practical `setTimeout()` range.
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
