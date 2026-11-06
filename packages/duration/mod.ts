/**
 * Represent a time setting with its unit, then convert it for the consumer. For example, sec(2.5) creates
 * a Temporal.Duration and elapsed() converts it to 2500 milliseconds.
 *
 * Unit functions construct durations; they do not wait or start timers. Use total() to choose an output
 * unit and elapsedNanoseconds() for an exact bigint count. Calendar conversions need a reference date when
 * the length depends on that date.
 *
 * @example A readable retry setting
 * ```ts
 * import { sec, min, elapsed, total } from '@okikio/duration';
 * console.log(elapsed(sec(2.5))); // 2500
 * console.log(total(min(90), 'hours')); // 1.5
 * ```
 *
 * @module
 */
export {
	days,
	from,
	hours,
	hr,
	microseconds,
	milliseconds,
	min,
	minutes,
	months,
	ms,
	nanoseconds,
	ns,
	s,
	sec,
	seconds,
	us,
	weeks,
	years,
} from './units.ts';
export { compare, convert, elapsed, elapsedNanoseconds, round, total } from './conversion.ts';
export { formatInstant, parseInstant } from './instant.ts';
export type * from './types.ts';
