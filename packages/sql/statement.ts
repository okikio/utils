/**
 * What every statement shares: its SQL, its dialect, its result types, the sources it reads and the named subqueries
 * (`with`) it defines first.
 *
 * Scope is checked here. A statement's **free owners** are the owners its expressions read minus the sources it
 * defines in `from`, joins and `using`. A subquery may have free owners; they become owners of the expression that
 * embeds it, so a correlated subquery passes them to the outer statement. A statement that runs must have none: its
 * type says `[reads]?: never`, and building its SQL throws a `TypeError` that names the stray owner.
 *
 * The statement builders belong to each dialect, such as `@okikio/sql/postgres`, because their clauses differ.
 *
 * @module
 */
import { type Dialect, same } from './dialect.ts';
import { type AnyExpr, Column, type OwnersOf, reads, union, type ValueOf } from './expr.ts';
import { alias, compile, type CompiledType, type Fragment, group, identifier, join, keyword } from './fragment.ts';
import type { Aliased, Columns, Table } from './table.ts';
import type { SqlType } from './type.ts';

export { reads };

/** Marks statements, so a statement cannot be mistaken for an expression or a schema statement. */
export const brand: unique symbol = Symbol('okikio.sql.statement');

/** Result columns: name to expression. */
export type Shape = Readonly<Record<string, AnyExpr>>;

/** The row a shape returns. */
export type RowOfShape<S extends Shape> = { [K in keyof S]: ValueOf<S[K]> };

/** The owners a shape reads, as a type. */
export type OwnersOfShape<S extends Shape> = OwnersOf<S[keyof S]>;

/** The value type of each column of a row. */
export type TypesOf<Row> = { readonly [K in keyof Row]: SqlType<Row[K]> };

/** A complete statement that returns rows of type `Row` (an empty object when it returns none). */
export interface Statement<Row> {
	readonly [brand]: true;
	/** The dialect the statement is written in. */
	readonly dialect: Dialect;
	/** The SQL sent to the database. Selected values are converted to their portable form. */
	readonly query: Fragment;
	/** The value type of each returned column, which decodes it. */
	readonly shape: TypesOf<Row>;
	/** A statement that runs reads nothing outside its own scope. */
	readonly [reads]?: never;
}

/** Whether a value is a statement. */
export function isStatement(value: unknown): value is Statement<unknown> {
	return typeof value === 'object' && value !== null && brand in value;
}

/** Compile a statement for any client of its dialect. */
export function toQuery(statement: Statement<unknown>): CompiledType {
	return compile(statement.query, statement.dialect);
}

/** The value type of each column of a shape. */
export function typesOf<Row>(shape: Shape): TypesOf<Row> {
	return Object.freeze(Object.fromEntries(Object.entries(shape).map(([key, expr]) => [key, expr.type]))) as never;
}

/** The dialect of a shape, checked across its expressions. */
export function dialectOf(shape: Shape, fallback: Dialect): Dialect {
	for (const expr of Object.values(shape)) same(fallback, expr.dialect);
	return fallback;
}

/** A select list, with each value converted for reading, or raw for a subquery. */
export function list(shape: Shape, read: boolean): Fragment {
	const items = Object.entries(shape).map(([key, expr]) =>
		join([read ? expr.type.read(expr.fragment) : expr.operand, keyword(' as '), alias(key)])
	);
	return items.length ? join(items, ', ') : keyword('1 as "_"');
}

/** Owners read minus owners defined. */
export function free(
	used: readonly { readonly owners: ReadonlySet<string> }[],
	defined: Iterable<string>,
): ReadonlySet<string> {
	const scope = new Set(defined);
	return Object.freeze(new Set([...union(...used)].filter((owner) => !scope.has(owner))));
}

/** Fail when a statement that runs reads an owner outside its scope. */
export function closed(free: ReadonlySet<string>, what: string): void {
	if (free.size) {
		throw new TypeError(`The ${what} reads ${[...free].join(', ')}, which is not in its from, join or using list.`);
	}
}

/** A subquery with a name, defined in a statement's `with` clause and read like a table. */
export interface CteType<Row, N extends string = string> {
	readonly name: N;
	readonly key: N;
	readonly dialect: Dialect;
	/** The subquery reads its own rows; see {@link recursive}. */
	readonly recursive?: boolean;
	/** Compute the rows once, even when the statement reads them several times. */
	readonly materialized?: boolean;
	/** The subquery's SQL, with raw values. */
	readonly fragment: Fragment;
	/** Its columns, referenced as `name.column`. */
	readonly c: { readonly [K in keyof Row]: Column<Row[K], N> };
}

/** A subquery that a `with` clause can name: it must read nothing from an outer statement. */
export interface NamedType<Row> {
	readonly fragment: Fragment;
	readonly shape: TypesOf<Row>;
	readonly dialect: Dialect;
	readonly free: ReadonlySet<string>;
	readonly [reads]?: never;
}

function refs<Row, N extends string>(name: N, shape: TypesOf<Row>): CteType<Row, N>['c'] {
	identifier(name);
	const types = shape as Readonly<Record<string, SqlType<unknown>>>;
	return Object.freeze(
		Object.fromEntries(Object.entries(types).map(([key, type]) => [key, new Column([name], key, type)])),
	) as never;
}

/**
 * Name a subquery so a statement can read it in `from`, `using` or a join. Pass the result to the statement's `with`.
 * `materialized` computes the rows once where the dialect supports it.
 *
 * @example
 * ```ts ignore
 * const due = sql.cte('due', sql.select({ id: jobs.c.id }).from(jobs).limit(10).for({ skipLocked: true }));
 * const claim = sql.update(jobs, { state: 'running' }).with(due).from(due).where(jobs.c.id.eq(due.c.id));
 * ```
 */
