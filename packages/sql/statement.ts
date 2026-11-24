/**
 * What every complete statement shares: its SQL, its result types, the sources it reads and the named subqueries
 * (`with`) it defines first.
 *
 * The builders live in `select.ts` and `write.ts`. Each builder is immutable: a method returns a new builder. A
 * statement knows the type of every column it returns, so running it gives typed rows. A statement is not an
 * expression; embed a `select` with `exists`, `scalar`, `in` or `cte`.
 *
 * @module
 */
import { type AnyExpr, Column, type Expr } from './expr.ts';
import {
	alias,
	compile,
	type CompiledType,
	type Fragment,
	group,
	identifier,
	join,
	keyword,
	qualified,
} from './fragment.ts';
import type { Aliased, Columns, Table } from './table.ts';
import type { SqlType } from './type.ts';

/** Marks statements, so a statement cannot be mistaken for an expression or a schema statement. */
export const brand: unique symbol = Symbol('okikio.sql.statement');

/** Result columns: name to expression. */
export type Shape = Readonly<Record<string, AnyExpr>>;

/** The row a shape returns. */
export type RowOfShape<S extends Shape> = { [K in keyof S]: S[K] extends Expr<infer T> ? T : never };

/** The value type of each column of a row. */
export type TypesOf<Row> = { readonly [K in keyof Row]: SqlType<Row[K]> };

/** A complete statement that returns rows of type `Row` (an empty object when it returns none). */
export interface Statement<Row> {
	readonly [brand]: true;
	/** The SQL sent to the database. Selected values are converted to their portable form. */
	readonly query: Fragment;
	/** The value type of each returned column, which decodes it. */
	readonly shape: TypesOf<Row>;
}

/** Whether a value is a statement. */
export function isStatement(value: unknown): value is Statement<unknown> {
	return typeof value === 'object' && value !== null && brand in value;
}

/** Compile a statement for any client. */
export function toQuery(statement: Statement<unknown>): CompiledType {
	return compile(statement.query);
}

/** The value type of each column of a shape. */
export function typesOf<Row>(shape: Shape): TypesOf<Row> {
	return Object.freeze(Object.fromEntries(Object.entries(shape).map(([key, expr]) => [key, expr.type]))) as never;
}

/** A select list, with each value converted for reading, or raw for a subquery. */
export function list(shape: Shape, read: boolean): Fragment {
	const items = Object.entries(shape).map(([key, expr]) =>
		join([read ? expr.type.read(expr.fragment) : expr.operand, keyword(' as '), alias(key)])
	);
	return items.length ? join(items, ', ') : keyword('1 as "_"');
}

/** `returning` with values converted for reading, or nothing for an empty shape. */
export function returning(shape: Shape | undefined): Fragment {
	return shape && Object.keys(shape).length ? join([keyword(' returning '), list(shape, true)]) : [];
}

/** A subquery with a name, defined in a statement's `with` clause and read like a table. */
export interface CteType<Row> {
	readonly name: string;
	/** The subquery's SQL, with raw values. */
	readonly fragment: Fragment;
	/** Its columns, referenced as `name.column`. */
	readonly c: { readonly [K in keyof Row]: Column<Row[K]> };
}

/**
 * Name a subquery so a statement can read it in `from`, `using` or a join. Pass the result to the statement's `with`.
 *
 * @example
 * ```ts
 * const due = cte('due', select({ id: jobs.c.id }).from(jobs).limit(10).for({ skipLocked: true }));
 * const claim = update(jobs, { state: 'running' }).with(due).from(due).where(jobs.c.id.eq(due.c.id));
 * ```
 */
export function cte<Row>(
	name: string,
	subquery: { readonly fragment: Fragment; readonly shape: TypesOf<Row> },
): CteType<Row> {
	identifier(name);
	const shape = subquery.shape as Readonly<Record<string, SqlType<unknown>>>;
	const c = Object.fromEntries(Object.entries(shape).map(([key, type]) => [key, new Column([name], key, type)]));
	return Object.freeze({ name, fragment: subquery.fragment, c: Object.freeze(c) as never });
}

/** A `with` clause, or nothing. */
export function prefix(ctes: readonly CteType<unknown>[]): Fragment {
	if (!ctes.length) return [];
	const items = ctes.map((item) => join([identifier(item.name), keyword(' as '), group(item.fragment)]));
	return join([keyword('with '), join(items, ', '), keyword(' ')]);
}

/** A table, an aliased table or a named subquery. */
export type Source = Table<Columns> | Aliased<Columns> | CteType<unknown>;

/** A source as it appears in `from`, `using` or a join. */
export function source(from: Source): Fragment {
	if ('alias' in from) {
		return join([qualified(from.table.schema, from.table.name), keyword(' as '), identifier(from.alias)]);
	}
	return 'schema' in from ? qualified(from.schema, from.name) : identifier(from.name);
}

/** The name that refers to a source inside the statement: its alias, or its bare name. */
export function owner(from: Source): Fragment {
	return identifier('alias' in from ? from.alias : from.name);
}
