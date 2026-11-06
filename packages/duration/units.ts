/**
 * Construct ordinary Temporal durations from named units, ISO text, or records.
 *
 * Use a long unit name for discoverability or a short name in a time setting.
 * Clock units accept numbers and exact bigint counts. Calendar units require
 * whole numbers; the consuming operation chooses calendar or elapsed meaning.
 * Native Temporal is preferred; a local implementation supplies it otherwise.
 * This module never installs globals.
 *
 * @example Author time settings without converting to milliseconds
 * ```ts
 * import { days, hr, min, ms, ns, sec } from '@okikio/duration/units';
 * console.log(sec(2.5).toString(), min(90).toString()); // PT2.5S PT90M
 * console.log(days(7).toString(), hr(1.5).toString()); // P7D PT1H30M
 * console.log(ms(0.5).toString(), ns(1n).toString()); // PT0.0005S PT0.000000001S
 * ```
 *
 * @module
 */
import type { ClockUnit, DurationInput, Unit } from './types.ts';
import { temporal } from './temporal.ts';

/** Singular and plural names share Temporal's record field vocabulary. */
const UNIT_FIELDS = {
	year: 'years',
	years: 'years',
	month: 'months',
	months: 'months',
	week: 'weeks',
	weeks: 'weeks',
	day: 'days',
	days: 'days',
	hour: 'hours',
	hours: 'hours',
	minute: 'minutes',
	minutes: 'minutes',
	second: 'seconds',
	seconds: 'seconds',
	millisecond: 'milliseconds',
	milliseconds: 'milliseconds',
	microsecond: 'microseconds',
	microseconds: 'microseconds',
	nanosecond: 'nanoseconds',
	nanoseconds: 'nanoseconds',
} as const satisfies Record<Unit, keyof Temporal.DurationLikeObject>;

/** Integer scales let bigint construction avoid a floating-point round trip. */
const CLOCK_SCALES = {
	hours: 3_600_000_000_000n,
	minutes: 60_000_000_000n,
	seconds: 1_000_000_000n,
	milliseconds: 1_000_000n,
	microseconds: 1_000n,
	nanoseconds: 1n,
} as const;

/** Larger authored integer counts need the bigint overload. */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Temporal's clock-duration magnitude is strictly below 2^53 seconds. */
const MAX_CLOCK = (1n << 53n) * CLOCK_SCALES.seconds - 1n;

/**
 * Parse ISO text, a duration record, or another Temporal duration.
 * Structured fields retain Temporal's integral, same-sign rules. Numeric
 * settings use the explicit-unit overload or a named unit constructor.
 *
 * @example Preserve calendar meaning
 * ```ts
 * console.log(from({ months: 1, days: 2 }).toString()); // P1M2D
 * ```
 */
export function from(value: DurationInput): Temporal.Duration;
/**
 * Construct a numeric count in a singular or plural Temporal unit.
 * Calendar counts must be whole safe numbers. Clock fractions must resolve to
 * nanoseconds; meaningful sub-nanosecond input rejects rather than being rounded.
 * Binary floating-point residue below one thousandth of a nanosecond is
 * accepted only within two representational epsilons of the supplied Number.
 *
 * @example Accept a fractional setting
 * ```ts
 * console.log(from(1.5, 'hours').toString()); // PT1H30M
 * ```
 */
export function from(value: number, unit: Unit): Temporal.Duration;
/**
 * Construct an exact whole clock count without converting it through Number.
 * The absolute value after conversion must be below 2^53 seconds. Large counts
 * are split into seconds and nanoseconds, so an authored nanosecond count need
 * not fit in the returned duration's individual nanoseconds field.
 *
 * @example Preserve an integer above Number's exact range
 * ```ts
 * console.log(from(9_007_199_254_740_993n, 'nanoseconds').toString()); // PT9007199.254740993S
 * ```
 */
export function from(value: bigint, unit: ClockUnit): Temporal.Duration;
export function from(value: DurationInput | number | bigint, unit?: Unit): Temporal.Duration {
	if (typeof value !== 'number' && typeof value !== 'bigint') {
		if (unit !== undefined) throw new TypeError('A duration count must be a number or bigint.');
		return temporal.Duration.from(value);
	}
	if (unit === undefined) throw new TypeError('A numeric duration requires an explicit unit.');
	if (!Object.hasOwn(UNIT_FIELDS, unit)) throw new RangeError('Unknown Temporal duration unit.');
	const field = UNIT_FIELDS[unit];
	if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(Math.trunc(value)))) {
		throw new RangeError(
			'A duration count must be finite and its whole part must be a safe integer; use bigint for larger clock counts.',
		);
	}
	if (!(field in CLOCK_SCALES)) {
		if (typeof value === 'bigint') {
			throw new TypeError('Bigint counts require a clock unit, from hours through nanoseconds.');
		}
		if (!Number.isInteger(value)) throw new RangeError('Calendar duration counts must be whole numbers.');
		return temporal.Duration.from({ [field]: value });
	}
	const clockField = field as keyof typeof CLOCK_SCALES;
	const scale = CLOCK_SCALES[clockField];
	const exact = typeof value === 'bigint' ? value * scale : numericNanoseconds(value, scale);
	if (exact > MAX_CLOCK || exact < -MAX_CLOCK) {
		throw new RangeError('A clock duration must be shorter than 2^53 seconds.');
	}
	// Preserve the requested unit when its count fits in Number. Otherwise split
	// into seconds and nanoseconds, whose fields can still represent this exact total.
	const whole = exact / scale;
	const remainder = exact % scale;
	if (whole <= MAX_SAFE && whole >= -MAX_SAFE) {
		if (remainder === 0n) return temporal.Duration.from({ [clockField]: Number(whole) });
		return temporal.Duration.from({ [clockField]: Number(whole), nanoseconds: Number(remainder) })
			.round({ largestUnit: clockField });
	}
	return temporal.Duration.from({
		seconds: Number(exact / CLOCK_SCALES.seconds),
		nanoseconds: Number(exact % CLOCK_SCALES.seconds),
	});
}

