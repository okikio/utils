/**
 * Conditions and choices: `and`, `or`, `not`, subquery tests, row comparisons and `case`.
 *
 * @module
 */
import { type AnyExpr, Expr, type Input, lift, type Subquery } from './expr.ts';
import { group, join, keyword } from './fragment.ts';
import * as types from './type.ts';
import type { SqlType } from './type.ts';

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

/**
 * The value of a one-column aggregate subquery without `group by`, such as `select max(…) from …`. Such a subquery
 * always returns exactly one row, so the value is not NULL when the aggregate is not.
 */
export function aggregate<T>(subquery: Subquery<Readonly<Record<string, T>>>): Expr<T> {
	const shape = Object.values(subquery.shape) as SqlType<T>[];
	if (shape.length !== 1) throw new TypeError('An aggregate subquery selects exactly one column.');
	return new Expr(group(subquery.fragment), shape[0]!, true);
}

/** The single value of a one-column, at-most-one-row subquery. NULL when it returns no row. */
export function scalar<T>(subquery: Subquery<Readonly<Record<string, T>>>): Expr<T | null> {
	const shape = Object.values(subquery.shape) as SqlType<T>[];
	if (shape.length !== 1) throw new TypeError('A scalar subquery selects exactly one column.');
	return new Expr(group(subquery.fragment), types.nullable(shape[0]!), true);
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
	/** Some item of this row differs from the same item of `other`, where NULL equals NULL. */
	distinct(other: RowExpr<T>): Expr<boolean> {
		return new Expr(join([this.#list(), keyword(' is distinct from '), other.#list()]), types.boolean);
	}
	/** Every item of this row equals the same item of `other`, where NULL equals NULL. */
	same(other: RowExpr<T>): Expr<boolean> {
		return new Expr(join([this.#list(), keyword(' is not distinct from '), other.#list()]), types.boolean);
	}
	#list() {
		return join([keyword('row'), group(join(this.#items.map((item) => item.operand), ', '))]);
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

/**
 * `case when condition then value else otherwise end`: one of two values of the same type.
 *
 * @example
 * ```ts
 * // Keep an advancing run's state; make any other run ready.
 * sql.update(runs, { state: sql.choose(r.state.eq('advancing'), r.state, 'ready') });
 * ```
 */
export function choose<T>(condition: Expr<boolean>, then: Expr<T>, otherwise: null): Expr<T | null>;
export function choose<T>(condition: Expr<boolean>, then: Expr<T>, otherwise: Input<T>): Expr<T>;
export function choose<T>(condition: Expr<boolean>, then: Expr<T>, otherwise: Input<T> | null): Expr<T | null> {
	const type: SqlType<T | null> = otherwise === null ? types.nullable(then.type) : then.type;
	return new Expr(
		join([
			keyword('case when '),
			condition.fragment,
			keyword(' then '),
			then.fragment,
			keyword(' else '),
			lift(otherwise, type).fragment,
			keyword(' end'),
		]),
		type,
		true,
	);
}

/** SQL NULL of a type, for a branch of {@link choose} that has no value. */
export function nothing<T>(type: SqlType<T>): Expr<T | null> {
	return new Expr(join([keyword('null::'), keyword(type.name)]), types.nullable(type), true);
}
