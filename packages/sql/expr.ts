/**
 * Typed SQL expressions.
 *
 * An {@link Expr} is a piece of SQL that produces one value of a known type. Columns, parameters, function calls and
 * comparisons are all expressions, and each method builds a new one: `messages.state.eq('pending')` is an
 * `Expr<boolean>`. TypeScript checks that both sides of a comparison have the same value type, and the left side's
 * SQL type decides how a plain JavaScript value on the right is sent.
 *
 * Expressions are not statements. A complete `select` becomes an expression only through {@link scalar},
 * {@link exists} or `in`, so a statement cannot land where a value belongs by mistake.
 *
 * @module
 */
import { column, type Fragment, group, identifier, join, keyword, qualified } from './fragment.ts';
import * as types from './type.ts';
import type { SqlType } from './type.ts';
import type { Temporal } from '@okikio/duration/temporal';

const brand: unique symbol = Symbol('okikio.sql.expr');

/** A value, or an expression of the same type. */
export type Input<T> = T | Expr<T>;

/** A statement that can be embedded as a subquery. Implemented by `select`. */
export interface Subquery<Row> {
	/** The statement's SQL. */
	readonly fragment: Fragment;
	/** Phantom row type. */
	readonly row?: Row;
	/** The value types of the selected columns, in order. */
	readonly shape: { readonly [K in keyof Row]: SqlType<Row[K]> };
}

/** Collations accepted by {@link Expr.collate}. `C` orders by bytes, independent of the database locale. */
export type Collation = 'C' | 'POSIX';

/** One ORDER BY item. */
export interface OrderType {
	readonly fragment: Fragment;
}

/** A SQL expression that produces a value of type `T`. */
export class Expr<T> {
	declare readonly [brand]: true;
	/** The expression's SQL. */
	readonly fragment: Fragment;
	/** The value type, which sends compared values and reads the selected value. */
	readonly type: SqlType<T>;
	/** Whether the SQL needs no parentheses inside a larger expression: a column, parameter, call or cast. */
	readonly atomic: boolean;

	constructor(fragment: Fragment, type: SqlType<T>, atomic = false) {
		this.fragment = fragment;
		this.type = type;
		this.atomic = atomic;
	}

	/** The SQL, in parentheses unless it is atomic. */
	get operand(): Fragment {
		return this.atomic ? this.fragment : group(this.fragment);
	}

