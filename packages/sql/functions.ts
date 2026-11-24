/**
 * Functions every SQL dialect shares, and the means to type any other function.
 *
 * Built-in function catalogs differ a lot between dialects, so the core keeps only `coalesce`, arithmetic, `min`,
 * `max` and `sum`. Each dialect's entry point has a typed catalog of the built-ins it uses, such as
 * `@okikio/sql/postgres`'s `fn`. {@link declare} types any other function, including an application's own, so no
 * catalog has to hold every built-in.
 *
 * @module
 */
import { same } from './dialect.ts';
import { type AnyExpr, Expr, type Input, lift, type OwnersOf, type OwnersOfAll, union, type ValueOf } from './expr.ts';
import { type Fragment, identifier, join, keyword, qualified } from './fragment.ts';
import { nullable, type SqlType } from './type.ts';

/**
 * A call of a function with a fixed name, for a dialect catalog: `name(arg, …)` typed as `result`. Only call it with
 * constant names from this package.
 */
export function call<R>(name: string, args: readonly Expr<unknown, string>[], result: SqlType<R>): Expr<R, string> {
	for (const arg of args) same(result.dialect, arg.dialect);
	return new Expr(
		join([keyword(`${name}(`), join(args.map((arg) => arg.fragment), ', '), keyword(')')]),
		result,
		true,
		union(...args),
	);
}

/** The first non-NULL value. The result is non-NULL when the last input is. */
export function coalesce<X extends AnyExpr, const R extends readonly Input<NonNullable<ValueOf<X>>>[]>(
	first: X,
	...rest: R
): Expr<NonNullable<ValueOf<X>>, OwnersOf<X> | OwnersOfAll<R>> {
	const type = first.type as SqlType<unknown>;
	const items = [first, ...rest.map((item) => lift(item as Input<unknown>, type))];
	return call('coalesce', items, type) as never;
}

/**
 * `cast(left op right as <left's type>)`. The cast keeps the result in the left operand's type, as the TypeScript type
 * says; CockroachDB, for one, widens `int4 + int4` to `int8`, which a recursive query then rejects.
 */
function arithmetic(operator: string, left: Expr<number, string>, right: Input<number>): Expr<number, string> {
	const other = lift(right, left.type);
	const fragment = join([
		keyword('cast('),
		left.operand,
		keyword(operator),
		other.operand,
		keyword(` as ${left.type.name})`),
	]);
	return new Expr(fragment, left.type, true, union(left, other));
}

/** Number addition. */
export function add<L extends Expr<number, string>, X extends Input<number>>(
	left: L,
	right: X,
): Expr<number, OwnersOf<L> | OwnersOf<X>> {
	return arithmetic(' + ', left, right as Input<number>) as never;
}
/** Number subtraction. */
export function subtract<L extends Expr<number, string>, X extends Input<number>>(
	left: L,
	right: X,
): Expr<number, OwnersOf<L> | OwnersOf<X>> {
	return arithmetic(' - ', left, right as Input<number>) as never;
}
/** Number multiplication. */
export function multiply<L extends Expr<number, string>, X extends Input<number>>(
	left: L,
	right: X,
): Expr<number, OwnersOf<L> | OwnersOf<X>> {
	return arithmetic(' * ', left, right as Input<number>) as never;
}

/** The largest value, or NULL for no rows. */
export function max<X extends AnyExpr>(input: X): Expr<ValueOf<X> | null, OwnersOf<X>> {
	return call('max', [input], nullable(input.type)) as never;
}

/** The smallest value, or NULL for no rows. */
export function min<X extends AnyExpr>(input: X): Expr<ValueOf<X> | null, OwnersOf<X>> {
	return call('min', [input], nullable(input.type)) as never;
}

/** The sum of the values, ignoring NULL, or NULL when there are none, cast back to the input's type. */
export function sum<X extends Expr<number | bigint | null, string>>(
	input: X,
): Expr<NonNullable<ValueOf<X>> | null, OwnersOf<X>> {
	const total: Fragment = join([keyword('cast(sum('), input.fragment, keyword(`) as ${input.type.name})`)]);
	return new Expr(total, nullable(input.type), true, input.owners) as never;
}

/**
 * Declare a SQL function with typed arguments and result, then call it like a JavaScript function. The name is
 * checked as an identifier; a schema-qualified name takes two parts. The result type decides the dialect.
 *
 * @example
 * ```ts ignore
 * const hash = sql.declare('hashtextextended', [types.text(), types.bigint], types.bigint);
 * const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);
 * const statement = sql.select({ locked: lock(hash(`outbox:${namespace}`, 0n)) });
 * ```
 */
export function declare<const A extends readonly unknown[], R>(
	name: string | readonly [schema: string, name: string],
	parameters: { readonly [K in keyof A]: SqlType<A[K]> },
	result: SqlType<R>,
): <const I extends { readonly [K in keyof A]: Input<A[K]> }>(...args: I) => Expr<R, OwnersOfAll<I>> {
	const callee = typeof name === 'string' ? identifier(name) : qualified(...name);
	return (...args) => {
		const list = args.map((arg, index) => lift(arg, (parameters as readonly SqlType<unknown>[])[index]!));
		for (const item of list) same(result.dialect, item.dialect);
		return new Expr(
			join([callee, keyword('('), join(list.map((item) => item.fragment), ', '), keyword(')')]),
			result,
			true,
			union(...list),
		) as never;
	};
}
