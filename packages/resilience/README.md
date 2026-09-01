`@okikio/resilience`
===================

Purpose
-------

`@okikio/resilience` defines import-safe timeout, idempotency, retry,
circuit-breaker, bulkhead, rate-limit, and body-limit policies. Definitions do
not allocate timers, counters, stores, or provider clients.

How it fits
-----------

Endpoints, middleware, services, activities, and provider adapters can
contribute these policies. The runtime that owns the affected operation must
supply the concrete behavior and must reject semantics it cannot support.

Import-safe timeout, idempotency, retry, circuit-breaker, bulkhead, rate-limit, and body-limit policy definitions.

Policies describe required behavior. They never start timers, open stores, allocate distributed counters, or wrap providers at import time.

Start here
----------

Attach explicit resilience policy where a real operation can fail:

```ts
import * as resilience from '@okikio/resilience';

const policy = resilience.retry({
  maximumAttempts: 3,
  initialDelay: { milliseconds: 250 },
  maximumDelay: { seconds: 2 },
  jitter: true,
});
```

The policy describes retry behavior. The runtime that owns the operation still
owns cancellation, deadlines, and the actual attempt.

For durable scheduling, `resilience.retryDelay(policy, failedAttempt)` computes
the policy's bounded exponential delay without starting a timer. Jittered
policies require the caller to provide the unit-interval jitter sample, so a
replay-sensitive scheduler can use deterministic entropy. The queue or runtime
still owns persistence, clocks, cancellation, and wake-up behavior.

Runtime ownership
-----------------

The generic Hono service runtime implements two policies directly:

```text
timeout
  Bounds request execution and actively aborts work at the deadline.

body-limit
  Bounds the request body before parsing or endpoint validation.
```

The remaining policies require an explicit host runtime:

```text
idempotency
  Durable operation-key ownership, in-progress coordination, response replay,
  conflict detection, and expiry.

rate-limit
  Distributed or deliberately regional admission accounting and Retry-After.

bulkhead
  Concurrency permits, bounded queues, cancellation, and release.

circuit-breaker
  Failure accounting, open/half-open state, and recovery probes.

retry
  Attempt classification, delay/backoff, cancellation, and retry-safe scope.
```

A service that declares one of those policies fails during runtime creation when no supporting resilience adapter is supplied. Policies never silently become documentation-only no-ops.

```ts
const runtime = service.create(compiled, implementation, {
  host,
  concerns: {
    resilience: {
      supports(policy) {
        return distributedResilience.supports(policy.type);
      },

      async run(policies, state, next) {
        return await distributedResilience.execute({
          policies,
          request: state.request,
          operation: state.operation,
          signal: state.execution.signal,
          next,
        });
      },
    },
  },
});
```

Policy placement
----------------

Request idempotency, request admission, and operation bulkheads may be declared on service operations. Provider-call retries and provider circuit breakers usually belong on the resource/provider adapter that owns the call; retrying an entire endpoint can repeat unrelated reads or side effects.

The compiler rejects unsafe retry declarations unless the effective operation also has an idempotency policy.


Runtime stages
--------------

Service-level policies are not all wrapped around the same block of work:

```text
validated request
|
+-- afterValidation middleware
|   |
|   +-- admission stage
|       idempotency -> rate limit -> bulkhead
|       |
|       +-- requirement interpretation
|       |   permission / entitlement / meter / future families
|       |
|       +-- operation stage
|           retry -> circuit breaker
|           |
|           +-- aroundOperation middleware
|               transaction/unit of work
|               +-- handler
```

`resilience.stage(policy)` exposes the assignment used by the generic service
runtime. A retry recreates `aroundOperation` middleware for every attempt, so a
transaction does not span several attempts. It does not automatically repeat
requirement interpretation. A requirement-family runtime decides whether a requirement is informational, observed, or enforced; resilience does not silently repeat that decision for each retry.

```ts
const CreateImportResilience = [
  resilience.timeout({ seconds: 30 }),
  resilience.bodyLimit(5_000_000),
  resilience.idempotent({ ttl: { hours: 24 } }),
  resilience.rateLimit({
    limit: 20,
    window: { minutes: 1 },
    key: 'organization',
  }),
  resilience.bulkhead({ concurrency: 8, queue: 32 }),
  resilience.retry({
    maximumAttempts: 3,
    retryOn: ['serialization-failure'],
  }),
];
```

The policy list may be contributed at service, targeted service-policy,
endpoint-group, endpoint-path, or operation scope. The compiler rejects two
different effective configurations for the same policy type.

Standard retry runtime
----------------------

```ts
const retryHost = service.retry({
  isRetriable(error, policy) {
    return error instanceof PostgresSerializationError &&
      policy.retryOn?.includes('serialization-failure') === true;
  },
});
```

The adapter delegates delay, exponential backoff, jitter, attempt limits, and
abort handling to `@std/async/retry`. Ordinary errors are not retryable by
default. An adapter must deliberately classify the failure or throw
`RetryableOperationError`.

Several focused hosts can be linked without a lowest-common-denominator
implementation:

```ts
const resilienceHost = service.resilience(
  postgresIdempotencyRuntime,
  distributedRateLimitRuntime,
  localBulkheadRuntime,
  service.retry(),
  providerCircuitRuntime,
);
```

Each effective policy must have exactly one runtime owner. Zero owners is a
configuration error; two owners is an ambiguity error.

Generated HTTP contract
-----------------------

The service compiler projects policy-visible transport behavior:

- an idempotency request header for idempotent operations;
- `409` for an idempotency-key conflict;
- `429` plus `Retry-After` for rate-limit admission;
- `503` plus `Retry-After` for bulkhead or circuit-breaker admission;
- timeout and body-limit problem responses.

Provider-specific rate-limit metadata may add fields such as remaining capacity or reset time, but the portable definition does not pretend every store exposes the same counters.

Adapter ownership
-----------------

Database, cache, workflow, and provider packages implement concrete behavior. For example:

- Postgres/Drizzle can own a durable idempotency table and transaction protocol;
- Redis or another distributed counter can own global rate limits;
- an HTTP provider resource can own retry and circuit-breaker state;
- an in-process semaphore can own a deliberately local bulkhead.

Those adapters consume the same immutable policy definitions and must reject unsupported semantics rather than degrading silently.

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `timeout()` / `retry()` / `circuitBreaker()` / `bulkhead()` / `rateLimit()` | construct policy records, validate durations/counts, and normalize defaults separately for every caller | one immutable policy vocabulary |
| `compose()` / `validate()` | flatten policy sets, reject duplicate stages, and verify stage compatibility manually | one ordered resilience pipeline contract |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/resilience` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with AbortSignal timers, @std/async/retry, counters, and small state machines around the operation.

The utility makes limits and policy composition explicit without hiding the underlying timing and cancellation mechanics.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Composition and inspection
--------------------------

- `circuitBreaker()` defines the breaker portion of a resilience policy.
- `compose()` combines compatible resilience declarations without starting runtime state.
- `validate()` checks one composed policy before a host builds runtime machinery.
- `document()` projects deterministic JSON-safe policy metadata for configuration tooling.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
