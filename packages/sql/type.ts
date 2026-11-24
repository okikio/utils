/**
 * The contract between a JavaScript value and a SQL type.
 *
 * Clients disagree about how they send and return values: one returns a 64-bit integer as a string and another as a
 * number, one parses JSON and another hands back text. Each {@link SqlType} fixes both directions for its dialect, so
 * every client of that dialect sees the same value. A dialect's entry point defines its types.
 *
 * @module
 */
import type { Dialect } from './dialect.ts';
import { type Fragment, group, join, keyword } from './fragment.ts';

/** One SQL type of a dialect and its conversions. `T` is the JavaScript value. */
export interface SqlType<T> {
	/** The dialect whose SQL this type writes. */
	readonly dialect: Dialect;
	/** The SQL type name used in DDL and casts, such as `text` or `double precision`. */
	readonly name: string;
	/** A parameter carrying `value`, converted to this type in SQL. */
	send(value: T): Fragment;
	/** Convert a selected expression to the portable form that `decode` reads. */
	read(expression: Fragment): Fragment;
	/** Check one returned value and build the JavaScript value. */
	decode(raw: unknown): T;
}

/** A type whose values may also be SQL NULL. NULL is written `cast(null as type)`, which every dialect reads. */
export function nullable<T>(type: SqlType<T>): SqlType<T | null> {
	return Object.freeze({
		dialect: type.dialect,
		name: type.name,
		send: (value: T | null) =>
			value === null ? join([keyword('cast(null as '), keyword(type.name), keyword(')')]) : type.send(value),
		read: type.read,
		decode: (raw: unknown) => raw === null || raw === undefined ? null : type.decode(raw),
	});
}

/** Reject a returned value of the wrong JavaScript type with a clear message. */
export function expect<T>(raw: unknown, check: (value: unknown) => value is T, name: string): T {
	if (!check(raw)) throw new TypeError(`Expected a ${name} value from SQL, received ${typeof raw}.`);
	return raw;
}

/** Wrap an expression in a conversion, such as `(x)::text`, written by the caller's dialect. */
export function wrap(expression: Fragment, before: string, after: string): Fragment {
	return join([keyword(before), group(expression), keyword(after)]);
}
