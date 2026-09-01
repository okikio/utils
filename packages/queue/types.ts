import type { EventBus } from '@okikio/observables';
import type { Context } from '@okikio/context';
import type { Encoded as EncodedFailure } from '@okikio/failure';

export type { Context } from '@okikio/context';
export type { Encoded as EncodedFailure } from '@okikio/failure';

/**
 * Stable reference to one logical queue item.
 *
 * `QueueRef` identifies one item across the whole lifecycle.
 * Retries, re-claims, and terminal result lookup all use the same id.
 * `QueueClaim` uses a different id because one item can have many ownership
 * attempts.
 */
export interface QueueRef {
	/** Stable logical item identity returned from `add()`. */
	readonly id: string;
}

/**
 * Temporary ownership token for one queue item.
 *
 * A claim gives one worker the right to act on a queued item for a limited
 * time.
 * Operations such as `complete()`, `fail()`, `retry()`, and `renew()` use the
 * claim to prove that the caller still owns the item.
 */
export interface QueueClaim<Value> {
	/** Unique identity for the current claim attempt. */
	readonly id: string;
	/** Stable logical item identity that the claim currently owns. */
	readonly itemId: string;
	/** Worker or runtime identity that currently owns the claim. */
	readonly owner: string;
	/** Input value carried by the claimed work item. */
	readonly value: Value;
	/** Attempt count for the logical item. The first successful claim is `1`. */
	readonly attempt: number;
	/** Instant when the queue granted the ownership attempt. */
	readonly claimedAt: Temporal.Instant;
	/** Instant when the claim expires and the queue may offer the item again. */
	readonly expiresAt: Temporal.Instant;
}

/**
 * Options used while adding one queue item.
 *
 * The options control idempotency, claim order, and delayed availability.
 */
export interface QueueAddOptions {
	/**
	 * Optional stable key used for idempotent admission.
	 *
	 * If another item already owns the key, `add()` returns that item's `QueueRef`
	 * instead of creating a duplicate logical item. The queue does not compare the
	 * new input with the retained input. The caller must therefore derive the key
	 * from the complete logical work identity, including an input/version
	 * fingerprint when changed input must represent different work.
	 */
	readonly key?: string;
	/**
	 * QueueClaim priority. Higher values are claimed first.
	 *
	 * Equal priority falls back to FIFO insertion order.
	 */
	readonly priority?: number;
	/**
	 * Earliest instant when the item may be claimed.
	 *
	 * Omit the field to make the item immediately eligible.
	 */
	readonly availableAt?: Temporal.Instant;
}

/**
 * Options used while claiming available items.
 *
 * QueueClaim options control who owns the lease, how many items may be claimed, how
 * long the lease lasts, and whether the caller waits for future eligibility.
 */
export interface QueueClaimOptions {
	/**
	 * Optional stable item reference to claim exactly one known logical item.
	 *
	 * Durable schedulers use this after idempotent admission so replay can
	 * reattach to the same job instead of taking unrelated queued work. When
	 * supplied, `limit` must be one.
	 */
	readonly ref?: QueueRef;
	/**
	 * Explicit owner identity for the claim.
	 *
	 * If omitted, the queue uses `ctx.id` from the provided context.
	 */
	readonly owner?: string;
	/** Maximum number of items to claim in one operation. */
	readonly limit?: number;
	/**
	 * Lease duration for each claimed item.
	 *
	 * When the duration expires, the queue may return the item to `queued` state.
	 */
	readonly duration?: Temporal.Duration | Temporal.DurationLike | string;
	/**
	 * Wait for future eligibility instead of returning an empty result immediately.
	 *
	 * The wait ends when work becomes claimable, the context is cancelled, or the
	 * queue closes.
	 */
	readonly wait?: boolean;
}

/**
 * Options used while taking the next FIFO-visible item.
 *
 * `take()` always claims at most one item. The remaining options mirror the
 * single-item part of `claim()`.
 */
export interface QueueTakeOptions {
	/**
	 * Lease duration for the taken item.
	 *
	 * When the duration expires, the queue may return the item to `queued` state.
	 */
	readonly duration?: Temporal.Duration | Temporal.DurationLike | string;
	/**
	 * Wait for future eligibility instead of returning `undefined` immediately.
	 */
	readonly wait?: boolean;
}

/**
 * Inputs accepted while creating a FIFO-friendly queue adapter.
 *
 * The adapter owns one internal context so callers do not need to pass `ctx`
 * through ordinary FIFO-style queue calls.
 */
