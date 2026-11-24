/**
 * Text, JSON, UUIDs, enums and bytes.
 *
 * @module
 */
import { compile, type Fragment, join, keyword, param, qualified } from '../../fragment.ts';
import { expect, type SqlType } from '../../type.ts';
import { cast, dialect } from '../dialect.ts';
import { checkJson, isString, storable, textOf, textual } from './shared.ts';

/** Text, optionally limited to a fixed set of values. NUL and a lone UTF-16 surrogate are refused before sending. */
export function text<const T extends string = string>(values?: readonly T[]): SqlType<T> {
	const allowed = values ? new Set<string>(values) : undefined;
	const check = (value: unknown): value is T => isString(value) && (!allowed || allowed.has(value));
	const encode = (value: T) => {
		if (!storable(expect(value, check, 'text'))) {
			throw new TypeError('Text for PostgreSQL may not hold NUL or a lone UTF-16 surrogate.');
		}
		return value;
	};
	return Object.freeze({
		dialect,
		name: 'text',
		send: (value: T) => param(encode(value), 'text'),
		read: (expression: Fragment) => cast(expression, 'text'),
		decode: (raw: unknown) => expect(raw, check, values ? `text in ${[...values].join(', ')}` : 'text'),
		encode,
	});
}

/** A UUID as its canonical lowercase text. */
export const uuid: SqlType<string> = textual(
	'uuid',
	(value: string) => expect(value, isString, 'uuid'),
	(raw) => expect(raw, isString, 'uuid'),
);

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
	const base = text(values);
	return textual(compile(qualified(...name), dialect).text, base.encode!, base.decode);
}

/** Any JSON value. It travels as JSON text both ways, so no client encodes or parses it differently. */
export function jsonb<T = unknown>(parse: (value: unknown) => T = (value) => value as T): SqlType<T> {
	return textual(
		'jsonb',
		(value: T) => {
			const encoded = JSON.stringify(value);
			if (encoded === undefined) throw new TypeError('Expected a JSON value for jsonb.');
			return checkJson(encoded, 'jsonb');
		},
		(raw) => parse(JSON.parse(expect(raw, isString, 'jsonb text'))),
	);
}

const hex = /^(?:[0-9a-f]{2})*$/u;

/**
 * Bytes (`bytea`) as a `Uint8Array`. They travel as hex text both ways (`\x…` in, `encode(x, 'hex')` out), so the
 * session's `bytea_output` and each client's binary handling make no difference.
 */
export const bytea: SqlType<Uint8Array> = textual(
	'bytea',
	(value: Uint8Array) => {
		expect(value, (v): v is Uint8Array => v instanceof Uint8Array, 'bytea');
		let out = '\\x';
		for (const byte of value) out += byte.toString(16).padStart(2, '0');
		return out;
	},
	(raw) => {
		const text = textOf(raw, hex, 'bytea');
		const out = new Uint8Array(text.length / 2);
		for (let index = 0; index < out.length; index++) out[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
		return out;
	},
	(expression) => join([keyword('encode('), expression, keyword(", 'hex')")]),
);
