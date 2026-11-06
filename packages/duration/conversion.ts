/**
 * Convert and compare durations with an explicit calendar or fixed-time choice.
 *
 * total() and compare() follow Temporal's calendar reference rules. elapsed()
 * and elapsedNanoseconds() use seven-day weeks and 24-hour days and reject months
 * and years. No operation chooses an arbitrary reference date.
 *
 * @example Keep a fixed interval separate from a calendar day
 * ```ts
 * import { days, ns } from '@okikio/duration/units';
 * import { elapsed, elapsedNanoseconds, total } from '@okikio/duration/conversion';
 * console.log(elapsed(days(1), 'hours')); // 24
 * console.log(total(days(1), 'hours', { relativeTo: '2026-03-08T00:00-05:00[America/New_York]' })); // 23
 * console.log(elapsedNanoseconds(ns(9_007_199_254_740_993n))); // 9007199254740993n
 * ```
 *
 * @module
 */
import { from } from './units.ts';
import { temporal } from './temporal.ts';
import type { ClockUnit, ConversionOptions, DurationInput, ElapsedUnit, RoundOptions, Unit } from './types.ts';

/**
 * Return a duration's count in a singular or plural Temporal unit.
 * Years, months, and weeks require relativeTo when present in the duration or
 * requested as the output unit. An unanchored day is 24 hours; a zoned reference
 * accounts for clock changes. Number totals can lose integer precision at large
 * magnitudes; elapsedNanoseconds() is the exact fixed-time alternative.
 *
 * @example Convert a mixed setting
 * ```ts
 * console.log(total({ minutes: 1, milliseconds: 500 }, 'seconds')); // 60.5
 * ```
 */
export function total(value: DurationInput, unit: Unit, options: ConversionOptions = {}): number {
	return from(value).total({ unit, relativeTo: options.relativeTo });
}

/** Convert a numeric count between units using from() precision and total() calendar rules. */
export function convert(value: number, source: Unit, target: Unit, options?: ConversionOptions): number;
/** Convert an exact bigint clock count to a Number total; use elapsedNanoseconds() for an exact bigint result. */
export function convert(value: bigint, source: ClockUnit, target: Unit, options?: ConversionOptions): number;
export function convert(value: number | bigint, source: Unit, target: Unit, options: ConversionOptions = {}): number {
	return total(typeof value === 'bigint' ? from(value, source as ClockUnit) : from(value, source), target, options);
}

/**
 * Round or balance with Temporal's unit, increment, and rounding modes.
 * A unit string chooses the smallest unit and nearest rounding with ties away
 * from zero. Calendar balancing requires relativeTo when Temporal needs one.
 *
 * @example Bill a duration in five-minute increments
 * ```ts
 * console.log(round('PT6M', { smallestUnit: 'minute', roundingIncrement: 5, roundingMode: 'ceil' }).toString()); // PT10M
 * ```
 */
export function round(value: DurationInput, options: Unit | RoundOptions): Temporal.Duration {
	return from(value).round(typeof options === 'string' ? { smallestUnit: options } : options);
}

/**
 * Compare durations, returning -1, 0, or 1. Calendar years, months, and weeks
 * need an explicit reference; zoned references also determine the length of days.
 * Signed offsets compare as numbers, so a negative duration precedes zero.
 */
export function compare(left: DurationInput, right: DurationInput, options: ConversionOptions = {}): number {
	return temporal.Duration.compare(from(left), from(right), options);
}

/**
 * Return a fixed elapsed count, defaulting to milliseconds for ordinary timers.
 * Weeks contain seven 24-hour days. Years and months reject. Fractional outputs
 * are preserved, but Number precision still limits very large totals. This
 * conversion does not enforce a host timer's range or a positive-only policy.
 *
 * @example Use a fixed reporting window
 * ```ts
 * console.log(elapsed({ weeks: 1 }, 'hours')); // 168
 * console.log(elapsed({ microseconds: 500 })); // 0.5
 * ```
 */
export function elapsed(value: DurationInput, unit: ElapsedUnit = 'milliseconds'): number {
	if (
		unit === ('year' as Unit) || unit === ('years' as Unit) || unit === ('month' as Unit) || unit === ('months' as Unit)
	) {
		throw new RangeError('Elapsed output cannot use years or months.');
	}
	const parsed = fixed(value);
	return unit === 'week' || unit === 'weeks' ? parsed.total('days') / 7 : parsed.total(unit);
}

/**
 * Return the exact fixed elapsed duration as bigint nanoseconds.
 * Each week is seven 24-hour days; months and years reject. Integer components
 * are added as bigint without an intermediate Number total. Inputs retain
 * Temporal's supported duration range. Precision already lost in an authored
 * Number cannot be recovered; use bigint unit constructors for large counts.
 *
 * @example Move an instant without reducing precision to milliseconds
 * ```ts
 * const next = Temporal.Instant.fromEpochNanoseconds(
 *   Temporal.Instant.from('2026-01-01T00:00:00Z').epochNanoseconds + elapsedNanoseconds({ days: 1, nanoseconds: 1 }),
 * );
 * console.log(next.toString()); // 2026-01-02T00:00:00.000000001Z
 * ```
 */
export function elapsedNanoseconds(value: DurationInput): bigint {
	const parsed = from(value);
	if (parsed.years !== 0 || parsed.months !== 0) {
		throw new RangeError('Elapsed durations cannot contain years or months.');
	}
	return ((BigInt(parsed.weeks) * 7n + BigInt(parsed.days)) * 24n + BigInt(parsed.hours)) * 3_600_000_000_000n +
		BigInt(parsed.minutes) * 60_000_000_000n + BigInt(parsed.seconds) * 1_000_000_000n +
		BigInt(parsed.milliseconds) * 1_000_000n + BigInt(parsed.microseconds) * 1_000n + BigInt(parsed.nanoseconds);
}

/** Fold weeks into days without a date anchor that could overflow Temporal's smaller instant range. */
function fixed(value: DurationInput): Temporal.Duration {
	const parsed = from(value);
	if (parsed.years !== 0 || parsed.months !== 0) {
		throw new RangeError('Elapsed durations cannot contain years or months.');
	}
	return parsed.weeks === 0 ? parsed : parsed.with({ weeks: 0, days: parsed.days + parsed.weeks * 7 });
}
