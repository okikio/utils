/** Arithmetic with an explicit fixed-elapsed or calendar reference policy. @module */
import { elapsedNanoseconds } from './conversion.ts';
import { from } from './units.ts';
import { temporal } from './temporal.ts';
import type { ConversionOptions, DurationInput } from './types.ts';

/** Calendar operations always require an authored reference; elapsed days are exactly 24 hours. */
export type ArithmeticOptionsType =
	| Readonly<{ readonly mode: 'elapsed' }>
	| Readonly<{
		readonly mode: 'calendar';
		/** Zoned references account for daylight-saving transitions. */
		readonly relativeTo: NonNullable<ConversionOptions['relativeTo']>;
	}>;

/**
 * Sum a bounded iterable. Elapsed arithmetic adds exact bigint nanoseconds and
 * rejects months and years. Calendar arithmetic moves a cursor from the explicit
 * reference for each input. It returns the difference from the starting point,
 * retaining the largest unit found in the inputs. Input order can matter when
 * calendar additions cross month ends or clock changes.
 *
 * No arbitrary reference date, rounding, or Number total is introduced. Exceeding
 * maximumItems or encountering invalid input throws and closes the source
 * iterator. An empty sum is PT0S.
 */
export function sum(
	values: Iterable<DurationInput>,
	options: ArithmeticOptionsType & Readonly<{ readonly maximumItems: number }>,
): Temporal.Duration {
	policy(options);
	if (!Number.isSafeInteger(options.maximumItems) || options.maximumItems < 0) {
		throw new RangeError('Duration sum maximumItems must be a non-negative safe integer.');
	}
	let count = 0;
	let exact = 0n;
	const start = options.mode === 'calendar' ? anchor(options.relativeTo) : undefined;
	let cursor = start;
	let largest: ArithmeticUnit = 'nanosecond';
	for (const next of values) {
		if (count++ >= options.maximumItems) throw new RangeError('Duration sum exceeds maximumItems.');
		if (options.mode === 'elapsed') exact += elapsedNanoseconds(next);
		else {
			const value = from(next);
			largest = larger(largest, largestUnit(value));
			cursor = cursor!.add(value);
		}
	}
	return options.mode === 'elapsed' ? from(exact, 'nanoseconds') : difference(start!, cursor!, largest);
}

/** Subtract with exact elapsed precision or Temporal calendar arithmetic under the supplied reference. */
export function subtract(left: DurationInput, right: DurationInput, options: ArithmeticOptionsType): Temporal.Duration {
	policy(options);
	if (options.mode === 'elapsed') return from(elapsedNanoseconds(left) - elapsedNanoseconds(right), 'nanoseconds');
	const start = anchor(options.relativeTo);
	const a = from(left);
	const b = from(right);
	return difference(start, start.add(a).subtract(b), larger(largestUnit(a), largestUnit(b)));
}

/** Select the smaller normalized duration; ties select the left value. */
export function minimum(left: DurationInput, right: DurationInput, options: ArithmeticOptionsType): Temporal.Duration {
	return order(left, right, options) <= 0 ? from(left) : from(right);
}

/** Select the larger normalized duration; ties select the left value. */
export function maximum(left: DurationInput, right: DurationInput, options: ArithmeticOptionsType): Temporal.Duration {
	return order(left, right, options) >= 0 ? from(left) : from(right);
}

/** Clamp inclusively, rejecting reversed bounds under the same reference and comparison policy. */
export function clamp(
	value: DurationInput,
	lower: DurationInput,
	upper: DurationInput,
	options: ArithmeticOptionsType,
): Temporal.Duration {
	if (order(lower, upper, options) > 0) throw new RangeError('Duration clamp lower bound exceeds upper bound.');
	return minimum(maximum(value, lower, options), upper, options);
}

/** Compare exact totals instead of subtracting potentially unsafe Number totals. */
function order(left: DurationInput, right: DurationInput, options: ArithmeticOptionsType): number {
	policy(options);
	if (options.mode === 'calendar') {
		return temporal.Duration.compare(from(left), from(right), { relativeTo: options.relativeTo });
	}
	const a = elapsedNanoseconds(left);
	const b = elapsedNanoseconds(right);
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Fail before source iteration when a JavaScript caller omits the reference or mode. */
function policy(options: ArithmeticOptionsType): void {
	if (options.mode === 'elapsed') return;
	if (options.mode !== 'calendar' || options.relativeTo === undefined || options.relativeTo === null) {
		throw new TypeError('Duration arithmetic requires elapsed mode or calendar mode with relativeTo.');
	}
}

/** Calendar cursors retain a zone when supplied; plain references retain wall-clock date/time semantics. */
function anchor(
	reference: NonNullable<ConversionOptions['relativeTo']>,
): Temporal.ZonedDateTime | Temporal.PlainDateTime {
	const zoned = typeof reference === 'string'
		? /\[(?!!?u-ca=)/u.test(reference)
		: ('timeZone' in reference || 'timeZoneId' in reference);
	if (zoned) return temporal.ZonedDateTime.from(reference as Parameters<typeof temporal.ZonedDateTime.from>[0]);
	if (typeof reference === 'string' && !/[Tt ]\d{2}:/u.test(reference)) {
		return temporal.PlainDate.from(reference).toPlainDateTime();
	}
	if (typeof reference !== 'string' && !('hour' in reference)) {
		return temporal.PlainDate.from(reference).toPlainDateTime();
	}
	return temporal.PlainDateTime.from(reference as Parameters<typeof temporal.PlainDateTime.from>[0]);
}

/** Ordered units select a stable representation for an anchored difference, without flattening months to days. */
const UNITS = [
	'year',
	'month',
	'week',
	'day',
	'hour',
	'minute',
	'second',
	'millisecond',
	'microsecond',
	'nanosecond',
] as const;

/** Unit names derived from the authored ordering table, not a parallel enum. */
type ArithmeticUnit = typeof UNITS[number];

/** First nonzero authored field determines the largest retained unit. */
function largestUnit(value: Temporal.Duration): ArithmeticUnit {
	for (const unit of UNITS) if (value[`${unit}s`] !== 0) return unit;
	return 'nanosecond';
}

/** Choose the larger unit rather than relying on lexical order. */
function larger(left: ArithmeticUnit, right: ArithmeticUnit): ArithmeticUnit {
	return UNITS.indexOf(left) < UNITS.indexOf(right) ? left : right;
}

/** Keep native Temporal brand checks on both operands instead of coercing a zoned cursor to plain time. */
function difference(
	start: Temporal.ZonedDateTime | Temporal.PlainDateTime,
	end: Temporal.ZonedDateTime | Temporal.PlainDateTime,
	largestUnit: ArithmeticUnit,
): Temporal.Duration {
	if ('timeZoneId' in start) return start.until(end as Temporal.ZonedDateTime, { largestUnit });
	return start.until(end as Temporal.PlainDateTime, { largestUnit });
}