export interface FifoQueueOptions {
	/** Stable identity used by the adapter-owned context. */
	readonly id?: string;
	/** Optional parent cancellation signal for the adapter-owned context. */
	readonly signal?: AbortSignal;
	/** Clock used by the adapter-owned context when a custom clock is needed. */
	readonly clock?: Context['clock'];
	/** Optional explicit claim owner used for `take()` calls. */
	readonly owner?: string;
}

/**
 * Options used while returning claimed work to the queue for a later attempt.
 */
export interface QueueRetryOptions {
	/**
	 * Relative delay before the retried item becomes claimable again.
	 *
	 * Use the field for backoff. Do not combine it with `availableAt`.
	 */
	readonly delay?: Temporal.Duration | Temporal.DurationLike | string;
	/**
	 * Absolute instant when the retried item becomes claimable again.
	 *
	 * Use the field when the caller already knows the next wake-up instant.
	 */
	readonly availableAt?: Temporal.Instant;
	/**
	 * Optional priority override applied when the item re-enters `queued` state.
	 */
	readonly priority?: number;
}

/**
 * Authoritative queue event emitted after one committed state change.
 *
 * The events describe committed queue state.
 * Observers, diagnostics, and higher-level orchestration can use the event
 * stream as a stable lifecycle feed.
 */
export type QueueEventType =
	| Readonly<{ readonly type: 'added'; readonly itemId: string; readonly key?: string }>
	| Readonly<{ readonly type: 'claimed'; readonly itemId: string; readonly claimId: string; readonly owner: string; readonly attempt: number }>
	| Readonly<{ readonly type: 'renewed'; readonly itemId: string; readonly claimId: string; readonly expiresAt: string }>
	| Readonly<{ readonly type: 'completed'; readonly itemId: string; readonly claimId: string }>
	| Readonly<{ readonly type: 'failed'; readonly itemId: string; readonly claimId: string; readonly failureId: string }>
	| Readonly<{ readonly type: 'retried'; readonly itemId: string; readonly claimId: string; readonly availableAt: string }>
	| Readonly<{ readonly type: 'cancelled'; readonly itemId: string }>
	| Readonly<{ readonly type: 'claim-expired'; readonly itemId: string; readonly claimId: string }>
	| Readonly<{ readonly type: 'closed' }>;

/**
 * Snapshot counters for current queue state.
 *
 * The counters expose queue occupancy and waiter pressure.
 * The mutable item table stays private.
 */
export interface QueueStats {
	/** Number of items currently waiting in `queued` state. */
	readonly queued: number;
	/** Number of items currently owned by active claims. */
	readonly claimed: number;
	/** Number of items that reached successful terminal state. */
	readonly completed: number;
	/** Number of items that reached failed terminal state. */
	readonly failed: number;
	/** Number of items that reached cancelled terminal state. */
	readonly cancelled: number;
	/** Number of callers currently blocked in `claim({ wait: true })`. */
	readonly waitingClaims: number;
	/** Number of callers currently blocked in `result(ref)`. */
	readonly waitingResults: number;
}

/** State returned after waiting for one exact logical item to change scheduling eligibility. */
export type QueueWaitStateType = 'claimable' | 'terminal';

/**
 * At-least-once work transport with explicit claim ownership.
 *
 * A queue admits work, leases work to owners, blocks stale claims, and keeps
 * stable item identity until callers observe a terminal result.
 */
export interface Queue<Input, Output> extends AsyncDisposable {
	/**
	 * QueueEventType stream that reports authoritative queue state changes.
	 */
	readonly events: EventBus<QueueEventType>['events'];
	/**
	 * Add one logical work item and return its stable reference.
	 */
	add(ctx: Context, input: Input, options?: QueueAddOptions): Promise<QueueRef>;
	/**
	 * QueueClaim up to `limit` eligible items for temporary ownership.
	 */
	claim(ctx: Context, options?: QueueClaimOptions): Promise<readonly QueueClaim<Input>[]>;
	/**
	 * Wait until one exact logical item can be claimed or has already settled.
	 *
	 * The call takes no ownership. Schedulers can use it after releasing scarce
	 * provider capacity, then retry placement and claiming without holding a
	 * process, Worker, or remote-host slot during queue backoff.
	 */
	wait(ctx: Context, ref: QueueRef): Promise<QueueWaitStateType>;
	/**
	 * Commit successful output for the current claim owner.
	 */
	complete(ctx: Context, claim: QueueClaim<Input>, output: Output): Promise<void>;
	/**
	 * Commit a declared failure for the current claim owner.
	 */
	fail(ctx: Context, claim: QueueClaim<Input>, value: EncodedFailure): Promise<void>;
	/**
	 * Return the claimed item to the queue for another attempt.
	 */
	retry(ctx: Context, claim: QueueClaim<Input>, options?: QueueRetryOptions): Promise<void>;
	/**
	 * Cancel the logical item by stable reference.
	 */
	/**
	 * Cancel one logical item by producer reference or by the current live claim.
	 *
	 * A `QueueRef` is producer authority. It cancels the logical item regardless
	 * of whether a consumer currently owns a claim. A `QueueClaim` is consumer
	 * authority. It is validated before cancellation, so an expired consumer
	 * cannot cancel a newer attempt after its lease is lost.
	 */
	cancel(ctx: Context, owner: QueueRef | QueueClaim<Input>, reason?: unknown): Promise<void>;
	/**
	 * Wait for one item to reach terminal state without taking ownership.
	 */
	result(ctx: Context, ref: QueueRef): Promise<Output>;
	/**
	 * Extend the expiry time of the current claim owner.
	 */
	renew(ctx: Context, claim: QueueClaim<Input>, duration: Temporal.Duration | Temporal.DurationLike | string): Promise<QueueClaim<Input>>;
	/**
	 * Return an authoritative snapshot of queue counts and local waiter pressure.
	 *
	 * The operation is asynchronous because durable providers may need to read
	 * shared storage before they can report cross-process queue state.
	 */
	stats(): Promise<QueueStats>;
	/**
	 * Close the queue and reject blocked waiters.
	 */
	close(reason?: unknown): Promise<void>;
}

