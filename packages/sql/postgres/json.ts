/**
 * `jsonb` operators, typed by what they return. Each result reads the owners of its inputs.
 *
 * @module
 */
import { type AnyExpr, Column, Expr, type Input, lift, type OwnersOf, type OwnersOfAll, union } from '../expr.ts';
import { type Fragment, group, identifier, join, keyword } from '../fragment.ts';
import type { CallSourceType } from '../statement.ts';
import { dialect } from './dialect.ts';
import * as types from './types.ts';

function binary(left: AnyExpr, operator: string, right: AnyExpr, type: types.SqlType<unknown>): never {
	return new Expr(join([left.operand, keyword(operator), right.operand]), type, false, union(left, right)) as never;
}

function call(name: string, items: readonly AnyExpr[], type: types.SqlType<unknown>): never {
	return new Expr(
		join([keyword(`${name}(`), join(items.map((item) => item.fragment), ', '), keyword(')')]),
		type,
		true,
		union(...items),
	) as never;
}

/** `value -> key`: a member as `jsonb`, or NULL when it is absent. */
export function get<X extends AnyExpr, K extends Input<string>>(
	value: X,
	key: K,
): Expr<unknown, OwnersOf<X> | OwnersOf<K>> {
	return binary(value, ' -> ', lift(key, types.text()), types.nullable(types.jsonb()));
}

/** `value ->> key`: a member as text, or NULL when it is absent. */
export function text<X extends AnyExpr, K extends Input<string>>(
	value: X,
	key: K,
): Expr<string | null, OwnersOf<X> | OwnersOf<K>> {
	return binary(value, ' ->> ', lift(key, types.text()), types.nullable(types.text()));
}

/** `value ?& array[...]`: the object has every listed key. */
export function hasAll<X extends AnyExpr>(value: X, keys: readonly string[]): Expr<boolean, OwnersOf<X>> {
	const list = join(keys.map((key) => lift(key, types.text()).operand), ', ');
	return new Expr(
		join([value.operand, keyword(' ?& array['), list, keyword(']')]),
		types.boolean,
		false,
		value.owners,
	) as never;
}

/** `jsonb_array_length(value)`: the number of elements of a `jsonb` array. */
export function length<X extends AnyExpr>(value: X): Expr<number, OwnersOf<X>> {
	return call('jsonb_array_length', [value], types.integer);
}

/** `jsonb_typeof(value)`: `object`, `array`, `string`, `number`, `boolean` or `null`. */
export function kind<X extends AnyExpr>(value: X): Expr<string | null, OwnersOf<X>> {
	return call('jsonb_typeof', [value], types.nullable(types.text()));
}

/** `left @> right`: `left` contains `right`, as PostgreSQL defines `jsonb` containment. */
export function contains<L extends AnyExpr, X extends Input<unknown>>(
	left: L,
	right: X,
): Expr<boolean, OwnersOf<L> | OwnersOf<X>> {
	return binary(left, ' @> ', lift(right, types.jsonb()), types.boolean);
}

/** `left <@ right`: `left` is contained in `right`. */
export function within<L extends AnyExpr, X extends Input<unknown>>(
	left: L,
	right: X,
): Expr<boolean, OwnersOf<L> | OwnersOf<X>> {
	return binary(left, ' <@ ', lift(right, types.jsonb()), types.boolean);
}

/** `jsonb_build_array(...)`: an array of the given values, built in SQL from columns or parameters. */
export function array<const L extends readonly AnyExpr[]>(...items: L): Expr<unknown, OwnersOfAll<L>> {
	return call('jsonb_build_array', items, types.jsonb());
}

/** `jsonb_build_object(...)`: an object of the given members, built in SQL from columns or parameters. */
export function object<const M extends Readonly<Record<string, AnyExpr>>>(
	members: M,
): Expr<unknown, OwnersOf<M[keyof M]>> {
	const values = Object.values(members);
	const items = Object.entries(members).map(([key, item]) =>
		join([lift(key, types.text()).fragment, keyword(', '), item.fragment])
	);
	return new Expr(
		join([keyword('jsonb_build_object('), join(items, ', '), keyword(')')]),
		types.jsonb(),
		true,
		union(...values),
	);
}

/** The elements of a `jsonb` array as rows, read in a statement's `from` like a table under `alias`. */
export interface ElementsType<A extends string = string, O extends string = string> extends CallSourceType<A, O> {
	/** `value` is one element. */
	readonly c: { readonly value: Column<unknown, A> };
}

/**
 * `jsonb_array_elements(value) as alias`: one row per array element. Use it with `exists` to test the elements. The
 * array may read an outer statement's columns; the select that reads the elements then needs them in scope.
 *
 * @example
 * ```ts ignore
 * const d = json.elements(sql.value(definitions, types.jsonb()), 'd');
 * sql.exists(sql.select({}).from(d).where(json.text(d.c.value, 'id').eq(runs.c.definition)));
 * ```
 */
export function elements<const A extends string, X extends AnyExpr>(
	value: X,
	alias: A,
): ElementsType<A, OwnersOf<X>> {
	identifier(alias);
	const fragment: Fragment = join([keyword('jsonb_array_elements'), group(value.fragment)]);
	return Object.freeze({
		alias,
		key: alias,
		dialect,
		call: fragment,
		owners: value.owners,
		c: Object.freeze({ value: new Column<unknown, A>([alias], 'value', types.jsonb()) }),
	});
}
