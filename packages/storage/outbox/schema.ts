/**
 * The outbox tables, defined once with `@okikio/sql`. `migrate()` in `postgres.ts` creates them; importing runs
 * nothing.
 *
 * Revision 1 created the version, policies and messages tables. Revision 2 added `budget` and `failure` to messages and
 * the `repairs` audit table. Every schema statement is idempotent, so a database at revision 1 or 2 reaches revision 2
 * by running them all again under the migration lock.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { types } from '@okikio/sql';

/** The revision this module installs. */
export const revision = 2;

/** Revisions that `migrate()` can bring to {@link revision}. Any other stored revision stops the migration. */
export const supported: readonly number[] = [1, 2];

const space = sql.schema('utils_outbox');

/** Delivery states. */
export const states = ['pending', 'leased', 'complete', 'failed'] as const;

/** One row that records the installed revision. */
export const version = space.table('version', {
	id: sql.column(types.boolean),
	revision: sql.column(types.integer),
}, (c) => ({ primaryKey: [c.id], checks: [c.id] }));

/** The admission policy every view of a namespace must share. */
export const policies = space.table('policies', {
	namespace: sql.column(types.text()),
	maximum: sql.column(types.integer),
	bytes: sql.column(types.integer),
	attempts: sql.column(types.integer),
}, (c) => ({ primaryKey: [c.namespace] }));

/** Messages and their delivery state. Times are database epoch milliseconds. */
export const messages = space.table('messages', {
	namespace: sql.column(types.text()),
	id: sql.column(types.text()),
	key: sql.column(types.text()),
	value: sql.column(types.jsonb()),
	state: sql.column(types.text(states)),
	attempt: sql.column(types.integer).default(0),
	token: sql.column(types.text()).nullable(),
	expires: sql.column(types.double).nullable(),
	due: sql.column(types.double),
	updated: sql.column(types.double),
	budget: sql.column(types.integer).default(0),
	failure: sql.column(types.text()).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.id, c.key],
	checks: [c.state.in(states)],
	indexes: [{ name: 'outbox_ready', on: [c.namespace, c.state, c.due] }],
}));

/** Operator decisions that granted another delivery budget. */
export const repairs = space.table('repairs', {
	namespace: sql.column(types.text()),
	id: sql.column(types.text()),
	key: sql.column(types.text()),
	attempt: sql.column(types.integer),
	actor: sql.column(types.text()),
	reason: sql.column(types.text()),
	updated: sql.column(types.double),
}, (c) => ({
	primaryKey: [c.namespace, c.id, c.key, c.attempt],
	foreignKeys: [{
		columns: [c.namespace, c.id, c.key],
		references: messages,
		to: [messages.c.namespace, messages.c.id, messages.c.key],
		onDelete: 'cascade',
	}],
}));

/** `pg_advisory_xact_lock(bigint)`: hold a lock until the transaction ends. */
export const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);
/** `hashtextextended(text, bigint)`: a 64-bit hash for lock keys. */
export const hash = sql.declare('hashtextextended', [types.text(), types.bigint], types.bigint);

/** The fixed key that serializes migrations from every process. */
const migrationKey = 776161007n;

/** Serializes migrations. */
export const migrationLock: sql.Statement<{ locked: undefined }> = sql.select({ locked: lock(migrationKey) });

/** Creates the version table and records revision 1 when it is new, so the stored revision can be read. */
export const prepare: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	sql.createSchema('utils_outbox'),
	sql.createTable(version),
	sql.insert(version, { id: true, revision: 1 }).onConflict({ action: 'nothing' }),
];

/** The stored revision. */
export const stored: sql.Statement<{ revision: number }> = sql.select({ revision: version.c.revision }).from(version)
	.where(version.c.id);

/** Creates or completes every table and index of {@link revision}, then records it. */
export const install: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	...sql.tableStatements(policies),
	...sql.tableStatements(messages),
	// A revision 1 table already exists, so its new columns are added here.
	sql.addColumn(messages, 'budget'),
	sql.addColumn(messages, 'failure'),
	...sql.tableStatements(repairs),
	sql.update(version, { revision }).where(version.c.id),
];