export function cte<Row, const N extends string>(
	name: N,
	subquery: NamedType<Row>,
	options: { readonly materialized?: boolean } = {},
): CteType<Row, N> {
	closed(subquery.free, `with subquery ${name}`);
	return Object.freeze({
		name,
		key: name,
		dialect: subquery.dialect,
		fragment: subquery.fragment,
		c: refs<Row, N>(name, subquery.shape),
		...(options.materialized ? { materialized: true } : {}),
	});
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
export function recursive<Row, const N extends string>(
	name: N,
	shape: TypesOf<Row>,
	step: (self: CteType<Row, N>) => NamedType<Row>,
): CteType<Row, N> {
	const dialect = (Object.values(shape) as SqlType<unknown>[])[0]?.dialect;
	if (!dialect) throw new TypeError(`Recursive subquery ${name} needs at least one column.`);
	const self: CteType<Row, N> = Object.freeze({ name, key: name, dialect, fragment: [], c: refs<Row, N>(name, shape) });
	const body = step(self);
	same(dialect, body.dialect);
	closed(body.free, `recursive subquery ${name}`);
	if (Object.keys(body.shape).join() !== Object.keys(shape).join()) {
		throw new TypeError(`Recursive subquery ${name} must select ${Object.keys(shape).join(', ')}.`);
	}
	return Object.freeze({ ...self, fragment: body.fragment, recursive: true });
}

/** Rows of several selects with the same columns, kept in order and with duplicates: `union all`. */
export interface UnionType<Row> {
	readonly fragment: Fragment;
	readonly shape: TypesOf<Row>;
	readonly dialect: Dialect;
	readonly free: ReadonlySet<string>;
	readonly [reads]?: never;
}

/**
 * `(select …) union all (select …)`. Each select keeps its own `order by` and `limit`. Name the result with
 * {@link cte} to read it. Every select must name the same columns in the same order and read nothing from outside.
 */
export function unionAll<Row>(first: NamedType<Row>, ...rest: readonly NamedType<Row>[]): UnionType<Row> {
	const names = Object.keys(first.shape).join();
	for (const item of rest) {
		same(first.dialect, item.dialect);
		if (Object.keys(item.shape).join() !== names) {
			throw new TypeError('Every select of a union names the same columns.');
		}
	}
	for (const item of [first, ...rest]) closed(item.free, 'union');
	return Object.freeze({
		fragment: join([first, ...rest].map((item) => group(item.fragment)), ' union all '),
		shape: first.shape,
		dialect: first.dialect,
		free: Object.freeze(new Set<string>()),
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

/**
 * A source of rows with a function call, such as the elements of a JSON array. Its arguments may read an outer
 * statement's owners (`O`), as in a correlated subquery; those become free owners of the statement that reads it.
 */
export interface CallSourceType<A extends string = string, O extends string = string> {
	readonly alias: A;
	readonly key: A;
	readonly dialect: Dialect;
	readonly call: Fragment;
	/** The owners the call's arguments read. */
	readonly owners: ReadonlySet<string>;
	readonly c: Readonly<Record<string, Column<unknown, A>>>;
	readonly [reads]?: O;
}

/** A table, an aliased table, a named subquery or a function that returns rows. */
export type Source<K extends string = string> =
	| Table<Columns, K>
	| Aliased<Columns, K>
	| CteType<unknown, K>
	| CallSourceType<K>;

/** The owner key a source defines. */
export type KeyOf<S> = S extends { readonly key: infer K extends string } ? K : never;

/** The owners a source reads from outside, such as a row function's arguments. */
export type ReadsOf<S> = S extends { readonly call: Fragment } ? OwnersOf<S> : never;

/** What a source reads, for a statement's free owners: only a row function reads anything. */
export function sourceReads(from: Source): { readonly owners: ReadonlySet<string> } {
	return 'call' in from ? from : { owners: new Set() };
}

/** The dialect of a source. */
export function dialectOfSource(from: Source): Dialect {
	return 'table' in from ? from.table.dialect : from.dialect;
}

/** A source as it appears in `from`, `using` or a join. */
export function source(from: Source): Fragment {
	if ('call' in from) return join([from.call, keyword(' as '), identifier(from.alias)]);
	if ('table' in from) {
		return join([
			identifier(from.table.schema),
			keyword('.'),
			identifier(from.table.name),
			keyword(' as '),
			identifier(from.alias),
		]);
	}
	return 'schema' in from
		? join([identifier(from.schema), keyword('.'), identifier(from.name)])
		: identifier(from.name);
}

/** The name that refers to a source inside the statement: its alias, or its bare name. */
export function owner(from: Source): Fragment {
	return identifier('alias' in from ? from.alias : from.name);
}

const ddlBrand: unique symbol = Symbol('okikio.sql.ddl');

/** One schema statement. */
export interface Ddl {
	readonly [ddlBrand]: true;
	readonly dialect: Dialect;
	readonly ddl: Fragment;
	/** A function or trigger, whose columns keep their owner (`new`, `old`). */
	readonly routine?: boolean;
}

/** Whether a value is a schema statement. */
export function isDdl(value: unknown): value is Ddl {
	return typeof value === 'object' && value !== null && ddlBrand in value;
}

/** Wrap a schema statement of a dialect. Only dialect entry points call this, with fragments they built. */
export function ddl(dialect: Dialect, fragment: Fragment, routine = false): Ddl {
	return Object.freeze({ [ddlBrand]: true as const, dialect, ddl: fragment, ...(routine ? { routine } : {}) });
}

/** Compile a schema statement; it has no parameters. */
export function toDdlQuery(statement: Ddl): CompiledType {
	return compile(statement.ddl, statement.dialect, { ddl: true, routine: statement.routine ?? false });
}
