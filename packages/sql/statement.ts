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
import type { ElementsType } from './json.ts';
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
	/** The subquery reads its own rows; see {@link recursive}. */
	readonly recursive?: boolean;
	/** Compute the rows once, even when the statement reads them several times. */
	readonly materialized?: boolean;
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
	options: { readonly materialized?: boolean } = {},
): CteType<Row> {
	return Object.freeze({
		name,
		fragment: subquery.fragment,
		c: refs<Row>(name, subquery.shape),
		...(options.materialized ? { materialized: true } : {}),
	});
}

function refs<Row>(name: string, shape: TypesOf<Row>): CteType<Row>['c'] {
	identifier(name);
	const types = shape as Readonly<Record<string, SqlType<unknown>>>;
	return Object.freeze(
		Object.fromEntries(Object.entries(types).map(([key, type]) => [key, new Column([name], key, type)])),
	) as never;
}

/**
 * Name a subquery that reads its own earlier rows, such as a walk down a tree. `step` receives the named rows and
 * returns a `unionAll` of the starting rows and the next ones. The statement's `with` becomes `with recursive`.
 *
 * @example
 * ```ts ignore
 * const tree = sql.recursive('tree', { id: types.uuid }, (self) =>
 * 	sql.unionAll(
 * 		sql.select({ id: runs.c.id }).from(runs).where(runs.c.id.eq(root)),
 * 		sql.select({ id: runs.c.id }).from(runs).join(self, runs.c.parent.eq(self.c.id)),
 * 	));
 * ```
 */
export function recursive<Row>(
	name: string,
	shape: TypesOf<Row>,
	step: (self: CteType<Row>) => { readonly fragment: Fragment; readonly shape: TypesOf<Row> },
): CteType<Row> {
	const self: CteType<Row> = Object.freeze({ name, fragment: [], c: refs<Row>(name, shape) });
	const body = step(self);
	if (Object.keys(body.shape).join() !== Object.keys(shape).join()) {
		throw new TypeError(`Recursive subquery ${name} must select ${Object.keys(shape).join(', ')}.`);
	}
	return Object.freeze({ ...self, fragment: body.fragment, recursive: true });
}

/** Rows of several selects with the same columns, kept in order and with duplicates: `union all`. */
export interface UnionType<Row> {
	readonly fragment: Fragment;
	readonly shape: TypesOf<Row>;
}

/**
 * `(select …) union all (select …)`. Each select keeps its own `order by` and `limit`. Name the result with
 * {@link cte} to read it. Every select must name the same columns in the same order.
 */
export function unionAll<Row>(
	first: { readonly fragment: Fragment; readonly shape: TypesOf<Row> },
	...rest: readonly { readonly fragment: Fragment; readonly shape: TypesOf<Row> }[]
): UnionType<Row> {
	const names = Object.keys(first.shape).join();
	for (const item of rest) {
		if (Object.keys(item.shape).join() !== names) {
			throw new TypeError('Every select of a union names the same columns.');
		}
	}
	return Object.freeze({
		fragment: join([first, ...rest].map((item) => group(item.fragment)), ' union all '),
		shape: first.shape,
	});
}

/** A `with` clause, or nothing. */
export function prefix(ctes: readonly CteType<unknown>[]): Fragment {
	if (!ctes.length) return [];
	const items = ctes.map((item) =>
		join([identifier(item.name), keyword(item.materialized ? ' as materialized ' : ' as '), group(item.fragment)])
	);
	const word = ctes.some((item) => item.recursive) ? 'with recursive ' : 'with ';
	return join([keyword(word), join(items, ', '), keyword(' ')]);
}

/** A table, an aliased table, a named subquery or the elements of a JSON array. */
export type Source = Table<Columns> | Aliased<Columns> | CteType<unknown> | ElementsType;

/** A source as it appears in `from`, `using` or a join. */
export function source(from: Source): Fragment {
	if ('call' in from) return join([from.call, keyword(' as '), identifier(from.alias)]);
	if ('alias' in from) {
		return join([qualified(from.table.schema, from.table.name), keyword(' as '), identifier(from.alias)]);
	}
	return 'schema' in from ? qualified(from.schema, from.name) : identifier(from.name);
}

/** The name that refers to a source inside the statement: its alias, or its bare name. */
export function owner(from: Source): Fragment {
	return identifier('alias' in from ? from.alias : from.name);
}
