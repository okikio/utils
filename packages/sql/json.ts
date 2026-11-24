/**
 * `jsonb` operators, typed by what they return.
 *
 * @module
 */
import { type AnyExpr, Column, type Expr, Expr as Value, type Input, lift } from './expr.ts';
import { type Fragment, group, identifier, join, keyword } from './fragment.ts';
import * as types from './type.ts';

/** `value -> key`: a member as `jsonb`, or NULL when it is absent. */
export function get(value: Expr<unknown>, key: Input<string>): Expr<unknown> {
	return new Value(
		join([value.operand, keyword(' -> '), lift(key, types.text()).operand]),
		types.nullable(types.jsonb()),
	);
}

/** `value ->> key`: a member as text, or NULL when it is absent. */
export function text(value: Expr<unknown>, key: Input<string>): Expr<string | null> {
	return new Value(
		join([value.operand, keyword(' ->> '), lift(key, types.text()).operand]),
		types.nullable(types.text()),
	);
}

/** `value ?& array[...]`: the object has every listed key. */
export function hasAll(value: Expr<unknown>, keys: readonly string[]): Expr<boolean> {
	const list = join(keys.map((key) => lift(key, types.text()).operand), ', ');
	return new Value(join([value.operand, keyword(' ?& array['), list, keyword(']')]), types.boolean);
}

/** `jsonb_array_length(value)`: the number of elements of a `jsonb` array. */
export function length(value: Expr<unknown>): Expr<number> {
	return new Value(join([keyword('jsonb_array_length'), group(value.fragment)]), types.integer, true);
}

/** `jsonb_typeof(value)`: `object`, `array`, `string`, `number`, `boolean` or `null`. */
export function kind(value: Expr<unknown>): Expr<string | null> {
	return new Value(join([keyword('jsonb_typeof'), group(value.fragment)]), types.nullable(types.text()), true);
}

/** `left @> right`: `left` contains `right`, as PostgreSQL defines `jsonb` containment. */
export function contains(left: Expr<unknown>, right: Input<unknown>): Expr<boolean> {
	return new Value(join([left.operand, keyword(' @> '), lift(right, types.jsonb()).operand]), types.boolean);
}

/** `left <@ right`: `left` is contained in `right`. */
export function within(left: Expr<unknown>, right: Input<unknown>): Expr<boolean> {
	return new Value(join([left.operand, keyword(' <@ '), lift(right, types.jsonb()).operand]), types.boolean);
}

/** `jsonb_build_array(...)`: an array of the given values, built in SQL from columns or parameters. */
export function array(...items: readonly AnyExpr[]): Expr<unknown> {
	return new Value(
		join([keyword('jsonb_build_array('), join(items.map((item) => item.fragment), ', '), keyword(')')]),
		types.jsonb(),
		true,
	);
}

/** `jsonb_build_object(...)`: an object of the given members, built in SQL from columns or parameters. */
export function object(members: Readonly<Record<string, AnyExpr>>): Expr<unknown> {
	const items = Object.entries(members).map(([key, item]) =>
		join([lift(key, types.text()).fragment, keyword(', '), item.fragment])
	);
	return new Value(join([keyword('jsonb_build_object('), join(items, ', '), keyword(')')]), types.jsonb(), true);
}

/** The elements of a `jsonb` array as rows, read in a statement's `from` like a table. */
export interface ElementsType {
	/** The name that refers to the rows in the statement. */
	readonly alias: string;
	/** `jsonb_array_elements(...)`. */
	readonly call: Fragment;
	/** `value` is one element. */
	readonly c: { readonly value: Column<unknown> };
}

/**
 * `jsonb_array_elements(value) as alias`: one row per array element. Use it with `exists` to test the elements.
 *
 * @example
 * ```ts ignore
 * const d = json.elements(sql.value(definitions, types.jsonb()), 'd');
 * sql.exists(sql.select({}).from(d).where(json.text(d.c.value, 'id').eq(runs.c.definition)));
 * ```
 */
export function elements(value: Expr<unknown>, alias: string): ElementsType {
	identifier(alias);
	return Object.freeze({
		alias,
		call: join([keyword('jsonb_array_elements'), group(value.fragment)]),
		c: Object.freeze({ value: new Column([alias], 'value', types.jsonb()) }),
	});
}
