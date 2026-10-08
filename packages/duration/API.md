# @okikio/duration contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                      | Source                         | Reference             |
| --------------------------- | ------------------------------ | --------------------- |
| `@okikio/duration`          | [./mod.ts](./mod.ts)           | [root](#root)         |
| `@okikio/duration/polyfill` | [./polyfill.ts](./polyfill.ts) | [polyfill](#polyfill) |
| `@okikio/duration/temporal` | [./temporal.ts](./temporal.ts) | [temporal](#temporal) |
| `@okikio/duration/types`    | [./types.ts](./types.ts)       | [types](#types)       |

## root

Import `@okikio/duration`. [Source](./mod.ts).

Convert human-readable Temporal durations to one deterministic numeric value. A month needs a calendar anchor; repeating
that decision across queues, retries and timeouts produces inconsistent answers.

Use milliseconds() for shared conversion and compare() for shared ordering. Calendar units use 2000-01-01, so this is
deterministic mechanics rather than a business calendar. A timer may still reject years and months; a lease may require
positive time. On hosts without Temporal, import the explicit polyfill first. Use the temporal ponyfill export when your
own application wants a local Temporal value without changing globals.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source |
| ---------------- | ------------------------ |
| `DurationInput`  | [Source](types.ts)       |

### root: compare

[Declaration source](mod.ts#L33)

```text
function compare(left: DurationInput, right: DurationInput): number
  Compare two Temporal duration inputs using the same deterministic calendar anchor.
```

### root: milliseconds

[Declaration source](mod.ts#L28)

```text
function milliseconds(value: DurationInput): number
  Convert one Temporal duration input to deterministic milliseconds.
```

### root: DurationInput

[Declaration source](types.ts#L1)

```text
type DurationInput = Temporal.Duration | Temporal.DurationLike | string
  Input accepted by Temporal duration conversion helpers.
```

## polyfill

Import `@okikio/duration/polyfill`. [Source](./polyfill.ts).

Install Temporal only when the host does not provide it.

Import this module first at an application entry point. It lets duration, context, queue, pool and workflow code run on
hosts without global Temporal. Libraries keep this choice with the application; ordinary utility imports do not install
globals. Each Worker or process has its own global and needs its own entry-point import. An existing native
implementation is preserved.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source |
| ---------------- | ------------------------ |
| `Temporal`       | [Source](temporal.ts)    |

## temporal

Import `@okikio/duration/temporal`. [Source](./temporal.ts).

Use Temporal in an application without installing a global.

This ponyfill exports the complete temporal-polyfill implementation. It works when the runtime has no Temporal and keeps
globalThis unchanged. Import the explicit polyfill subpath instead when other libraries use global Temporal.

### temporal: Temporal

External declaration: `temporal-spec/index.d.ts`, line 10.

```text
namespace Temporal

  type CalendarLike = PlainDate | PlainDateTime | PlainMonthDay | PlainYearMonth | ZonedDateTime | string
  type DurationLike = Duration | DurationLikeObject | string
  type InstantLike = Instant | ZonedDateTime | string
  type PlainDateLike = PlainDate | ZonedDateTime | PlainDateTime | DateLikeObject | string
  type PlainDateTimeLike = PlainDateTime | ZonedDateTime | PlainDate | DateTimeLikeObject | string
  type PlainMonthDayLike = PlainMonthDay | DateLikeObject | string
  type PlainTimeLike = PlainTime | PlainDateTime | ZonedDateTime | TimeLikeObject | string
  type PlainYearMonthLike = PlainYearMonth | YearMonthLikeObject | string
  type TimeZoneLike = ZonedDateTime | string
  type ZonedDateTimeLike = ZonedDateTime | ZonedDateTimeLikeObject | string
  type PartialTemporalLike<T extends object> = [P in Exclude<keyof T, "calendar" | "timeZone">]?: T[P] | undefined
  interface DateLikeObject
  interface DateTimeLikeObject extends DateLikeObject, TimeLikeObject
  interface DurationLikeObject
  interface TimeLikeObject
  interface YearMonthLikeObject extends Omit<DateLikeObject, "day">
  interface ZonedDateTimeLikeObject extends DateTimeLikeObject
  type DateUnit = "year" | "month" | "week" | "day"
  type TimeUnit = "hour" | "minute" | "second" | "millisecond" | "microsecond" | "nanosecond"
  type PluralizeUnit<T extends DateUnit | TimeUnit> = T | { year: "years"; month: "months"; week: "weeks"; day: "days"; hour: "hours"; minute: "minutes"; second: "seconds"; millisecond: "milliseconds"; microsecond: "microseconds"; nanosecond: "nanoseconds"; }[T]
  interface DisambiguationOptions
  interface OverflowOptions
  interface TransitionOptions
  interface RoundingOptions<Units extends DateUnit | TimeUnit>
  interface RoundingOptionsWithLargestUnit<Units extends DateUnit | TimeUnit> extends RoundingOptions<Units>
  interface ToStringRoundingOptions<Units extends DateUnit | TimeUnit> extends Pick<RoundingOptions<Units>, "smallestUnit" | "roundingMode">
  interface ToStringRoundingOptionsWithFractionalSeconds<Units extends DateUnit | TimeUnit> extends ToStringRoundingOptions<Units>
  namespace Now
  interface PlainDateToStringOptions
  interface PlainDateToZonedDateTimeOptions
  interface PlainDate
  var PlainDate: PlainDateConstructor
  interface PlainDateConstructor
  interface PlainTimeToStringOptions extends ToStringRoundingOptionsWithFractionalSeconds<Exclude<TimeUnit, "hour">>
  interface PlainTime
  var PlainTime: PlainTimeConstructor
  interface PlainTimeConstructor
  interface PlainDateTimeToStringOptions extends PlainDateToStringOptions, PlainTimeToStringOptions
  interface PlainDateTime
  var PlainDateTime: PlainDateTimeConstructor
  interface PlainDateTimeConstructor
  interface ZonedDateTimeToStringOptions extends PlainDateTimeToStringOptions
  interface ZonedDateTimeFromOptions extends OverflowOptions, DisambiguationOptions
  interface ZonedDateTime
  var ZonedDateTime: ZonedDateTimeConstructor
  interface ZonedDateTimeConstructor
  interface DurationRelativeToOptions
  interface DurationRoundingOptions extends DurationRelativeToOptions, RoundingOptionsWithLargestUnit<DateUnit | TimeUnit>
  interface DurationToStringOptions extends ToStringRoundingOptionsWithFractionalSeconds<Exclude<TimeUnit, "hour" | "minute">>
  interface DurationTotalOptions extends DurationRelativeToOptions
  type DurationFormatOptions = typeof Intl extends { DurationFormat: { }; } ? NonNullable<Options> : unknown
  interface Duration
  var Duration: DurationConstructor
  interface DurationConstructor
  interface InstantToStringOptions extends PlainTimeToStringOptions
  interface Instant
  var Instant: InstantConstructor
  interface InstantConstructor
  interface PlainYearMonthToPlainDateOptions
  interface PlainYearMonth
  var PlainYearMonth: PlainYearMonthConstructor
  interface PlainYearMonthConstructor
  interface PlainMonthDayToPlainDateOptions
  interface PlainMonthDay
  var PlainMonthDay: PlainMonthDayConstructor
  interface PlainMonthDayConstructor
```

## types

Import `@okikio/duration/types`. [Source](./types.ts).

### types: DurationInput

[Declaration source](types.ts#L1)

```text
type DurationInput = Temporal.Duration | Temporal.DurationLike | string
  Input accepted by Temporal duration conversion helpers.
```
