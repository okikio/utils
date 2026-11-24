/**
 * Typed PostgreSQL statements without SQL strings, for any client or ORM.
 *
 * Define tables once, build statements from typed expressions, and run them through a one-method executor. The
 * package depends on no database client: Postgres.js, pg, Drizzle, Kysely and Prisma all run its compiled statements.
 *
 * @example
 * ```ts ignore
 * import * as sql from '@okikio/sql';
 * import { types } from '@okikio/sql';
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
export * as types from './type.ts';
export type { SqlType } from './type.ts';
export type { CompiledType, Fragment } from './fragment.ts';
export {
	type AnyExpr,
	type Collation,
	Column,
	Expr,
	type Input,
	isExpr,
	lift,
	type OrderType,
	type Subquery,
	value,
} from './expr.ts';
export { aggregate, and, choose, exists, not, nothing, or, row, RowExpr, scalar } from './logic.ts';
export { add, coalesce, declare, fn, later, multiply, subtract } from './functions.ts';
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
	type Refs,
	type RowOf,
	schema,
	type SchemaType,
	type Table,
} from './table.ts';
export * as json from './json.ts';
export {
	cte,
	type CteType,
	isStatement,
	type RowOfShape,
	type Shape,
	type Source,
	type Statement,
	toQuery,
	type TypesOf,
} from './statement.ts';
export { type LockType, Select, select } from './select.ts';
export {
	type ConflictType,
	Delete,
	Insert,
	insert,
	type InsertRow,
	type InsertSelect,
	remove,
	Update,
	update,
	type UpdateRow,
} from './write.ts';
export {
	addColumn,
	begin,
	commit,
	createIndex,
	createSchema,
	createTable,
	type Ddl,
	isDdl,
	type IsolationType,
	rollback,
	tableStatements,
	toDdlQuery,
} from './ddl.ts';
export {
	type BeginOptions,
	type Database,
	decode,
	execute,
	type Executor,
	one,
	type RawRow,
	rows,
	type RunOptions,
} from './run.ts';
export { type CatalogType, compiled, describe, type DescriptionType, type ProblemType, render } from './verify.ts';
