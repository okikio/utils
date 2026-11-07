# Repeat work only under an explicit policy

A read can fail because a service is briefly unavailable. Trying again may help. A payment is different: if the charge
succeeded but its reply was lost, a second call could charge the customer again. Before retrying a write, decide how
the application can recognize the same request and recover its original result. Resilience controls when to try again
and which failures allow it. The application still owns the write.

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

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `retry-read.ts` at the checkout root and use
`mise exec -- deno run retry-read.ts`.

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

Count the initial call as attempt one. In the report example, `maximumAttempts: 2` allows the first read and one retry.
A successful read returns its value. If a read fails, the next step depends on the budget and the error:

| What happened | What `attempt()` does |
| --- | --- |
| No attempts remain | Throws the last read error. |
| The classifier rejects the error | Throws that error immediately. |
| The classifier permits a retry | Calculates the delay, awaits `onRetry`, waits on the clock, and calls the reader again. |

The next call receives the same AbortSignal. When a delay is too long for one timer, Context splits it into shorter
waits without changing the target time.

`attempt()` checks for cancellation before and after each awaited step. If a result arrives after cancellation,
the function throws the signal's reason, even if that reason is `null`. Pass the signal into your I/O call so it
can stop waiting. If that call never finishes, the retry utility cannot force it to stop.

Only errors from the operation go to `isRetryable`. If that callback, the source of random values, `onRetry`,
or the clock throws, the retry loop stops. When no attempts remain, it throws the last value from the operation
without wrapping it.

## Inspect configuration separately

`retry` validates configuration and stores Temporal durations. Its timing values use fixed elapsed days and weeks, and
reject months or years without an application calendar. Jitter requires explicit samples; `jitter: false` disables it.
`retryDelay` alone never enforces the count of attempts.

`validate` checks combinations, including an unsafe retry without an idempotency declaration. `owner` and `stage`
describe which service/adapter applies each policy and at what point. They do not turn a policy into a running limiter,
circuit, timer, or store.

## Compose with Task or Workflow

A Task can retry one operation with `attempt()` and still report progress and clean up as before. A Workflow
scheduler can use `retryDelay()` to calculate when to run again and save that time. If you need workflow history
to show every attempt, let the scheduler run the retries rather than hiding them inside one activity.

Cancelling a sender does not undo an effect the receiver has accepted. When you retry, send the same logical ID.
The receiver needs to recognize that ID and handle the repeat safely. Logging the write does not prevent a duplicate.

The [package guide](../packages/capability/resilience/README.md) supplies runnable standalone examples. Source contracts
are in [attempt.ts](../packages/capability/resilience/attempt.ts), [poll.ts](../packages/capability/resilience/poll.ts),
and [types.ts](../packages/capability/resilience/types.ts).