/**
 * Read the Number's shortest decimal representation with integer arithmetic.
 * Multiplying a large count directly by a unit scale loses low nanoseconds.
 * Decimal decomposition preserves ordinary settings such as 1.1 hours while
 * rejecting meaningful sub-nanosecond fractions. The bounded residue allowance
 * also accepts arithmetic such as 0.1 + 0.2 seconds.
 */
function numericNanoseconds(value: number, scale: bigint): bigint {
	const negative = value < 0;
	const [mantissa, exponentText] = Math.abs(value).toString().split('e');
	const [whole, fraction = ''] = mantissa!.split('.');
	const exponent = Number(exponentText ?? 0) - fraction.length;
	// Remove the decimal point, then use the exponent to restore its scale with integer arithmetic.
	let numerator = BigInt(`${whole}${fraction}`) * scale;
	let denominator = 1n;
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
	else denominator = 10n ** BigInt(-exponent);
	let integral = numerator / denominator;
	const remainder = numerator % denominator;
	if (remainder !== 0n) {
		const increment = remainder * 2n >= denominator;
		const divisor = Number(denominator);
		const distance = Number.isFinite(divisor)
			? Number(increment ? denominator - remainder : remainder) / divisor
			: Infinity;
		// Accept tiny floating-point residue without silently rounding a meaningful
		// fraction of a nanosecond. The absolute cap prevents large inputs widening it.
		const tolerance = Math.min(0.001, Math.abs(value) * Number.EPSILON * Number(scale) * 2);
		if (!(distance <= tolerance)) throw new RangeError('A clock duration must be representable as whole nanoseconds.');
		if (increment) integral++;
	}
	return negative ? -integral : integral;
}

/** Construct whole calendar years. Conversion to elapsed time needs a real reference date. */
export function years(value: number): Temporal.Duration {
	return from(value, 'years');
}
/** Construct whole calendar months. Conversion to elapsed time needs a real reference date. */
export function months(value: number): Temporal.Duration {
	return from(value, 'months');
}
/** Construct whole weeks. elapsed() interprets each week as seven 24-hour days. */
export function weeks(value: number): Temporal.Duration {
	return from(value, 'weeks');
}
/** Construct whole days. elapsed() fixes each day at 24 hours; total() honors an explicit zoned reference. */
export function days(value: number): Temporal.Duration {
	return from(value, 'days');
}
/** Construct hours, including fractional numbers or exact bigint counts. See from() for precision and range. */
export function hours(value: number | bigint): Temporal.Duration {
	return clock(value, 'hours');
}
/** Construct minutes, including fractional numbers or exact bigint counts. See from() for precision and range. */
export function minutes(value: number | bigint): Temporal.Duration {
	return clock(value, 'minutes');
}
/** Construct seconds, including fractional numbers or exact bigint counts. See from() for precision and range. */
export function seconds(value: number | bigint): Temporal.Duration {
	return clock(value, 'seconds');
}
/** Construct milliseconds. Use elapsed(value) or total(value, 'milliseconds') to convert an existing duration. */
export function milliseconds(value: number | bigint): Temporal.Duration {
	return clock(value, 'milliseconds');
}
/** Construct microseconds, including fractional numbers or exact bigint counts. See from() for precision and range. */
export function microseconds(value: number | bigint): Temporal.Duration {
	return clock(value, 'microseconds');
}
/** Construct nanoseconds. Fractions below nanosecond precision reject; bigint preserves large integer counts. */
export function nanoseconds(value: number | bigint): Temporal.Duration {
	return clock(value, 'nanoseconds');
}

/** Dispatch a clock count without widening the calendar overload to bigint. */
function clock(value: number | bigint, unit: ClockUnit): Temporal.Duration {
	return typeof value === 'bigint' ? from(value, unit) : from(value, unit);
}

export {
	hours as hr,
	microseconds as us,
	milliseconds as ms,
	minutes as min,
	nanoseconds as ns,
	seconds as s,
	seconds as sec,
};
