# @okikio/resilience contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                     | Source                   | Reference       |
| -------------------------- | ------------------------ | --------------- |
| `@okikio/resilience`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/resilience/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/resilience`. [Source](./mod.ts).

Describe timeout, retry and admission policies as inspectable values before a host applies them. Putting retry loops
around every call can repeat unsafe side effects and hide who owns the timer or storage.

Validate a policy set first, then let the designated server or adapter enforce it. Retry safety requires idempotency for
unsafe operations; a description does not itself create an idempotency store. Supply entropy explicitly for jitter and a
clock for actual waits. Body limits, bulkheads and circuit breakers have different owners and lifecycle stages, which
the document projection preserves.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding             | Contract owner or source                 |
| ---------------------------- | ---------------------------------------- |
| `durationCore`               | [duration contracts](../duration/API.md) |
| `BodyLimitPolicy`            | [Source](types.ts)                       |
| `BulkheadPolicy`             | [Source](types.ts)                       |
| `CircuitBreakerPolicy`       | [Source](types.ts)                       |
| `IdempotencyPolicy`          | [Source](types.ts)                       |
| `RateLimitPolicy`            | [Source](types.ts)                       |
| `ResilienceDocument`         | [Source](types.ts)                       |
| `ResilienceInput`            | [Source](types.ts)                       |
| `ResilienceOperationSafety`  | [Source](types.ts)                       |
| `ResilienceOwner`            | [Source](types.ts)                       |
| `ResiliencePolicy`           | [Source](types.ts)                       |
| `ResilienceStage`            | [Source](types.ts)                       |
| `ResilienceValidationIssue`  | [Source](types.ts)                       |
| `ResilienceValidationResult` | [Source](types.ts)                       |
| `RetryPolicy`                | [Source](types.ts)                       |
| `TimeoutPolicy`              | [Source](types.ts)                       |

### root: bodyLimit

[Declaration source](mod.ts#L180)

```text
function bodyLimit(bytes: number): BodyLimitPolicy
  Define a maximum accepted request-body size.
```

### root: bulkhead

[Declaration source](mod.ts#L145)

```text
function bulkhead(options: Readonly<{ readonly concurrency: number; readonly queue?: number; }>): BulkheadPolicy
  Define bounded concurrent admission and queueing.
```

### root: circuitBreaker

[Declaration source](mod.ts#L126)

```text
function circuitBreaker(options: Readonly<{ readonly failureThreshold?: number; readonly resetAfter?: Temporal.Duration | Temporal.DurationLike | string; readonly halfOpenPermits?: number; }>): CircuitBreakerPolicy
  Define a circuit breaker around a provider or resource capability.
```

### root: compose

[Declaration source](mod.ts#L224)

```text
function compose(...input: readonly ResilienceInput[]): readonly ResiliencePolicy[]
  Flatten nested policy inputs while preserving authored order.
```

### root: document

[Declaration source](mod.ts#L287)

```text
function document(input: ResilienceInput): readonly ResilienceDocument[]
  Create deterministic JSON-safe documentation.
```

### root: idempotent

[Declaration source](mod.ts#L45)

```text
function idempotent(options: Readonly<{ readonly header?: string; readonly required?: boolean; readonly maximumKeyBytes?: number; readonly ttl?: Temporal.Duration | Temporal.DurationLike | string; }>): IdempotencyPolicy
  Define a request idempotency-key protocol.
```

### root: is

[Declaration source](mod.ts#L280)

```text
function is(value: unknown): value is ResiliencePolicy
  Return whether a value is a resiliency policy.
```

### root: owner

[Declaration source](mod.ts#L186)

```text
function owner(policy: ResiliencePolicy): ResilienceOwner
  Return which runtime owns the concrete behavior for one policy.
```

### root: rateLimit

[Declaration source](mod.ts#L162)

```text
function rateLimit(options: Readonly<{ readonly limit: number; readonly window: Temporal.Duration | Temporal.DurationLike | string; readonly key?: string; }>): RateLimitPolicy
  Define request-rate admission.
```

### root: retry

[Declaration source](mod.ts#L66)

```text
function retry(options: Readonly<{ readonly maximumAttempts?: number; readonly initialDelay?: Temporal.Duration | Temporal.DurationLike | string; readonly maximumDelay?: Temporal.Duration | Temporal.DurationLike | string; readonly multiplier?: number; readonly jitter?: boolean; readonly retryOn?: readonly string[]; }>): RetryPolicy
  Define bounded automatic retry behavior.
```

### root: retryDelay

[Declaration source](mod.ts#L103)

```text
function retryDelay(policy: RetryPolicy, failedAttempt: number, options: Readonly<{ readonly jitter?: number; }>): Temporal.Duration
  Compute the delay after one failed attempt without allocating a timer.

  Durable queues and schedulers can use the same retry-policy math while they
  retain ownership of persistence, clocks, cancellation, and wake-up behavior.
  Jittered policies require an explicit unit-interval sample so replay-sensitive
  runtimes can provide deterministic entropy instead of inheriting randomness.
