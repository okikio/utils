/**
 * PostgreSQL types and how each value crosses the client boundary.
 *
 * - **Send.** A value is sent as a parameter with an explicit cast (`$1::text`), then converted in SQL when the column
 *   type differs, such as `$1::text::jsonb`. No client encodes it a second time.
 * - **Read.** A selected value is converted in SQL to a form every client returns the same way: text, `integer`,
 *   `double precision` or `boolean`. Then `decode` checks it and builds the JavaScript value.
 *
 * @module
 */
import { temporal } from '@okikio/duration/temporal';
import type { Temporal } from '@okikio/duration/temporal';
import { compile, type Fragment, join, keyword, param, qualified } from '../fragment.ts';
import { expect, type SqlType } from '../type.ts';
import { cast, dialect } from './dialect.ts';

export { boolean } from './dialect.ts';
export { nullable, type SqlType } from '../type.ts';

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Whether PostgreSQL can store a string unchanged. It has no NUL character, and a lone UTF-16 surrogate has no UTF-8
 * form, so every client would replace it with U+FFFD without an error.
 */
function storable(value: string): boolean {
	return !value.includes('\0') && value.isWellFormed();
}

/** A JSON escape PostgreSQL's `jsonb` rejects: `\u0000`, or a lone surrogate, which `JSON.stringify` escapes. */
const unstorable = /(?<!\\)(?:\\\\)*\\u(?:0000|d[89a-f][0-9a-f]{2})/iu;

/** Text, optionally limited to a fixed set of values. */
export function text<const T extends string = string>(values?: readonly T[]): SqlType<T> {
	const allowed = values ? new Set<string>(values) : undefined;
	const check = (value: unknown): value is T => isString(value) && (!allowed || allowed.has(value));
	return Object.freeze({
		dialect,
		name: 'text',
		send: (value: T) => {
			if (!storable(expect(value, check, 'text'))) {
				throw new TypeError('Text for PostgreSQL may not hold NUL or a lone UTF-16 surrogate.');
			}
			return param(value, 'text');
		},
		read: (expression: Fragment) => cast(expression, 'text'),
		decode: (raw: unknown) => expect(raw, check, values ? `text in ${[...values].join(', ')}` : 'text'),
	});
}

/**
 * A 32-bit integer. It is sent as text, like every number: a client that writes values into the SQL text, such as
 * MikroORM, would turn `-1` into `-1::integer`, which PostgreSQL reads as `-(1::integer)` and rejects at the minimum.
 */
export const integer: SqlType<number> = Object.freeze({
	dialect,
	name: 'integer',
	send: (value: number) =>
		cast(
			param(String(expect(value, Number.isSafeInteger as (v: unknown) => v is number, 'integer')), 'text'),
			'integer',
		),
	read: (expression: Fragment) => cast(expression, 'integer'),
	decode: (raw: unknown) => expect(raw, Number.isSafeInteger as (v: unknown) => v is number, 'integer'),
});

/** A 64-bit integer as a JavaScript `bigint`. It travels as text, because clients return `bigint` differently. */
export const bigint: SqlType<bigint> = Object.freeze({
	dialect,
	name: 'bigint',
	send: (value: bigint) =>
		cast(param(String(expect(value, (v): v is bigint => typeof v === 'bigint', 'bigint')), 'text'), 'bigint'),
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: (raw: unknown) => BigInt(expect(raw, (v): v is string => isString(v) && /^-?\d+$/u.test(v), 'bigint')),
});

/**
 * A 64-bit integer column read as a JavaScript `number`, for counts and limits that stay below 2^53. It travels as
 * text, like {@link bigint}, and a value outside the safe range is an error instead of a rounded number.
 */
export const long: SqlType<number> = Object.freeze({
	dialect,
	name: 'bigint',
	send: (value: number) =>
		cast(param(String(expect(value, Number.isSafeInteger as (v: unknown) => v is number, 'long')), 'text'), 'bigint'),
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: (raw: unknown) => {
		const text = expect(raw, (v): v is string => isString(v) && /^-?\d+$/u.test(v), 'long');
		const value = Number(text);
		if (!Number.isSafeInteger(value)) throw new RangeError(`Value ${text} is outside the safe integer range.`);
		return value;
	},
});

