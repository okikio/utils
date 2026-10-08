# @okikio/queue contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                | Source                   | Reference       |
| --------------------- | ------------------------ | --------------- |
| `@okikio/queue`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/queue/fifo`  | [./fifo.ts](./fifo.ts)   | [fifo](#fifo)   |
| `@okikio/queue/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/queue`. [Source](./mod.ts).

Give queued work an expiring claim and fenced completion. Removing an item from an array loses it when a worker dies;
leaving it in place without a claim permits concurrent duplicate ownership.

Start with FIFO convenience for a small local producer, then use explicit claims for multiple executors, priority or
expiry recovery. Renewal extends an attempt; completion must present the exact live claim. Expired claims can be
recovered and stale owners cannot replace the result. memory() loses all state when the process exits. A storage adapter
must make admission, claiming and fenced completion atomic for durable or distributed work.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding     | Contract owner or source                                           |
| -------------------- | ------------------------------------------------------------------ |
| `EventBus`           | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `duration`           | [duration contracts](../duration/API.md)                           |
| `context`            | [context contracts](../context/API.md)                             |
| `Context`            | [context contracts](../context/API.md)                             |
| `EncodedFailure`     | [failure contracts](../failure/API.md)                             |
| `MemoryQueueOptions` | [Source](types.ts)                                                 |
| `Queue`              | [Source](types.ts)                                                 |
| `QueueAddOptions`    | [Source](types.ts)                                                 |
| `QueueClaim`         | [Source](types.ts)                                                 |
| `QueueClaimOptions`  | [Source](types.ts)                                                 |
| `QueueEventType`     | [Source](types.ts)                                                 |
| `QueueRef`           | [Source](types.ts)                                                 |
| `QueueRetryOptions`  | [Source](types.ts)                                                 |
| `QueueStats`         | [Source](types.ts)                                                 |

### root: memory

[Declaration source](mod.ts#L217)

````text
function memory<Input, Output>(options: MemoryQueueOptions): Queue<Input, Output>
  Create a process-local queue that implements the same ownership contract as durable adapters.

  State stays in local process memory.
  Ownership rules match the stronger queue model that durable adapters must
  also follow.

  Each worker receives a claim with an owner, an attempt number, and an expiry
  time.
  Later mutations must prove that the claim still owns the item.

  Three identities stay separate:

  - item identity: the stable reference returned from `add()`;
  - claim identity: the temporary lease returned from `claim()`;
  - terminal outcome: completed output, encoded failure, or cancellation.

  One caller can add work.
  Another caller can process work.
  A third caller can wait for the final result.
  No caller needs shared mutable state.

  ```text
  add(input)
     |
     v
  ready --claim(owner, lease)--> claimed
    ^                              |
    |                              +-- complete(output) --> completed
    |                              +-- fail(failure) -----> failed
    |                              +-- cancel(reason) ----> cancelled
    `---------- retry(delay) <-----+

  expired claim -> ready for a new owner
  stale owner   -> completion is rejected
  ```

  The memory queue keeps claim identity, expiry, and stale-owner rules that
  durable adapters also need.
````

### root: QueueCapacityError

