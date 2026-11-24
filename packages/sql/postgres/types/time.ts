/**
 * Times, dates, times of day and intervals.
 *
 * The default text form of these types depends on the session's `TimeZone`, `DateStyle` and `IntervalStyle`, so no
 * direction uses it. Values are sent as ISO 8601 text, which PostgreSQL reads the same way under every setting, and read
 * as exact numbers: seconds or days since the epoch, or interval parts. Reading needs PostgreSQL 14 or later, where
 * `extract` returns an exact `numeric`.
 *
 * @module
 */
import { temporal } from '@okikio/duration/temporal';
import type { Temporal } from '@okikio/duration/temporal';
import { type Fragment, group, join, keyword } from '../../fragment.ts';
import { expect, type SqlType } from '../../type.ts';
import { cast } from '../dialect.ts';
import { era, textOf, textual } from './shared.ts';

/** Seconds as PostgreSQL's exact `numeric` text, such as `-62154086400.500000`. */
const seconds = /^(-?)(\d+)(?:\.(\d{1,6}))?$/u;

/** Microseconds from exact seconds text. */
function micros(text: string, name: string): bigint {
	const parts = seconds.exec(text);
	if (!parts) throw new TypeError(`Expected a finite ${name}; received ${JSON.stringify(text)}.`);
	const value = BigInt(parts[2]!) * 1_000_000n + BigInt((parts[3] ?? '').padEnd(6, '0'));
	return parts[1] ? -value : value;
}

/** `(extract(epoch from x))::text`: exact seconds. */
const epoch = (expression: Fragment): Fragment =>
	cast(join([keyword('extract(epoch from '), expression, keyword(')')]), 'text');

const instant = (value: Temporal.Instant): Temporal.Instant =>
	expect(value, (v): v is Temporal.Instant => v instanceof temporal.Instant, 'Temporal.Instant');

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

const fromEpoch = (raw: unknown, name: string): Temporal.Instant =>
	temporal.Instant.fromEpochNanoseconds(
		micros(expect(raw, (v): v is string => typeof v === 'string', name), name) * 1000n,
	);

/**
 * A point in time as a `Temporal.Instant`, at PostgreSQL's microsecond precision, from 4713 BC to 294276 AD. A
 * nanosecond part is rounded by PostgreSQL. A stored `infinity` has no `Temporal.Instant`, so reading one fails.
 */
export const timestamptz: SqlType<Temporal.Instant> = textual(
	'timestamptz',
	iso,
	(raw) => fromEpoch(raw, 'timestamp'),
	epoch,
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
	(raw) => fromEpoch(raw, 'timestamp'),
	epoch,
);

const epochDay = (): Temporal.PlainDate => temporal.PlainDate.from('1970-01-01');

/** A calendar date as a `Temporal.PlainDate`, read as days since 1970-01-01. A stored `infinity` cannot be read. */
export const date: SqlType<Temporal.PlainDate> = textual(
	'date',
	(value) => {
		expect(value, (v): v is Temporal.PlainDate => v instanceof temporal.PlainDate, 'Temporal.PlainDate');
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
		expect(value, (v): v is Temporal.PlainTime => v instanceof temporal.PlainTime, 'Temporal.PlainTime').toString(),
	(raw) => {
		const total = micros(expect(raw, (v): v is string => typeof v === 'string', 'time'), 'time');
		if (total >= 86_400_000_000n) throw new RangeError('PostgreSQL time 24:00:00 has no Temporal.PlainTime.');
		return temporal.PlainTime.from('00:00').add({ microseconds: Number(total) });
	},
	epoch,
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

const parts = (expression: Fragment): Fragment => {
	const x = group(expression);
	// `json_build_array` of NULL parts is not NULL, so a NULL interval is tested first.
	return cast(
		join([
			keyword('case when '),
			x,
			keyword(' is null then null else json_build_array((extract(year from '),
			x,
			keyword(') * 12 + extract(month from '),
			x,
			keyword('))::text, (extract(day from '),
			x,
			keyword('))::text, (extract(epoch from '),
			x,
			keyword(" - date_trunc('day', "),
			x,
			keyword(')))::text) end'),
		]),
		'text',
	);
};

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
			months: Number(textOf(months, /^-?\d+$/u, 'interval months')),
			days: Number(textOf(days, /^-?\d+$/u, 'interval days')),
			microseconds: micros(time, 'interval'),
		});
	},
	parts,
);
