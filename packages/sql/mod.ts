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
	add,
	and,
	coalesce,
	type Collation,
	Column,
	declare,
	exists,
	Expr,
	fn,
	type Input,
	isExpr,
	later,
	lift,
	multiply,
	not,
	or,
	type OrderType,
	row,
	scalar,
	subtract,
	value,
} from './expr.ts';
export {
	column,
	type ColumnDef,
	type Columns,
	type Constraints,
	excluded,
	type RowOf,
	schema,
	type Table,
} from './table.ts';
export * as json from './json.ts';
export {
	Delete,
	Insert,
	insert,
	type InsertRow,
	isStatement,
	type LockType,
	remove,
	type RowOfShape,
	Select,
	select,
	type Shape,
	type Statement,
	toQuery,
	Update,
	update,
	type UpdateRow,
} from './statement.ts';
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
export { type Database, decode, execute, type Executor, one, type RawRow, rows } from './run.ts';
export { type CatalogType, compiled, describe, type DescriptionType, type ProblemType, render } from './verify.ts';
