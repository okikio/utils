# Retry, polling, and inspectable protection policies

Use `attempt` to repeat one ordinary operation after an explicitly classified failure. Use `poll` to keep checking for
work. Use policy values when a service, queue, or workflow must inspect protection rules before choosing their owner.
These jobs share timing and retry math; they have different completion and ownership rules.

A **retry** calls the operation again after a failure. **Polling** asks repeatedly whether something has become ready.
A delay between calls gives a temporarily unavailable service time to recover; **backoff** increases that delay over
successive failures. **Jitter** varies the delay so many clients do not all retry at the same instant.

Repeating a read is usually easier to reason about than repeating a payment. If the first payment committed but its reply
was lost, repeating it can charge twice. Decide which failures are safe to repeat before choosing the delay policy.

## Retry a read and return its value

This read fails once with a known temporary error. Only that exact error permits repetition. The result stays a string;
there is no special computation to unwrap and no workflow runtime to start.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `retry-read.ts` and run `mise exec -- deno run retry-read.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable=retry-read.ts
import { attempt, retry } from '@okikio/capability/resilience';
import { ms } from '@okikio/duration';

const temporary = new Error('Read temporarily unavailable.');
let calls = 0;
// Retry only the known temporary failure. This callback performs no external write that a retry could duplicate.
const value = await attempt(() => {
	calls++;
	if (calls === 1) throw temporary;
	return 'Report ready';
}, {
	signal: new AbortController().signal,
	policy: retry({ maximumAttempts: 2, initialDelay: ms(1), jitter: false }),
	isRetryable: (error) => error === temporary,
});
console.log(value);
console.log(calls);
```

```text output
Report ready
2
```

For real I/O, use `async ({ signal }) => fetch(url, { signal })`. A signal passed to `attempt` cannot cancel provider
work unless that work also observes it. Repeating an operation may repeat effects that happened before failure; choose a
classifier only after the application knows repetition is safe.

`maximumAttempts` includes the initial call. The policy controls waits; `isRetryable(error, attempt)` controls which
operation failures may repeat. `retryOn` labels are inspectable metadata for application interpreters, not a built-in
error classifier.

## Own time and failure policy explicitly

| Option        | Effect                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `signal`      | Checked before and after work, hooks, and waits. Exact abort reason is preserved.               |
| `policy`      | Validated attempt count and backoff configuration.                                              |
| `isRetryable` | Required classifier for this operation; false preserves its original rejected value.            |
| `clock`       | Borrowed Context clock; defaults to the system clock. Supply TestClock for deterministic tests. |
| `jitter`      | Explicit unit-interval sample source when policy jitter is enabled.                             |
| `onRetry`     | Awaited hook before the next wait. Hook failures stop the operation and are not retried.        |

Permanent and exhausted failures retain their exact identity, including non-Error rejected values. Classifier, hook,
entropy, and clock failures escape directly. Cancellation wins over a late successful return. Work already admitted must
cooperate with cancellation; no retry utility can preempt a synchronous call or undo a completed write.

The retry policy enables jitter by default. Supply an entropy source or explicitly choose `jitter: false`. No hidden
random source is consulted, so logical-clock tests and durable schedulers can choose reproducible timing.

`retry()` uses these defaults when a field is omitted:

| Field             | Default                                                |
| ----------------- | ------------------------------------------------------ |
| `maximumAttempts` | 3, including the first call                            |
| `initialDelay`    | 100 milliseconds                                       |
| `maximumDelay`    | 5 seconds, including the final jittered delay          |
| `multiplier`      | 2                                                      |
| `jitter`          | `true`; a runner must supply an explicit sample source |

Jitter scales a nominal delay by 0.5 to 1.5. The final delay is capped again so that even the highest sample respects
`maximumDelay`. Choose a different maximum explicitly when selecting an initial delay above five seconds.

## Inspect timing without executing work

`retry` returns configuration. `retryDelay` calculates a delay after a failed attempt and starts no timer. An
independent queue scheduler can use that math while retaining its own persistence and wake-up logic.

Save this complete variation as `inspect-delays.ts` and run `mise exec -- deno run inspect-delays.ts` after the same checkout setup.

```ts runnable=inspect-delays.ts
import { retry, retryDelay, validate } from '@okikio/capability/resilience';
import { sec } from '@okikio/duration';

const policy = retry({ initialDelay: sec(1), maximumDelay: sec(5), multiplier: 2, jitter: false });
console.log(retryDelay(policy, 1).total('milliseconds'));
console.log(retryDelay(policy, 4).total('milliseconds'));
console.log(validate(policy, { safety: 'unsafe' }).valid);
```

```text output
1000
5000
false
```

A calculated delay does not grant another attempt. The executor enforces the attempt count. Validation rejects an unsafe
retry plan without the declared idempotency protocol, but a protocol declaration does not implement an idempotency
store. The selected service or adapter must provide that protection.

## Keep polling separate from a finite attempt

`poll(iteration, options)` runs until cancellation or a permanent/exhausted failure. An iteration returns true after
useful work or false when idle. Idle iterations wait; successful work resets consecutive failure backoff. Busy loops
periodically yield so cancellation and timers can run. It requires an explicit failure classifier and bounded timing.

The polling owner supplies any durable queue, claim, or checkpoint. A process crash loses local polling state. Its
cancellation completes the polling loop normally, whereas `attempt` rejects with the cancellation reason because it was
asked for one operation's result. [poll.ts](./poll.ts) documents the precise loop contract.

Other policy constructors describe timeout, body size, idempotency, rate, concurrent admission, and circuit rules for
hosts that implement them. Importing these values starts no timer, opens no store, and changes no circuit state.
[policy.ts](./policy.ts) and [types.ts](./types.ts) document the policy fields. The
[usage guide](../../../docs/resilience.md) connects these policies to services and workflows.

## Choose adjacent capabilities

Use attempt for an ordinary repeat-safe call and poll when waiting for eligible work. Queue owns retryable logical
items; Workflow owns recorded instructions. Policy data does not start either runtime.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.
