# @okikio/context contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                  | Source                   | Reference       |
| ----------------------- | ------------------------ | --------------- |
| `@okikio/context`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/context/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/context`. [Source](./mod.ts).

Give nested work one cancellation signal, deadline, clock and cleanup owner. Passing separate signals and timers through
every call otherwise makes it easy to outlive the caller or forget a temporary resource.

Start with create(), derive a child deadline for an expensive operation, and register cleanup on the context that owns
it. Use view() or family scopes to attach capabilities without inventing a new lifetime. Snapshots carry identity and
deadline across a transport; they do not carry resources or cancellation listeners. TestClock lets tests advance logical
time without assuming a fast machine.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                    |
| ---------------- | ----------------------------------------------------------- |
| `standardDelay`  | [External source](https://jsr.io/@std/async/1.5.0/delay.ts) |
| `durationCore`   | [duration contracts](../duration/API.md)                    |
| `ChildOptions`   | [Source](types.ts)                                          |
| `Clock`          | [Source](types.ts)                                          |
| `Context`        | [Source](types.ts)                                          |
| `CreateOptions`  | [Source](types.ts)                                          |
| `Owned`          | [Source](types.ts)                                          |
| `RestoreOptions` | [Source](types.ts)                                          |
| `Snapshot`       | [Source](types.ts)                                          |

### root: cancel

[Declaration source](mod.ts#L274)

```text
function cancel(value: Owned, reason: unknown): void
  Cancel an owned context or a view of that owned context. Repeated cancellation is harmless.
```

### root: cancelled

[Declaration source](mod.ts#L58)

```text
function cancelled(value: unknown): boolean
  Return whether a reason represents explicit context cancellation or deadline expiry.
```

### root: cause

[Declaration source](mod.ts#L295)

```text
function cause(value: Pick<Context, "signal">): unknown
  Return the cancellation reason without changing control flow.
```

### root: check

[Declaration source](mod.ts#L281)

```text
function check(value: Pick<Context, "clock" | "deadline" | "signal">): void
  Throw the appropriate cancellation or deadline error when work must stop.
```

### root: child

[Declaration source](mod.ts#L203)

```text
function child(parent: Context, options: ChildOptions): Owned
  Derive a child context that inherits identity, cancellation, and the parent deadline.
```

### root: combineSignals

[Declaration source](mod.ts#L458)

```text
function combineSignals(signals: Iterable<AbortSignal | undefined>): AbortSignal
  Compose cancellation signals for an unowned view.
```

### root: create

[Declaration source](mod.ts#L140)

```text
function create(options: CreateOptions): Owned
  Create one independently owned context.
```

### root: deadline

[Declaration source](mod.ts#L222)

```text
function deadline(parent: Context, value: Temporal.Instant): Owned
  Derive a child with an absolute deadline that cannot exceed its parent's deadline.
```

### root: delay

[Declaration source](mod.ts#L395)

```text
function delay(milliseconds: number, cancellation?: AbortSignal | AbortController): Promise<void>
  Delay for a bounded number of milliseconds using `@std/async/delay`.

  Passing an `AbortSignal` is equivalent to calling
  `@std/async/delay(milliseconds, { signal })`. An `AbortController` is a
  convenience accepted by this utility and is normalized to its signal.
```

### root: remaining

[Declaration source](mod.ts#L300)

```text
function remaining(value: Pick<Context, "clock" | "deadline">): Temporal.Duration | undefined
  Return the non-negative time remaining before the deadline.
```

### root: restore

[Declaration source](mod.ts#L429)

```text
function restore(value: Snapshot, options: RestoreOptions): Owned
  Restore a snapshot into a new local context and cancellation controller.
```

### root: settles

[Declaration source](mod.ts#L370)

```text
async function settles(value: PromiseLike<unknown>, milliseconds: number, clock: Pick<Clock, "sleep">): Promise<boolean>
  Return whether a value settles before the supplied clock reaches a duration.

  Settlement includes fulfillment and rejection. This helper does not cancel the
  value when time expires. It only cancels its own clock wait, so a host can
  continue its existing shutdown or cleanup policy after a `false` result.
```

### root: snapshot

[Declaration source](mod.ts#L417)

```text
function snapshot(value: Context): Snapshot
  Create a serializable context snapshot. Cancellation is intentionally not serialized.
```

### root: timeout

[Declaration source](mod.ts#L242)

```text
function timeout(parent: Context, duration: Temporal.DurationLike | string): Owned
  Start a deadline wait and return the owner of a child operation.

  Like a timer, the wait becomes due after the supplied duration. Its action is
  to abort the child's signal; this function does not run a callback or await
  work. Pass the signal to cooperative I/O and check it between synchronous
  steps. The inherited clock controls the wait, and an earlier parent deadline
  still wins.

  The returned `Owned` context needs `await using` or explicit awaited disposal.
  Disposal cancels the deadline wait, removes the parent listener, and releases
  child-owned resources. Deadline expiry alone does not dispose those resources,
  and disposing this child does not cancel its parent.

  @return
      A child context immediately, not a Promise for the operation's value.
