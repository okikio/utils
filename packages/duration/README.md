# `@okikio/duration`

Write a retry as `sec(2.5)`, a reporting window as `days(7)`, or a precise offset as `ns(1n)`. Convert those settings to
the unit a timer, report, or deadline needs. Every constructor returns an ordinary `Temporal.Duration`.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

A **duration** answers “how long?” A timestamp answers “when?” For example, a two-second request budget is a duration;
its deadline is a particular timestamp. `Temporal.Duration` keeps named units instead of making every bare number mean
milliseconds. Calendar months still need a date and time zone when you ask how much elapsed time they contain.

## Start with a time setting

A service allows 2.5 seconds for a read. Keep that setting as a duration, then convert it to milliseconds for a timer consumer. `PT2.5S` is ISO duration text: a period of 2.5 seconds, not a timestamp.

From the experimental checkout, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps`. Save this as `duration-setting.ts` and run `mise exec -- deno run duration-setting.ts`. Ordinary Duration imports need no global installer.

```ts runnable=duration-setting.ts
import { elapsed, sec } from '@okikio/duration';
// Keep the authored unit until a timer or another consumer needs a numeric count.
const readBudget = sec(2.5);
console.log(readBudget.toString());
// elapsed() returns milliseconds by default; it does not start a timer.
console.log(elapsed(readBudget));
```

```text output
PT2.5S
2500
```

`elapsed()` defaults to milliseconds. It starts no timer and does not decide whether a negative value is appropriate. Pass the converted count to a host timer, or pass the duration directly to Context's `timeout` and `wait`. Context owns cancellation and waiting; Duration owns the representation and conversion.

## Construct, then convert

Unit names always construct a duration. Conversion has its own named operations, so `milliseconds(500)` and
`elapsed(sec(0.5))` have different, visible jobs.

| Constructor           | Short name               | Accepted count   |
| --------------------- | ------------------------ | ---------------- |
| `years(count)`        |                          | Whole number     |
| `months(count)`       |                          | Whole number     |
| `weeks(count)`        |                          | Whole number     |
| `days(count)`         |                          | Whole number     |
| `hours(count)`        | `hr(count)`              | Number or bigint |
| `minutes(count)`      | `min(count)`             | Number or bigint |
| `seconds(count)`      | `sec(count)`, `s(count)` | Number or bigint |
| `milliseconds(count)` | `ms(count)`              | Number or bigint |
| `microseconds(count)` | `us(count)`              | Number or bigint |
| `nanoseconds(count)`  | `ns(count)`              | Number or bigint |

Numbers may contain clock fractions that resolve to whole nanoseconds: `sec(2.5)`, `hr(1.1)`, and `ms(0.000001)` work.
Meaningful smaller fractions such as `ns(0.5)` reject. Signs and zero are supported. A constructor does not decide
whether a negative delay is appropriate for an application.

| Conversion                                  | Result              | Use                                                                            |
| ------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `from('PT2.5S')`, `from({ seconds: 2 })`    | `Temporal.Duration` | Read ISO text or a standard duration record.                                   |
| `from(2.5, 'seconds')`                      | `Temporal.Duration` | Use a unit selected in configuration. Singular and plural Temporal names work. |
| `total(value, 'seconds', options?)`         | `number`            | Read a duration in a chosen unit, with calendar context when needed.           |
| `convert(90, 'minutes', 'hours', options?)` | `number`            | Convert a count directly; this example returns `1.5`.                          |
| `elapsed(value, unit?)`                     | `number`            | Fixed weeks and days; defaults to milliseconds.                                |
| `elapsedNanoseconds(value)`                 | `bigint`            | Exact fixed offsets without a floating-point total.                            |
| `compare(left, right, options?)`            | `-1`, `0`, or `1`   | Compare lengths using a real calendar reference when needed.                   |
| `round(value, unitOrOptions)`               | `Temporal.Duration` | Balance fields or choose a rounding unit and increment.                        |

## A calendar day and a fixed day answer different questions

`days(1)` retains one day as a duration field. The consuming operation decides how to interpret it. A timer's fixed day
contains 24 hours. A local calendar day can contain 23 or 25 hours when clocks change.

Save this complete variation as `example-2.ts` and run `mise exec -- deno run example-2.ts` after the same checkout setup.

```ts runnable
import { days, elapsed, months, total } from '@okikio/duration';

