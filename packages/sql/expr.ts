/**
 * Typed SQL expressions.
 *
 * An {@link Expr} is a piece of SQL that produces one value of a known type. Columns, parameters, function calls and
 * comparisons are all expressions, and each method builds a new one: `messages.state.eq('pending')` is an
 * `Expr<boolean>`. TypeScript checks that both sides of a comparison have the same value type, and the left side's
 * SQL type decides how a plain JavaScript value on the right is sent.
 *
 * Expressions are not statements. A complete `select` becomes an expression only through `scalar`, `exists` or `in`,
 * so a statement cannot land where a value belongs by mistake. Conditions live in `logic.ts`; functions and arithmetic
 * live in `functions.ts`.
 *
 * @module
 */
import { column, type Fragment, group, join, keyword } from './fragment.ts';
import * as types from './type.ts';
import type { SqlType } from './type.ts';

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
	/** This value differs from `other`, where NULL equals NULL: `is distinct from`. */
	distinct(other: Input<T>): Expr<boolean> {
		return new Expr(join([this.operand, keyword(' is distinct from '), lift(other, this.type).operand]), types.boolean);
	}
	/** This value equals `other`, where NULL equals NULL: `is not distinct from`. */
	same(other: Input<T>): Expr<boolean> {
		return new Expr(
			join([this.operand, keyword(' is not distinct from '), lift(other, this.type).operand]),
			types.boolean,
		);
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
