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
import { type Fragment, group, join, keyword, param } from '../fragment.ts';
import { expect, type SqlType } from '../type.ts';
import { cast, dialect } from './dialect.ts';

export { boolean } from './dialect.ts';
export { nullable, type SqlType } from '../type.ts';

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Text, optionally limited to a fixed set of values. */
export function text<const T extends string = string>(values?: readonly T[]): SqlType<T> {
	const allowed = values ? new Set<string>(values) : undefined;
	const check = (value: unknown): value is T => isString(value) && (!allowed || allowed.has(value));
	return Object.freeze({
		dialect,
		name: 'text',
		send: (value: T) => param(expect(value, check, 'text'), 'text'),
		read: (expression: Fragment) => cast(expression, 'text'),
		decode: (raw: unknown) => expect(raw, check, values ? `text in ${[...values].join(', ')}` : 'text'),
	});
}

/** A 32-bit integer. */
export const integer: SqlType<number> = Object.freeze({
	dialect,
	name: 'integer',
	send: (value: number) =>
		param(expect(value, Number.isSafeInteger as (v: unknown) => v is number, 'integer'), 'integer'),
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

/** A double-precision float. */
export const double: SqlType<number> = Object.freeze({
	dialect,
	name: 'double precision',
	send: (value: number) => param(expect(value, isNumber, 'double precision'), 'double precision'),
	read: (expression: Fragment) => cast(expression, 'double precision'),
	decode: (raw: unknown) => expect(raw, isNumber, 'double precision'),
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
			return cast(param(encoded, 'text'), 'jsonb');
		},
		read: (expression: Fragment) => cast(expression, 'text'),
		decode: (raw: unknown) => parse(JSON.parse(expect(raw, isString, 'jsonb text'))),
	});
}

/**
 * A point in time as a `Temporal.Instant`, at PostgreSQL's microsecond precision.
 *
 * The default text form of `timestamptz` depends on the session's time zone and date style, so neither direction uses
 * it. A value is sent as an ISO 8601 string in UTC, which PostgreSQL reads the same way under every setting, and read
 * through `to_char` in UTC with six fractional digits. A nanosecond part is rounded by PostgreSQL to microseconds.
 */
export const timestamptz: SqlType<Temporal.Instant> = Object.freeze({
	dialect,
	name: 'timestamptz',
	send: (value: Temporal.Instant) => cast(param(value.toString(), 'text'), 'timestamptz'),
	read: (expression: Fragment) =>
		join([
			keyword('to_char('),
			group(expression),
			keyword(` at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`),
		]),
	decode: (raw: unknown) => {
		const text = expect(raw, isString, 'timestamp');
		try {
			return temporal.Instant.from(text);
		} catch {
			throw new TypeError(`Expected a UTC timestamp; received ${JSON.stringify(text)}.`);
		}
	},
});

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