console.log(elapsed(days(1), 'hours'));
console.log(total(days(1), 'hours', {
	relativeTo: '2026-03-08T00:00-05:00[America/New_York]',
}));
console.log(total(months(1), 'days', { relativeTo: '2026-02-01' }));
```

```text output
24
23
28
```

`total()`, `convert()`, `compare()`, and `round()` follow Temporal's reference rules. Calendar years, months, and weeks
need an explicit `relativeTo` when their length must be determined. An unanchored day is 24 hours. `elapsed()` and
`elapsedNanoseconds()` explicitly fix weeks to seven 24-hour days and reject months and years. No conversion silently
chooses a January 2000 reference.

## Import one capability or the complete package

| Import                        | Purpose                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@okikio/duration`            | Constructors, conversions, instant helpers, and shared types.                                                              |
| `@okikio/duration/units`      | All named constructors, aliases, and `from()`.                                                                             |
| `@okikio/duration/conversion` | `total`, `convert`, `elapsed`, `elapsedNanoseconds`, `round`, and `compare`.                                               |
| `@okikio/duration/instant`    | `parseInstant` and `formatInstant` for epoch-millisecond records.                                                          |
| `@okikio/duration/arithmetic` | Sum, subtract, compare and clamp under an explicit elapsed or calendar policy. |
| `@okikio/duration/format` | Format with an explicit locale and fallback policy. |
| `@okikio/duration/types`      | Input, unit, and conversion option types.                                                                                  |
| `@okikio/duration/temporal`   | `temporal`, the native-first implementation binding, and `Temporal`, the explicit local implementation and type namespace. |
| `@okikio/duration/polyfill`   | Explicitly install global Temporal if another consumer needs it.                                                           |

The regular APIs work without installing globals. They select native Temporal when available and use a local
implementation otherwise. This keeps one-call helpers usable across runtimes, at the cost of making the fallback
implementation reachable from duration bundles. Importing Duration starts no work, configures no environment, and
changes no global object.

`parseInstant()` deliberately accepts a smaller record format than Temporal's general ISO parser: a four-digit ISO date
at UTC midnight, or a date-time with seconds and `Z` or a `±HH:MM` offset. Numeric offsets use hours 00 through 23 and
minutes 00 through 59. Fractions have one through nine digits. Calendar dates are validated by Temporal; the lexical
guard excludes zone annotations and leap-second spellings. The result is epoch milliseconds, so use `temporal.Instant`
directly when the application needs nanosecond precision or a different input vocabulary.

## Precision and failures

Bigint clock counts preserve exact integers. Their converted magnitude must be strictly below `2^53` seconds, matching
Temporal's supported clock-duration range. Large counts may be stored as seconds plus nanoseconds rather than entirely
in one component. Use `elapsedNanoseconds()` to read the exact total.

Unsafe numeric integer counts reject because precision may already be lost before the function receives them. Number
totals can still lose integer precision at large magnitudes. A tiny floating-point residue, such as the one in
`0.1 + 0.2` seconds, is accepted only within two Number epsilons and below one thousandth of a nanosecond; a meaningful
sub-nanosecond setting rejects.

Invalid ISO text, non-finite counts, mixed-sign records, fractional calendar counts, missing calendar references, and
values outside Temporal's range throw. Structured records retain Temporal's integral-field rule, so use `sec(2.5)` or
`{ seconds: 2, milliseconds: 500 }` instead of `{ seconds: 2.5 }`.