```

### root: view

[Declaration source](mod.ts#L261)

```text
function view<Base extends Context, Extension extends object>(base: Base, extension: Extension & readonly [Key in Extract<keyof Extension, keyof Context>]: never): Base & Readonly<Extension>
  Create a typed view that adds runtime-local fields without creating a new lifetime.

  The view retains the source context's cancellation and ownership identity. It is
  useful when a focused utility adds one execution capability, such as permissions
  or declared effects, while another utility adds a different typed view to the
  same operation. Views can be nested safely.

  Stable Context properties cannot be replaced at compile time, and no property
  already present on the concrete runtime value can be replaced at runtime. The
  runtime check is necessary because generic composition helpers cannot always
  prove whether an earlier view added the same extension key. Use `child()` when
  work needs a new independently owned cancellation and cleanup lifetime.
```

### root: wait

[Declaration source](mod.ts#L312)

```text
async function wait(ctx: Pick<Context, "clock" | "deadline" | "signal">, duration: Temporal.Duration | Temporal.DurationLike | string): Promise<void>
  Wait for a context-scoped duration.

  This is the context-aware convenience form of `delay()`. It observes the
  context before and after the timer, converts context cancellation into the
  context error model, and never hides an elapsed deadline.
```

### root: waitFor

[Declaration source](mod.ts#L334)

```text
function waitFor(ctx: Pick<Context, "signal">, listen: (resume: () => void) => () => void): Promise<void>
  Wait for one external cooperative gate while the context remains cancellable.

  `listen` owns the external gate and returns the cleanup that removes its
  resume callback. This helper owns the context abort listener and removes both
  listeners when either path settles. It does not cancel work outside the gate.
```

### root: SystemClock

[Declaration source](mod.ts#L63)

```text
const SystemClock
  Clock backed by the runtime's native Temporal implementation and timer queue.
```

### root: ContextCancelledError

[Declaration source](mod.ts#L29)

```text
class ContextCancelledError extends Error
  Error raised when a context has been cancelled.

  constructor(reason: unknown)
    Create this ContextCancelledError from the explicit contract values supplied by its caller.
  readonly reason: unknown
    Caller or runtime reason retained for cancellation or failure diagnostics.
```

### root: ContextDeadlineExceededError

[Declaration source](mod.ts#L42)

```text
class ContextDeadlineExceededError extends Error
  Error raised when a context deadline has elapsed.

  constructor(deadline: Temporal.Instant, observedAt: Temporal.Instant)
    Create this ContextDeadlineExceededError from the explicit contract values supplied by its caller.
  readonly deadline: Temporal.Instant
    Latest permitted completion instant; serialized contexts use ISO timestamp text.
  readonly observedAt: Temporal.Instant
    Instant when this observation was recorded.
```

### root: TestClock

[Declaration source](mod.ts#L79)

```text
class TestClock implements Clock
  Mutable deterministic clock intended for tests and simulations.

  constructor(initial: Temporal.Instant | string)
    Create this TestClock from the explicit contract values supplied by its caller.
  now(): Temporal.Instant
    Return the current deterministic instant.
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>
    Wait until deterministic time advances by the requested milliseconds.
  set(instant: Temporal.Instant | string): void
    Set deterministic time and release sleepers whose target is now due.
  advance(duration: Temporal.Duration | Temporal.DurationLike | string): Temporal.Instant
    Advance deterministic time and release sleepers whose target is now due.
```

### root: ChildOptions

[Declaration source](mod.ts#L567)

```text
reference ChildOptions: ./packages/context/types.ts:93:1
```

### root: Clock

[Declaration source](mod.ts#L568)

```text
reference Clock: ./packages/context/types.ts:1:1
```

### root: Context

[Declaration source](mod.ts#L569)

```text
reference Context: ./packages/context/types.ts:37:1
```

### root: CreateOptions

[Declaration source](mod.ts#L570)

```text
reference CreateOptions: ./packages/context/types.ts:73:1
```

### root: Owned

[Declaration source](mod.ts#L571)

```text
reference Owned: ./packages/context/types.ts:67:1
```

### root: Resources

[Declaration source](mod.ts#L572)

```text
reference Resources: ./packages/context/types.ts:57:1
```

### root: RestoreOptions

[Declaration source](mod.ts#L573)

```text
reference RestoreOptions: ./packages/context/types.ts:99:1
```

### root: Snapshot

[Declaration source](mod.ts#L574)

```text
reference Snapshot: ./packages/context/types.ts:14:1
```

## types

Import `@okikio/context/types`. [Source](./types.ts).

### types: ChildOptions

[Declaration source](types.ts#L93)

```text
interface ChildOptions extends Partial<Omit<CreateOptions, "startedAt">>
  Inputs accepted while deriving a child context.

  readonly id?: string
    Override the inherited operation identity for a new nested operation.