/** The text PostgreSQL reads and writes for a double, including `NaN`, the infinities and `-0`. */
const float = /^(?:NaN|-?Infinity|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/u;

/**
 * A double-precision float, including `NaN`, `Infinity`, `-Infinity` and `-0`. It travels as text both ways: clients
 * disagree about sending `NaN` and `-0` as numbers, and text keeps every value exact on PostgreSQL 12 and later.
 */
export const double: SqlType<number> = Object.freeze({
	dialect,
	name: 'double precision',
	send: (value: number) => {
		const number = expect(value, (v): v is number => typeof v === 'number', 'double precision');
		return cast(param(Object.is(number, -0) ? '-0' : String(number), 'text'), 'double precision');
	},
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: (raw: unknown) => Number(expect(raw, (v): v is string => isString(v) && float.test(v), 'double precision')),
});

/** A UUID as its canonical lowercase text. */
export const uuid: SqlType<string> = Object.freeze({
	dialect,
	name: 'uuid',
	send: (value: string) => cast(param(expect(value, isString, 'uuid'), 'text'), 'uuid'),
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: (raw: unknown) => expect(raw, isString, 'uuid'),
});

/** Any JSON value. The value travels as JSON text both ways, so no client encodes or parses it differently. */
export function jsonb<T = unknown>(parse: (value: unknown) => T = (value) => value as T): SqlType<T> {
	return Object.freeze({
		dialect,
		name: 'jsonb',
		send: (value: T) => {
			const encoded = JSON.stringify(value);
			if (encoded === undefined) throw new TypeError('Expected a JSON value for jsonb.');
			if (unstorable.test(encoded)) {
				throw new TypeError('A jsonb string may not hold NUL or a lone UTF-16 surrogate.');
			}
			return cast(param(encoded, 'text'), 'jsonb');
		},
		read: (expression: Fragment) => cast(expression, 'text'),
		decode: (raw: unknown) => parse(JSON.parse(expect(raw, isString, 'jsonb text'))),
	});
}

/**
 * ISO 8601 text that PostgreSQL reads: years after 9999 lose Temporal's `+` and leading zeros, and years before 1
 * become `BC` years, because PostgreSQL has no year 0 (Temporal's year 0 is 1 BC).
 */
function iso(value: Temporal.Instant): string {
	const text = value.toString();
	const extended = /^([+-])(\d{6})(-.*)$/u.exec(text);
	const year = extended ? Number(`${extended[1]}${extended[2]}`) : Number(text.slice(0, 4));
	const rest = extended ? extended[3]! : text.slice(4);
	return year > 0 ? `${String(year).padStart(4, '0')}${rest}` : `${String(1 - year).padStart(4, '0')}${rest} BC`;
}

/** Seconds since the epoch as PostgreSQL's exact `numeric` text, such as `-62154086400.500000`. */
const seconds = /^(-?)(\d+)(?:\.(\d{1,6}))?$/u;

/**
 * A point in time as a `Temporal.Instant`, at PostgreSQL's microsecond precision, from 4713 BC to 294276 AD.
 *
 * The default text form of `timestamptz` depends on the session's time zone and date style, so neither direction uses
 * it. A value is sent as ISO 8601 text in UTC, which PostgreSQL reads the same way under every setting, and read as
 * exact seconds since the epoch (`extract` returns `numeric` from PostgreSQL 14). A nanosecond part is rounded by
 * PostgreSQL to microseconds. A stored `infinity` has no `Temporal.Instant`, so reading one fails.
 */
export const timestamptz: SqlType<Temporal.Instant> = Object.freeze({
	dialect,
	name: 'timestamptz',
	send: (value: Temporal.Instant) => cast(param(iso(value), 'text'), 'timestamptz'),
	read: (expression: Fragment) => cast(join([keyword('extract(epoch from '), expression, keyword(')')]), 'text'),
	decode: (raw: unknown) => {
		const text = expect(raw, isString, 'timestamp');
		const parts = seconds.exec(text);
		if (!parts) throw new TypeError(`Expected a finite timestamp; received ${JSON.stringify(text)}.`);
		const micros = BigInt(parts[2]!) * 1_000_000n + BigInt((parts[3] ?? '').padEnd(6, '0'));
		return temporal.Instant.fromEpochNanoseconds((parts[1] ? -micros : micros) * 1000n);
	},
});

/**
 * A `timestamp without time zone` column that stores UTC wall-clock time, as Prisma, TypeORM and many migrations
 * create, read and written as a `Temporal.Instant`.
 *
 * Use it for such a column instead of {@link timestamptz}. PostgreSQL converts between the two types with the
 * session's `TimeZone`, so a `timestamptz` value written into this column shifts by the session's offset.
 */
export const timestamp: SqlType<Temporal.Instant> = Object.freeze({
	dialect,
	name: 'timestamp',
	send: (value: Temporal.Instant) => cast(param(iso(value).replace('Z', ''), 'text'), 'timestamp'),
	read: timestamptz.read,
	decode: timestamptz.decode,
});

const decimal = /^(?:NaN|-?Infinity|-?\d+(?:\.\d+)?)$/u;

/**
 * An exact `numeric` value as its decimal text, such as `'12.50'`, so no digit is lost to a JavaScript number. A
 * column with a scale, such as `numeric(12, 2)`, rounds a longer value when it stores it.
 */
export const numeric: SqlType<string> = Object.freeze({
	dialect,
	name: 'numeric',
	send: (value: string) =>
		cast(param(expect(value, (v): v is string => isString(v) && decimal.test(v), 'numeric'), 'text'), 'numeric'),
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: (raw: unknown) => expect(raw, (v): v is string => isString(v) && decimal.test(v), 'numeric'),
});

/**
 * A value of an existing PostgreSQL enum type, such as the `mood` type that Drizzle's `pgEnum` or a Prisma `enum`
 * creates. Text has no implicit cast to an enum, so a column of an enum type needs this instead of {@link text}.
 *
 * @example
 * ```ts ignore
 * const mood = types.enumerated(['app', 'mood'], ['sad', 'ok', 'happy']);
 * ```
 */
export function enumerated<const T extends string>(
	name: readonly [schema: string, type: string],
	values: readonly T[],
): SqlType<T> {
	const label = compile(qualified(...name), dialect).text;
	const base = text(values);
	return Object.freeze({
		dialect,
		name: label,
		send: (value: T) => cast(base.send(value), label),
		read: base.read,
		decode: base.decode,
	});
}

/** The result of a function such as `pg_advisory_xact_lock` that returns nothing. */
export const empty: SqlType<undefined> = Object.freeze({
	dialect,
	name: 'void',
	send: () => {
		throw new TypeError('A void value cannot be sent.');
	},
	// A void result has a text form (the empty string); reading it keeps the column without a special case.
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: () => undefined,
});