Continue with the [Duration cookbook](../../docs/packages/05-duration.md) for exact deadlines, rounding, UTC records,
and composition with other utilities.
[Temporal's duration reference](https://tc39.es/proposal-temporal/docs/duration.html) specifies the underlying calendar
model.

## Choose elapsed time or a calendar window

A queue lease measures elapsed seconds. A billing month follows a calendar. The same duration value can require
different conversion rules in those two contexts.

Construct a value with named units, then choose elapsed conversion for timers or calendar conversion with a reference
date. Context and Scheduler own waiting and admission.

A precise duration does not imply a precise host timer. Months and years cannot become fixed elapsed milliseconds
without a calendar decision.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                        | Use it to                                                                | Exact contract              |
| ----------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `@okikio/duration/arithmetic` | Combine durations under an explicit elapsed or calendar policy. | [Contract](./arithmetic.ts) |
| `@okikio/duration/format` | Format with a locale and explicit fallback policy. | [Contract](./format.ts) |
| `@okikio/duration/units`      | Construct Temporal durations with named units, records, or ISO text.     | [Contract](./units.ts)      |
| `@okikio/duration/conversion` | Choose calendar-aware or fixed elapsed conversion and comparison.        | [Contract](./conversion.ts) |
| `@okikio/duration/instant`    | Parse and format explicit UTC timestamps at millisecond precision.       | [Contract](./instant.ts)    |
| `@okikio/duration`            | Use the package entry shown in the complete examples above.              | [Contract](./mod.ts)        |
| `@okikio/duration/types`      | Import public types for this capability; this entry does not start work. | [Contract](./types.ts)      |
| `@okikio/duration/temporal`   | Use the selected Temporal implementation through an explicit import.     | [Contract](./temporal.ts)   |
| `@okikio/duration/polyfill`   | Install missing global Temporal explicitly at an application entrypoint. | [Contract](./polyfill.ts)   |

## Choose elapsed or calendar arithmetic

`@okikio/duration/arithmetic` makes the reference policy explicit:

Save this complete variation as `example-3.ts` and run `mise exec -- deno run example-3.ts` after the same checkout setup.

```ts runnable
import { minimum, sum } from '@okikio/duration/arithmetic';
console.log(
	sum(['PT0.000000001S', 'PT0.000000002S'], {
		mode: 'elapsed',
		maximumItems: 2,
	}).toString(),
);
console.log(
	minimum('P1D', 'PT24H', {
		mode: 'calendar',
		relativeTo: '2026-03-08T00:00-05:00[America/New_York]',
	}).toString(),
);
```

```text output
PT0.000000003S
P1D
```

Elapsed sum/subtraction use exact bigint nanoseconds, with seven-day weeks and 24-hour days; months/years reject.
Calendar operations require `relativeTo`. Calendar sums move a cursor through each input in order, then take the
difference from the original reference using the largest authored unit. Month-end constraints make input order
meaningful. Calendar subtraction moves by the left duration, then backwards by the right duration; it is not subtraction
of flattened Number totals. Plain references retain wall-clock semantics; zoned references follow zone transitions.
`minimum`, `maximum` and `clamp` compare under the selected policy; reversed clamp bounds reject. `sum` requires
`maximumItems` and closes the input on failure. All outputs remain within Temporal's supported ranges.

## Format with an explicit locale

Formatting introduces two application choices that elapsed arithmetic does not need: the language shown to the
reader, and what to do on a runtime without localized duration formatting. Requiring `locale` avoids silently using
the machine's language. Requiring `fallback` avoids silently replacing a requested localized label with ISO text.
The `style` already defaults to `short`; you do not need to specify every formatting option.

`@okikio/duration/format` provides `create(options)` for a reusable formatter and `format(value, options)` for one call.
Supply `locale`, an optional `long`, `short`, `narrow` or `digital` style, and a required `fallback`: `iso` permits an
ISO string when Intl.DurationFormat is absent; `reject` throws DurationFormatUnsupportedError. The returned formatter's
`mode` makes that choice inspectable. No global polyfill is installed. Optional `rounding` uses Temporal's existing
explicit rounding rules, including any required calendar reference. Invalid locales reject even for ISO fallback. Locale
output follows the host's locale data and can differ across ICU versions; select ISO for a canonical wire format. See
the [arithmetic source](./arithmetic.ts), [format contract](./format.ts) and
[benchmark](./duration-arithmetic.bench.ts).

## Measure numeric and calendar conversion

The focused benchmarks measure fractional units and a 23-hour calendar day. The benchmark compares against direct
pre-balanced Temporal values. Pre-balanced inputs omit numeric convenience validation.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/duration test
deno task --cwd=packages/duration bench:check
deno task --cwd=packages/duration bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.
