/**
 * The queue tables, defined once with `@okikio/sql`. `migrate()` in `postgres.ts` creates them; importing runs
 * nothing.
 *
 * Revision 1 created the version, policies and items tables. Revision 2 added `redriven_from` and the inspection index.
 * Every schema statement is idempotent, so a database at revision 1 or 2 reaches revision 2 by running them all again
 * under the migration lock.
 *
 * Queue state and claim authority live in the same row, so one transaction fences every change.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';

/** The revision this module installs. */
export const revision = 2;

/** Revisions that `migrate()` can bring to {@link revision}. Any other stored revision stops the migration. */
export const supported: readonly number[] = [1, 2];

const space = sql.schema('utils_queue');

/** Item states. */
export const states = ['queued', 'claimed', 'completed', 'failed', 'cancelled'] as const;

/** States that hold capacity. */
export const active = ['queued', 'claimed'] as const;

/** States that end an item. */
export const terminal = ['completed', 'failed', 'cancelled'] as const;

/** One row that records the installed revision. */
export const version = space.table('version', {
	id: sql.column(types.boolean).default(true),
	revision: sql.column(types.integer),
}, (c) => ({ primaryKey: [c.id], checks: [c.id] }));

/** The admission policy every view of a namespace must share. */
export const policies = space.table('policies', {
	namespace: sql.column(types.text()),
	contract: sql.column(types.text()),
	capacity: sql.column(types.long),
	retained: sql.column(types.long),
	ttl: sql.column(types.long),
}, (c) => ({
	primaryKey: [c.namespace],
	checks: [c.capacity.gt(0), c.retained.gt(0), c.ttl.gt(0)],
}));

/** Work items, their claim and their result. */
export const items = space.table('items', {
	namespace: sql.column(types.text()),
	id: sql.column(types.uuid),
	key: sql.column(types.text()).nullable(),
	sequence: sql.column(types.bigint).identity(),
	input: sql.column(types.jsonb()),
	redriven_from: sql.column(types.uuid).nullable(),
	priority: sql.column(types.long).default(0),
	state: sql.column(types.text(states)),
	available: sql.column(types.timestamptz).default(sql.fn.clockTimestamp()),
	attempt: sql.column(types.integer).default(0),
	claim: sql.column(types.uuid).nullable(),
	owner: sql.column(types.text()).nullable(),
	claimed: sql.column(types.timestamptz).nullable(),
	expires: sql.column(types.timestamptz).nullable(),
	output: sql.column(types.jsonb()).nullable(),
	failure: sql.column(types.jsonb()).nullable(),
	cancellation: sql.column(types.text()).nullable(),
	finished: sql.column(types.timestamptz).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.id],
	unique: [[c.namespace, c.key]],
	foreignKeys: [{ columns: [c.namespace], references: policies, to: [policies.c.namespace] }],
	checks: [
		c.state.in(states),
		c.attempt.gte(0),
		// A claimed item has every claim field; any other item has none of them.
		c.state.eq('claimed').eq(
			sql.and(c.claim.isNotNull(), c.owner.isNotNull(), c.claimed.isNotNull(), c.expires.isNotNull()),
		),
		c.state.in(terminal).eq(c.finished.isNotNull()),
	],
	indexes: [
		{ name: 'queue_ready', on: [c.namespace, c.priority.desc(), c.sequence], where: c.state.eq('queued') },
		{ name: 'queue_expired', on: [c.namespace, c.expires], where: c.state.eq('claimed') },
		{ name: 'queue_terminal', on: [c.namespace, c.finished, c.sequence], where: c.finished.isNotNull() },
		{ name: 'queue_inspection', on: [c.namespace, c.sequence] },
	],
}));

/** `pg_advisory_xact_lock(bigint)`: hold a lock until the transaction ends. */
const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);

/** The fixed key that serializes migrations from every process. */
const migrationKey = 776161004n;

/** Serializes migrations. */
export const migrationLock: sql.Statement<{ locked: undefined }> = sql.select({ locked: lock(migrationKey) });

/** Creates the version table and records revision 1 when it is new, so the stored revision can be read. */
export const prepare: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	sql.createSchema('utils_queue'),
	sql.createTable(version),
	sql.insert(version, { id: true, revision: 1 }).onConflict({ action: 'nothing' }),
];

/** The stored revision. */
export const stored: sql.Statement<{ revision: number }> = sql.select({ revision: version.c.revision }).from(version)
	.where(version.c.id);

/** Creates or completes every table and index of {@link revision}, then records it. */
export const install: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	...sql.tableStatements(policies),
	...sql.tableStatements(items),
	// A revision 1 table already exists, so its new column is added here.
	sql.addColumn(items, 'redriven_from'),
	sql.update(version, { revision }).where(version.c.id),
];
