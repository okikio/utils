/**
 * Times, dates, times of day and intervals.
 *
 * The default text form of these types depends on the session's `TimeZone`, `DateStyle` and `IntervalStyle`, so no
 * direction uses it. Values are sent as ISO 8601 text, which PostgreSQL reads the same way under every setting, and read
 * as whole numbers: days since 1970-01-01 and microseconds since midnight, or interval parts. Each is built from
 * fields that `extract` returns, such as the hour and the microseconds within the minute, which are whole numbers on
 * PostgreSQL 14 and later and on CockroachDB, where `extract` returns a float, so no field loses precision.
 *
 * @module
 */
import { Temporal, temporal } from '@okikio/duration/temporal';
import { type Fragment, group, join, keyword, once } from '../../fragment.ts';
import { expect, type SqlType } from '../../type.ts';
import { cast } from '../dialect.ts';
import { era, textOf, textual } from './shared.ts';

const whole = /^-?\d+$/u;

/** A whole number of microseconds or days from its text. */
function count(raw: unknown, name: string): bigint {
	return BigInt(textOf(raw, whole, name));
}

/** `(extract(f from x))`, one field of a time, timestamp or interval. */
const field = (name: string, x: Fragment): Fragment => join([keyword(`extract(${name} from `), x, keyword(')')]);

/**
 * Microseconds from the hours, minutes and seconds of `x`, as `int8`. Each field is a whole number of its unit, so the
 * sum is exact even where `extract` returns a float.
 */
const clockMicros = (x: Fragment): Fragment =>
	join([
		keyword('('),
		field('hour', x),
		keyword(' * 3600000000 + '),
		field('minute', x),
		keyword(' * 60000000 + '),
		field('microseconds', x),
		keyword(')::int8'),
	]);

/** `'<days since 1970-01-01> <microseconds since midnight>'` for a timestamp in UTC wall-clock time. */
const dayAndClock = (utc: Fragment): Fragment =>
	join([
		keyword('(('),
		utc,
		keyword(")::date - date '1970-01-01')::text || ' ' || ("),
		clockMicros(utc),
		keyword(')::text'),
	]);

/** Accept both supported constructor families without admitting arbitrary lookalike objects. */
const instant = (value: Temporal.Instant): Temporal.Instant =>
	expect(
		value,
		(v): v is Temporal.Instant => (v instanceof temporal.Instant || v instanceof Temporal.Instant),
		'Temporal.Instant',
	);

const nanosPerDay = 86_400_000_000_000n;
const two = (value: number): string => String(value).padStart(2, '0');

/**
 * An instant as ISO 8601 text in UTC, in the form `Temporal.Instant.toString()` writes, built from its epoch
 * nanoseconds. Deno's `toString` loads ICU time zone rules even for UTC, and throws when they fail to load, such as
 * when `ICU_TIMEZONE_FILES_DIR` points at rules of another ICU version. Sending a timestamp needs no time zone.
 */
