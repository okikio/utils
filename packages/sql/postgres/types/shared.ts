/**
 * What the PostgreSQL types share: string checks, and a type built from a value's text form.
 *
 * @module
 */
import { type Fragment, param } from '../../fragment.ts';
import { expect, type SqlType } from '../../type.ts';
import { cast, dialect } from '../dialect.ts';

/** Whether a value is a string. */
export const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Whether PostgreSQL can store a string unchanged. It has no NUL character, and a lone UTF-16 surrogate has no UTF-8
 * form, so every client would replace it with U+FFFD without an error.
 */
export function storable(value: string): boolean {
	return !value.includes('\0') && value.isWellFormed();
}

/** A JSON escape PostgreSQL's `jsonb` rejects: `\u0000`, or a lone surrogate, which `JSON.stringify` escapes. */
const unstorable = /(?<!\\)(?:\\\\)*\\u(?:0000|d[89a-f][0-9a-f]{2})/iu;

/** Fail when JSON text holds a string PostgreSQL's `jsonb` rejects. */
export function checkJson(encoded: string, what: string): string {
	if (unstorable.test(encoded)) throw new TypeError(`A ${what} string may not hold NUL or a lone UTF-16 surrogate.`);
	return encoded;
}

/** Read a returned string that must match a pattern. */
export function textOf(raw: unknown, pattern: RegExp, name: string): string {
	return expect(raw, (v): v is string => isString(v) && pattern.test(v), name);
}

/** Convert an expression to text for reading: `(x)::text`. */
export const asText = (expression: Fragment): Fragment => cast(expression, 'text');

/**
 * A type whose value travels as its text form both ways: sent as `($1::text)::name`, so a client that writes values
 * into the SQL text cannot change their meaning, and read through `read`, which defaults to `(x)::text`.
 */
export function textual<T>(
	name: string,
	encode: (value: T) => string,
	decode: (raw: unknown) => T,
	read: (expression: Fragment) => Fragment = asText,
): SqlType<T> {
	return Object.freeze({
		dialect,
		name,
		send: (value: T) => cast(param(encode(value), 'text'), name),
		read,
		decode,
		encode,
	});
}

/**
 * A year in PostgreSQL's input syntax, from the start of Temporal's ISO text: `+010000` becomes `10000`, and year 0 or
 * less becomes a `BC` year, because PostgreSQL has no year 0 (Temporal's year 0 is 1 BC). Returns the ISO text with
 * the year replaced, and the suffix to append (`' BC'` or nothing).
 */
export function era(text: string): { readonly text: string; readonly suffix: string } {
	const extended = /^([+-])(\d{6})(-.*)$/u.exec(text);
	const year = extended ? Number(`${extended[1]}${extended[2]}`) : Number(text.slice(0, 4));
	const rest = extended ? extended[3]! : text.slice(4);
	return year > 0
		? { text: `${String(year).padStart(4, '0')}${rest}`, suffix: '' }
		: { text: `${String(1 - year).padStart(4, '0')}${rest}`, suffix: ' BC' };
}
