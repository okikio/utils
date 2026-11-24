/**
 * Functions, aggregates and arithmetic, each with a fixed name or a name checked as an identifier.
 *
 * @module
 */
import { Expr, type Input, lift, type OrderType } from './expr.ts';
import { identifier, join, keyword, qualified } from './fragment.ts';
import * as types from './type.ts';
import type { SqlType } from './type.ts';
import type { Temporal } from '@okikio/duration/temporal';

/** The first non-NULL value. The result is non-NULL when the last input is. */
export function coalesce<T>(first: Expr<T | null>, ...rest: readonly Input<T>[]): Expr<T> {
	const type = first.type as SqlType<T>;
	const items = [first.fragment, ...rest.map((item) => lift(item, type).fragment)];
	return new Expr(join([keyword('coalesce('), join(items, ', '), keyword(')')]), type, true);
}

/** Number arithmetic. */
export function add(left: Expr<number>, right: Input<number>): Expr<number> {
	return new Expr(join([left.operand, keyword(' + '), lift(right, left.type).operand]), left.type);
}
/** Number subtraction. */
export function subtract(left: Expr<number>, right: Input<number>): Expr<number> {
	return new Expr(join([left.operand, keyword(' - '), lift(right, left.type).operand]), left.type);
}
/** Number multiplication. */
export function multiply(left: Expr<number>, right: Input<number>): Expr<number> {
	return new Expr(join([left.operand, keyword(' * '), lift(right, left.type).operand]), left.type);
}

/** A point in time moved by a number of milliseconds, which may be negative. */
export function later(instant: Expr<Temporal.Instant>, milliseconds: Input<number>): Expr<Temporal.Instant> {
	const amount = lift(milliseconds, types.double).operand;
	return new Expr(
		join([instant.operand, keyword(' + '), amount, keyword(" * interval '1 millisecond'")]),
		instant.type,
	);
}

/**
 * Declare a SQL function with typed arguments and result, then call it like a JavaScript function. The name is
 * checked as an identifier; a schema-qualified name takes two parts.
 *
 * @example
 * ```ts
 * const hash = declare('hashtextextended', [types.text, types.bigint], types.bigint);
 * const lock = declare('pg_advisory_xact_lock', [types.bigint], types.empty);
 * const statement = select({ locked: lock(hash(`outbox:${namespace}`, 0n)) });
 * ```
 */
export function declare<const A extends readonly unknown[], R>(
	name: string | readonly [schema: string, name: string],
	parameters: { readonly [K in keyof A]: SqlType<A[K]> },
	result: SqlType<R>,
): (...args: { readonly [K in keyof A]: Input<A[K]> }) => Expr<R> {
	const callee = typeof name === 'string' ? identifier(name) : qualified(...name);
	return (...args) => {
		const list = args.map((arg, index) => lift(arg, (parameters as readonly SqlType<unknown>[])[index]!).fragment);
		return new Expr(join([callee, keyword('('), join(list, ', '), keyword(')')]), result, true);
	};
}

/** Built-in functions and aggregates, with fixed names. */
export const fn = Object.freeze({
	/** The current time, which moves during a transaction. */
	clockTimestamp: (): Expr<Temporal.Instant> => new Expr(keyword('clock_timestamp()'), types.timestamptz, true),
	/** The time the transaction started. */
	now: (): Expr<Temporal.Instant> => new Expr(keyword('now()'), types.timestamptz, true),
	/** Milliseconds since the Unix epoch, as a double. */
	epochMilliseconds: (instant: Expr<Temporal.Instant>): Expr<number> =>
		new Expr(
			join([keyword('(extract(epoch from '), instant.fragment, keyword(') * 1000)::double precision')]),
			types.double,
			true,
		),
	/** The number of rows, or of rows where `filter` holds. */
	count: (filter?: Expr<boolean>): Expr<number> =>
		new Expr(
			filter
				? join([keyword('(count(*) filter (where '), filter.fragment, keyword('))::integer')])
				: keyword('count(*)::integer'),
			types.integer,
			true,
		),
	/** Each row's 1-based position in this order, as a window function. */
	rowNumber: (...order: readonly OrderType[]): Expr<number> =>
		new Expr(
			join([
				keyword('(row_number() over (order by '),
				join(order.map((item) => item.fragment), ', '),
				keyword('))::integer'),
			]),
			types.integer,
			true,
		),
	/** The largest value, or NULL for no rows. */
	max: <T>(input: Expr<T>): Expr<T | null> =>
		new Expr(join([keyword('max('), input.fragment, keyword(')')]), types.nullable(input.type), true),
	/** The smallest value, or NULL for no rows. */
	min: <T>(input: Expr<T>): Expr<T | null> =>
		new Expr(join([keyword('min('), input.fragment, keyword(')')]), types.nullable(input.type), true),
	/** The largest of the inputs. */
	greatest: <T>(first: Expr<T>, ...rest: readonly Input<T>[]): Expr<T> =>
		new Expr(
			join([
				keyword('greatest('),
				join(
					[
						first,
						...rest.map((item) => lift(item, first.type)),
					].map((item) => item.fragment),
					', ',
				),
				keyword(')'),
			]),
			first.type,
			true,
		),
	/** The number of characters in a text value. */
	charLength: (input: Expr<string | null>): Expr<number | null> =>
		new Expr(join([keyword('char_length('), input.fragment, keyword(')')]), types.nullable(types.integer), true),
	/** Set a configuration value for the current transaction only, such as `statement_timeout`. */
	setLocal: (name: Input<string>, value: Input<string>): Expr<string> =>
		new Expr(
			join([
				keyword('set_config('),
				lift(name, types.text()).fragment,
				keyword(', '),
				lift(value, types.text()).fragment,
				keyword(', true)'),
			]),
			types.text(),
			true,
		),
	/** The table with this qualified name, as text, or NULL when it does not exist. */
	tableExists: (schema: string, table: string): Expr<boolean> =>
		new Expr(
			join([keyword('to_regclass('), lift(`${schema}.${table}`, types.text()).fragment, keyword(') is not null')]),
			types.boolean,
		),
	/** A random UUID. */
	randomUuid: (): Expr<string> => new Expr(keyword('gen_random_uuid()'), types.uuid, true),
});
