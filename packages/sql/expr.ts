/**
 * Typed SQL expressions.
 *
 * An {@link Expr} is a piece of SQL that produces one value of a known type. Columns, parameters, function calls and
 * comparisons are all expressions, and each method builds a new one: `messages.c.state.eq('pending')` is an
 * `Expr<boolean>`. TypeScript checks that both sides of a comparison have the same value type, and the left side's
 * SQL type decides how a plain JavaScript value on the right is sent.
 *
 * Every expression also knows two more things:
 *
 * - **Its dialect**, through its type. Combining PostgreSQL and another dialect in one expression is an error.
 * - **Its owners**: the tables, aliases and named rows whose columns it reads. The second type parameter carries them,
 *   such as `Expr<boolean, 'app.notes'>`. A statement checks that every owner is in its scope, so a column of a table
 *   the statement does not read fails to type-check and fails when the statement is built.
 *
 * Expressions are not statements. A complete `select` becomes an expression only through `scalar`, `exists` or `in`,
 * so a statement cannot land where a value belongs by mistake. Conditions live in `logic.ts`; functions and arithmetic
 * live in `functions.ts`.
 *
 * @module
 */
import { type Dialect, same } from './dialect.ts';
import { column, type Fragment, group, join, keyword } from './fragment.ts';
import type { SqlType } from './type.ts';

const brand: unique symbol = Symbol('okikio.sql.expr');
/** Phantom key: the owners an expression or statement reads but does not define, as a string union. */
export const reads: unique symbol = Symbol('okikio.sql.reads');

/** A value, or an expression of the same type that reads at most the owners `O`. */
export type Input<T, O extends string = string> = T | Expr<T, O>;

/**
 * The other side of a comparison: a value, or an expression that may be NULL. A comparison with NULL is NULL, which a
 * condition treats as false, so `a.eq(nullableColumn)` is safe. Compare with NULL itself through `isNull`.
 */
export type Operand<T> =
	| NonNullable<T>
	| Expr<T, string>
	| Expr<T | null, string>
	| Expr<NonNullable<T>, string>;

/**
 * The owners an input reads: none for a plain value. It reads the phantom {@link reads} key rather than matching
 * `Expr<T, O>`, because inference through the generic methods of `Expr` widens `O` to `string`.
 */
export type OwnersOf<X> = X extends object ? X extends { readonly [reads]?: infer O } ? Extract<O, string> : never
	: never;

/** The value type an expression produces, read from its SQL type. */
export type ValueOf<X> = X extends { readonly type: SqlType<infer T> } ? T : never;

/**
 * The value type of a one-column subquery's column.
 *
 * Functions that take an expression are generic over the whole expression, as `X extends AnyExpr`, and read its value
 * and owners with {@link ValueOf} and {@link OwnersOf}. Inferring `O` from a parameter typed `Expr<T, O>` does not work
 * for a `Column`, because TypeScript then matches every method of `Expr` and widens `O` to `string`.
 */
export type OnlyOf<Q> = Q extends { readonly shape: infer S } ? ValueOf<{ readonly type: S[keyof S] }> : never;

/** The owners of every input in a list. */
export type OwnersOfAll<L extends readonly unknown[]> = OwnersOf<L[number]>;

/** A statement that can be embedded as a subquery. Implemented by `select` and `unionAll`. */
export interface Subquery<Row, Free extends string = string> {
	/** The statement's SQL. */
	readonly fragment: Fragment;
	/** Phantom row type. */
	readonly row?: Row;
	/** The value types of the selected columns, in order. */
	readonly shape: { readonly [K in keyof Row]: SqlType<Row[K]> };
	/** The dialect the subquery is written in. */
	readonly dialect: Dialect;
	/** Owners the subquery reads but does not define: the outer statement must have them in scope. */
	readonly free: ReadonlySet<string>;
	/** Phantom: {@link Subquery.free} as a type. */
	readonly [reads]?: Free;
}

