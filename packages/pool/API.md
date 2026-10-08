# @okikio/pool contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import               | Source                   | Reference       |
| -------------------- | ------------------------ | --------------- |
| `@okikio/pool`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/pool/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/pool`. [Source](./mod.ts).

Reuse a bounded set of expensive resources while retaining explicit lease ownership. Opening a connection for every
request wastes setup work; sharing one connection without leases can interleave incompatible operations.

Replace the example value with a database connection, browser page or Worker handle, then configure validation, idle age
and acquisition timeout. Release a lease after each use; close the pool at the owning host lifetime. The pool owns
created values while callers borrow leased values. A limit controls resource count, not queue-job authority or
distributed placement.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                           |
| ---------------- | ------------------------------------------------------------------ |
| `EventBus`       | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `context`        | [context contracts](../context/API.md)                             |
| `duration`       | [duration contracts](../duration/API.md)                           |
| `Context`        | [context contracts](../context/API.md)                             |
| `Owned`          | [context contracts](../context/API.md)                             |
| `CreateOptions`  | [Source](types.ts)                                                 |
| `Event`          | [Source](types.ts)                                                 |
| `Lease`          | [Source](types.ts)                                                 |
| `Pool`           | [Source](types.ts)                                                 |
| `Stats`          | [Source](types.ts)                                                 |

### root: create

[Declaration source](mod.ts#L133)

````text
async function create<Value>(options: CreateOptions<Value>): Promise<Pool<Value>>
  Create a bounded reusable-value pool with explicit ownership and fair acquisition waits.

  ```text
  acquire(ctx)
     |
     +-- idle value -------------------------------> Lease
     |
     +-- capacity available -> create(value) ------> Lease
     |
     `-- saturated -> FIFO waiter -> release ------> retry acquire

  Lease.dispose() -> idle queue or close(value)
  Lease.invalidate(reason) -> close(value)
  Pool.drain() -> stop admission -> wait active transitions -> close idle
  ```

  The pool owns every created value. A lease only borrows one value until its
  disposal either returns a healthy value to the pool or closes it.
````

### root: PoolAcquireTimeoutError

[Declaration source](mod.ts#L49)

```text
class PoolAcquireTimeoutError extends Error
  Pool acquisition exceeded its configured timeout.

  constructor(duration: Temporal.Duration)
    Create one acquisition-timeout error with the normalized configured duration.
  readonly duration: Temporal.Duration
    Configured timeout that elapsed before a value became available.
```

### root: PoolUnavailableError

[Declaration source](mod.ts#L33)

```text
class PoolUnavailableError extends Error
  Acquisition attempted while a pool is draining or disposed.

  constructor(state: "draining" | "disposed", reason?: unknown)
    Create one unavailable error without losing the owner-supplied stop reason.
  readonly state: "draining" | "disposed"
    Lifecycle state that rejected the acquisition.
  readonly reason: unknown
    Original drain/disposal reason when the owner supplied one.
```

### root: CreateOptions

[Declaration source](mod.ts#L664)

```text
reference CreateOptions: ./packages/pool/types.ts:59:1
```

### root: Event

[Declaration source](mod.ts#L664)

```text
reference Event: ./packages/pool/types.ts:4:1
```

### root: Lease

[Declaration source](mod.ts#L664)

```text
reference Lease: ./packages/pool/types.ts:33:1
```

### root: Pool

[Declaration source](mod.ts#L664)

```text
reference Pool: ./packages/pool/types.ts:45:1
```

### root: Stats

[Declaration source](mod.ts#L664)

```text
reference Stats: ./packages/pool/types.ts:15:1
```

## types

Import `@okikio/pool/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                           |
| ---------------- | ------------------------------------------------------------------ |
| `EventBus`       | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `Context`        | [context contracts](../context/API.md)                             |

### types: CreateOptions

[Declaration source](types.ts#L59)

```text
interface CreateOptions<Value>
  Inputs accepted while creating a pool.

  readonly ctx: Context
    Borrowed execution context for identity, cancellation, deadlines and clock access.
  readonly minimum?: number
    Minimum reusable values retained by the pool; omitted input defaults to zero.
  readonly maximum: number
    Maximum values owned across creation, health checks, leases, return and close transitions.
  readonly maximumIdle?: number
    Largest idle set retained for reuse after leases return.
  readonly maximumIdleAge?: Temporal.Duration | Temporal.DurationLike | string
    Maximum idle age enforced before reuse and by explicit maintenance.
  readonly acquireTimeout?: Temporal.Duration | Temporal.DurationLike | string
    Optional maximum wait for a pool lease; it does not extend the caller deadline.
  readonly create: (ctx: Context) => Value | Promise<Value>
    Create a provider value under the supplied execution lifetime.
  readonly check?: (value: Value) => boolean | Promise<boolean>
    Optional health check before reuse; false retires the value before a replacement is created.
  readonly close: (value: Value, reason?: unknown) => void | Promise<void>
    Close one retired provider value; the pool joins this callback before releasing its capacity.
```

### types: Lease

[Declaration source](types.ts#L33)

```text
interface Lease<Value> extends AsyncDisposable
  Caller-owned borrow of one reusable value.

  readonly value: Value
    Value carried by this contract; its schema and owner define the accepted shape.
  readonly acquiredAt: Temporal.Instant
    Instant when this lease was granted by the owning clock.
  readonly invalid: boolean
    Whether the borrower marked this lease unusable for future reuse.
  invalidate(reason?: unknown): void
    Mark a lease unhealthy without closing it while the borrower still owns it.
```

### types: Pool

[Declaration source](types.ts#L45)

```text
interface Pool<Value> extends AsyncDisposable
  Bounded process-local owner of reusable values.

  readonly events: EventBus<Event>["events"]
    Observation stream; terminal results and cancellation retain their separate authority.
  acquire(ctx: Context): Promise<Lease<Value>>
    Borrow one value under an owned lease; disposing the lease returns or closes it.
  stats(): Stats
    Return an immutable occupancy or progress snapshot without transferring ownership.
  maintain(): Promise<void>
    Close idle values older than the configured maximum age while preserving the minimum.
  drain(reason?: unknown): Promise<void>
    Stop new admission and wait for existing ownership transitions to settle.
```

### types: Stats

[Declaration source](types.ts#L15)

```text
interface Stats
  Current bounded-capacity counters.

  readonly state: "active" | "draining" | "disposed"
    Current owner state; transitions determine whether new work can be admitted.
  readonly minimum: number
    Configured minimum reusable values retained by the pool.
  readonly maximum: number
    Maximum values owned across creation, health checks, leases, return and close transitions.
  readonly idle: number
    Reusable pool values currently available without a live lease.
  readonly leased: number
    Pool values currently owned by borrowers.
  readonly creating: number
    Provider values whose creation has not yet settled.
  readonly waiting: number
    Acquisition callers currently queued for pool capacity.
```

### types: Event

[Declaration source](types.ts#L4)

```text
type Event = Readonly<{ readonly type: "creating"; }> | Readonly<{ readonly type: "created"; }> | Readonly<{ readonly type: "acquired"; readonly acquiredAt: string; }> | Readonly<{ readonly type: "released"; readonly reusable: boolean; }> | Readonly<{ readonly type: "invalidated"; readonly reason?: unknown; }> | Readonly<{ readonly type: "closed-value"; readonly reason?: unknown; }> | Readonly<{ readonly type: "draining"; readonly reason?: unknown; }> | Readonly<{ readonly type: "disposed"; }>
  Pool lifecycle event emitted after one state transition.
```
