/** Native UTC timestamp conversion with an explicit application-to-wire direction. @module */
import { Temporal, temporal } from '@okikio/duration/temporal';
import { elapsedNanoseconds } from '@okikio/duration/conversion';
import { from } from '@okikio/duration/units';
import * as schema from './mod.ts';
import * as codec from './codec/mod.ts';

/**
 * Keep the codec's four-digit UTC wire spelling narrower than Temporal's ISO parser.
 *
 * Temporal also accepts offsets, annotations and leap-second spellings. This
 * codec promises uppercase T/Z and ordinary seconds, so only that lexical policy
 * lives here. Temporal owns month lengths, leap years and clock validity.
 */
const utcPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d)(?:\.(\d+))?Z$/u;

/**
 * Parse through the shared Temporal implementation and create the promised Date.
 *
 * The wire contract has always accepted arbitrarily long fractional seconds and
 * retained their first three digits. Reduce that precision before Temporal's
 * nanosecond parser so neither a new precision limit nor rounding changes an
 * existing timestamp, including timestamps before the Unix epoch.
 */
function instant(value: string): Date {
	const match = utcPattern.exec(value);
	if (match === null) schema.reject('Expected an ISO UTC timestamp ending in Z.');
	const source = match[2] === undefined ? value : `${match[1]}.${match[2].slice(0, 3)}Z`;
	try {
		return new Date(temporal.Instant.from(source).epochMilliseconds);
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		schema.reject('Timestamp contains an invalid calendar date or time.');
	}
}

/** Format a validated Date without broadening the codec to signed expanded years. */
function timestamp(value: Date): string {
	const instant = temporal.Instant.fromEpochMilliseconds(value.getTime());
	const year = instant.toZonedDateTimeISO('UTC').year;
	if (year < 0 || year > 9999) schema.reject('UTC timestamp years must be between 0000 and 9999.');
	return instant.toString({ fractionalSecondDigits: 3 });
}

/**
 * Decode an ISO UTC timestamp to a Date and encode with millisecond precision.
 *
 * The shared Temporal implementation validates and formats the instant. Date is
 * the explicit application compatibility value, and each decode creates a fresh
 * instance. Offsets and local times reject. Fractional precision beyond
 * milliseconds is truncated, and encoding always emits three fractional digits.
 * Invalid Dates and years outside 0000 through 9999 reject in both directions.
 *
 * @example Keep an existing Date-based application contract
 * ```ts
 * import * as codec from '@okikio/schema/codec';
 * import { DateSchema } from '@okikio/schema/time';
 * const value = await codec.read(DateSchema, '2024-02-29T12:00:00.123456Z');
 * console.log(await codec.write(DateSchema, value)); // 2024-02-29T12:00:00.123Z
 * ```
 */
export const DateSchema: codec.Codec<string, Date, Date, string> = codec.define({
	decode: schema.transform(schema.string(), instant),
	encode: schema.transform(schema.date(), timestamp),
});

/** Application timestamp produced by DateSchema. */
export type DateType = codec.Decoded<typeof DateSchema>;

/** UTC instant syntax accepts at most nanosecond precision and ordinary seconds; DateSchema stays unchanged. */
const exactUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?Z$/u;

/** Reject calendar-invalid input as data while retaining unexpected runtime defects. */
function exactInstant(value: string): Temporal.Instant {
	if (!exactUtcPattern.test(value)) {
		schema.reject('Expected a four-digit UTC timestamp with at most nine fractional digits.');
	}
	try {
		return temporal.Instant.from(value);
	} catch (error) {
		if (error instanceof RangeError) schema.reject('Invalid UTC instant.');
		throw error;
	}
}

/** Canonical wire spelling is UTC with exactly nine fractional digits; expanded years remain outside this profile. */
function exactTimestamp(value: Temporal.Instant): string {
	const text = value.toString({ fractionalSecondDigits: 9 });
	if (!exactUtcPattern.test(text)) schema.reject('Instant year is outside the four-digit UTC profile.');
	return text;
}

/**
 * Decode four-digit UTC text to Temporal.Instant and encode exactly nine fractional
 * digits. Offsets, annotations, leap-second spelling and excess precision reject.
 * Values from the selected native or explicit local Temporal implementation are
 * accepted on encode. This profile never truncates to Date milliseconds.
 */
export const InstantSchema: codec.Codec<string, Temporal.Instant, Temporal.Instant, string> = codec.define({
	decode: schema.transform(schema.string({ maxLength: 30, pattern: exactUtcPattern }), exactInstant),
	encode: schema.transform(
		schema.guard(
			(value): value is Temporal.Instant => value instanceof temporal.Instant || value instanceof Temporal.Instant,
			'Expected a Temporal.Instant.',
		),
		exactTimestamp,
	),
});

/** Exact application timestamp produced by InstantSchema. */
export type InstantType = codec.Decoded<typeof InstantSchema>;

/** ISO duration syntax is bounded before Temporal performs semantic validation. */
const durationPattern = /^-?P(?=\d|T\d)[0-9YMWDTHS.,]+$/u;

/** Native Temporal owns ISO unit ordering, sign consistency, precision and supported range. */
function isoDuration(value: string): Temporal.Duration {
	try {
		return temporal.Duration.from(value);
	} catch (error) {
		if (error instanceof RangeError) schema.reject('Invalid ISO duration.');
		throw error;
	}
}

/** The identity guard accepts native and explicit ponyfill values without guessing from object fields. */
const DurationValueSchema: schema.JsonReader<Temporal.Duration, Temporal.Duration> = schema.guard(
	(value): value is Temporal.Duration => value instanceof temporal.Duration || value instanceof Temporal.Duration,
	'Expected a Temporal.Duration.',
);

/**
 * ISO duration codec retaining calendar units; it does not imply an elapsed length.
 * Calendar conversion requires the caller's reference. Encoding canonicalizes
 * Temporal's spelling and bounds the wire to 128 code units in either direction.
 */
export const DurationSchema: codec.Codec<string, Temporal.Duration, Temporal.Duration, string> = codec.define({
	decode: schema.transform(schema.string({ maxLength: 128, pattern: durationPattern }), isoDuration),
	encode: schema.transform(DurationValueSchema, (value) => {
		const text = value.toString();
		if (text.length > 128) schema.reject('Encoded duration exceeds its wire limit.');
		return text;
	}),
});

/** Application duration retained by the ISO calendar profile. */
export type DurationType = codec.Decoded<typeof DurationSchema>;

/** Normalize fixed durations exactly; months/years reject instead of receiving an arbitrary reference. */
function fixedDuration(value: Temporal.Duration): Temporal.Duration {
	try {
		return from(elapsedNanoseconds(value), 'nanoseconds');
	} catch (error) {
		if (error instanceof RangeError) schema.reject('Elapsed duration cannot contain months or years.');
		throw error;
	}
}

/**
 * Fixed elapsed ISO profile: weeks are seven days and days are 24 hours. Decode
 * normalizes to clock units with exact bigint arithmetic; encode uses that same
 * normalization. Months and years reject in both directions. This is unsuitable
 * for scheduling calendar days across a zone transition.
 */
export const ElapsedSchema: codec.Codec<string, Temporal.Duration, Temporal.Duration, string> = codec.define({
	decode: schema.transform(
		schema.string({ maxLength: 128, pattern: durationPattern }),
		(value) => fixedDuration(isoDuration(value)),
	),
	encode: schema.transform(DurationValueSchema, (value) => fixedDuration(value).toString()),
});

/** Application duration normalized by the fixed elapsed profile. */
export type ElapsedType = codec.Decoded<typeof ElapsedSchema>;