	/** This value equals `other`. Compare with NULL through {@link Expr.isNull}, never `eq(null)`. */
	eq(other: Input<NonNullable<T>>): Expr<boolean> {
		return this.#compare(' = ', other);
	}
	/** This value differs from `other`. */
	ne(other: Input<NonNullable<T>>): Expr<boolean> {
		return this.#compare(' <> ', other);
	}
	/** This value is less than `other`. */
	lt(other: Input<NonNullable<T>>): Expr<boolean> {
		return this.#compare(' < ', other);
	}
	/** This value is less than or equal to `other`. */
	lte(other: Input<NonNullable<T>>): Expr<boolean> {
		return this.#compare(' <= ', other);
	}
	/** This value is greater than `other`. */
	gt(other: Input<NonNullable<T>>): Expr<boolean> {
		return this.#compare(' > ', other);
	}
	/** This value is greater than or equal to `other`. */
	gte(other: Input<NonNullable<T>>): Expr<boolean> {
		return this.#compare(' >= ', other);
	}
	/** This value is SQL NULL. */
	isNull(): Expr<boolean> {
		return new Expr(join([this.operand, keyword(' is null')]), types.boolean);
	}
	/** This value is not SQL NULL. */
	isNotNull(): Expr<boolean> {
		return new Expr(join([this.operand, keyword(' is not null')]), types.boolean);
	}
	/** This value is one of `values`, or one of the rows a one-column subquery returns. An empty list matches nothing. */
	in(values: readonly Input<NonNullable<T>>[] | Subquery<Readonly<Record<string, T>>>): Expr<boolean> {
		if (Array.isArray(values)) {
			if (values.length === 0) return new Expr(keyword('false'), types.boolean, true);
			const list = join(values.map((value) => this.#value(value)), ', ');
			return new Expr(join([this.operand, keyword(' in '), group(list)]), types.boolean);
		}
		const subquery = values as Subquery<Readonly<Record<string, T>>>;
		if (Object.keys(subquery.shape).length !== 1) throw new TypeError('An in subquery selects exactly one column.');
		return new Expr(join([this.operand, keyword(' in '), group(subquery.fragment)]), types.boolean);
	}
	/** This value lies between `low` and `high`, both included. */
	between(low: Input<NonNullable<T>>, high: Input<NonNullable<T>>): Expr<boolean> {
		return new Expr(
			join([this.operand, keyword(' between '), this.#value(low), keyword(' and '), this.#value(high)]),
			types.boolean,
		);
	}
	/** Convert to another SQL type. */
	cast<U>(type: SqlType<U>): Expr<U> {
		return new Expr(join([this.operand, keyword(`::${type.name}`)]), type, true);
	}
	/** Compare and order text by a fixed collation. */
	collate(collation: Collation): Expr<T> {
		return new Expr(join([this.operand, keyword(` collate "${collation}"`)]), this.type);
	}
	/** Ascending order. */
	asc(): OrderType {
		return Object.freeze({ fragment: join([this.operand, keyword(' asc')]) });
	}
	/** Descending order. */
	desc(): OrderType {
		return Object.freeze({ fragment: join([this.operand, keyword(' desc')]) });
	}

	/** Send `value` with this expression's type, or embed it when it is already an expression. */
	#value(value: Input<NonNullable<T>>): Fragment {
		return value instanceof Expr ? value.operand : this.type.send(value as T);
	}
	#compare(operator: string, other: Input<NonNullable<T>>): Expr<boolean> {
		return new Expr(join([this.operand, keyword(operator), this.#value(other)]), types.boolean);
	}
}

/** A column of a table, as an expression. Its name is what `insert` and `update` set. */
export class Column<T> extends Expr<T> {
	/** The column's name in its table. */
	readonly name: string;
	constructor(owner: readonly string[], name: string, type: SqlType<T>) {
		super(column(owner, name), type, true);
		this.name = name;
	}
}

/** Any expression; used where only the SQL matters. */
// deno-lint-ignore no-explicit-any
export type AnyExpr = Expr<any>;

/** Whether a value is an expression. */
export function isExpr(value: unknown): value is AnyExpr {
	return value instanceof Expr;
}

/** A parameter of a given type. */
export function value<T>(input: T, type: SqlType<T>): Expr<T> {
	return new Expr(type.send(input), type, true);
}

/** Embed a value of a known type, sending it when it is not an expression yet. */
export function lift<T>(input: Input<T>, type: SqlType<T>): Expr<T> {
	return input instanceof Expr ? input : value(input, type);
}

/** Combine conditions; every one must hold. No conditions is `true`. */
export function and(...conditions: readonly Expr<boolean>[]): Expr<boolean> {
	if (conditions.length === 0) return new Expr(keyword('true'), types.boolean, true);
	if (conditions.length === 1) return conditions[0]!;
	return new Expr(join(conditions.map((item) => item.operand), ' and '), types.boolean);
}

/** Combine conditions; at least one must hold. No conditions is `false`. */
export function or(...conditions: readonly Expr<boolean>[]): Expr<boolean> {
	if (conditions.length === 0) return new Expr(keyword('false'), types.boolean, true);
	if (conditions.length === 1) return conditions[0]!;
	return new Expr(join(conditions.map((item) => item.operand), ' or '), types.boolean);
}

/** The condition does not hold. */
export function not(condition: Expr<boolean>): Expr<boolean> {
	return new Expr(join([keyword('not '), condition.operand]), types.boolean);
}

/** The subquery returns at least one row. */
export function exists(subquery: Subquery<unknown>): Expr<boolean> {
	return new Expr(join([keyword('exists '), group(subquery.fragment)]), types.boolean, true);
}

/** The single value of a one-column, at-most-one-row subquery. NULL when it returns no row. */
export function scalar<T>(subquery: Subquery<Readonly<Record<string, T>>>): Expr<T | null> {
	const shape = Object.values(subquery.shape) as SqlType<T>[];
	if (shape.length !== 1) throw new TypeError('A scalar subquery selects exactly one column.');
	return new Expr(group(subquery.fragment), types.nullable(shape[0]!), true);
}

/** The first non-NULL value. The result is non-NULL when the last input is. */
export function coalesce<T>(first: Expr<T | null>, ...rest: readonly Input<T>[]): Expr<T> {
	const type = first.type as SqlType<T>;
	const items = [first.fragment, ...rest.map((item) => lift(item, type).fragment)];
	return new Expr(join([keyword('coalesce('), join(items, ', '), keyword(')')]), type, true);
}

/** Compare row values element by element, for keyset pagination such as `(id, key) > ($1, $2)`. */
export function row<const T extends readonly AnyExpr[]>(...items: T): RowExpr<T> {
	return new RowExpr(items);
}

/** A row value, compared element by element. */
export class RowExpr<T extends readonly AnyExpr[]> {
	readonly #items: T;
	constructor(items: T) {
		this.#items = items;
	}
	/** This row sorts after `other`. */
	gt(other: { readonly [K in keyof T]: T[K] extends Expr<infer V> ? Input<V> : never }): Expr<boolean> {
		const left = join(this.#items.map((item) => item.operand), ', ');
		const right = join(this.#items.map((item, index) => lift(other[index], item.type).operand), ', ');
		return new Expr(join([group(left), keyword(' > '), group(right)]), types.boolean);
	}
	/** This row is one of the rows a subquery with the same number of columns returns. */
	in(subquery: Subquery<unknown>): Expr<boolean> {
		if (Object.keys(subquery.shape).length !== this.#items.length) {
			throw new TypeError('A row in subquery selects one column for each row item.');
		}
		const left = join(this.#items.map((item) => item.operand), ', ');
		return new Expr(join([group(left), keyword(' in '), group(subquery.fragment)]), types.boolean);
	}
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
	/** The number of rows. */
	count: (): Expr<number> => new Expr(keyword('count(*)::integer'), types.integer, true),
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
