/**
 * PostgreSQL statements, types and functions on the typed SQL core.
 *
 * This entry point re-exports the core algebra and adds what is specific to PostgreSQL: `select`, `insert`, `update`
 * and `delete` with PostgreSQL clauses, the column types, the built-in functions in {@link fn}, `jsonb` operators,
 * schema statements and typed triggers. {@link schema} defines tables in the PostgreSQL dialect.
 *
 * Built-in functions are grouped in `fn` by what they work on. Only the functions the packages need are typed; reach
 * others through `declare`, which checks argument types the same way.
 *
 * @example
 * ```ts ignore
 * import * as sql from '@okikio/sql/postgres';
 * import { types } from '@okikio/sql/postgres';
 *
 * const app = sql.schema('app');
 * const notes = app.table('notes', { id: sql.column(types.uuid), title: sql.column(types.text()) });
 * const titles = sql.select({ title: notes.c.title }).from(notes).orderBy(notes.c.title);
 * ```
 *
 * @module
 */
import { schema as core, type SchemaType } from '../table.ts';
import { dialect } from './dialect.ts';

export * from '../mod.ts';
export { dialect } from './dialect.ts';
export * as types from './types/mod.ts';
export * as json from './json.ts';
export * as trigger from './trigger.ts';
export { collate, type Collation, fn, later } from './functions.ts';
export { type LockType, Select, select } from './select.ts';
export { type ConflictType, type InsertRow, type InsertSelect, type UpdateRow } from './write.ts';
export { Insert, insert } from './insert.ts';
export { Update, update } from './update.ts';
export { Delete, remove } from './delete.ts';
export {
	addColumn,
	type AddColumnOptions,
	begin,
	commit,
	createIndex,
	createSchema,
	createTable,
	replaceCheck,
	rollback,
	setNotNull,
	tableStatements,
} from './ddl.ts';

/** Start a PostgreSQL schema definition: a namespace for tables. */
export function schema<const S extends string>(name: S): SchemaType<S> {
	return core(dialect, name);
}