/** The free owners of a subquery as a type. */
export type FreeOf<Q> = OwnersOf<Q>;

/** One ORDER BY item, with the owners it reads. */
export interface OrderType<O extends string = string> {
	readonly fragment: Fragment;
	readonly owners: ReadonlySet<string>;
	readonly dialect: Dialect;
	readonly [reads]?: O;
}

/** The owner key of a column reference: `schema.table`, an alias, or a named row such as `new`. */
export function key(owner: readonly string[]): string {
	return owner.join('.');
}

/** Every owner of the given parts. */
export function union(...parts: readonly { readonly owners: ReadonlySet<string> }[]): ReadonlySet<string> {
	const out = new Set<string>();
	for (const part of parts) for (const owner of part.owners) out.add(owner);
	return out;
}

const none: ReadonlySet<string> = Object.freeze(new Set<string>());

/** A SQL expression that produces a value of type `T` and reads the owners `O`. */
export class Expr<T, O extends string = never> {
	declare readonly [brand]: true;
	declare readonly [reads]?: O;
	/** The expression's SQL. */
	readonly fragment: Fragment;
	/** The value type, which sends compared values and reads the selected value. */
	readonly type: SqlType<T>;
	/** Whether the SQL needs no parentheses inside a larger expression: a column, parameter, call or cast. */
	readonly atomic: boolean;
	/** The tables, aliases and named rows whose columns this expression reads. */
	readonly owners: ReadonlySet<string>;

	constructor(fragment: Fragment, type: SqlType<T>, atomic = false, owners: ReadonlySet<string> = none) {
		this.fragment = fragment;
		this.type = type;
		this.atomic = atomic;
		this.owners = owners;
	}

	/** The dialect this expression is written in. */
	get dialect(): Dialect {
		return this.type.dialect;
	}

	/** The SQL, in parentheses unless it is atomic. */
	get operand(): Fragment {
		return this.atomic ? this.fragment : group(this.fragment);
	}

