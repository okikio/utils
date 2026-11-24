/**
 * Typed SQL statements without SQL strings, for any client or ORM.
 *
 * This entry point is the dialect-neutral core: typed expressions, conditions, tables, scope checks and the executor
 * port. It builds no statements by itself. Each SQL dialect has its own entry point, because their clauses, types and
 * built-in functions differ:
 *
 * - `@okikio/sql/postgres`: PostgreSQL statements, types and functions.
 * - `@okikio/sql/postgres/postgresjs`: run PostgreSQL statements through Postgres.js.
 *
 * Other tabular dialects, such as ClickHouse, MySQL and T-SQL, would get sibling entry points on this core. Document
 * dialects, such as Cosmos DB SQL and Couchbase SQL++, have no fixed columns, so they would need their own model.
 *
 * The core enforces two rules for every dialect:
 *
 * - **Scope.** A statement can read only the tables, aliases and named subqueries it defines. TypeScript reports a
 *   stray column, and building the statement throws a `TypeError` that names it.
 * - **One dialect.** Every type, table and expression knows its dialect. Mixing two in one statement throws.
 *
 * @example
 * ```ts ignore
 * import * as sql from '@okikio/sql/postgres';
 * import { types } from '@okikio/sql/postgres';
 *
 * const app = sql.schema('app');
 * const notes = app.table('notes', {
 * 	id: sql.column(types.uuid),
 * 	title: sql.column(types.text()),
 * 	done: sql.column(types.boolean).default(false),
 * }, (c) => ({ primaryKey: [c.id] }));
 *
 * const open = sql.select({ id: notes.c.id, title: notes.c.title }).from(notes).where(notes.c.done.eq(false));
 * const found = await sql.rows(executor, open); // { id: string; title: string }[]
 * ```
 *
 * @module
 */
export { type Dialect, same } from './dialect.ts';
export { nullable, type SqlType } from './type.ts';
export type { CompiledType, Fragment } from './fragment.ts';
export {
	type AnyExpr,
	Column,
	Expr,
	type Input,
	isExpr,
	lift,
	type OnlyOf,
	type Operand,
	type OrderType,
	type OwnersOf,
	type OwnersOfAll,
	type Subquery,
	value,
	type ValueOf,
} from './expr.ts';
export { aggregate, and, choose, exists, not, nothing, or, row, RowExpr, scalar } from './logic.ts';
export { add, coalesce, declare, max, min, multiply, subtract, sum } from './functions.ts';
export {
	type Aliased,
	column,
	type ColumnBuilder,
	type ColumnDef,
	type Columns,
	type Constraints,
	excluded,
	type ForeignKeyType,
	type IndexType,
	record,
	type Refs,
	type RowOf,
	schema,
	type SchemaType,
	type Table,
} from './table.ts';
export {
	type CallSourceType,
	cte,
	type CteType,
	type Ddl,
	isDdl,
	isStatement,
	recursive,
	type RowOfShape,
	type Shape,
	type Source,
	type Statement,
	toDdlQuery,
	toQuery,
	type TypesOf,
	unionAll,
	type UnionType,
} from './statement.ts';
export {
	type BeginOptions,
	type Database,
	decode,
	execute,
	type Executor,
	type IsolationType,
	one,
	type RawRow,
	rows,
	type RunOptions,
} from './run.ts';
export { type CatalogType, compiled, describe, type DescriptionType, type ProblemType, render } from './verify.ts';
