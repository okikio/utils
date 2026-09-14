`@okikio/resilience`
===================

`@okikio/resilience` defines import-safe policies for request protection and
failure handling. Policy definitions contain configuration only. They do not
start timers, create distributed counters, open stores, or change circuit state
when imported.

Start here
----------

~~~~ typescript
import * as resilience from '@okikio/resilience';

const RetryWrites = resilience.retry({
  maximumAttempts: 3,
  initialDelay: { milliseconds: 250 },
  maximumDelay: { seconds: 2 },
  jitter: true,
  retryOn: ['serialization-failure'],
});
~~~~

The policy states what retry behavior is allowed. The runtime that executes the
operation still owns cancellation, attempt classification, timers, and any
stateful provider behavior.

Two independent questions
-------------------------

Every resilience policy answers two separate questions.

### Who executes it?

`resilience.owner(policy)` returns:

 -  `server`: the generic service runtime can execute the policy from request
    state that it already owns.
 -  `adapter`: the policy needs application or distributed state that the generic
    server does not own.

### When does it run?

`resilience.stage(policy)` returns:

 -  `request`: protects raw request execution before application work starts.
 -  `admission`: runs once after validation before application requirements and
    endpoint execution.
 -  `operation`: wraps endpoint execution and can control repeated attempts.

These classifications are independent. `server` is not a stage, and `admission`
is not an ownership model.

Policy map
----------

| Policy | Owner | Stage | Concrete job |
| ------ | ----- | ----- | ------------ |
| `body-limit` | `server` | `request` | Reject a request body that exceeds the configured byte limit before parsing |
| `timeout` | `server` | `request` | Give the request context an absolute deadline and abort work when the deadline expires |
| `idempotency` | `adapter` | `admission` | Coordinate one logical request key, detect conflicts, and replay an accepted result |
| `rate-limit` | `adapter` | `admission` | Admit or reject one request from a caller, tenant, route, or other configured key |
| `bulkhead` | `adapter` | `admission` | Bound concurrent admitted requests and any configured wait queue |
| `retry` | `adapter` | `operation` | Repeat endpoint execution when the adapter classifies the failure as retry-safe |
| `circuit-breaker` | `adapter` | `operation` | Reject or probe protected execution according to failure history and breaker state |

The generic server executes only the two `server` policies. An adapter-owned
policy must have an explicit runtime implementation. Missing implementations fail
runtime creation instead of silently turning a policy into documentation.

Why admission and operation are separate
----------------------------------------

Admission applies once to the logical HTTP request. Operation resilience applies
after requirements have passed and wraps the endpoint operation.

~~~~ text
validated request
    |
    +-- admission
    |     idempotency
    |     rate limit
    |     bulkhead
    |
    +-- requirements
    |     permission
    |     entitlement
    |     quota / consent / another family
    |
    `-- operation
          retry
          circuit breaker
            |
            +-- aroundOperation middleware
            |     transaction / unit of work
            |
            `-- handler
~~~~

A retry can execute the operation more than once. It does not automatically
consume another rate-limit admission or rerun authentication. Because
`aroundOperation` middleware is inside operation resilience, each retry attempt
can start a fresh transaction instead of reusing a failed transaction.

Runtime adapters
----------------

`@okikio/server/service` accepts a `ServiceResilienceAdapter`. The adapter owns
state that the generic server cannot own.

~~~~ typescript
const resilienceAdapter = service.resilience(
  postgresIdempotencyAdapter,
  distributedRateLimitAdapter,
  localBulkheadAdapter,
  service.retry({
    isRetriable(error, policy) {
      return error instanceof PostgresSerializationError &&
        policy.retryOn?.includes('serialization-failure') === true;
    },
  }),
  providerCircuitAdapter,
);

await using runtime = service.create(compiled, {
  host,
  adapters: {
    resilience: resilienceAdapter,
  },
});
~~~~

Each effective adapter-owned policy must have exactly one adapter. No adapter is
a configuration error. More than one matching adapter is an ambiguity error.

Policy placement
----------------

Service-level resilience should protect the whole endpoint only when that scope
matches the intended failure semantics.

A provider-call retry usually belongs on the provider resource that owns the
call. Retrying a whole endpoint can repeat unrelated reads and side effects. The
compiler rejects retry on an unsafe operation unless the operation also declares
an idempotency policy.

Durable runtimes can use `retryDelay()` without starting a timer. The function
calculates the configured backoff for one failed attempt. A queue or workflow
runtime still owns persistence, clocks, cancellation, wake-up behavior, and
replay-safe entropy.

Idempotency requirements
------------------------

`idempotent()` limits caller-controlled keys to 256 UTF-8 bytes by default. A
concrete idempotency adapter still owns the durability protocol.

The adapter must define at least:

 -  the tenant or principal scope of a key
 -  atomic ownership of in-progress work
 -  request fingerprint comparison before replay
 -  success and failure retention rules
 -  expiry
 -  which response fields are safe to replay
 -  how cancellation affects in-progress ownership

Do not replay transport fields such as `Set-Cookie`, `Content-Length`, or
`Transfer-Encoding` unless the adapter has an explicit protocol that makes the
field safe.

Inspection and documentation
----------------------------

`compose()` flattens authored policy input. `validate()` rejects conflicting
configurations and unsafe retry plans. `document()` creates deterministic
JSON-safe metadata for generated service artifacts and deployment tooling.
