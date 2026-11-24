/**
 * Work beside Drizzle: read Drizzle tables as table definitions, and run statements through a Drizzle database.
 *
 * - {@link table} turns a Drizzle table into a definition of this package, so one schema file describes the table.
 * - {@link executor} and {@link database} run this package's statements through Drizzle, inside its transactions too.
 *
 * @example
 * ```ts ignore
 * import { sql as tag } from 'drizzle-orm';
 * import { getTableConfig } from 'drizzle-orm/pg-core';
 * import * as drizzle from '@okikio/sql/postgres/drizzle';
 *
 * const accounts = drizzle.table(schema.accounts, getTableConfig);
 * const db = drizzle.database(orm, tag);
 * await orm.transaction(async (tx) => {
 *   await sql.execute(drizzle.executor(tx, tag), sql.insert(accounts, { displayName: 'Ada' }));
 * });
 * ```
 *
 * @module
 */
export {
	type DefOf,
	type DrizzleColumn,
	type DrizzleConfig,
	type DrizzleTable,
	table,
	type TableOf,
	type ValueOf,
} from './table.ts';
export { database, type DrizzleDatabase, executor, type Session, type Tag } from './run.ts';
