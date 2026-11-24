/**
 * SQL types and how each value crosses the client boundary.
 *
 * Clients disagree about how they send and return values: one returns `bigint` as a string and another as a number,
 * one parses `jsonb` and another hands back text, and a `Date` depends on the session time zone. Each type here fixes
 * both directions, so every client sees the same thing:
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
import { type Fragment, group, join, keyword, param } from './fragment.ts';

/** One SQL type and its conversions. `T` is the JavaScript value. */
export interface SqlType<T> {
	/** The SQL type name used in DDL and casts, such as `text` or `double precision`. */
	readonly name: string;
	/** A parameter carrying `value`, converted to this type in SQL. */
	send(value: T): Fragment;
	/** Convert a selected expression to the portable form that `decode` reads. */
	read(expression: Fragment): Fragment;
	/** Check one returned value and build the JavaScript value. */
	decode(raw: unknown): T;
}

/** A type whose values may also be SQL NULL. */
export function nullable<T>(type: SqlType<T>): SqlType<T | null> {
	return Object.freeze({
		name: type.name,
		send: (value: T | null) => value === null ? join([keyword('null::'), keyword(type.name)]) : type.send(value),
		read: type.read,
		decode: (raw: unknown) => raw === null || raw === undefined ? null : type.decode(raw),
	});
}

/** Reject a returned value of the wrong JavaScript type with a clear message. */
function expect<T>(raw: unknown, check: (value: unknown) => value is T, name: string): T {
	if (!check(raw)) throw new TypeError(`Expected a ${name} value from SQL, received ${typeof raw}.`);
	return raw;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Cast a fragment to a type name. */
function cast(expression: Fragment, name: string): Fragment {
	return join([group(expression), keyword(`::${name}`)]);
}

/** Text, optionally limited to a fixed set of values. */
export function text<const T extends string = string>(values?: readonly T[]): SqlType<T> {
	const allowed = values ? new Set<string>(values) : undefined;
	const check = (value: unknown): value is T => isString(value) && (!allowed || allowed.has(value));
	return Object.freeze({
		name: 'text',
		send: (value: T) => param(expect(value, check, 'text'), 'text'),
		read: (expression: Fragment) => cast(expression, 'text'),
		decode: (raw: unknown) => expect(raw, check, values ? `text in ${[...values].join(', ')}` : 'text'),
	});
}

/** A 32-bit integer. */
export const integer: SqlType<number> = Object.freeze({
	name: 'integer',
	send: (value: number) =>
		param(expect(value, Number.isSafeInteger as (v: unknown) => v is number, 'integer'), 'integer'),
	read: (expression: Fragment) => cast(expression, 'integer'),
	decode: (raw: unknown) => expect(raw, Number.isSafeInteger as (v: unknown) => v is number, 'integer'),
});

/** A 64-bit integer as a JavaScript `bigint`. It travels as text, because clients return `bigint` differently. */
export const bigint: SqlType<bigint> = Object.freeze({
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
	name: 'double precision',
	send: (value: number) => param(expect(value, isNumber, 'double precision'), 'double precision'),
	read: (expression: Fragment) => cast(expression, 'double precision'),
	decode: (raw: unknown) => expect(raw, isNumber, 'double precision'),
});

/** A boolean. */
export const boolean: SqlType<boolean> = Object.freeze({
	name: 'boolean',
	send: (value: boolean) => param(expect(value, isBoolean, 'boolean'), 'boolean'),
	read: (expression: Fragment) => cast(expression, 'boolean'),
	decode: (raw: unknown) => expect(raw, isBoolean, 'boolean'),
});

/** A UUID as its canonical lowercase text. */
export const uuid: SqlType<string> = Object.freeze({
	name: 'uuid',
	send: (value: string) => cast(param(expect(value, isString, 'uuid'), 'text'), 'uuid'),
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: (raw: unknown) => expect(raw, isString, 'uuid'),
});

/** Any JSON value. The value travels as JSON text both ways, so no client encodes or parses it differently. */
export function jsonb<T = unknown>(parse: (value: unknown) => T = (value) => value as T): SqlType<T> {
	return Object.freeze({
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
 * A point in time as a `Temporal.Instant`, at millisecond precision. It travels as epoch milliseconds, because the
 * text form of `timestamptz` depends on the session's time zone and date style.
 */
export const timestamptz: SqlType<Temporal.Instant> = Object.freeze({
	name: 'timestamptz',
	send: (value: Temporal.Instant) =>
		join([keyword('to_timestamp('), param(value.epochMilliseconds, 'double precision'), keyword(' / 1000)')]),
	read: (expression: Fragment) =>
		join([keyword('floor(extract(epoch from '), expression, keyword(') * 1000)::double precision')]),
	decode: (raw: unknown) => temporal.Instant.fromEpochMilliseconds(expect(raw, isNumber, 'epoch milliseconds')),
});

/** The result of a function such as `pg_advisory_xact_lock` that returns nothing. */
export const empty: SqlType<undefined> = Object.freeze({
	name: 'void',
	send: () => {
		throw new TypeError('A void value cannot be sent.');
	},
	// A void result has a text form (the empty string); reading it keeps the column without a special case.
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: () => undefined,
});