function utc(value: Temporal.Instant): string {
	const nanos = instant(value).epochNanoseconds;
	let days = nanos / nanosPerDay;
	let rest = nanos % nanosPerDay;
	if (rest < 0n) {
		rest += nanosPerDay;
		days -= 1n;
	}
	// Days since 1970-01-01 to a proleptic Gregorian date, by Howard Hinnant's `civil_from_days`.
	const z = Number(days) + 719_468;
	const cycle = Math.floor(z / 146_097);
	const dayOfCycle = z - cycle * 146_097;
	const yearOfCycle = Math.floor(
		(dayOfCycle - Math.floor(dayOfCycle / 1460) + Math.floor(dayOfCycle / 36_524) - Math.floor(dayOfCycle / 146_096)) /
			365,
	);
	const dayOfYear = dayOfCycle - (365 * yearOfCycle + Math.floor(yearOfCycle / 4) - Math.floor(yearOfCycle / 100));
	const shifted = Math.floor((5 * dayOfYear + 2) / 153);
	const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
	const month = shifted < 10 ? shifted + 3 : shifted - 9;
	const year = yearOfCycle + cycle * 400 + (month <= 2 ? 1 : 0);
	const yearText = year >= 0 && year <= 9999
		? String(year).padStart(4, '0')
		: `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
	const seconds = Number(rest / 1_000_000_000n);
	const fraction = rest % 1_000_000_000n;
	const clock = `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`;
	const digits = fraction ? `.${String(fraction).padStart(9, '0').replace(/0+$/u, '')}` : '';
	return `${yearText}-${two(month)}-${two(day)}T${clock}${digits}Z`;
}

/** An instant as ISO 8601 text in UTC that PostgreSQL reads, for any year it holds. */
function iso(value: Temporal.Instant): string {
	const { text, suffix } = era(utc(value));
	return text + suffix;
}

/** An instant from `'<days> <microseconds>'`. A stored `infinity` fails earlier, when the database subtracts it. */
function fromDayAndClock(raw: unknown, name: string): Temporal.Instant {
	const [days, clock] = textOf(raw, /^-?\d+ \d+$/u, name).split(' ');
	return temporal.Instant.fromEpochNanoseconds((BigInt(days!) * 86_400_000_000n + BigInt(clock!)) * 1000n);
}

/**
 * A point in time as a `Temporal.Instant`, at PostgreSQL's microsecond precision, from 4713 BC to 294276 AD. A
 * nanosecond part is rounded by PostgreSQL. A stored `infinity` has no `Temporal.Instant`, so reading one fails.
 */
export const timestamptz: SqlType<Temporal.Instant> = textual(
	'timestamptz',
	iso,
	(raw) => fromDayAndClock(raw, 'timestamp'),
	(expression) => once(expression, (x) => dayAndClock(join([keyword('('), group(x), keyword(" at time zone 'UTC')")]))),
);

/**
 * A `timestamp without time zone` column that stores UTC wall-clock time, as Prisma, TypeORM and many migrations
 * create, read and written as a `Temporal.Instant`. Use it for such a column instead of {@link timestamptz}:
 * PostgreSQL converts between the two with the session's `TimeZone`, so the wrong one shifts the value.
 */
export const timestamp: SqlType<Temporal.Instant> = textual(
	'timestamp',
	(value) => {
		const { text, suffix } = era(utc(value));
		return text.replace('Z', '') + suffix;
	},
	(raw) => fromDayAndClock(raw, 'timestamp'),
	(expression) => once(expression, (x) => dayAndClock(group(x))),
);

const epochDay = (): Temporal.PlainDate => temporal.PlainDate.from('1970-01-01');

/** A calendar date as a `Temporal.PlainDate`, read as days since 1970-01-01. A stored `infinity` cannot be read. */
export const date: SqlType<Temporal.PlainDate> = textual(
	'date',
	(value) => {
		expect(
			value,
			(v): v is Temporal.PlainDate => (v instanceof temporal.PlainDate || v instanceof Temporal.PlainDate),
			'Temporal.PlainDate',
		);
		const { text, suffix } = era(value.toString());
		return text + suffix;
	},
	(raw) => epochDay().add({ days: Number(textOf(raw, /^-?\d+$/u, 'date')) }),
	(expression) => cast(join([group(expression), keyword(" - date '1970-01-01'")]), 'text'),
);

/**
 * A time of day without a zone as a `Temporal.PlainTime`, at microsecond precision. PostgreSQL's `24:00:00` has no
 * `Temporal.PlainTime`, so reading it fails.
 */
export const time: SqlType<Temporal.PlainTime> = textual(
	'time',
	(value) =>
		expect(
			value,
			(v): v is Temporal.PlainTime => (v instanceof temporal.PlainTime || v instanceof Temporal.PlainTime),
			'Temporal.PlainTime',
		).toString(),
	(raw) => {
		const total = count(raw, 'time');
		if (total >= 86_400_000_000n) throw new RangeError('PostgreSQL time 24:00:00 has no Temporal.PlainTime.');
		return temporal.PlainTime.from('00:00').add({ microseconds: Number(total) });
	},
	(expression) => once(expression, (x) => cast(clockMicros(group(x)), 'text')),
);

/**
 * An `interval` as PostgreSQL keeps it: months, days and microseconds, each with its own sign. A
 * `Temporal.Duration` cannot hold `1 month -1 day`, so this is a plain record. A month and a day have no fixed length,
 * so the three parts are never folded into each other.
 */
export interface IntervalType {
	readonly months: number;
	readonly days: number;
	readonly microseconds: bigint;
}

/** Exact seconds text for microseconds, such as `-1.000001`. */
function secondsText(value: bigint): string {
	const sign = value < 0n ? '-' : '';
	const abs = value < 0n ? -value : value;
	return `${sign}${abs / 1_000_000n}.${String(abs % 1_000_000n).padStart(6, '0')}`;
}

const parts = (expression: Fragment): Fragment =>
	once(expression, (value) => {
		const x = group(value);
		// `json_build_array` of NULL parts is not NULL, so a NULL interval is tested first.
		return cast(
			join([
				keyword('case when '),
				x,
				keyword(' is null then null else json_build_array(('),
				field('year', x),
				keyword(' * 12 + '),
				field('month', x),
				keyword(')::int8::text, ('),
				field('day', x),
				keyword(')::int8::text, '),
				clockMicros(x),
				keyword('::text) end'),
			]),
			'text',
		);
	});

/** An `interval`, as {@link IntervalType}. */
export const interval: SqlType<IntervalType> = textual(
	'interval',
	(value) => {
		const ok = (v: unknown): v is IntervalType =>
			typeof v === 'object' && v !== null && Number.isSafeInteger((v as IntervalType).months) &&
			Number.isSafeInteger((v as IntervalType).days) && typeof (v as IntervalType).microseconds === 'bigint';
		expect(value, ok, 'interval');
		return `${value.months} months ${value.days} days ${secondsText(value.microseconds)} seconds`;
	},
	(raw) => {
		const [months, days, time] = JSON.parse(expect(raw, (v): v is string => typeof v === 'string', 'interval')) as [
			string,
			string,
			string,
		];
		return Object.freeze({
			months: Number(textOf(months, whole, 'interval months')),
			days: Number(textOf(days, whole, 'interval days')),
			microseconds: count(time, 'interval'),
		});
	},
	parts,
);
