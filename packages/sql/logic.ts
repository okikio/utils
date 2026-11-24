/**
 * Conditions and choices in standard SQL: `and`, `or`, `not`, subquery tests, row comparisons and `case`.
 *
 * Each function takes its dialect from its operands and merges their owners, so a condition carries every table it
 * reads into the statement that uses it.
 *
 * @module
 */
import { same } from './dialect.ts';
import {
	type AnyExpr,
	Expr,
	type FreeOf,
	type Input,
	lift,
	type OnlyOf,
	type OwnersOf,
	type OwnersOfAll,
	type Subquery,
	union,
	type ValueOf,
} from './expr.ts';
import { group, join, keyword } from './fragment.ts';
import { nullable, type SqlType } from './type.ts';

/** Condition owners as a type. */
type Conditions = readonly [Expr<boolean, string>, ...Expr<boolean, string>[]];

/** Combine at least one condition with a fixed operator. */
function combine(operator: string, conditions: readonly Expr<boolean, string>[]): Expr<boolean, string> {
	if (conditions.length === 0) throw new TypeError('Combine at least one condition.');
	const [first, ...rest] = conditions;
	for (const item of rest) same(first!.dialect, item.dialect);
	if (rest.length === 0) return first!;
	return new Expr(
		join(conditions.map((item) => item.operand), operator),
		first!.dialect.boolean,
		false,
		union(...conditions),
	);
}

/** Every condition holds. */
export function and<const C extends Conditions>(...conditions: C): Expr<boolean, OwnersOfAll<C>> {
	return combine(' and ', conditions) as Expr<boolean, OwnersOfAll<C>>;
}

/** At least one condition holds. */
export function or<const C extends Conditions>(...conditions: C): Expr<boolean, OwnersOfAll<C>> {
	return combine(' or ', conditions) as Expr<boolean, OwnersOfAll<C>>;
}

/** The condition does not hold. */
export function not<X extends Expr<boolean, string>>(condition: X): Expr<boolean, OwnersOf<X>> {
	return new Expr(join([keyword('not '), condition.operand]), condition.type, false, condition.owners) as never;
}

/** The subquery returns at least one row. Its outer references become the condition's owners. */
export function exists<Q extends Subquery<unknown>>(subquery: Q): Expr<boolean, FreeOf<Q>> {
	return new Expr(join([keyword('exists '), group(subquery.fragment)]), subquery.dialect.boolean, true, subquery.free);
}

/** The single type of a one-column subquery. */
function only(subquery: Subquery<unknown>, what: string): SqlType<unknown> {
	const shape = Object.values(subquery.shape as object) as SqlType<unknown>[];
	if (shape.length !== 1) throw new TypeError(`${what} subquery selects exactly one column.`);
	return shape[0]!;
}

/**
 * The value of a one-column aggregate subquery without `group by`, such as `select max(…) from …`. Such a subquery
 * always returns exactly one row, so the value is not NULL when the aggregate is not.
 */
export function aggregate<Q extends Subquery<unknown>>(subquery: Q): Expr<OnlyOf<Q>, FreeOf<Q>> {
	return new Expr(group(subquery.fragment), only(subquery, 'An aggregate'), true, subquery.free) as never;
}

/** The single value of a one-column, at-most-one-row subquery. NULL when it returns no row. */
export function scalar<Q extends Subquery<unknown>>(subquery: Q): Expr<OnlyOf<Q> | null, FreeOf<Q>> {
	return new Expr(group(subquery.fragment), nullable(only(subquery, 'A scalar')), true, subquery.free) as never;
}

/** Compare row values element by element, for keyset pagination such as `(id, key) > ($1, $2)`. */
export function row<const T extends readonly AnyExpr[]>(...items: T): RowExpr<T> {
	if (items.length === 0) throw new TypeError('A row needs at least one item.');
	return new RowExpr(items);
}

/** The values a row comparison takes, one per item. */
type RowValues<T extends readonly AnyExpr[]> = { readonly [K in keyof T]: Input<ValueOf<T[K]>> };

