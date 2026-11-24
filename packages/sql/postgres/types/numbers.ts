/**
 * Numbers. Every number is sent as text: a client that writes values into the SQL text, such as MikroORM, would turn
 * `-1` into `-1::integer`, which PostgreSQL reads as `-(1::integer)` and rejects at the type's minimum.
 *
 * @module
 */
import type { Fragment } from '../../fragment.ts';
import { expect, type SqlType } from '../../type.ts';
import { cast } from '../dialect.ts';
import { textOf, textual } from './shared.ts';

const integral = /^-?\d+$/u;

/** A safe integer within a range, as its text form. */
function bounded(name: string, low: number, high: number): (value: number) => string {
	return (value) => {
		expect(value, Number.isSafeInteger as (v: unknown) => v is number, name);
		if (value < low || value > high) throw new RangeError(`A ${name} must be from ${low} to ${high}; got ${value}.`);
		return String(value);
	};
}

/** Read an integer as `integer`, which every client returns as a JavaScript number. */
const asInteger = (expression: Fragment): Fragment => cast(expression, 'integer');
const safe = (name: string) => (raw: unknown) => expect(raw, Number.isSafeInteger as (v: unknown) => v is number, name);

/** A 32-bit integer. */
export const integer: SqlType<number> = textual(
	'integer',
	bounded('integer', -2147483648, 2147483647),
	safe('integer'),
	asInteger,
);

/** A 16-bit integer, such as Drizzle's `smallint`. */
export const smallint: SqlType<number> = textual(
	'smallint',
	bounded('smallint', -32768, 32767),
	safe('smallint'),
	asInteger,
);

/** A 64-bit integer as a JavaScript `bigint`. It is read as text, because clients return `bigint` differently. */
export const bigint: SqlType<bigint> = textual(
	'bigint',
	(value: bigint) => String(expect(value, (v): v is bigint => typeof v === 'bigint', 'bigint')),
	(raw) => BigInt(textOf(raw, integral, 'bigint')),
);

/**
 * A 64-bit integer column read as a JavaScript `number`, for counts and limits that stay below 2^53. A value outside
 * the safe range is an error instead of a rounded number.
 */
export const long: SqlType<number> = textual(
	'bigint',
	(value: number) => String(expect(value, Number.isSafeInteger as (v: unknown) => v is number, 'long')),
	(raw) => {
		const text = textOf(raw, integral, 'long');
		const value = Number(text);
		if (!Number.isSafeInteger(value)) throw new RangeError(`Value ${text} is outside the safe integer range.`);
		return value;
	},
);

/** The text PostgreSQL reads and writes for a float, including `NaN`, the infinities and `-0`. */
const float = /^(?:NaN|-?Infinity|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/u;

function floating(name: string): SqlType<number> {
	return textual(
		name,
		(value: number) => {
			const number = expect(value, (v): v is number => typeof v === 'number', name);
			return Object.is(number, -0) ? '-0' : String(number);
		},
		(raw) => Number(textOf(raw, float, name)),
	);
}

/**
 * A double-precision float, including `NaN`, `Infinity`, `-Infinity` and `-0`. It travels as text both ways: clients
 * disagree about sending `NaN` and `-0` as numbers, and text keeps every value exact on PostgreSQL 12 and later.
 */
export const double: SqlType<number> = floating('double precision');

/** A single-precision float (`real`). PostgreSQL rounds a value to single precision when it stores it. */
export const real: SqlType<number> = floating('real');

const decimal = /^(?:NaN|-?Infinity|-?\d+(?:\.\d+)?)$/u;

/** A decimal in scientific notation, as CockroachDB writes small and large values: `-1E-9`, `1.5E+20`. */
const scientific = /^(-?)(\d+)(?:\.(\d+))?E([-+]?\d+)$/iu;

/** Plain decimal text for a decimal in scientific notation, moving the point without rounding any digit. */
function plainDecimal(text: string): string {
	const parts = scientific.exec(text);
	if (!parts) return text;
	const [, sign, whole, fraction = '', power] = parts;
	const digits = whole! + fraction;
	const point = whole!.length + Number(power);
	const padded = point <= 0 ? '0'.repeat(1 - point) + digits : digits.padEnd(point, '0');
	const at = Math.max(point, 1);
	const integer = padded.slice(0, at).replace(/^0+(?=\d)/u, '');
	const rest = padded.slice(at);
	return `${sign}${integer}${rest ? `.${rest}` : ''}`;
}

/**
 * An exact `numeric` value as its decimal text, such as `'12.50'`, so no digit is lost to a JavaScript number. A
 * column with a scale, such as `numeric(12, 2)`, rounds a longer value when it stores it. A value the server writes in
 * scientific notation, as CockroachDB does for `-1E-9`, is read back as plain decimal text.
 */
export const numeric: SqlType<string> = textual(
	'numeric',
	(value: string) => textOf(value, decimal, 'numeric'),
	(raw) => textOf(typeof raw === 'string' ? plainDecimal(raw) : raw, decimal, 'numeric'),
);
