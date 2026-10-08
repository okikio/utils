# `@okikio/duration`

A settings screen says “wait 2.5 seconds,” but a timer wants the number `2500`. `@okikio/duration` translates structured
or text durations into milliseconds and compares two durations consistently. It lets retries, queue leases, and timeout
configuration share one conversion rule instead of each doing its own arithmetic.

**Temporal** is the JavaScript date-and-time API used for these values. `PT2.5S` is its standard duration text for 2.5
seconds. A duration describes an amount of time; converting it does not start a timer.

| Input question                     | Answer in the demo   | Meaning                                           |
| ---------------------------------- | -------------------- | ------------------------------------------------- |
| How many milliseconds is `PT2.5S`? | `2500`               | 2.5 seconds, expressed in thousandths of a second |
| Does one month equal 31 days?      | `0` from `compare()` | Equal at this package's fixed January 2000 anchor |

The table shows conversion rules, not a universal rule that every month has 31 days. Calendar units use `2000-01-01` as
their anchor; billing periods or “next month from today” need their own business date.

The [full API reference](API.md) includes the input type and explicit Temporal entrypoints.

## Run a complete example

The Temporal installer is needed only on hosts without Temporal. Duration conversion uses no disposal API.

```ts runnable
import '@okikio/duration/polyfill';
import * as duration from '@okikio/duration';
console.log(duration.milliseconds('PT2.5S'));
console.log(duration.compare({ months: 1 }, { days: 31 }));
```

Expected output:

```text output
2500
0
```

## Use the number with an ordinary timer

When a retry setting arrives as ISO duration text, convert it once and hand the number to JavaScript's timer. This demo
uses a one-millisecond setting to finish quickly; real applications can supply longer settings such as `PT2.5S`. The
timer owns the wait.

```ts runnable=plain-timer.ts
import '@okikio/duration/polyfill';
import { milliseconds } from '@okikio/duration';

const retrySetting = 'PT0.001S';
const delay = milliseconds(retrySetting);
await new Promise<void>((resolve) => setTimeout(resolve, delay));
console.log('Ready to try again.');
```

```text output
Ready to try again.
```

| Call or input          | Contract                                                         | Boundary                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DurationInput`        | `Temporal.Duration`, duration-like record or ISO duration string | `{ seconds: 2.5 }` is not the same input as `{ milliseconds: 2500 }`: Temporal requires integer record fields. Use `PT2.5S` for fractional seconds. |
| `milliseconds(input)`  | Input → number immediately                                       | Uses Temporal conversion. Invalid inputs throw Temporal errors; no timer is started.                                                                |
| `compare(left, right)` | Two inputs → negative, zero or positive number                   | Uses the same calendar anchor for both operands.                                                                                                    |

One level deeper: both functions first call `Temporal.Duration.from()`. `milliseconds()` then totals milliseconds;
`compare()` uses Temporal's duration comparison. Both supply the fixed date `2000-01-01` when calendar units need an
anchor. That shared date makes generic conversions repeatable, but it cannot answer “how long is next month from today?”
Use a real business date with Temporal directly for that question.

## Temporal when the host has none

The ponyfill is a local import. It does not write to globalThis:

```ts runnable
import { Temporal } from '@okikio/duration/temporal';
const now = Temporal.Instant.from('2026-01-01T00:00:00Z');
console.log(now.add({ minutes: 15 }).toString());
```

```text output
2026-01-01T00:15:00Z
```

Use `import '@okikio/duration/polyfill'` first at each application, Worker or process entry point when utilities use
global Temporal. This exposes the existing
[`temporal-polyfill` implementation](https://github.com/fullcalendar/temporal-polyfill) through its
`full/implementation` entry, including non-ISO calendars. Loading that implementation adds startup and bundle cost; the
explicit installer preserves native Temporal when present. It does not install the separate
Date.prototype.toTemporalInstant extension. Avoid mixing constructor identity checks across native and ponyfill realms;
use strings or duration-like records at those interfaces.

Duration converts time. Workflow durable values and history make outcomes serializable and replayable; a Temporal
polyfill does not make a workflow store durable.

`milliseconds()` returns a number immediately, here `2500`; `compare()` returns the ordering value `0` for these
calendar-anchored inputs. Conversion starts no timer and owns no lifetime. Timer APIs decide independently whether a
converted duration is allowed and who clears the timer.

## Read the mini-demo

The first demo prints a number a timer API can consume, then prints `0`, meaning the two anchored durations compare as
equal. Try replacing `PT2.5S` with `PT1S` to get `1000`. For calendar-sensitive work, change the comparison approach
rather than interpreting that fixed anchor as today's calendar. The local Temporal mini-demo adds 15 minutes to a known
instant and prints the new instant without installing a global.

- **Give a download a deadline:** use [Context](../context/README.md) to own cancellation and the timer. Duration
  supplies conversion mechanics; the context decides which durations are acceptable for a deadline.
- **Plan retry waits:** use [Resilience](../resilience/README.md) to describe delays and retry safety, then let the
  chosen runtime apply them. A time value does not decide whether repeating a payment or write is safe.

## Choose the operation's time policy

Conversion and permission are separate decisions. A deadline may forbid months, a retry wait may require positive time,
and a host timer may clamp large numbers. Each caller must decide those rules before starting its operation.
`milliseconds({ seconds: 2, milliseconds: 250 })` returns `2250`; it does not decide whether that wait is appropriate.

Calendar comparison uses the same fixed anchor as conversion. The opening example compares one month with 31 days and
gets `0`, because January 2000 has 31 days. That result is repeatable mechanics, not a claim about every month.

## Convenience and the manual equivalent

| Convenience                     | Manual equivalent                                                                                                                    | Concrete value                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `duration.milliseconds(value)`  | call `Temporal.Duration.from(value).total({ unit: 'milliseconds', relativeTo })` with the same fixed `Temporal.PlainDate` everywhere | one deterministic conversion rule across utilities             |
| `duration.compare(left, right)` | normalize both inputs and call `Temporal.Duration.compare(left, right, { relativeTo })` with the same fixed relative date            | one deterministic ordering rule for calendar-bearing durations |

The underlying object model is still Temporal. The convenience functions only centralize the relative-date mechanism.

```ts
import { Temporal } from '@okikio/duration/temporal';

const relativeTo = Temporal.PlainDate.from('2000-01-01');
const value = Temporal.Duration.from({ months: 1 });
const milliseconds = value.total({ unit: 'milliseconds', relativeTo });

console.log(milliseconds);
// 2678400000
```

Expected output:

```text
2678400000
```

Outcome: this is the lower-level operation that `duration.milliseconds()` keeps consistent. Use the direct Temporal form
when you intentionally need a _different_ calendar anchor because the date itself has domain meaning.

## What callers still own

A shared conversion must not silently become shared policy. For example:

- context timers can reject years and months;
- queue lease validation can require a positive duration;
- workflow retry code can translate Temporal errors into workflow-specific diagnostics;
- gateway runtime code can clamp a converted value to the JavaScript timer range.

That separation keeps this package generic.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` contains the two runtime operations and the private deterministic calendar anchor.
2. `types.ts` defines the accepted Temporal input shape.
3. `mod.test.ts` shows fixed-unit, calendar-unit, negative, and ordering behavior as executable examples.

The [generated API reference](API.md) lists the public operations, input shape and Temporal entrypoints.
