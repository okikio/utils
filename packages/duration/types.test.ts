import type { ConversionOptions, ElapsedUnit, RoundOptions, Unit } from './types.ts';
import * as duration from './mod.ts';

/** Compile ordinary consumer calls and reject ambiguous units before runtime. */
function durationTypes(): void {
	const count: Temporal.Duration = duration.from(2.5, 'seconds');
	const settings: Temporal.Duration = duration.from({ seconds: 2, milliseconds: 500 });
	const converted: number = duration.convert(2500, 'milliseconds', 'seconds');
	const unit: Unit = 'nanosecond';
	const elapsedUnit: ElapsedUnit = 'weeks';
	const options: ConversionOptions = { relativeTo: { year: 2026, month: 2, day: 1 } };
	const rounding: RoundOptions = { smallestUnit: 'minute', roundingIncrement: 5, roundingMode: 'ceil' };
	const rounded: Temporal.Duration = duration.round(count, rounding);
	const total: number = duration.total(settings, unit, options);
	const elapsed: number = duration.elapsed(count, elapsedUnit);
	const exact: bigint = duration.elapsedNanoseconds(duration.ns(9_007_199_254_740_993n));
	const named: Temporal.Duration = duration.days(1).add(duration.hr(12));
	const short: Temporal.Duration = duration.s(2.5).add(duration.ms(500));
	void [converted, rounded, total, elapsed, exact, named, short];

	// @ts-expect-error A numeric count without a unit is ambiguous.
	duration.from(1000);
	// @ts-expect-error Unit-bearing input must be a number, not a duration record.
	duration.from({ seconds: 1 }, 'seconds');
	// @ts-expect-error Units use Temporal names, not an unrelated abbreviation system.
	duration.from(1, 'ms');
	// @ts-expect-error Calendar months do not have a fixed elapsed size.
	duration.elapsed({ days: 30 }, 'months');
	// @ts-expect-error Output unit must exist in Temporal's unit family.
	duration.total('PT1S', 'fortnights');
	// @ts-expect-error Rounding modes follow Temporal's standard vocabulary.
	duration.round('PT1S', { roundingMode: 'nearest' });
	// @ts-expect-error Calendar counts use numbers and require integral calendar meaning.
	duration.from(1n, 'months');
	// @ts-expect-error Named milliseconds construct a count; conversion is elapsed/total.
	duration.milliseconds({ seconds: 1 });
}

void durationTypes;
