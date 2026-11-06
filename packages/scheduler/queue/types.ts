import type { QueueEventType } from '@okikio/telemetry/events';
import type { EventBus } from '@okikio/observables/events';
import type { Context } from '@okikio/context';
import type { Encoded as EncodedFailure } from '@okikio/result/failure';

export type { Context } from '@okikio/context';
export type { Encoded as EncodedFailure } from '@okikio/result/failure';

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
 * Observation emitted after a committed change through this queue handle. Other handles may not receive it.
 *
 * The events describe committed queue state observed by this handle; use result() and stats() for current authority.
 * Observers, diagnostics, and higher-level orchestration can use the event
 * stream as a stable lifecycle feed.
 */
export type { QueueEventType } from '@okikio/telemetry/events';

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
	/** Inspect bounded metadata pages; cursor identity is provider/queue/filter bound, never authorization. */
	inspect(options: QueueInspectOptions): Promise<QueuePageType>;
	/** Copy one retained failed/cancelled item into a new logical item. A key deduplicates the copy while retained. */
	redrive(ctx: Context, ref: QueueRef, options: QueueRedriveOptions): Promise<QueueRef>;
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
	renew(
		ctx: Context,
		claim: QueueClaim<Input>,
		duration: Temporal.Duration | Temporal.DurationLike | string,
	): Promise<QueueClaim<Input>>;
	/**
	 * Return an authoritative snapshot of queue counts and local waiter pressure.
	 *
	 * The operation is asynchronous because durable providers may need to read
	 * shared storage before they can report cross-process queue state.
	 */
	stats(): Promise<QueueStats>;
	/** Remove expired terminal records within an explicit budget. Removed keys may be admitted again. */
	prune(options?: QueuePruneOptions): Promise<QueuePruneResult>;
	/**
	 * Close the queue and reject blocked waiters.
	 */
	close(reason?: unknown): Promise<void>;
}

/**
 * One taken attempt, with methods that carry its exact claim back to the queue.
 * Disposing this handle makes no completion, failure or retry decision. Call one
 * of those methods explicitly; otherwise the lease must expire before reclaim.
 * Keep the new handle returned by renew(), since it carries the new expiry.
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
	/** Notifications after local transitions. Await result() or mutation methods for their authoritative outcomes. */
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
	/** Remove expired terminal records within an explicit budget. Removed keys may be admitted again. */
	prune(options?: QueuePruneOptions): Promise<QueuePruneResult>;
	/** Close the queue and reject blocked waiters. */
	close(reason?: unknown): Promise<void>;
}

/**
 * Inputs accepted by the process-local memory queue.
 */
export interface MemoryQueueOptions {
	/** Receive subscriber callback failures without failing queued work. */
	readonly onObserverError?: (error: unknown) => void | PromiseLike<void>;
	/**
	 * Maximum number of active items.
	 *
	 * Active means `queued` or `claimed`. Terminal items do not consume the
	 * capacity. The default capacity is 10,000 active items.
	 */
	readonly capacity?: number;
	/** Maximum concurrent blocked claim and result calls in this view. Defaults to 1,000. */
	readonly maximumWaiters?: number;
	/** Bounded terminal history. Defaults to 10,000 records retained for up to 24 elapsed hours. */
	readonly retention?: QueueRetentionOptions;
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

/** Terminal history also bounds deduplication: a removed key can admit new work. */
export interface QueueRetentionOptions {
	/** Maximum retained terminal records. Defaults to 10,000. */
	readonly limit?: number;
	/** Fixed elapsed retention duration; calendar units are rejected. Defaults to 24 hours. */
	readonly duration?: Temporal.Duration | Temporal.DurationLike | string;
}
/** Bound one explicit maintenance operation. */
export interface QueuePruneOptions {
	/** Maximum deleted terminal rows in this call, from 1 through 1,000. Defaults to 1,000. */
	readonly limit?: number;
}
/** Result of one bounded terminal-history maintenance pass. */
export interface QueuePruneResult {
	/** Number of terminal records and their deduplication keys removed. */
	readonly deleted: number;
	/** Whether another eligible record was observed. Concurrent calls can change this hint. */
	readonly more: boolean;
}

/** Stored lifecycle, not permission to claim an item. Expired claims may remain stored as claimed until recovery. */
export type QueueStateType = 'queued' | 'claimed' | 'completed' | 'failed' | 'cancelled';
/** Metadata only: no payload, failure details, credentials or claim token. */
export interface QueueEntryType {
	/** Stable logical item identity. */
	readonly id: string;
	/** Stored lifecycle at this page read. */
	readonly state: QueueStateType;
	/** Claim attempts already issued for this item. */
	readonly attempt: number;
	/** Descending scheduling priority; inspection instead orders by admission sequence. */
	readonly priority: number;
	/** Source logical item when this record was copied by redrive. */
	readonly redrivenFrom?: string;
}
/** Explicit limits bound rows scanned as well as rows returned. */
export interface QueueInspectOptions {
	/** Match one stored state, or all states when absent. */
	readonly state?: QueueStateType;
	/** Opaque continuation from this exact queue and filter. Not a stable database snapshot. */
	readonly cursor?: string;
	/** Maximum returned entries, 1 through 1,000. */
	readonly limit: number;
	/** Maximum sequence positions/rows examined, 1 through 10,000 and at least limit. */
	readonly maximumScanned: number;
}
/** A finite admission watermark excludes later additions; concurrent changes and pruning remain visible. */
export interface QueuePageType {
	/** Frozen metadata in admission order. */
	readonly entries: readonly QueueEntryType[];
	/** Present when the watermark has not been fully scanned; an empty page may still continue. */
	readonly cursor?: string;
	/** Actual examined positions/rows for this page. */
	readonly scanned: number;
}
/** Redrive creates attempt zero and preserves the source priority, without reviving its old claim. */
export interface QueueRedriveOptions {
	/** Nonempty key, distinct from any unrelated retained item's key. Retention bounds deduplication. */
	readonly key: string;
}
