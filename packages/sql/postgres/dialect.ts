/**
 * PostgreSQL's text rules: double-quoted names, `$1::type` parameters, and literals for DDL and PL/pgSQL bodies.
 *
 * Every parameter carries an explicit cast, in the numbered form and in the template form, so every client sends the
 * same parameter type and PostgreSQL never has to infer one.
 *
 * @module
 */
import type { Dialect, LiteralModeType } from '../dialect.ts';
import { type Fragment, group, join, keyword, param } from '../fragment.ts';
import { expect, type SqlType } from '../type.ts';

/**
 * A constant as a PostgreSQL literal. Only constants from definitions reach this: strings, finite numbers, booleans
 * and null. A string may not hold a backslash or NUL, so its meaning does not depend on
 * `standard_conforming_strings`. Inside a dollar-quoted function body it may not hold `$` either.
 */
function literal(value: unknown, type: string, mode: LiteralModeType): string {
	if (value === null) return `null::${type}`;
	if (typeof value === 'boolean') return `${value}::${type}`;
	// In parentheses, because `-1::integer` reads as `-(1::integer)`, which fails at the type's minimum.
	if (typeof value === 'number' && Number.isFinite(value)) return `(${value})::${type}`;
	const unsafe = mode === 'routine' ? /[\\\0$]/u : /[\\\0]/u;
	if (typeof value === 'string' && !unsafe.test(value) && value.isWellFormed()) {
		return `'${value.replaceAll("'", "''")}'::${type}`;
	}
	throw new TypeError('A DDL constant must be a plain string, finite number, boolean or null.');
}

/** `(expression)::type`. */
export function cast(expression: Fragment, type: string): Fragment {
	return join([group(expression), keyword(`::${type}`)]);
}

/** PostgreSQL. */
export const dialect: Dialect = Object.freeze({
	name: 'postgres',
	quote: (name: string) => `"${name}"`,
	placeholder: (index: number, type: string) => ({ text: `$${index}::${type}`, suffix: `::${type}` }),
	literal,
	// The Bind message counts parameters in 16 bits. Past this, some clients wrap the count and fail with a misleading
	// error, and clients that write values into the text send it anyway.
	parameters: 65_535,
	get boolean(): SqlType<boolean> {
		return boolean;
	},
});

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** A boolean, which is also the type of every condition. */
export const boolean: SqlType<boolean> = Object.freeze({
	dialect,
	name: 'boolean',
	send: (value: boolean) => param(expect(value, isBoolean, 'boolean'), 'boolean'),
	read: (expression: Fragment) => cast(expression, 'boolean'),
	decode: (raw: unknown) => expect(raw, isBoolean, 'boolean'),
});
