/**
 * The PostgreSQL built-ins this package types, grouped by what they work on.
 *
 * The catalog holds the built-ins its adapters use, not every PostgreSQL function. Type any other one with `declare`,
 * which checks its name and its argument and result types the same way:
 *
 * ```ts ignore
 * const similarity = sql.declare('similarity', [types.text(), types.text()], types.double);
 * ```
 *
 * Every function keeps the owners of its arguments, so a statement still checks that it reads only tables in scope.
 *
 * @module
 */
import type { Temporal } from '@okikio/duration/temporal';
import {
	type AnyExpr,
	Expr,
	type Input,
	lift,
	type OrderType,
	type OwnersOf,
	type OwnersOfAll,
	union,
	type ValueOf,
} from '../expr.ts';
import { type Fragment, identifier, join, keyword } from '../fragment.ts';
import { call, coalesce, max, min, sum } from '../functions.ts';
import { nullable, type SqlType } from '../type.ts';
import { textOf } from './types/shared.ts';
import * as types from './types/mod.ts';

/**
 * A `double precision` count of milliseconds since the epoch, read as whole microseconds. A timestamp holds whole
 * microseconds, so the read is exact without `float8send`, which CockroachDB lacks, and no session setting rounds it.
 */
const milliseconds: SqlType<number> = Object.freeze({
	...types.double,
	read: (expression: Fragment) => join([keyword('(('), expression, keyword(') * 1000)::int8::text')]),
	decode: (raw: unknown) => Number(textOf(raw, /^-?\d+$/u, 'epoch milliseconds')) / 1000,
});

/** `(value)::int4`, which a count needs, because `count` returns `bigint`. */
function counted(fragment: ReturnType<typeof join>, owners: ReadonlySet<string>): Expr<number, string> {
	return new Expr(join([keyword('('), fragment, keyword(')::int4')]), types.integer, true, owners);
}

/** The number of rows, or of rows where `filter` holds, as an integer. */
function count(): Expr<number>;
function count<X extends Expr<boolean, string>>(filter: X): Expr<number, OwnersOf<X>>;
function count(filter?: Expr<boolean, string>): Expr<number, string> {
	return filter
		? counted(join([keyword('count(*) filter (where '), filter.fragment, keyword(')')]), filter.owners)
		: counted(keyword('count(*)'), new Set());
}

/** Aggregates and window functions. */
const rows = {
	count,
	/** Each row's 1-based position in this order, as a window function. */
	rowNumber: <const L extends readonly OrderType[]>(...order: L): Expr<number, OwnersOf<L[number]>> =>
		counted(
			join([keyword('row_number() over (order by '), join(order.map((item) => item.fragment), ', '), keyword(')')]),
			union(...order),
		) as never,
	max,
	min,
	sum,
	/** Bytes that each stored row of an aliased table takes: `pg_column_size(alias)`. Sum it for a table's share. */
	size: <A extends string>(source: { readonly alias: A }): Expr<number, A> =>
		new Expr(
			join([keyword('pg_column_size('), identifier(source.alias), keyword(')::int4')]),
			types.integer,
			true,
			new Set([source.alias]),
		) as Expr<number, A>,
};

/** Times, all from the database clock, never from a host. */
const time = {
	/** The current time, which moves during a transaction. */
	clockTimestamp: (): Expr<Temporal.Instant> => new Expr(keyword('clock_timestamp()'), types.timestamptz, true),
	/** The time the transaction started. */
	now: (): Expr<Temporal.Instant> => new Expr(keyword('now()'), types.timestamptz, true),
	/** The time the transaction started; the same for every statement of the transaction. */
	transactionTimestamp: (): Expr<Temporal.Instant> =>
		new Expr(keyword('transaction_timestamp()'), types.timestamptz, true),
	/** Milliseconds since the Unix epoch, as a double. */
	epochMilliseconds: <X extends Expr<Temporal.Instant, string>>(instant: X): Expr<number, OwnersOf<X>> =>
		new Expr(
			join([keyword('(extract(epoch from '), instant.fragment, keyword(') * 1000)::double precision')]),
			milliseconds,
			true,
			instant.owners,
		) as never,
};