```

### types: Clock

[Declaration source](types.ts#L1)

```text
interface Clock
  Provider-neutral clock used by requests, activities, workflows, and tests.

  now(): Temporal.Instant
    Return the current absolute instant.
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>
    Wait for a bounded duration using the same time source as `now()`.
```

### types: Context

[Declaration source](types.ts#L37)

```text
interface Context
  Cancellation, deadline, identity, and clock carried through one operation.

  `id` names the current operation. The caller decides what the operation is,
  such as an HTTP request, activity job, queue claim, workflow run, or process
  command. Protocol-specific code can keep a more specific name such as
  `requestId` and copy that value into `id` when it creates the context.

  readonly id: string
    Stable identity of the operation represented by this context.
  readonly traceId?: string
    Optional trace correlation identity; it does not authorize the operation.
  readonly deploymentId?: string
    Optional host deployment identity carried with the operation.
  readonly idempotencyKey?: string
    Caller-owned identity for repeated work; a receiving provider must enforce its idempotency policy.
  readonly startedAt: Temporal.Instant
    Start instant captured by the owning clock, or its serialized ISO timestamp.
  readonly deadline?: Temporal.Instant | undefined
    Latest permitted completion instant; serialized contexts use ISO timestamp text.
  readonly signal: AbortSignal
    Cancellation signal supplied by the operation lifetime owner.
  readonly clock: Clock
    Clock used for operation time and waits; tests can supply a logical clock.
```

### types: CreateOptions

[Declaration source](types.ts#L73)

```text
interface CreateOptions
  Inputs accepted while creating one owned operation context.

  readonly id: string
    Stable identity of the operation represented by the new context.
  readonly traceId?: string
    Optional trace correlation identity; it does not authorize the operation.
  readonly deploymentId?: string
    Optional host deployment identity carried with the operation.
  readonly idempotencyKey?: string
    Caller-owned identity for repeated work; a receiving provider must enforce its idempotency policy.
  readonly startedAt?: Temporal.Instant
    Start instant captured by the owning clock, or its serialized ISO timestamp.
  readonly deadline?: Temporal.Instant
    Latest permitted completion instant; serialized contexts use ISO timestamp text.
  readonly signal?: AbortSignal
    Cancellation signal supplied by the operation lifetime owner.
  readonly clock?: Clock
    Clock used for operation time and waits; tests can supply a logical clock.
```

### types: Owned

[Declaration source](types.ts#L67)

```text
interface Owned extends Context, Resources, AsyncDisposable
  Independently owned context with deterministic cancellation and resource cleanup.

  readonly closed: Promise<void>
    Resolves after the context and every resource it owns have been disposed.
```

### types: Resources

[Declaration source](types.ts#L57)

```text
interface Resources
  Standard resource ownership operations available on one owned context.

  use(value: Value): Value
    Add an already disposable value to this context's lifetime.
  adopt(value: Value, dispose: (value: Value) => void | PromiseLike<void>): Value
    Add an arbitrary value with an explicit asynchronous or synchronous disposer.
  defer(dispose: () => void | PromiseLike<void>): void
    Add cleanup that runs when this context closes.
```

### types: RestoreOptions

[Declaration source](types.ts#L99)

```text
interface RestoreOptions
  Inputs accepted while restoring a serializable snapshot.

  readonly signal?: AbortSignal
    Cancellation signal supplied by the operation lifetime owner.
  readonly clock?: Clock
    Clock used for operation time and waits; tests can supply a logical clock.
```

### types: Snapshot

[Declaration source](types.ts#L14)

```text
interface Snapshot
  Serializable identity and timing data for one operation context.

  A snapshot can cross a queue, process, or Worker message. Cancellation does
  not cross with it. The receiving host creates a new local `AbortSignal`.

  readonly id: string
    Stable identity of the operation represented by this context.
  readonly traceId?: string
    Optional trace correlation identity; it does not authorize the operation.
  readonly deploymentId?: string
    Optional host deployment identity carried with the operation.
  readonly idempotencyKey?: string
    Caller-owned identity for repeated work; a receiving provider must enforce its idempotency policy.
  readonly startedAt: string
    Start instant captured by the owning clock, or its serialized ISO timestamp.
  readonly deadline?: string
    Latest permitted completion instant; serialized contexts use ISO timestamp text.
```