/** A row value, compared element by element. */
export class RowExpr<T extends readonly AnyExpr[]> {
	readonly #items: T;
	constructor(items: T) {
		this.#items = items;
		for (const item of items.slice(1)) same(items[0]!.dialect, item.dialect);
	}
	get #dialect() {
		return this.#items[0]!.dialect;
	}
	#list() {
		return join([keyword('row'), group(join(this.#items.map((item) => item.operand), ', '))]);
	}
	#condition(fragment: ReturnType<typeof join>, ...more: readonly { readonly owners: ReadonlySet<string> }[]) {
		return new Expr(fragment, this.#dialect.boolean, false, union(...this.#items, ...more));
	}
	/** This row sorts after `other`. */
	gt<const V extends RowValues<T>>(other: V): Expr<boolean, OwnersOfAll<T> | OwnersOfAll<V>> {
		const values = this.#items.map((item, index) => lift(other[index] as Input<unknown>, item.type));
		const left = join(this.#items.map((item) => item.operand), ', ');
		const right = join(values.map((item) => item.operand), ', ');
		return this.#condition(join([group(left), keyword(' > '), group(right)]), ...values) as never;
	}
	/** Some item of this row differs from the same item of `other`, where NULL equals NULL. */
	distinct<U extends readonly AnyExpr[]>(other: RowExpr<U>): Expr<boolean, OwnersOfAll<T> | OwnersOfAll<U>> {
		same(this.#dialect, other.#dialect);
		return this.#condition(
			join([this.#list(), keyword(' is distinct from '), other.#list()]),
			...other.#items,
		) as never;
	}
	/** Every item of this row equals the same item of `other`, where NULL equals NULL. */
	same<U extends readonly AnyExpr[]>(other: RowExpr<U>): Expr<boolean, OwnersOfAll<T> | OwnersOfAll<U>> {
		same(this.#dialect, other.#dialect);
		return this.#condition(
			join([this.#list(), keyword(' is not distinct from '), other.#list()]),
			...other.#items,
		) as never;
	}
	/** This row is one of the rows a subquery with the same number of columns returns. */
	in<Q extends Subquery<unknown>>(subquery: Q): Expr<boolean, OwnersOfAll<T> | FreeOf<Q>> {
		same(this.#dialect, subquery.dialect);
		if (Object.keys(subquery.shape).length !== this.#items.length) {
			throw new TypeError('A row in subquery selects one column for each row item.');
		}
		const left = join(this.#items.map((item) => item.operand), ', ');
		return this.#condition(join([group(left), keyword(' in '), group(subquery.fragment)]), {
			owners: subquery.free,
		}) as never;
	}
}

/**
 * `case when condition then value else otherwise end`: one of two values of the same type.
 *
 * @example
 * ```ts ignore
 * // Keep an advancing run's state; make any other run ready.
 * sql.update(runs, { state: sql.choose(r.state.eq('advancing'), r.state, 'ready') });
 * ```
 */
export function choose<C extends Expr<boolean, string>, V extends AnyExpr>(
	condition: C,
	then: V,
	otherwise: null,
): Expr<ValueOf<V> | null, OwnersOf<C> | OwnersOf<V>>;
export function choose<C extends Expr<boolean, string>, V extends AnyExpr, const X extends Input<ValueOf<V>>>(
	condition: C,
	then: V,
	otherwise: X,
): Expr<ValueOf<V>, OwnersOf<C> | OwnersOf<V> | OwnersOf<X>>;
export function choose<T>(
	condition: Expr<boolean, string>,
	then: Expr<T, string>,
	otherwise: Input<T> | null,
): Expr<T | null, string> {
	same(condition.dialect, then.dialect);
	const type: SqlType<T | null> = otherwise === null ? nullable(then.type) : then.type;
	const other = lift(otherwise as Input<T | null>, type);
	return new Expr(
		join([
			keyword('case when '),
			condition.fragment,
			keyword(' then '),
			then.fragment,
			keyword(' else '),
			other.fragment,
			keyword(' end'),
		]),
		type,
		true,
		union(condition, then, other),
	);
}

/** SQL NULL of a type, for a branch of {@link choose} that has no value. */
export function nothing<T>(type: SqlType<T>): Expr<T | null> {
	return new Expr(join([keyword('cast(null as '), keyword(type.name), keyword(')')]), nullable(type), true);
}