```

### root: stage

[Declaration source](mod.ts#L208)

```text
function stage(policy: ResiliencePolicy): ResilienceStage
  Return when one policy runs in the service request lifecycle.

  Request policies protect raw request execution. Admission policies run once
  after validation before application requirements and the handler. Operation
  policies wrap endpoint execution and can therefore control retry attempts or
  circuit state.
```

### root: timeout

[Declaration source](mod.ts#L40)

```text
function timeout(duration: Temporal.Duration | Temporal.DurationLike | string): TimeoutPolicy
  Define an absolute request timeout.
```

### root: validate

[Declaration source](mod.ts#L238)

```text
function validate(input: ResilienceInput | undefined, options: Readonly<{ readonly safety?: ResilienceOperationSafety; }>): ResilienceValidationResult
  Validate and normalize a resilience plan.
```

### root: BodyLimitPolicy

[Declaration source](mod.ts#L391)

```text
reference BodyLimitPolicy: ./packages/resilience/types.ts:90:1
```

### root: BulkheadPolicy

[Declaration source](mod.ts#L392)

```text
reference BulkheadPolicy: ./packages/resilience/types.ts:64:1
```

### root: CircuitBreakerPolicy

[Declaration source](mod.ts#L393)

```text
reference CircuitBreakerPolicy: ./packages/resilience/types.ts:50:1
```

### root: IdempotencyPolicy

[Declaration source](mod.ts#L394)

```text
reference IdempotencyPolicy: ./packages/resilience/types.ts:14:1
```

### root: RateLimitPolicy

[Declaration source](mod.ts#L395)

```text
reference RateLimitPolicy: ./packages/resilience/types.ts:76:1
```

### root: ResilienceDocument

[Declaration source](mod.ts#L396)

```text
reference ResilienceDocument: ./packages/resilience/types.ts:138:1
```

### root: ResilienceInput

[Declaration source](mod.ts#L397)

```text
reference ResilienceInput: ./packages/resilience/types.ts:116:1
```

### root: ResilienceOperationSafety

[Declaration source](mod.ts#L398)

```text
reference ResilienceOperationSafety: ./packages/resilience/types.ts:1:1
```

### root: ResilienceOwner

[Declaration source](mod.ts#L399)

```text
reference ResilienceOwner: ./packages/resilience/types.ts:100:1
```

### root: ResiliencePolicy

[Declaration source](mod.ts#L400)

```text
reference ResiliencePolicy: ./packages/resilience/types.ts:106:1
```

### root: ResilienceStage

[Declaration source](mod.ts#L401)

```text
reference ResilienceStage: ./packages/resilience/types.ts:103:1
```

### root: ResilienceValidationIssue

[Declaration source](mod.ts#L402)

```text
reference ResilienceValidationIssue: ./packages/resilience/types.ts:119:1
```

### root: ResilienceValidationResult

[Declaration source](mod.ts#L403)

```text
reference ResilienceValidationResult: ./packages/resilience/types.ts:133:1
```

### root: RetryPolicy

[Declaration source](mod.ts#L404)

```text
reference RetryPolicy: ./packages/resilience/types.ts:30:1
```

### root: TimeoutPolicy

[Declaration source](mod.ts#L405)

```text
reference TimeoutPolicy: ./packages/resilience/types.ts:4:1
```

## types

Import `@okikio/resilience/types`. [Source](./types.ts).

### types: BodyLimitPolicy

[Declaration source](types.ts#L90)

```text
interface BodyLimitPolicy
  Maximum accepted request-body size.

  readonly kind: "resilience"
    Stable discriminant that selects the documented variant.
  readonly type: "body-limit"
    Protocol or representation variant selected by this value.
  readonly bytes: number
    Maximum request-body size in bytes.
```

### types: BulkheadPolicy

[Declaration source](types.ts#L64)

```text
interface BulkheadPolicy
  Concurrency-admission policy.

  readonly kind: "resilience"
    Stable discriminant that selects the documented variant.
  readonly type: "bulkhead"
    Protocol or representation variant selected by this value.
  readonly concurrency: number
    Maximum concurrent operations admitted by the bulkhead owner.
  readonly queue: number
    Maximum operations that may wait when bulkhead concurrency is exhausted.
```

### types: CircuitBreakerPolicy

[Declaration source](types.ts#L50)

```text
interface CircuitBreakerPolicy
  Circuit-breaker policy around a provider/resource capability.

  readonly kind: "resilience"
    Stable discriminant that selects the documented variant.
  readonly type: "circuit-breaker"
    Protocol or representation variant selected by this value.
  readonly failureThreshold: number
    Failure count that opens the circuit under this policy.
  readonly resetAfter: Temporal.Duration
    Time before an open circuit admits a half-open trial.
  readonly halfOpenPermits: number
    Maximum trial calls admitted while the circuit is half-open.
