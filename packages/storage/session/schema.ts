/**
 * The resource session tables, defined once with `@okikio/sql`. `migrate()` in `postgres.ts` creates them;
 * importing runs nothing.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { RecordSchema } from '@okikio/capability/resource/session';

/** The revision this module installs. */
export const revision = 1;

const space = sql.schema('utils_session');

/** One row that records the installed revision. */
export const version = space.table('version', {
	id: sql.column(types.boolean).default(true),
	revision: sql.column(types.integer),
}, (c) => ({ primaryKey: [c.id], checks: [c.id] }));

/** One session record per namespace and ID. */
export const records = space.table('records', {
	namespace: sql.column(types.text()),
	id: sql.column(types.text()),
	value: sql.column(types.jsonb((value) => RecordSchema.parse(value))),
}, (c) => ({ primaryKey: [c.namespace, c.id] }));

const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);
/** `hashtextextended(text, bigint)`: a 64-bit hash for lock keys. */
export const hash = sql.declare('hashtextextended', [types.text(), types.bigint], types.bigint);

/** Serializes migrations from every process. */
export const migrationLock: sql.Statement<{ locked: undefined }> = sql.select({ locked: lock(776161006n) });

/** Serializes every change to one session, even before its record exists. */
export function guard(key: string): sql.Statement<{ locked: undefined }> {
	return sql.select({ locked: lock(hash(key, 0n)) });
}

/** Whether the version table exists, so an installed revision is checked instead of created. */
export const installed: sql.Statement<{ present: boolean }> = sql.select({
	present: sql.fn.tableExists('utils_session', 'version'),
});

/** Whether the records table exists. */
export const complete: sql.Statement<{ present: boolean }> = sql.select({
	present: sql.fn.tableExists('utils_session', 'records'),
});

/** The stored revision. */
export const stored: sql.Statement<{ revision: number }> = sql.select({ revision: version.c.revision }).from(version)
	.where(version.c.id);

/** Installs revision one. */
export const install: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	sql.createSchema('utils_session'),
	sql.createTable(version),
	sql.insert(version, { revision }).onConflict({ action: 'nothing' }),
	...sql.tableStatements(records),
];