/**
 * Caller-owned handle for one FIFO-visible item.
 *
 * The handle wraps one underlying queue claim. The caller can complete, fail,
 * retry, or renew the item without passing the claim object back into queue
 * methods manually.
 */
export interface QueueClaimHandle<Input, Output> extends AsyncDisposable {
	/** Unique identity for the current claim attempt. */
	readonly id: string;
	/** Stable logical item identity for the taken item. */
	readonly itemId: string;
	/** Task or runtime identity that currently owns the item. */
	readonly owner: string;
	/** Input value carried by the taken item. */
	readonly value: Input;
	/** Attempt count for the logical item. The first successful take is `1`. */
	readonly attempt: number;
	/** Instant when the queue granted the current take. */
	readonly claimedAt: Temporal.Instant;
	/** Instant when the current take expires. */
	readonly expiresAt: Temporal.Instant;
	/** Commit successful output for the taken item. */
	complete(output: Output): Promise<void>;
	/** Commit a declared failure for the taken item. */
	fail(value: EncodedFailure): Promise<void>;
	/** Return the taken item to the queue for another attempt. */
	retry(options?: QueueRetryOptions): Promise<void>;
	/** Extend the expiry time of the taken item and return the renewed handle. */
	renew(duration: Temporal.Duration | Temporal.DurationLike | string): Promise<QueueClaimHandle<Input, Output>>;
}

/**
 * FIFO-friendly adapter over the claimed-work queue.
 *
 * The adapter keeps the same recovery and ownership rules under the hood, but
 * exposes a smaller surface for callers that want one-at-a-time queue usage.
 */
export interface FifoQueue<Input, Output> extends AsyncDisposable {
	/** QueueEventType stream that reports authoritative queue state changes. */
	readonly events: EventBus<QueueEventType>['events'];
	/** Add one logical work item and return its stable reference. */
	add(input: Input, options?: QueueAddOptions): Promise<QueueRef>;
	/** Take the next eligible item or wait for one item when configured. */
	take(options?: QueueTakeOptions): Promise<QueueClaimHandle<Input, Output> | undefined>;
	/** Cancel the logical item by stable reference. */
	cancel(ref: QueueRef, reason?: unknown): Promise<void>;
	/** Wait for one item to reach terminal state without taking ownership. */
	result(ref: QueueRef): Promise<Output>;
	/** Return an authoritative snapshot of queue counts and local waiter pressure. */
	stats(): Promise<QueueStats>;
	/** Close the queue and reject blocked waiters. */
	close(reason?: unknown): Promise<void>;
}

/**
 * Inputs accepted by the process-local memory queue.
 */
export interface MemoryQueueOptions {
	/**
	 * Maximum number of active items.
	 *
	 * Active means `queued` or `claimed`. Terminal items do not consume the
	 * capacity.
	 */
	readonly capacity?: number;
	/** Clock used for delayed availability, expiry, and renewals. */
	readonly clock?: Context['clock'];
	/**
	 * Optional id generator for both item ids and claim ids.
	 *
	 * Tests often supply a deterministic generator so claim sequences stay easy to
	 * assert.
	 */
	readonly id?: () => string;
	/**
	 * Default claim lease duration used when `claim()` receives no explicit
	 * duration.
	 */
	readonly defaultClaimDuration?: Temporal.Duration | Temporal.DurationLike | string;
}
