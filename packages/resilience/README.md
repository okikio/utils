# `@okikio/resilience`

A remote service sometimes fails. Retrying can help a read, but retrying a payment can charge someone twice.
`@okikio/resilience` describes protection rules such as deadlines, retry delays, and request limits as values that a
runtime can inspect and validate before applying them. You can see the policy without starting a timer or opening a
store.

A **retry** repeats an attempt. **Idempotency** means repeated attempts for one logical operation do not create unwanted
duplicate effects; its implementation needs an appropriate owner and storage. A retry policy alone does not provide it.

```text
Describe policy -> validate against operation safety -> chosen runtime applies
                          |                                  |
                      invalid: stop                    attempts / waits / limits
```

The visual separates configuration from execution. This package calculates and classifies policy; the executing server
or adapter owns actual waits, cancellation, failure classification, and any shared state.

## Inspect retry delays before doing any work

The duration polyfill supplies Temporal when the host lacks it. Retry settings and calculated delays use Temporal
durations; this example creates no cleanup owner and therefore needs no disposal polyfill.

```ts runnable
import '@okikio/duration/polyfill';
import * as resilience from '@okikio/resilience';
const retry = resilience.retry({
	initialDelay: { seconds: 1 },
	maximumDelay: { seconds: 5 },
	multiplier: 2,
	jitter: false,
});
console.log(resilience.retryDelay(retry, 1).milliseconds);
console.log(resilience.retryDelay(retry, 4).milliseconds);
console.log(resilience.validate(retry, { safety: 'unsafe' }).valid);
```

Expected output:

```text output
1000
5000
false
```

## Read the mini-demo

The demo asks for retry delays starting at one second, doubling toward a five-second ceiling, with jitter disabled. The
delay after failed attempt 1 prints `1000` milliseconds; asking for the delay after failed attempt 4 prints the capped
value `5000`. This is arithmetic, not permission for another attempt: `maximumAttempts` defaults to three, and the
executing runtime must enforce that count. The final `false` means this retry policy does not validate for an operation
labelled unsafe without the required safety protection. It makes no network calls. Try a different delay multiplier to
inspect the calculation before any real operation runs.

The policy is a frozen configuration object with this contract:

```text
RetryPolicy
  kind: "resilience"
  type: "retry"
  maximumAttempts: number          includes the first attempt
  initialDelay: Temporal.Duration
  maximumDelay: Temporal.Duration
  multiplier: number
  jitter: boolean
  retryOn?: string[]               labels the executing runtime must interpret
```

`retry()` normalizes duration input and validates the settings. `retryDelay(policy, failedAttempt)` calculates a
`Temporal.Duration`: start at `initialDelay`, multiply for later failures, cap the delay, and apply a supplied jitter
sample when enabled. It starts no timer and does not decide whether that error deserves a retry. The executing owner
still checks the attempt budget, classifies failures, waits, and forwards cancellation to the operation. This keeps the
same policy inspectable in a service manifest and usable by a queue's persisted wake-up scheduler. The
[contract reference](API.md) covers the other policy shapes.

## Keep an ordinary async read inside an explicit retry loop

This simulated read fails once with a known temporary error, then returns text. The application owns the loop and uses
the policy for its attempt limit and delay. A one-millisecond configured delay keeps the demo short; there is no
elapsed-time assertion. In production, choose a realistic delay and signal, and retry only failures your operation can
safely repeat.

```ts runnable=retry-read.ts
import '@okikio/duration/polyfill';
import * as resilience from '@okikio/resilience';
import { setTimeout as wait } from 'node:timers/promises';
class TemporaryError extends Error {}
const policy = resilience.retry({
	maximumAttempts: 2,
	initialDelay: { milliseconds: 1 },
	maximumDelay: { milliseconds: 1 },
	jitter: false,
});
let attempts = 0;
async function read(): Promise<string> {
	attempts++;
	if (attempts === 1) throw new TemporaryError('Try the read again.');
	return 'Report ready';
}
async function readWithRetry(signal: AbortSignal): Promise<string> {
	for (let attempt = 1;; attempt++) {
		signal.throwIfAborted();
		try {
			return await read();
		} catch (error) {
			if (!(error instanceof TemporaryError) || attempt >= policy.maximumAttempts) throw error;
			await wait(resilience.retryDelay(policy, attempt).total('milliseconds'), undefined, { signal });
		}
	}
}
console.log(await readWithRetry(new AbortController().signal));
console.log(attempts);
```

```text output
Report ready
2
```

The signal stops this loop or its wait. The local `read()` has no pending I/O to cancel; a real fetch must also receive
that signal. The result remains `Promise<string>`. A server adapter can own this repeated-attempt loop instead when you
need consistent endpoint retry behavior, but a policy object alone never retries anything.

- **Protect a report endpoint:** combine policy values with [Service](../server/service/README.md). Its runtime owns
  server policies; adapter-owned policies need an explicit implementation, such as an application-owned idempotency
  store.
