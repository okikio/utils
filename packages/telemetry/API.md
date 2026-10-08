# @okikio/telemetry contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                        | Source                           | Reference               |
| ----------------------------- | -------------------------------- | ----------------------- |
| `@okikio/telemetry`           | [./mod.ts](./mod.ts)             | [root](#root)           |
| `@okikio/telemetry/lifecycle` | [./lifecycle.ts](./lifecycle.ts) | [lifecycle](#lifecycle) |
| `@okikio/telemetry/logtape`   | [./logtape.ts](./logtape.ts)     | [logtape](#logtape)     |
| `@okikio/telemetry/otel`      | [./otel.ts](./otel.ts)           | [otel](#otel)           |
| `@okikio/telemetry/server`    | [./server.ts](./server.ts)       | [server](#server)       |
| `@okikio/telemetry/types`     | [./types.ts](./types.ts)         | [types](#types)         |

## root

Import `@okikio/telemetry`. [Source](./mod.ts).

Report correlated diagnostic events without letting a broken reporter fail the operation. Console messages have no
shared correlation contract and cannot buffer the useful history preceding a failure.

Start with a memory reporter to inspect behavior, then choose an explicit LogTape or OpenTelemetry adapter. Scope fields
attach correlation, and buffering can retain a bounded recent history until failure. Applications configure logging and
exporting. Telemetry is observation; it cannot authorize cancellation, settle a job or prove an authoritative effect was
accepted.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source           |
| ---------------------- | ---------------------------------- |
| `faultCore`            | [fault contracts](../fault/API.md) |
| `BufferedReporter`     | [Source](types.ts)                 |
| `BufferOptions`        | [Source](types.ts)                 |
| `ContextFieldsInput`   | [Source](types.ts)                 |
| `Event`                | [Source](types.ts)                 |
| `EventInput`           | [Source](types.ts)                 |
| `Fields`               | [Source](types.ts)                 |
| `Level`                | [Source](types.ts)                 |
| `MemoryReporter`       | [Source](types.ts)                 |
| `Reporter`             | [Source](types.ts)                 |
| `ReporterErrorHandler` | [Source](types.ts)                 |
| `Scope`                | [Source](types.ts)                 |
| `ScopeOptions`         | [Source](types.ts)                 |
| `TraceFields`          | [Source](types.ts)                 |
| `Value`                | [Source](types.ts)                 |

### root: atLeast

[Declaration source](mod.ts#L209)

```text
function atLeast(level: Level, threshold: Level): boolean
  Return whether one severity is at least as important as another.
```

### root: buffer

[Declaration source](mod.ts#L150)

```text
function buffer(target: Reporter, options: BufferOptions): BufferedReporter
  Retain low-severity history per correlation key and flush it when a failure arrives.

  The wrapper is intentionally backend-neutral. A host can call `discard(key)`
  after successful completion and `flush(key)` when a warning or domain-specific
  condition should reveal the preceding history.
```

### root: contextFields

[Declaration source](mod.ts#L86)

```text
function contextFields(ctx: ContextFieldsInput): Fields
  Project the shared execution context into stable telemetry correlation fields.
```

### root: create

[Declaration source](mod.ts#L47)

```text
function create(reporter: Reporter, options: ScopeOptions): Scope
  Create one explicit telemetry scope around a reporter and stable correlation fields.
```

### root: event

[Declaration source](mod.ts#L61)

```text
function event(input: EventInput, fields: Fields, now: () => string): Event
  Create one immutable telemetry record without delivering it.
```

### root: fanout

[Declaration source](mod.ts#L110)

```text
function fanout(...reporters: readonly Reporter[]): Reporter
  Create a reporter that copies every record to each destination.
```

### root: memory

[Declaration source](mod.ts#L127)

```text
function memory(): MemoryReporter
  Create a small in-memory reporter for unit tests and deterministic diagnostics.
```

### root: traceFields

[Declaration source](mod.ts#L99)

```text
function traceFields(trace: TraceFields | undefined): Fields
  Merge trace fields from an instrumentation adapter with caller-owned fields.
```

### root: noop

[Declaration source](mod.ts#L44)

```text
const noop
  Reporter that intentionally drops every record.
```

### root: BufferOptions

[Declaration source](mod.ts#L369)

```text
reference BufferOptions: ./packages/telemetry/types.ts:105:1
```

### root: BufferedReporter

[Declaration source](mod.ts#L368)

```text
reference BufferedReporter: ./packages/telemetry/types.ts:115:1
```

### root: ContextFieldsInput

[Declaration source](mod.ts#L370)

```text
reference ContextFieldsInput: ./packages/telemetry/types.ts:131:1
```

### root: Event

[Declaration source](mod.ts#L371)

```text
reference Event: ./packages/telemetry/types.ts:24:1
```

### root: EventInput

[Declaration source](mod.ts#L372)

```text
reference EventInput: ./packages/telemetry/types.ts:44:1
```

### root: Fields

[Declaration source](mod.ts#L373)

```text
reference Fields: ./packages/telemetry/types.ts:9:1
```

### root: Level

[Declaration source](mod.ts#L374)

```text
reference Level: ./packages/telemetry/types.ts:3:1
```

### root: MemoryReporter

[Declaration source](mod.ts#L375)

```text
reference MemoryReporter: ./packages/telemetry/types.ts:97:1
```

### root: Reporter

[Declaration source](mod.ts#L376)

```text
reference Reporter: ./packages/telemetry/types.ts:64:1
```

### root: ReporterErrorHandler

[Declaration source](mod.ts#L377)

```text
reference ReporterErrorHandler: ./packages/telemetry/types.ts:72:1
```

### root: Scope

[Declaration source](mod.ts#L378)

```text
reference Scope: ./packages/telemetry/types.ts:85:1
```

### root: ScopeOptions

[Declaration source](mod.ts#L379)

```text
reference ScopeOptions: ./packages/telemetry/types.ts:75:1
```

### root: TraceFields

[Declaration source](mod.ts#L380)

```text
reference TraceFields: ./packages/telemetry/types.ts:12:1
```

### root: Value

[Declaration source](mod.ts#L381)

```text
reference Value: ./packages/telemetry/types.ts:6:1
```

## lifecycle

Import `@okikio/telemetry/lifecycle`. [Source](./lifecycle.ts).

Portable adapters for existing Okikio lifecycle event streams.

These helpers translate authoritative queue/pool/Worker/process events into telemetry records. They do not subscribe,
mutate source state, or make telemetry delivery part of the source lifecycle.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding          | Contract owner or source               |
| ------------------------- | -------------------------------------- |
| `FaultValue`              | [fault contracts](../fault/API.md)     |
| `PoolEvent`               | [pool contracts](../pool/API.md)       |
| `QueueEventType`          | [queue contracts](../queue/API.md)     |
| `ProcessEventType`        | [process contracts](../process/API.md) |
| `ProcessChannelEventType` | [process contracts](../process/API.md) |
| `WorkerEventType`         | [worker contracts](../worker/API.md)   |
| `EventInput`              | [Source](types.ts)                     |
| `Fields`                  | [Source](types.ts)                     |
| `Level`                   | [Source](types.ts)                     |
| `Scope`                   | [Source](types.ts)                     |

### lifecycle: channel

[Declaration source](lifecycle.ts#L41)

```text
function channel(scope: Scope, fields: Fields): Handler<ProcessChannelEventType>
  Translate framed process-channel request lifecycle changes into stable telemetry events.
```

### lifecycle: pool

[Declaration source](lifecycle.ts#L26)

```text
function pool(scope: Scope, fields: Fields): Handler<PoolEvent>
  Translate process-local pool ownership changes into stable telemetry events.
```

### lifecycle: process

[Declaration source](lifecycle.ts#L36)

```text
function process(scope: Scope, fields: Fields): Handler<ProcessEventType>
  Translate owned OS-process lifecycle changes into stable telemetry events.
```

### lifecycle: queue

[Declaration source](lifecycle.ts#L21)

```text
function queue(scope: Scope, fields: Fields): Handler<QueueEventType>
  Translate committed queue state changes into stable telemetry events.
```

### lifecycle: worker

[Declaration source](lifecycle.ts#L31)

```text
function worker(scope: Scope, fields: Fields): Handler<WorkerEventType>
  Translate Worker transport/request lifecycle changes into stable telemetry events.
```

### lifecycle: Handler

[Declaration source](lifecycle.ts#L18)

```text
type Handler<Event> = (event: Event) => void | Promise<void>
  Event callback that can be passed directly to an observable subscription.
```

## logtape

Import `@okikio/telemetry/logtape`. [Source](./logtape.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source |
| ---------------- | ------------------------ |
| `Event`          | [Source](types.ts)       |
| `Fields`         | [Source](types.ts)       |
| `Reporter`       | [Source](types.ts)       |

### logtape: reporter

[Declaration source](logtape.ts#L26)

```text
function reporter(logger: LogTapeLogger): Reporter
  Adapt an already-configured LogTape-compatible logger to the telemetry Reporter contract.
```

### logtape: run

[Declaration source](logtape.ts#L67)

```text
function run<Result>(api: LogTapeContextApi, fields: Fields, callback: () => Result): Result
  Run a callback inside a host-provided LogTape implicit context.

  Browser and other runtimes without context-local state should use explicit
  telemetry scopes instead; every event still carries its fields directly.
```

### logtape: LogTapeContextApi

[Declaration source](logtape.ts#L20)

```text
interface LogTapeContextApi
  Minimal LogTape context bridge supplied by a host that enabled implicit context propagation.

  withContext(properties: Readonly<Record<string, unknown>>, callback: () => Result): Result
    Run this callback under the caller-supplied LogTape correlation context.
```

### logtape: LogTapeLogger

[Declaration source](logtape.ts#L4)

```text
interface LogTapeLogger
  Minimal LogTape logger surface consumed by the telemetry reporter adapter.

  trace(message: string, properties?: Readonly<Record<string, unknown>>): void
    Emit one trace-level record through the supplied LogTape logger.
  debug(message: string, properties?: Readonly<Record<string, unknown>>): void
    Emit one debug-level event through the supplied LogTape logger.
  info(message: string, properties?: Readonly<Record<string, unknown>>): void
    Emit one info-level record through the supplied LogTape logger.
  warn(message: string, properties?: Readonly<Record<string, unknown>>): void
    Emit one warning-level event through the supplied LogTape logger.
  error(message: string, properties?: Readonly<Record<string, unknown>>): void
    Emit one error-level record through the supplied LogTape logger.
  fatal(message: string, properties?: Readonly<Record<string, unknown>>): void
    Emit one fatal-level event through the supplied LogTape logger.
```

## otel

Import `@okikio/telemetry/otel`. [Source](./otel.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source |
| ---------------- | ------------------------ |
| `TraceFields`    | [Source](types.ts)       |

### otel: active

[Declaration source](otel.ts#L47)

```text
function active(api: OpenTelemetryApi): TraceFields
  Return active OpenTelemetry trace/span identity when the supplied host API exposes a valid active span.
```

### otel: OpenTelemetryApi

[Declaration source](otel.ts#L34)

```text
interface OpenTelemetryApi
  Structural OpenTelemetry API accepted from a host-owned instrumentation setup.

  readonly context: OpenTelemetryContextApi
    Explicit OpenTelemetry context API; the utility does not configure a global tracing runtime.
  readonly trace: OpenTelemetryTraceApi
    Explicit OpenTelemetry trace lookup API; the utility does not start spans.
```

### otel: OpenTelemetryContextApi

[Declaration source](otel.ts#L4)

```text
interface OpenTelemetryContextApi
  Minimal active-context surface used from an OpenTelemetry API implementation.

  active(): unknown
    Return the caller-supplied OpenTelemetry API current context.
```

### otel: OpenTelemetrySpan

[Declaration source](otel.ts#L22)

```text
interface OpenTelemetrySpan
  Minimal active span surface consumed by telemetry correlation projection.

  spanContext(): OpenTelemetrySpanContext
    Read the active span correlation identifiers without starting a span.
```

### otel: OpenTelemetrySpanContext

[Declaration source](otel.ts#L10)

```text
interface OpenTelemetrySpanContext
  Minimal span context consumed by telemetry correlation projection.

  readonly traceId: string
    Trace correlation identity retained for diagnostic propagation.
  readonly spanId: string
    Span correlation identity for the current operation.
  readonly traceFlags: number
    Trace flags retained in the representation required by this adapter.
  readonly traceState?: Readonly<{ serialize(): string; }>
    Optional vendor trace-state object supplied by the host OpenTelemetry API.
```

### otel: OpenTelemetryTraceApi

[Declaration source](otel.ts#L28)

```text
interface OpenTelemetryTraceApi
  Minimal tracing surface used from an OpenTelemetry API implementation.

  getSpan(ctx: unknown): OpenTelemetrySpan | undefined
    Find a span in the supplied OpenTelemetry context, if one is active.
```

## server

Import `@okikio/telemetry/server`. [Source](./server.ts).

Adapters from `@okikio/server` lifecycle observers to portable telemetry scopes.

The adapters depend only on import-safe observer types. They do not create a server runtime, start a listener, configure
logging, or install tracing.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source             |
| --------------------------- | ------------------------------------ |
| `FaultValue`                | [fault contracts](../fault/API.md)   |
| `GatewayObserverDefinition` | [server contracts](../server/API.md) |
| `GatewayObserverEvent`      | [server contracts](../server/API.md) |
| `GatewayObserverEventKind`  | [server contracts](../server/API.md) |
| `GatewayObserverHandler`    | [server contracts](../server/API.md) |
| `ServiceObserverDefinition` | [server contracts](../server/API.md) |
| `ServiceObserverEvent`      | [server contracts](../server/API.md) |
| `ServiceObserverEventKind`  | [server contracts](../server/API.md) |
| `ServiceObserverHandler`    | [server contracts](../server/API.md) |
| `EventInput`                | [Source](types.ts)                   |
| `Fields`                    | [Source](types.ts)                   |
| `Level`                     | [Source](types.ts)                   |
| `Scope`                     | [Source](types.ts)                   |

### server: gateway

[Declaration source](server.ts#L60)

```text
function gateway<Definition extends GatewayObserverDefinition>(definition: Definition, scope: Scope): GatewayObserverHandler<Definition>
  Bind an exact gateway observer definition to one portable telemetry scope.
```

### server: service

[Declaration source](server.ts#L45)

```text
function service<Definition extends ServiceObserverDefinition>(definition: Definition, scope: Scope): ServiceObserverHandler<Definition>
  Bind an exact service observer definition to one portable telemetry scope.
```

## types

Import `@okikio/telemetry/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source           |
| ---------------- | ---------------------------------- |
| `FaultValue`     | [fault contracts](../fault/API.md) |
| `FaultOptions`   | [fault contracts](../fault/API.md) |

### types: BufferOptions

[Declaration source](types.ts#L105)

```text
interface BufferOptions
  Options controlling bounded failure-history buffering.

  readonly capacity?: number
    Maximum retained pre-trigger records per correlation key. @default 64
  readonly trigger?: Level
    Minimum severity that flushes retained history before the triggering event. @default error
  readonly key?: (event: Event) => string
    Derive the buffer key. Defaults to trace, request, operation, then a shared fallback key.
```

### types: BufferedReporter

[Declaration source](types.ts#L115)

```text
interface BufferedReporter extends Reporter
  Reporter that holds low-severity history until a failure or explicit flush.

  readonly keys: readonly string[]
    Correlation keys with buffered history that has not been flushed or discarded.
  flush(key?: string): Promise<void>
    Deliver or release buffered diagnostic events under the reporter contract.
  discard(key?: string): void
    Discard buffered diagnostic records without making them authoritative events.
```

### types: ContextFieldsInput

[Declaration source](types.ts#L131)

```text
interface ContextFieldsInput
  Structural execution-context fields projected without importing or owning a runtime context.

  readonly id: string
    Stable identity used to correlate this contract or occurrence.
  readonly traceId?: string
    Optional trace correlation identity; it does not authorize the operation.
  readonly deploymentId?: string
    Optional host deployment identity carried with the operation.
  readonly idempotencyKey?: string
    Caller-owned identity for repeated work; a receiving provider must enforce its idempotency policy.
  readonly startedAt: InstantLike
    Start instant captured by the owning clock, or its serialized ISO timestamp.
  readonly deadline?: InstantLike
    Latest permitted completion instant; serialized contexts use ISO timestamp text.
```

### types: Event

[Declaration source](types.ts#L24)

```text
interface Event
  Portable structured diagnostic record emitted by one observed transition.

  readonly kind: "telemetry-event"
    Stable discriminant that selects the documented variant.
  readonly name: string
    Stable machine-readable event identity such as `queue.claim.expired`.
  readonly level: Level
    Diagnostic severity used by the reporter.
  readonly message: string
    Short human-readable description. Dashboards should group by `name`, not this text.
  readonly at: string
    ISO-8601 timestamp chosen by the scope clock.
  readonly fields: Fields
    Bounded JSON-safe diagnostic fields.
  readonly fault?: FaultValue
    Bounded projection of one associated unexpected runtime fault.
  readonly error?: Error
    Original local Error retained only for in-process adapters that can preserve it.
```

### types: EventInput

[Declaration source](types.ts#L44)

```text
interface EventInput
  Input accepted when one telemetry record is created.

  readonly name: string
    Declared name used by the owning protocol.
  readonly level?: Level
    Diagnostic severity used by the reporter.
  readonly message?: string
    Human-readable explanation; use the stable code or discriminant for program decisions.
  readonly at?: string
    Observation instant supplied by the owning clock.
  readonly fields?: Fields
    Named fields that belong to this representation or observation.
  readonly error?: unknown
    Unexpected error retained for diagnostic projection or the explicit failure branch.
  readonly fault?: FaultValue
    Unexpected diagnostic data projected for this boundary.
  readonly faultOptions?: FaultOptions
    Explicit projection limits for unexpected diagnostic data.
```

### types: InstantLike

[Declaration source](types.ts#L125)

```text
interface InstantLike
  Minimal instant-like value required by portable execution-context projection.

  toString(): string
    Serialize the instant for diagnostic fields without importing or owning its runtime clock.
```

### types: MemoryReporter

[Declaration source](types.ts#L97)

```text
interface MemoryReporter extends Reporter
  Reporter that retains records in memory for tests and local diagnostics.

  readonly records: readonly Event[]
    Retained observations available to the caller.
  clear(): void
    Remove retained diagnostic state from this owner.
```

### types: Reporter

[Declaration source](types.ts#L64)

```text
interface Reporter
  Destination for structured telemetry records.

  report(event: Event): void | Promise<void>
    Deliver one diagnostic event to the explicit reporter; observation does not settle authoritative work.
  flush?(): void | Promise<void>
    Flush buffered/exporter state when this reporter owns any.
```

### types: Scope

[Declaration source](types.ts#L85)

```text
interface Scope
  Explicit correlation scope that does not require async-local runtime support.

  readonly fields: Fields
    Named fields that belong to this representation or observation.
  report(input: EventInput): Promise<Event>
    Emit one record with this scope's correlation fields. Reporter failures remain observational.
  child(fields: Fields): Scope
    Create a nested explicit scope whose fields override matching parent fields.
  flush(): Promise<void>
    Flush the underlying reporter when it exposes a flush operation.
```

### types: ScopeOptions

[Declaration source](types.ts#L75)

```text
interface ScopeOptions
  Options used to create one explicit telemetry scope.

  readonly fields?: Fields
    Named fields that belong to this representation or observation.
  readonly now?: () => string
    Runtime-neutral clock. Defaults to `new Date().toISOString()`.
  readonly onReporterError?: ReporterErrorHandler
    Optional non-authoritative observer for reporter failures.
```

### types: TraceFields

[Declaration source](types.ts#L12)

```text
interface TraceFields
  Correlation fields extracted from a tracing implementation when one is active.

  readonly trace_id?: string
    Optional OpenTelemetry trace correlation identifier.
  readonly span_id?: string
    Optional OpenTelemetry span correlation identifier.
  readonly trace_flags?: number
    Optional trace flags carried for diagnostic correlation.
  readonly trace_state?: string
    Optional vendor trace state carried for diagnostic correlation.
```

### types: Fields

[Declaration source](types.ts#L9)

```text
type Fields = Readonly<Record<string, Value>>
  Immutable structured fields attached to a telemetry record or scope.
```

### types: Level

[Declaration source](types.ts#L3)

```text
type Level = "trace" | "debug" | "info" | "warning" | "error" | "fatal"
  Severity shared by portable telemetry records and common logging backends.
```

### types: ReporterErrorHandler

[Declaration source](types.ts#L72)

```text
type ReporterErrorHandler = (error: unknown, event?: Event) => void | Promise<void>
  Callback used when observational delivery itself fails.
```

### types: Value

[Declaration source](types.ts#L6)

```text
type Value = FaultValue
  JSON-safe structured value accepted by telemetry fields.
```
