# Use time settings without losing their meaning

A caller should be able to write `sec(2.5)` and pass that value to a retry policy, convert it for a host timer, or
display it as standard duration text, such as `PT2.5S` for two and a half seconds. A reporting window can use `days(7)` while keeping its calendar interpretation explicit. The
[Duration package](../../packages/duration/README.md) lists every constructor and conversion.

The package returns ordinary Temporal durations. It owns time values and conversion; the operation using those values
owns scheduling, cancellation, clocks, and validation such as “the lease must be positive.”

## Use a focused import

Unit constructors and conversion functions can be imported independently. Neither requires the other package utilities.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import { min, ms, sec } from '@okikio/duration/units';
import { elapsed, total } from '@okikio/duration/conversion';

// Retain named units while combining settings; convert only when the consumer needs a numeric unit.
const retry = sec(2.5);
const budget = min(2).add(ms(250));
console.log(elapsed(retry));
console.log(total(budget, 'seconds'));
console.log(budget.toString());
```

```text output
2500
120.25
PT2M0.25S
```

The package root re-exports the same functions for a caller that uses them together. Short names are deliberate
authoring conveniences, not different units or a second time model. `sec` and `s` refer to the same constructor as
`seconds`.

Use `from(value)` for ISO text, standard duration records, or existing Temporal values. Use `from(count, unit)` when the
unit comes from a setting. A bare count such as `from(1000)` rejects because its unit is unknown.

## Choose calendar or fixed elapsed conversion

A local calendar day describes a date transition. A fixed interval describes elapsed time. Choose at the conversion call
rather than hiding a time zone inside the constructor.

```ts runnable
import { days, elapsed, months, total, weeks } from '@okikio/duration';

const spring = '2026-03-08T00:00-05:00[America/New_York]';
const fall = '2026-11-01T00:00-04:00[America/New_York]';
console.log(total(days(1), 'hours', { relativeTo: spring }));
console.log(total(days(1), 'hours', { relativeTo: fall }));
console.log(elapsed(weeks(1), 'hours'));
console.log(total(months(1), 'days', { relativeTo: '2024-02-01' }));
```

```text output
23
25
168
29
```

A date reference has 24-hour days; a zoned reference accounts for its actual clock transitions. Without a reference,
Temporal treats days as 24 hours but cannot determine the length of years, months, or weeks in calendar operations. The
fixed converters instead define a week as seven 24-hour days and reject months and years.

A timeout, queue lease, or retry normally uses `elapsed(value)`. A billing interval or calendar comparison uses `total`
or `compare` with the relevant date. Neither operation supplies an arbitrary date on the caller's behalf.

## Preserve exact nanoseconds

A Number cannot distinguish every large integer. Write a large integer count as bigint and keep it bigint through
conversion.

```ts runnable
import { days, elapsedNanoseconds, ns } from '@okikio/duration';
import { temporal } from '@okikio/duration/temporal';

const count = 9_007_199_254_740_993n;
console.log(elapsedNanoseconds(ns(count)).toString());
const now = temporal.Instant.from('2026-01-01T00:00:00Z');
const offset = elapsedNanoseconds(days(1).add(ns(1n)));
const deadline = temporal.Instant.fromEpochNanoseconds(now.epochNanoseconds + offset);
console.log(deadline.toString());
```

```text output
9007199254740993
2026-01-02T00:00:00.000000001Z
```

`elapsedNanoseconds()` adds each integral component as bigint. It never obtains precision by converting a rounded Number
total back into bigint. Temporal's instant range is smaller than its duration range, so adding a valid duration to an
instant can still exceed the instant's range and throw.

Clock constructors accept bigint counts from hours through nanoseconds. Calendar constructors accept whole numbers. A
converted clock duration must have magnitude below `2^53` seconds; bigint changes precision, not that range.

## Handle fractional settings deliberately

`hr(1.1)` means one hour and six minutes. `sec(0.1 + 0.2)` resolves to 300 milliseconds after the narrowly bounded
binary residue rule. `ns(0.5)` rejects because half a nanosecond cannot be retained by Temporal.

This differs from rounding an existing duration for display or billing. Construction does not silently choose a rounding
policy for meaningful sub-nanosecond input. Validate or quantize such measurements at the point where your application
chooses that policy.

Number conversion remains useful for ordinary reporting and timers. `elapsed({ microseconds: 500 })` returns `0.5`,
retaining a fractional millisecond. The host decides its timer resolution and maximum delay. Do not infer a
nanosecond-resolution timer from the precision of a time value.

## Round, balance, and format

A unit string selects nearest rounding with ties away from zero. An options object can choose a different mode,
increment, or largest unit.

```ts runnable
import { min, round, sec } from '@okikio/duration';

console.log(round(sec(1.6), 'seconds').toString());
console.log(
	round(min(6), {
		smallestUnit: 'minute',
		roundingIncrement: 5,
		roundingMode: 'ceil',
	}).toString(),
);
console.log(round(min(130), { largestUnit: 'hour' }).toString());
```

```text output
PT2S
PT10M
PT2H10M
```

`toString()` returns ISO duration text. Use standard `Intl.DurationFormat` when localized presentation is the job.
Calendar balancing still requires a reference when converting years, months, or weeks.

## Store an instant at millisecond precision

The `/instant` subpath reads explicit timestamps for configuration and stored records. Date-only text means UTC
midnight. Date-times must include seconds and a UTC offset; ambiguous local text rejects.

```ts runnable
import { formatInstant, parseInstant } from '@okikio/duration/instant';

console.log(formatInstant(parseInstant('2026-11-01')));
console.log(formatInstant(parseInstant('2026-11-01T01:30:00-04:00')));
```

```text output
2026-11-01T00:00:00.000Z
2026-11-01T05:30:00.000Z
```

These two helpers use epoch milliseconds and reduce sub-millisecond fractions to that precision. Use `temporal.Instant`
and bigint epoch nanoseconds for records that need finer precision.

## Compose with the other utilities

| Consumer                     | What Duration supplies                             | What the consumer owns                                                  |
| ---------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Context                      | `sec(2)` or `days(1)` and exact elapsed conversion | The clock, cancellation, deadline, wait, and cleanup.                   |
| Scheduler and Storage queues | Fixed lease, delay, and retry settings             | Positive limits, durable timestamps, lease extension, and recovery.     |
| Query cursor policy          | A fixed TTL such as `min(15)`                      | Cursor signing, verification, expiration checks, and provider behavior. |
| Workflow                     | Serializable ISO duration values and conversion    | Durable timers, replay, retries, and progress.                          |
| A browser timer              | Milliseconds from `elapsed(value)`                 | Timer resolution, maximum delay, page lifecycle, and cancellation.      |

## Runtime behavior and public source

Ordinary Duration imports select native Temporal when available and use the bundled local implementation otherwise. They
do not install globals. Import `@okikio/duration/polyfill` only when another consumer explicitly requires global
Temporal. The separate `/temporal` entry exports the selected `temporal` binding and the explicit local `Temporal`
implementation and type namespace.

The fallback is a real dependency cost. A focused unit import avoids unrelated utility code but still carries the time
implementation required on hosts without Temporal. The implementation does not use `instanceof` to distinguish native
and local Temporal values.

`units.ts` owns construction, `conversion.ts` owns calendar and fixed conversion, and `instant.ts` owns the millisecond
timestamp helpers. Public inference tests and runtime suites cover named units, exact bigint values, invalid input,
calendar transitions, rounding, and cross-implementation values. The declared subpaths are tested again in emitted
packages.