[Declaration source](mod.ts#L57)

```text
class QueueCapacityError extends Error
  Queue active-item capacity was exhausted.

  constructor(capacity: number)
    Create a capacity error that records the configured active-item limit.
  readonly capacity: number
    Active-item capacity that rejected the new admission.
```

### root: QueueClosedError

[Declaration source](mod.ts#L44)

```text
class QueueClosedError extends Error
  Operation attempted after a queue stopped accepting work.

  constructor(reason?: unknown)
    Create a queue-closed error with the stored closure reason.
  readonly reason: unknown
    Reason recorded when the queue closed, if the caller supplied one.
```

### root: QueueItemCancelledError

[Declaration source](mod.ts#L115)

```text
class QueueItemCancelledError extends Error
  Result wait failed because the queue item was cancelled.

  constructor(itemId: string, reason?: unknown)
    Create a result error that exposes the stored cancellation reason.
  readonly itemId: string
    Stable item id that reached cancelled terminal state.
  readonly reason: unknown
    Optional cancellation reason recorded on the item.
```

### root: QueueItemFailedError

[Declaration source](mod.ts#L99)

```text
class QueueItemFailedError extends Error
  Result wait failed because the queue item reached a failed state.

  constructor(itemId: string, failure: EncodedFailure)
    Create a result error that exposes the encoded item failure.
  readonly itemId: string
    Stable item id that reached failed terminal state.
  readonly failure: EncodedFailure
    Encoded failure committed for the item.
```

### root: QueueItemNotFoundError

[Declaration source](mod.ts#L70)

```text
class QueueItemNotFoundError extends Error
  A queue reference does not identify a known item.

  constructor(itemId: string)
    Create an item-not-found error for one stable item id.
  readonly itemId: string
    Unknown item id supplied by the caller.
```

### root: StaleClaimError

[Declaration source](mod.ts#L83)

```text
class StaleClaimError extends Error
  A queue claim no longer owns the referenced item.

  constructor(itemId: string, claimId: string)
    Create a stale-claim error for one item id and claim id pair.
  readonly itemId: string
    Stable item id that the stale claim tried to mutate.
  readonly claimId: string
    QueueClaim id that no longer owns the item.
```

### root: Context

[Declaration source](mod.ts#L820)

```text
reference Context: ./packages/context/types.ts:37:1
```

### root: EncodedFailure

[Declaration source](mod.ts#L821)

```text
reference EncodedFailure: ./packages/failure/types.ts:45:1
```

### root: FifoQueue

[Declaration source](mod.ts#L822)

```text
reference FifoQueue: ./packages/queue/types.ts:341:1
```

### root: FifoQueueOptions

[Declaration source](mod.ts#L823)

```text
reference FifoQueueOptions: ./packages/queue/types.ts:138:1
```

### root: MemoryQueueOptions

[Declaration source](mod.ts#L824)

```text
reference MemoryQueueOptions: ./packages/queue/types.ts:361:1
```

### root: Queue

[Declaration source](mod.ts#L825)

```text
reference Queue: ./packages/queue/types.ts:233:1
```

### root: QueueAddOptions

[Declaration source](mod.ts#L826)

```text
reference QueueAddOptions: ./packages/queue/types.ts:50:1
```

### root: QueueClaim

[Declaration source](mod.ts#L827)

```text
reference QueueClaim: ./packages/queue/types.ts:28:1
```

### root: QueueClaimHandle

[Declaration source](mod.ts#L828)

```text
reference QueueClaimHandle: ./packages/queue/types.ts:310:1
```

### root: QueueClaimOptions

[Declaration source](mod.ts#L829)

```text
reference QueueClaimOptions: ./packages/queue/types.ts:81:1
```

### root: QueueEventType

[Declaration source](mod.ts#L830)

```text
reference QueueEventType: ./packages/queue/types.ts:178:1
```

### root: QueueRef

[Declaration source](mod.ts#L831)

```text
reference QueueRef: ./packages/queue/types.ts:15:1
```

### root: QueueRetryOptions

[Declaration source](mod.ts#L832)

```text
reference QueueRetryOptions: ./packages/queue/types.ts:152:1
```

### root: QueueStats

[Declaration source](mod.ts#L833)

```text
reference QueueStats: ./packages/queue/types.ts:207:1
```

### root: QueueTakeOptions

[Declaration source](mod.ts#L834)

```text
reference QueueTakeOptions: ./packages/queue/types.ts:119:1
```

### root: QueueWaitStateType

[Declaration source](mod.ts#L835)

```text
reference QueueWaitStateType: ./packages/queue/types.ts:225:1
```

### root: fifo

[Declaration source](mod.ts#L41)

```text
reference fifo: ./packages/queue/fifo.ts:30:1
```

## fifo

Import `@okikio/queue/fifo`. [Source](./fifo.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding    | Contract owner or source               |
| ------------------- | -------------------------------------- |
| `contextCore`       | [context contracts](../context/API.md) |
| `Context`           | [context contracts](../context/API.md) |
| `EncodedFailure`    | [failure contracts](../failure/API.md) |
| `FifoQueue`         | [Source](types.ts)                     |
| `FifoQueueOptions`  | [Source](types.ts)                     |
| `Queue`             | [Source](types.ts)                     |
| `QueueAddOptions`   | [Source](types.ts)                     |
| `QueueClaim`        | [Source](types.ts)                     |
| `QueueClaimHandle`  | [Source](types.ts)                     |
| `QueueClaimOptions` | [Source](types.ts)                     |
| `QueueRef`          | [Source](types.ts)                     |
| `QueueRetryOptions` | [Source](types.ts)                     |
| `QueueTakeOptions`  | [Source](types.ts)                     |

### fifo: fifo

[Declaration source](fifo.ts#L30)

```text
function fifo<Input, Output>(queue: Queue<Input, Output>, options: FifoQueueOptions): FifoQueue<Input, Output>
  Create a FIFO-friendly adapter over a claimed-work queue.

  The adapter keeps the same queue rules under the hood.
  The public surface becomes smaller for callers that want one item at a time.
  `take()` wraps `claim({ limit: 1 })`.
  Each taken item wraps `complete()`, `fail()`, `retry()`, and `renew()`.

  The adapter owns one internal context.
  Callers can use FIFO-style queue calls without passing `ctx` through each
  step. Recovery, expiry, stale-claim rejection, and result waiting still come
  from the underlying claimed-work queue.
```

## types

Import `@okikio/queue/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                           |
| ---------------- | ------------------------------------------------------------------ |
| `EventBus`       | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `Context`        | [context contracts](../context/API.md)                             |
| `EncodedFailure` | [failure contracts](../failure/API.md)                             |

### types: FifoQueue

[Declaration source](types.ts#L341)

```text
interface FifoQueue<Input, Output> extends AsyncDisposable
  FIFO-friendly adapter over the claimed-work queue.

  The adapter keeps the same recovery and ownership rules under the hood, but
  exposes a smaller surface for callers that want one-at-a-time queue usage.

  readonly events: EventBus<QueueEventType>["events"]
    QueueEventType stream that reports authoritative queue state changes.
  add(input: Input, options?: QueueAddOptions): Promise<QueueRef>
    Add one logical work item and return its stable reference.
  take(options?: QueueTakeOptions): Promise<QueueClaimHandle<Input, Output> | undefined>
    Take the next eligible item or wait for one item when configured.
  cancel(ref: QueueRef, reason?: unknown): Promise<void>
    Cancel the logical item by stable reference.
  result(ref: QueueRef): Promise<Output>
    Wait for one item to reach terminal state without taking ownership.
  stats(): Promise<QueueStats>
    Return an authoritative snapshot of queue counts and local waiter pressure.
  close(reason?: unknown): Promise<void>
    Close the queue and reject blocked waiters.
```

### types: FifoQueueOptions

[Declaration source](types.ts#L138)

```text
interface FifoQueueOptions
  Inputs accepted while creating a FIFO-friendly queue adapter.

  The adapter owns one internal context so callers do not need to pass `ctx`
  through ordinary FIFO-style queue calls.

  readonly id?: string
    Stable identity used by the adapter-owned context.
  readonly signal?: AbortSignal
    Optional parent cancellation signal for the adapter-owned context.
  readonly clock?: Context["clock"]
    Clock used by the adapter-owned context when a custom clock is needed.
  readonly owner?: string
    Optional explicit claim owner used for `take()` calls.
```

### types: MemoryQueueOptions

[Declaration source](types.ts#L361)

```text
interface MemoryQueueOptions
  Inputs accepted by the process-local memory queue.

  readonly capacity?: number
    Maximum number of active items.

    Active means `queued` or `claimed`. Terminal items do not consume the
    capacity.
  readonly clock?: Context["clock"]
    Clock used for delayed availability, expiry, and renewals.
  readonly id?: () => string
    Optional id generator for both item ids and claim ids.

    Tests often supply a deterministic generator so claim sequences stay easy to
    assert.
  readonly defaultClaimDuration?: Temporal.Duration | Temporal.DurationLike | string
    Default claim lease duration used when `claim()` receives no explicit
    duration.
```

### types: Queue

[Declaration source](types.ts#L233)

```text
interface Queue<Input, Output> extends AsyncDisposable
  At-least-once work transport with explicit claim ownership.

  A queue admits work, leases work to owners, blocks stale claims, and keeps
  stable item identity until callers observe a terminal result.

  readonly events: EventBus<QueueEventType>["events"]
    QueueEventType stream that reports authoritative queue state changes.
  add(ctx: Context, input: Input, options?: QueueAddOptions): Promise<QueueRef>
    Add one logical work item and return its stable reference.
  claim(ctx: Context, options?: QueueClaimOptions): Promise<readonly QueueClaim<Input>[]>
    QueueClaim up to `limit` eligible items for temporary ownership.
  wait(ctx: Context, ref: QueueRef): Promise<QueueWaitStateType>
    Wait until one exact logical item can be claimed or has already settled.

    The call takes no ownership. Schedulers can use it after releasing scarce
    provider capacity, then retry placement and claiming without holding a
    process, Worker, or remote-host slot during queue backoff.
  complete(ctx: Context, claim: QueueClaim<Input>, output: Output): Promise<void>
    Commit successful output for the current claim owner.
  fail(ctx: Context, claim: QueueClaim<Input>, value: EncodedFailure): Promise<void>
    Commit a declared failure for the current claim owner.
  retry(ctx: Context, claim: QueueClaim<Input>, options?: QueueRetryOptions): Promise<void>
    Return the claimed item to the queue for another attempt.
  cancel(ctx: Context, owner: QueueRef | QueueClaim<Input>, reason?: unknown): Promise<void>
    Cancel one logical item by producer reference or by the current live claim.

    A `QueueRef` is producer authority. It cancels the logical item regardless
    of whether a consumer currently owns a claim. A `QueueClaim` is consumer
    authority. It is validated before cancellation, so an expired consumer
    cannot cancel a newer attempt after its lease is lost.
  result(ctx: Context, ref: QueueRef): Promise<Output>
    Wait for one item to reach terminal state without taking ownership.
  renew(ctx: Context, claim: QueueClaim<Input>, duration: Temporal.Duration | Temporal.DurationLike | string): Promise<QueueClaim<Input>>
    Extend the expiry time of the current claim owner.
  stats(): Promise<QueueStats>
    Return an authoritative snapshot of queue counts and local waiter pressure.

    The operation is asynchronous because durable providers may need to read
    shared storage before they can report cross-process queue state.
  close(reason?: unknown): Promise<void>
    Close the queue and reject blocked waiters.
```

### types: QueueAddOptions

[Declaration source](types.ts#L50)

```text
interface QueueAddOptions
  Options used while adding one queue item.

  The options control idempotency, claim order, and delayed availability.

  readonly key?: string
    Optional stable key used for idempotent admission.

    If another item already owns the key, `add()` returns that item's `QueueRef`
    instead of creating a duplicate logical item. The queue does not compare the
    new input with the retained input. The caller must therefore derive the key
    from the complete logical work identity, including an input/version
    fingerprint when changed input must represent different work.
  readonly priority?: number
    QueueClaim priority. Higher values are claimed first.

    Equal priority falls back to FIFO insertion order.
  readonly availableAt?: Temporal.Instant
    Earliest instant when the item may be claimed.

    Omit the field to make the item immediately eligible.
```

### types: QueueClaim

[Declaration source](types.ts#L28)

```text
interface QueueClaim<Value>
  Temporary ownership token for one queue item.

  A claim gives one worker the right to act on a queued item for a limited
  time.
  Operations such as `complete()`, `fail()`, `retry()`, and `renew()` use the
  claim to prove that the caller still owns the item.

  readonly id: string
    Unique identity for the current claim attempt.
  readonly itemId: string
    Stable logical item identity that the claim currently owns.
  readonly owner: string
    Worker or runtime identity that currently owns the claim.
  readonly value: Value
    Input value carried by the claimed work item.
  readonly attempt: number
    Attempt count for the logical item. The first successful claim is `1`.
  readonly claimedAt: Temporal.Instant
    Instant when the queue granted the ownership attempt.
  readonly expiresAt: Temporal.Instant
    Instant when the claim expires and the queue may offer the item again.
```

### types: QueueClaimHandle

[Declaration source](types.ts#L310)

```text
interface QueueClaimHandle<Input, Output> extends AsyncDisposable
  Caller-owned handle for one FIFO-visible item.

  The handle wraps one underlying queue claim. The caller can complete, fail,
  retry, or renew the item without passing the claim object back into queue
  methods manually.

  readonly id: string
    Unique identity for the current claim attempt.
  readonly itemId: string
    Stable logical item identity for the taken item.
  readonly owner: string
    Task or runtime identity that currently owns the item.
  readonly value: Input
    Input value carried by the taken item.
  readonly attempt: number
    Attempt count for the logical item. The first successful take is `1`.
  readonly claimedAt: Temporal.Instant
    Instant when the queue granted the current take.
  readonly expiresAt: Temporal.Instant
    Instant when the current take expires.
  complete(output: Output): Promise<void>
    Commit successful output for the taken item.
  fail(value: EncodedFailure): Promise<void>
    Commit a declared failure for the taken item.
  retry(options?: QueueRetryOptions): Promise<void>
    Return the taken item to the queue for another attempt.
  renew(duration: Temporal.Duration | Temporal.DurationLike | string): Promise<QueueClaimHandle<Input, Output>>
    Extend the expiry time of the taken item and return the renewed handle.
```

### types: QueueClaimOptions

[Declaration source](types.ts#L81)

```text
interface QueueClaimOptions
  Options used while claiming available items.

  QueueClaim options control who owns the lease, how many items may be claimed, how
  long the lease lasts, and whether the caller waits for future eligibility.

  readonly ref?: QueueRef
    Optional stable item reference to claim exactly one known logical item.

    Durable schedulers use this after idempotent admission so replay can
    reattach to the same job instead of taking unrelated queued work. When
    supplied, `limit` must be one.
  readonly owner?: string
    Explicit owner identity for the claim.

    If omitted, the queue uses `ctx.id` from the provided context.
  readonly limit?: number
    Maximum number of items to claim in one operation.
  readonly duration?: Temporal.Duration | Temporal.DurationLike | string
    Lease duration for each claimed item.

    When the duration expires, the queue may return the item to `queued` state.
  readonly wait?: boolean
    Wait for future eligibility instead of returning an empty result immediately.

    The wait ends when work becomes claimable, the context is cancelled, or the
    queue closes.
```

### types: QueueRef

[Declaration source](types.ts#L15)

```text
interface QueueRef
  Stable reference to one logical queue item.

  `QueueRef` identifies one item across the whole lifecycle.
  Retries, re-claims, and terminal result lookup all use the same id.
  `QueueClaim` uses a different id because one item can have many ownership
  attempts.

  readonly id: string
    Stable logical item identity returned from `add()`.
```

### types: QueueRetryOptions

[Declaration source](types.ts#L152)

```text
interface QueueRetryOptions
  Options used while returning claimed work to the queue for a later attempt.

  readonly delay?: Temporal.Duration | Temporal.DurationLike | string
    Relative delay before the retried item becomes claimable again.

    Use the field for backoff. Do not combine it with `availableAt`.
  readonly availableAt?: Temporal.Instant
    Absolute instant when the retried item becomes claimable again.

    Use the field when the caller already knows the next wake-up instant.
  readonly priority?: number
    Optional priority override applied when the item re-enters `queued` state.
```

### types: QueueStats

[Declaration source](types.ts#L207)

```text
interface QueueStats
  Snapshot counters for current queue state.

  The counters expose queue occupancy and waiter pressure.
  The mutable item table stays private.

  readonly queued: number
    Number of items currently waiting in `queued` state.
  readonly claimed: number
    Number of items currently owned by active claims.
  readonly completed: number
    Number of items that reached successful terminal state.
  readonly failed: number
    Number of items that reached failed terminal state.
  readonly cancelled: number
    Number of items that reached cancelled terminal state.
  readonly waitingClaims: number
    Number of callers currently blocked in `claim({ wait: true })`.
  readonly waitingResults: number
    Number of callers currently blocked in `result(ref)`.
```

### types: QueueTakeOptions

[Declaration source](types.ts#L119)

```text
interface QueueTakeOptions
  Options used while taking the next FIFO-visible item.

  `take()` always claims at most one item. The remaining options mirror the
  single-item part of `claim()`.

  readonly duration?: Temporal.Duration | Temporal.DurationLike | string
    Lease duration for the taken item.

    When the duration expires, the queue may return the item to `queued` state.
  readonly wait?: boolean
    Wait for future eligibility instead of returning `undefined` immediately.
```

### types: QueueEventType

[Declaration source](types.ts#L178)

```text
type QueueEventType = Readonly<{ readonly type: "added"; readonly itemId: string; readonly key?: string; }> | Readonly<{ readonly type: "claimed"; readonly itemId: string; readonly claimId: string; readonly owner: string; readonly attempt: number; }> | Readonly<{ readonly type: "renewed"; readonly itemId: string; readonly claimId: string; readonly expiresAt: string; }> | Readonly<{ readonly type: "completed"; readonly itemId: string; readonly claimId: string; }> | Readonly<{ readonly type: "failed"; readonly itemId: string; readonly claimId: string; readonly failureId: string; }> | Readonly<{ readonly type: "retried"; readonly itemId: string; readonly claimId: string; readonly availableAt: string; }> | Readonly<{ readonly type: "cancelled"; readonly itemId: string; }> | Readonly<{ readonly type: "claim-expired"; readonly itemId: string; readonly claimId: string; }> | Readonly<{ readonly type: "closed"; }>
  Authoritative queue event emitted after one committed state change.

  The events describe committed queue state.
  Observers, diagnostics, and higher-level orchestration can use the event
  stream as a stable lifecycle feed.
```

### types: QueueWaitStateType

[Declaration source](types.ts#L225)

```text
type QueueWaitStateType = "claimable" | "terminal"
  State returned after waiting for one exact logical item to change scheduling eligibility.
```

### types: Context

[Declaration source](types.ts#L4)

```text
reference Context: ./packages/context/types.ts:37:1
```

### types: EncodedFailure

[Declaration source](types.ts#L5)

```text
reference EncodedFailure: ./packages/failure/types.ts:45:1
```