```

### types: IdempotencyPolicy

[Declaration source](types.ts#L14)

```text
interface IdempotencyPolicy
  Request idempotency protocol.

  readonly kind: "resilience"
    Stable discriminant that selects the documented variant.
  readonly type: "idempotency"
    Protocol or representation variant selected by this value.
  readonly header: string
    HTTP header used to carry the caller-controlled idempotency key.
  readonly required: boolean
    Whether the runtime must reject a request that omits the configured idempotency header.
  readonly maximumKeyBytes: number
    Maximum UTF-8 bytes accepted for a caller-controlled idempotency key.
  readonly ttl?: Temporal.Duration
    Optional lifetime selected by the caller.
```

### types: RateLimitPolicy

[Declaration source](types.ts#L76)

```text
interface RateLimitPolicy
  Request-rate admission policy.

  readonly kind: "resilience"
    Stable discriminant that selects the documented variant.
  readonly type: "rate-limit"
    Protocol or representation variant selected by this value.
  readonly limit: number
    Explicit caller-selected upper bound for this operation.
  readonly window: Temporal.Duration
    Rate-limit accounting interval enforced by the designated runtime adapter.
  readonly key?: string
    Stable lookup or correlation key within the owning contract.
```

### types: ResilienceDocument

[Declaration source](types.ts#L138)

```text
interface ResilienceDocument
  JSON-safe policy documentation.

  readonly type: ResiliencePolicy["type"]
    Protocol or representation variant selected by this value.
  readonly owner: ResilienceOwner
    Runtime owner responsible for executing the policy.
  readonly stage: ResilienceStage
    Request lifecycle stage where the policy takes effect.
  readonly configuration: Readonly<Record<string, string | number | boolean | readonly string[]>>
    JSON-safe policy settings projected for documentation; projection does not enforce them.
```

### types: ResilienceValidationIssue

[Declaration source](types.ts#L119)

```text
interface ResilienceValidationIssue
  Deterministic validation issue.

  readonly code: "invalid-policy" | "duplicate-policy" | "conflicting-policy" | "unsafe-retry"
    Stable machine-readable reason that callers can inspect without matching message text.
  readonly message: string
    Human-readable explanation; use the stable code or discriminant for program decisions.
  readonly policy?: ResiliencePolicy
    Explicit caller-selected policy; generic mechanics do not choose product decisions.
```

### types: RetryPolicy

[Declaration source](types.ts#L30)

```text
interface RetryPolicy
  Bounded automatic retry policy.

  readonly kind: "resilience"
    Stable discriminant that selects the documented variant.
  readonly type: "retry"
    Protocol or representation variant selected by this value.
  readonly maximumAttempts: number
    Total attempt budget, including the initial attempt.
  readonly initialDelay: Temporal.Duration
    Initial retry delay before growth, jitter and maximum bounds are applied.
  readonly maximumDelay: Temporal.Duration
    Upper bound for the retry delay after applying the selected policy.
  readonly multiplier: number
    Growth factor applied to retry delays before the maximum delay bound.
  readonly jitter: boolean
    Randomized delay policy; tests can provide deterministic randomness.
  readonly retryOn?: readonly string[]
    Optional stable failure codes that the runtime may retry; this list is not a callback.
```

### types: TimeoutPolicy

[Declaration source](types.ts#L4)

```text
interface TimeoutPolicy
  Absolute request timeout policy.

  readonly kind: "resilience"
    Stable discriminant that selects the documented variant.
  readonly type: "timeout"
    Protocol or representation variant selected by this value.
  readonly duration: Temporal.Duration
    Lease or operation duration interpreted with the owning clock.
```

### types: ResilienceInput

[Declaration source](types.ts#L116)

```text
type ResilienceInput = ResiliencePolicy | readonly ResilienceInput[]
  Recursive authoring input accepted by resiliency fields.
```

### types: ResilienceOperationSafety

[Declaration source](types.ts#L1)

```text
type ResilienceOperationSafety = "safe" | "idempotent" | "unsafe"
  HTTP method safety class used when validating retry policy.
```

### types: ResilienceOwner

[Declaration source](types.ts#L100)

```text
type ResilienceOwner = "server" | "adapter"
  Runtime owner responsible for executing one resilience policy.
```

### types: ResiliencePolicy

[Declaration source](types.ts#L106)

```text
type ResiliencePolicy = TimeoutPolicy | IdempotencyPolicy | RetryPolicy | CircuitBreakerPolicy | BulkheadPolicy | RateLimitPolicy | BodyLimitPolicy
  Any static resiliency policy.
```

### types: ResilienceStage

[Declaration source](types.ts#L103)

```text
type ResilienceStage = "request" | "admission" | "operation"
  Request lifecycle stage where one resilience policy takes effect.
```

### types: ResilienceValidationResult

[Declaration source](types.ts#L133)

```text
type ResilienceValidationResult = Readonly<{ readonly valid: true; readonly policies: readonly ResiliencePolicy[]; }> | Readonly<{ readonly valid: false; readonly issues: readonly ResilienceValidationIssue[]; }>
  Validation result for one composed resiliency plan.
```