- **Wait between background attempts:** use [Workflow](../workflow/README.md) and [Context](../context/README.md) for
  execution and cancellation. Reuse a logical operation key for replay-safe writes; telemetry about a retry cannot make
  the write idempotent.

## Build on the example

Validate a policy set first, then let the designated server or adapter enforce it. Retry safety requires idempotency for
unsafe operations; a description does not itself create an idempotency store. Supply entropy explicitly for jitter and a
clock for actual waits. Body limits, bulkheads and circuit breakers have different owners and lifecycle stages, which
the document projection preserves.

`@okikio/resilience` defines import-safe policies for request protection and failure handling. Policy definitions
contain configuration only. They do not start timers, create distributed counters, open stores, or change circuit state
when imported.

## Start here

```typescript
import * as resilience from '@okikio/resilience';

const RetryWrites = resilience.retry({
	maximumAttempts: 3,
	initialDelay: { milliseconds: 250 },
	maximumDelay: { seconds: 2 },
	jitter: true,
	retryOn: ['serialization-failure'],
});
console.log(resilience.document(RetryWrites)[0]?.configuration.maximumAttempts);
```

The policy states what retry behavior is allowed. The runtime that executes the operation still owns cancellation,
attempt classification, timers, and any stateful provider behavior.

## Two independent questions

Every resilience policy answers two separate questions.

### Who executes it?

`resilience.owner(policy)` returns:

- `server`: the generic service runtime can execute the policy from request state that it already owns.
- `adapter`: the policy needs application or distributed state that the generic server does not own.

### When does it run?

`resilience.stage(policy)` returns:

- `request`: protects raw request execution before application work starts.
- `admission`: runs once after validation before application requirements and endpoint execution.
- `operation`: wraps endpoint execution and can control repeated attempts.

These classifications are independent. `server` is not a stage, and `admission` is not an ownership model.

## Policy map

| Policy            | Owner     | Stage       | Concrete job                                                                           |
| ----------------- | --------- | ----------- | -------------------------------------------------------------------------------------- |
| `body-limit`      | `server`  | `request`   | Reject a request body that exceeds the configured byte limit before parsing            |
| `timeout`         | `server`  | `request`   | Give the request context an absolute deadline and abort work when the deadline expires |
| `idempotency`     | `adapter` | `admission` | Coordinate one logical request key, detect conflicts, and replay an accepted result    |
| `rate-limit`      | `adapter` | `admission` | Admit or reject one request from a caller, tenant, route, or other configured key      |
| `bulkhead`        | `adapter` | `admission` | Bound concurrent admitted requests and any configured wait queue                       |
| `retry`           | `adapter` | `operation` | Repeat endpoint execution when the adapter classifies the failure as retry-safe        |
| `circuit-breaker` | `adapter` | `operation` | Reject or probe protected execution according to failure history and breaker state     |

The generic server executes only the two `server` policies. An adapter-owned policy must have an explicit runtime
implementation. Missing implementations fail runtime creation instead of silently turning a policy into documentation.

## Why admission and operation are separate

Admission applies once to the logical HTTP request. Operation resilience applies after requirements have passed and
wraps the endpoint operation.

```text
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
```

A retry can execute the operation more than once. It does not automatically consume another rate-limit admission or
rerun authentication. Because `aroundOperation` middleware is inside operation resilience, each retry attempt can start
a fresh transaction instead of reusing a failed transaction.

## Runtime adapters

`@okikio/server/service` accepts a `ServiceResilienceAdapter`. The adapter owns state that the generic server cannot
own.

```typescript
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
```

Each effective adapter-owned policy must have exactly one adapter. No adapter is a configuration error. More than one
matching adapter is an ambiguity error.

## Policy placement

Service-level resilience should protect the whole endpoint only when that scope matches the intended failure semantics.

A provider-call retry usually belongs on the provider resource that owns the call. Retrying a whole endpoint can repeat
unrelated reads and side effects. The compiler rejects retry on an unsafe operation unless the operation also declares
an idempotency policy.

Durable runtimes can use `retryDelay()` without starting a timer. The function calculates the configured backoff for one
failed attempt. A queue or workflow runtime still owns persistence, clocks, cancellation, wake-up behavior, and
replay-safe entropy.

## Idempotency requirements

`idempotent()` limits caller-controlled keys to 256 UTF-8 bytes by default. A concrete idempotency adapter still owns
the durability protocol.

The adapter must define at least:

- the tenant or principal scope of a key
- atomic ownership of in-progress work
- request fingerprint comparison before replay
- success and failure retention rules
- expiry
- which response fields are safe to replay
- how cancellation affects in-progress ownership

Do not replay transport fields such as `Set-Cookie`, `Content-Length`, or `Transfer-Encoding` unless the adapter has an
explicit protocol that makes the field safe.

## Inspection and documentation

`compose()` flattens authored policy input. `validate()` rejects conflicting configurations and unsafe retry plans.
`document()` creates deterministic JSON-safe metadata for generated service artifacts and deployment tooling.
