# `@okikio/duration`

Convert human-readable Temporal durations to one deterministic numeric value. A month needs a calendar anchor; repeating
that decision across queues, retries and timeouts produces inconsistent answers.

## Run a complete example

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as duration from '@okikio/duration';
console.log(duration.milliseconds('PT2.5S'));
console.log(duration.compare({ months: 1 }, { days: 31 }));
```

Expected output:

```text output
2500
0
```

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

## Build on the example

Use milliseconds() for shared conversion and compare() for shared ordering. Calendar units use 2000-01-01, so this is
deterministic mechanics rather than a business calendar. A timer may still reject years and months; a lease may require
positive time. On hosts without Temporal, import the explicit polyfill first. Use the temporal ponyfill export when your
own application wants a local Temporal value without changing globals.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/duration` gives shared runtime code one deterministic way to convert and compare Temporal durations.

Temporal durations such as `PT30S` are straightforward. Calendar durations such as one month are different because their
exact length depends on the date used for comparison. This package owns one fixed calendar anchor so generic runtime
utilities do not each invent a different answer.

The package does **not** decide whether a duration is valid for a specific operation. A timer can reject months, a retry
policy can require positive time, and a gateway can clamp JavaScript timer ranges. Those policies stay with the caller.

## Start here

```ts
import * as duration from '@okikio/duration';

const milliseconds = duration.milliseconds({ seconds: 2, milliseconds: 250 });
console.log(milliseconds);
// 2250
```

Expected output:

```text
2250
```

Outcome: code that needs a numeric duration can use one shared Temporal conversion rule instead of copying a
relative-date choice into every package.

## Calendar-aware comparison

```ts
import * as duration from '@okikio/duration';

const order = duration.compare({ months: 1 }, { days: 31 });
console.log(order);
// 0
```

Expected output:

```text
0
```

Outcome: both values are compared at the same deterministic calendar anchor, so all callers agree about ordering even
when calendar units are present.

## Convenience and the manual equivalent

| Convenience                     | Manual equivalent                                                                                                                    | Concrete value                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `duration.milliseconds(value)`  | call `Temporal.Duration.from(value).total({ unit: 'milliseconds', relativeTo })` with the same fixed `Temporal.PlainDate` everywhere | one deterministic conversion rule across utilities             |
| `duration.compare(left, right)` | normalize both inputs and call `Temporal.Duration.compare(left, right, { relativeTo })` with the same fixed relative date            | one deterministic ordering rule for calendar-bearing durations |

The underlying object model is still Temporal. The convenience functions only centralize the relative-date mechanism.

```ts
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

The README is the primary user documentation. It stays close to the public source instead of maintaining a separate
hand-written API reference.
