/**
 * The persistent state tables, defined once with `@okikio/sql`. `migrate()` in `postgres.ts` creates them;
 * importing runs nothing.
 *
 * Version one stores one validated Context envelope per namespace and key and keeps no revision history. The composite
 * primary key arbitrates competing first writes. Envelope fields stay JSON, so Context owns their format.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { types } from '@okikio/sql';
import { SnapshotSchema } from '@okikio/context/state';

/** The revision this module installs. */
export const revision = 1;

const space = sql.schema('utils_state');

/** One row that records the installed revision. */
export const version = space.table('version', {
	id: sql.column(types.boolean).default(true),
	revision: sql.column(types.integer),
}, (c) => ({ primaryKey: [c.id], checks: [c.id] }));

/** The current snapshot of each namespace and key. */
export const snapshots = space.table('snapshots', {
	namespace: sql.column(types.text()),
	key: sql.column(types.text()),
	snapshot: sql.column(types.jsonb((value) => SnapshotSchema.parse(value))),
}, (c) => {
	const s = c.snapshot;
	return {
		primaryKey: [c.namespace, c.key],
		checks: [
			sql.fn.charLength(c.namespace).between(1, 128),
			sql.fn.charLength(c.key).between(1, 512),
			// A snapshot is a Context envelope: format 1 with a nonblank contract and version.
			sql.coalesce(
				sql.and(
					sql.json.kind(s).eq('object'),
					sql.json.hasAll(s, ['format', 'contract', 'version', 'value']),
					sql.json.get(s, 'format').eq(1),
					sql.json.kind(sql.json.get(s, 'contract')).eq('string'),
					sql.fn.charLength(sql.json.text(s, 'contract')).between(1, 256),
					sql.json.kind(sql.json.get(s, 'version')).eq('string'),
					sql.fn.charLength(sql.json.text(s, 'version')).between(1, 128),
				),
				false,
			),
		],
	};
});

/** Serializes migrations from every process. */
export const migrationLock: sql.Statement<{ locked: undefined }> = sql.select({
	locked: sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty)(776161005n),
});

/** Whether the version table exists, so an installed revision is checked instead of created. */
export const installed: sql.Statement<{ present: boolean }> = sql.select({
	present: sql.fn.tableExists('utils_state', 'version'),
});

/** Whether the snapshots table exists. */
export const complete: sql.Statement<{ present: boolean }> = sql.select({
	present: sql.fn.tableExists('utils_state', 'snapshots'),
});

/** The stored revision. */
export const stored: sql.Statement<{ revision: number }> = sql.select({ revision: version.c.revision }).from(version)
	.where(version.c.id);

/** Installs revision one. */
export const install: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	sql.createSchema('utils_state'),
	sql.createTable(version),
	sql.insert(version, { revision }).onConflict({ action: 'nothing' }),
	...sql.tableStatements(snapshots),
];
