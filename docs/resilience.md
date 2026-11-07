# Repeat work only under an explicit policy

A transient read failure can justify another attempt. A partially completed payment needs application-level idempotency
before repetition is safe. Resilience makes the timing and classification choices explicit without choosing the service
or storage that owns an operation's effects.

There are three independent uses:

- `retry` and `retryDelay` describe and calculate retry timing without performing work.
- `attempt` runs one operation until success or its explicit failure/cancellation policy stops it.
- `poll` repeatedly checks for work, waiting when idle and stopping on cancellation or permanent failure.

Service-oriented policies can also be inspected before an adapter applies them. A policy value cannot supply durable
state, idempotency storage, or a distributed limit by itself. Read the
[executable examples](../packages/capability/resilience/README.md), then use the policies below to adapt them.

Start with the operation's safety rule. A classifier must recognize failures for which another attempt is permitted.
Then choose a retry policy and a cancellation lifetime. The attempt utility preserves the operation's ordinary return
value and exact failures.

Use `@okikio/capability/resilience/attempt` when finite retry is the only capability needed. The same function is
exposed as `resilience.attempt` from the package family and as `attempt` from Capability's root.

## Retry a temporary read once

The first read throws a specific temporary error; the second returns the report. The classifier permits only that error
to retry. The output shows both the returned value and the two calls counted by the application.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `example.ts` at the checkout root and use
`mise exec -- deno run example.ts`.

A **jittered** retry varies its delay so many callers do not retry at the same instant after a shared failure.
This example sets `jitter: false` so its delay is predictable; it demonstrates retry classification without random timing.

```ts runnable=retry-read.ts
import { attempt, retry } from '@okikio/capability/resilience';
import { ms } from '@okikio/duration';

const temporary = new Error('Read temporarily unavailable.');
let calls = 0;
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

## Time, cancellation, and attempts

An attempt number starts at one. `maximumAttempts` includes the initial operation. After an eligible failure, the
utility calculates `retryDelay`, awaits `onRetry`, and waits on the borrowed clock. The next call receives the same
AbortSignal. Long waits use Context's bounded timer slices while keeping the absolute target intact.

Cancellation is checked before and after each awaited operation. A result arriving after an abort is not returned as
success. The exact signal reason is thrown, including null. An underlying provider must cooperate with the supplied
signal to interrupt its pending I/O. A never-settling provider cannot be forcibly joined by this utility.

Only operation failures reach `isRetryable`. Classifier, entropy, retry-hook, and clock failures stop execution
directly. Exhausted attempts rethrow the operation's last rejected value by identity. No generic error wrapper replaces
it.

## Inspect configuration separately

`retry` validates configuration and stores Temporal durations. Its timing values use fixed elapsed days and weeks, and
reject months or years without an application calendar. Jitter requires explicit samples; `jitter: false` disables it.
`retryDelay` alone never enforces the count of attempts.

`validate` checks combinations, including an unsafe retry without an idempotency declaration. `owner` and `stage`
describe which service/adapter applies each policy and at what point. They do not turn a policy into a running limiter,
circuit, timer, or store.

## Compose with Task or Workflow

A Task may call `attempt` around one provider operation while retaining its own progress, checkpoints, and cleanup. A
Workflow scheduler can instead use the pure delay calculation to persist a next wake-up. Do not put an opaque local
retry loop around work whose every attempt must be represented in workflow history; let that scheduler own the retries.

An accepted effect remains accepted after producer cancellation. A retry must reuse the application's logical identity
and its recipient must implement the required duplicate policy. A log or progress event cannot make a write idempotent.

The [package guide](../packages/capability/resilience/README.md) supplies runnable standalone examples. Source contracts
are in [attempt.ts](../packages/capability/resilience/attempt.ts), [poll.ts](../packages/capability/resilience/poll.ts),
and [types.ts](../packages/capability/resilience/types.ts).