/** Numbers, compared or rounded. */
const numbers = {
	/** The smallest integer not less than the value. */
	ceil: <X extends Expr<number, string>>(input: X): Expr<number, OwnersOf<X>> =>
		call('ceil', [input], input.type) as never,
	/** The largest of the inputs. */
	greatest: <X extends AnyExpr, const R extends readonly Input<ValueOf<X>>[]>(
		first: X,
		...rest: R
	): Expr<ValueOf<X>, OwnersOf<X> | OwnersOfAll<R>> =>
		call('greatest', [first, ...rest.map((item) => lift(item as Input<unknown>, first.type))], first.type) as never,
	/** The smallest of the inputs. */
	least: <X extends AnyExpr, const R extends readonly Input<ValueOf<X>>[]>(
		first: X,
		...rest: R
	): Expr<ValueOf<X>, OwnersOf<X> | OwnersOfAll<R>> =>
		call('least', [first, ...rest.map((item) => lift(item as Input<unknown>, first.type))], first.type) as never,
	coalesce,
};

/** Text. */
const text = {
	/** Whether text starts with a prefix, compared as plain characters with no pattern syntax. */
	startsWith: <I extends Expr<string | null, string>, X extends Input<string>>(
		input: I,
		prefix: X,
	): Expr<boolean, OwnersOf<I> | OwnersOf<X>> =>
		call('starts_with', [input, lift(prefix as Input<string>, types.text())], types.boolean) as never,
	/** The number of characters in a text value. */
	charLength: <I extends Expr<string | null, string>>(input: I): Expr<number | null, OwnersOf<I>> =>
		call('char_length', [input], nullable(types.integer)) as never,
};

/** Session, catalog and identity functions. */
const system = {
	/** Set a configuration value for the current transaction only, such as `statement_timeout`. */
	setLocal: (name: string, value: string): Expr<string> =>
		new Expr(
			join([
				keyword('set_config('),
				types.text().send(name),
				keyword(', '),
				types.text().send(value),
				keyword(', true)'),
			]),
			types.text(),
			true,
		),
	/** Whether a table with this qualified name exists. */
	tableExists: (schema: string, table: string): Expr<boolean> =>
		new Expr(
			join([keyword('to_regclass('), types.text().send(`${schema}.${table}`), keyword(') is not null')]),
			types.boolean,
		),
	/** A random UUID. */
	randomUuid: (): Expr<string> => new Expr(keyword('gen_random_uuid()'), types.uuid, true),
};

/** The typed PostgreSQL built-ins, grouped by what they work on. */
export const fn = Object.freeze({ ...rows, ...time, ...numbers, ...text, ...system });

/** A point in time moved by a number of milliseconds, which may be negative. NULL stays NULL. */
export function later<I extends Expr<Temporal.Instant | null, string>, X extends Input<number>>(
	instant: I,
	milliseconds: X,
): Expr<ValueOf<I>, OwnersOf<I> | OwnersOf<X>> {
	const amount = lift(milliseconds as Input<number>, types.double);
	return new Expr(
		join([instant.operand, keyword(' + '), amount.operand, keyword(" * interval '1 millisecond'")]),
		instant.type,
		false,
		union(instant, amount),
	) as never;
}

/** Collations accepted by {@link collate}. `C` orders by bytes, independent of the database locale. */
export type Collation = 'C' | 'POSIX';

/** Compare and order text by a fixed collation. */
export function collate<X extends AnyExpr>(input: X, collation: Collation): Expr<ValueOf<X>, OwnersOf<X>> {
	return new Expr(join([input.operand, keyword(` collate "${collation}"`)]), input.type, false, input.owners) as never;
}