	/** This value equals `other`. Compare with NULL through {@link Expr.isNull}, never `eq(null)`. */
	eq<X extends Operand<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' = ', other);
	}
	/** This value differs from `other`. */
	ne<X extends Operand<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' <> ', other);
	}
	/** This value is less than `other`. */
	lt<X extends Operand<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' < ', other);
	}
	/** This value is less than or equal to `other`. */
	lte<X extends Operand<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' <= ', other);
	}
	/** This value is greater than `other`. */
	gt<X extends Operand<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' > ', other);
	}
	/** This value is greater than or equal to `other`. */
	gte<X extends Operand<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' >= ', other);
	}
	/** This value differs from `other`, where NULL equals NULL: `is distinct from`. */
	distinct<X extends Input<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' is distinct from ', other as Operand<T>);
	}
	/** This value equals `other`, where NULL equals NULL: `is not distinct from`. */
	same<X extends Input<T>>(other: X): Expr<boolean, O | OwnersOf<X>> {
		return this.#compare(' is not distinct from ', other as Operand<T>);
	}
	/** This value is SQL NULL. */
	isNull(): Expr<boolean, O> {
		return this.#condition(join([this.operand, keyword(' is null')]), this.owners);
	}
	/** This value is not SQL NULL. */
	isNotNull(): Expr<boolean, O> {
		return this.#condition(join([this.operand, keyword(' is not null')]), this.owners);
	}
	/** This value is one of `values`. An empty list matches nothing. */
	in<const L extends readonly Operand<T>[]>(values: L): Expr<boolean, O | OwnersOfAll<L>>;
	/** This value is one of the rows a one-column subquery returns. */
	in<Q extends Subquery<Readonly<Record<string, T>>>>(subquery: Q): Expr<boolean, O | FreeOf<Q>>;
	in(values: readonly Operand<T>[] | Subquery<Readonly<Record<string, T>>>): Expr<boolean, string> {
		if (Array.isArray(values)) {
			if (values.length === 0) return this.#condition(keyword('false'), none, true);
			const list = values as readonly Operand<T>[];
			const owners = union(this, ...list.filter((item): item is Expr<T, string> => item instanceof Expr));
			return this.#condition(
				join([this.operand, keyword(' in '), group(join(list.map((value) => this.#value(value)), ', '))]),
				owners,
			);
		}
		const subquery = values as Subquery<Readonly<Record<string, T>>>;
		same(this.dialect, subquery.dialect);
		if (Object.keys(subquery.shape).length !== 1) throw new TypeError('An in subquery selects exactly one column.');
		return this.#condition(
			join([this.operand, keyword(' in '), group(subquery.fragment)]),
			union(this, { owners: subquery.free }),
		);
	}
	/** This value lies between `low` and `high`, both included. */
	between<A extends Operand<T>, B extends Operand<T>>(
		low: A,
		high: B,
	): Expr<boolean, O | OwnersOf<A> | OwnersOf<B>> {
		return this.#condition(
			join([this.operand, keyword(' between '), this.#value(low), keyword(' and '), this.#value(high)]),
			union(
				this,
				...([low, high] as readonly Operand<T>[]).filter((item): item is Expr<T, string> => item instanceof Expr),
			),
		);
	}
	/** Convert to another SQL type of the same dialect: `cast(value as type)`. */
	cast<U>(type: SqlType<U>): Expr<U, O> {
		same(this.dialect, type.dialect);
		return new Expr(
			join([keyword('cast('), this.fragment, keyword(` as ${type.name})`)]),
			type,
			true,
			this.owners,
		) as Expr<U, O>;
	}
	/** Ascending order. */
	asc(): OrderType<O> {
		return Object.freeze({
			fragment: join([this.operand, keyword(' asc')]),
			owners: this.owners,
			dialect: this.dialect,
		});
	}
	/** Descending order. */
	desc(): OrderType<O> {
		return Object.freeze({
			fragment: join([this.operand, keyword(' desc')]),
			owners: this.owners,
			dialect: this.dialect,
		});
	}

	/** Send `value` with this expression's type, or embed it when it is already an expression. */
	#value(value: Operand<T> | Input<T>): Fragment {
		if (value instanceof Expr) {
			same(this.dialect, value.dialect);
			return value.operand;
		}
		return this.type.send(value as T);
	}
	#condition(fragment: Fragment, owners: ReadonlySet<string>, atomic = false): Expr<boolean, never> {
		return new Expr(fragment, this.dialect.boolean, atomic, owners);
	}
	#compare(operator: string, other: Operand<T>): Expr<boolean, never> {
		const owners = other instanceof Expr ? union(this, other) : this.owners;
		return this.#condition(join([this.operand, keyword(operator), this.#value(other)]), owners);
	}
}

/** A column of a table, as an expression. Its name is what `insert` and `update` set. */
export class Column<T, O extends string = string> extends Expr<T, O> {
	/** The column's name in its table. */
	readonly name: string;
	constructor(owner: readonly string[], name: string, type: SqlType<T>) {
		super(column(owner, name), type, true, Object.freeze(new Set([key(owner)])));
		this.name = name;
	}
}

/** Any expression; used where only the SQL matters. */
// deno-lint-ignore no-explicit-any
export type AnyExpr = Expr<any, string>;

/** Whether a value is an expression. */
export function isExpr(value: unknown): value is AnyExpr {
	return value instanceof Expr;
}

/** A parameter of a given type. It reads no owners. */
export function value<T>(input: T, type: SqlType<T>): Expr<T> {
	return new Expr(type.send(input), type, true);
}

/** Embed a value of a known type, sending it when it is not an expression yet. */
export function lift<T, O extends string = never>(input: T | Expr<T, O>, type: SqlType<T>): Expr<T, O> {
	if (input instanceof Expr) {
		same(input.dialect, type.dialect);
		return input;
	}
	return value(input as T, type) as Expr<T, O>;
}
