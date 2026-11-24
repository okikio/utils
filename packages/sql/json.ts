/**
 * `jsonb` operators, typed by what they return.
 *
 * @module
 */
import { type Expr, Expr as Value, type Input, lift } from './expr.ts';
import { group, join, keyword } from './fragment.ts';
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

/** `jsonb_typeof(value)`: `object`, `array`, `string`, `number`, `boolean` or `null`. */
export function kind(value: Expr<unknown>): Expr<string | null> {
	return new Value(join([keyword('jsonb_typeof'), group(value.fragment)]), types.nullable(types.text()), true);
}
