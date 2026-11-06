/**
 * Read and write UTC instants for configuration and serialized records.
 *
 * These helpers use epoch milliseconds. Use Temporal.Instant directly when
 * nanoseconds or a different ISO input vocabulary are required.
 *
 * @example Round trip a stored timestamp
 * ```ts
 * import { formatInstant, parseInstant } from '@okikio/duration/instant';
 * console.log(formatInstant(parseInstant('2026-11-01'))); // 2026-11-01T00:00:00.000Z
 * ```
 *
 * @module
 */
import { temporal } from './temporal.ts';

/**
 * Parse an ISO date or explicit-offset date-time into epoch milliseconds.
 * A date means UTC midnight. Date-times require seconds and a UTC offset, so
 * the result never depends on the host time zone. Invalid calendar dates reject.
 * Offsets use hours 00 through 23 and minutes 00 through 59. Leap seconds and
 * zone annotations are outside this record format. Sub-millisecond input is
 * reduced to epoch-millisecond precision.
 */
export function parseInstant(value: string): number {
	if (typeof value !== 'string') throw new TypeError('An instant must be ISO text.');
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return temporal.PlainDate.from(value).toZonedDateTime('UTC').toInstant().epochMilliseconds;
	}
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) {
		throw new RangeError('An instant must be an ISO date or date-time with seconds and an explicit UTC offset.');
	}
	return temporal.Instant.from(value).epochMilliseconds;
}

/** Serialize a safe whole epoch-millisecond value as canonical UTC ISO text; invalid or out-of-range values reject. */
export function formatInstant(value: number): string {
	if (!Number.isSafeInteger(value)) throw new RangeError('Epoch milliseconds must be a safe whole number.');
	return temporal.Instant.fromEpochMilliseconds(value).toString({ smallestUnit: 'millisecond' });
}
