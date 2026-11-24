/**
 * The workflow schema and its migration, built with `@okikio/sql`. Importing runs nothing; `migrate()` in
 * `postgresjs.ts` runs these statements under the migration lock.
 *
 * Revision 1 saved the queue and progress. Revision 2 added operator control, completion-based retention and run
 * history. Revision 3 added placement. Every statement is idempotent, so a database at revision 1 or 2 reaches
 * revision 3 by running {@link install} again, in the same order:
 *
 * ```text
 * create tables -> add newer columns -> backfill -> set not null -> replace the state check
 *   -> record history baselines -> indexes -> trigger functions -> triggers -> record the revision
 * ```
 *
 * Indexes come after the added columns, because an index of an older table can name a column the upgrade adds.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { routines, triggers } from './triggers.ts';
import {
	hosts,
	instructions,
	jobs,
	name,
	progress,
	runEvents,
	runs,
	runStates,
	tables,
	terminal,
	version as versions,
} from './tables.ts';

export * from './tables.ts';

/** The revision this module installs. */
export const revision = 3;

const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);
const share = sql.declare('pg_advisory_xact_lock_shared', [types.bigint], types.empty);

/** The fixed key that serializes migrations and host registration. */
const migrationKey = 776161003n;

/** Serializes migrations. */
export const migrationLock: sql.Statement<{ locked: undefined }> = sql.select({ locked: lock(migrationKey) });

/** Lets registrations run together while keeping a migration out. */
export const registrationLock: sql.Statement<{ locked: undefined }> = sql.select({ locked: share(migrationKey) });

/** Whether the version and hosts tables exist. Either may be missing before the first migration. */
export const present: sql.Statement<{ version: boolean; hosts: boolean }> = sql.select({
	version: sql.fn.tableExists(name, versions.name),
	hosts: sql.fn.tableExists(name, hosts.name),
});

/** The stored revision. */
export const stored: sql.Statement<{ version: number }> = sql.select({ version: versions.c.version }).from(versions)
	.where(versions.c.id);

/** One live host that is not draining. An upgrade waits until there is none. */
export const activeHost: sql.Statement<{ id: string }> = sql.select({ id: hosts.c.id }).from(hosts).where(
	sql.not(hosts.c.draining),
	hosts.c.expires.gt(sql.fn.clockTimestamp()),
).limit(1);

/** Bound lock waits while the migration changes tables that workers use. */
export const lockTimeout: sql.Statement<{ timeout: string }> = sql.select({
	timeout: sql.fn.setLocal('lock_timeout', '5000ms'),
});

/** Columns added after revision 1, in the order the upgrade adds them. */
const added: readonly [sql.Table<sql.Columns>, string, sql.AddColumnOptions?][] = [
	[runs, 'trace'],
	[instructions, 'parent'],
	[instructions, 'branches'],
	[instructions, 'event'],
	[instructions, 'event_key'],
	[runs, 'paused'],
	[runs, 'control_revision'],
	[runs, 'updated_at'],
	[runs, 'finished_at'],
	// Older runs get their own ID as chain root before the column requires a value.
	[runs, 'chain_root', { backfill: true }],
	[runs, 'chain_index'],
	[runs, 'continued_to'],
	[runs, 'continuation'],
	[progress, 'reported_at'],
	[runs, 'location'],
	[jobs, 'location'],
	[jobs, 'affinity'],
	[hosts, 'compute'],
	[hosts, 'affinity'],
];

const r = runs.c;
const e = runEvents.c;

/** Creates the version table and records revision 1 when it is new, so the stored revision can be read. */
export const prepare: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	sql.createSchema(name),
	sql.createTable(versions),
	sql.insert(versions, { id: true, version: 1 }).onConflict({ action: 'nothing' }),
];

/** Creates or completes every table, index, function and trigger of {@link revision}, then records it. */
export const install: readonly (sql.Ddl | sql.Statement<unknown>)[] = [
	...tables.filter((table) => table !== versions).map((table) => sql.createTable(table)),
	...added.map(([table, column, options]) => sql.addColumn(table, column, options)),
	sql.update(runs, { chain_root: r.id }).where(r.chain_root.isNull()),
	sql.setNotNull(runs, 'chain_root'),
	...sql.replaceCheck(runs, 'runs_state_check', r.state.in(runStates)),
	// Acceptance time is not completion time. Give older terminal runs a fresh full retention window.
	sql.update(runs, { finished_at: sql.fn.clockTimestamp() }).where(r.state.in(terminal), r.finished_at.isNull()),
	// One truthful baseline for each older run, not invented historical transitions.
	sql.insert(
		runEvents,
		sql.select({
			namespace: r.namespace,
			run: r.id,
			sequence: sql.value(1, types.long),
			kind: sql.value('baseline', runEvents.columns.kind.type),
			state: r.state,
			paused: r.paused,
			control_revision: r.control_revision,
			epoch: r.epoch,
		}).from(runs).where(
			sql.not(
				sql.exists(sql.select({ run: e.run }).from(runEvents).where(e.namespace.eq(r.namespace), e.run.eq(r.id))),
			),
		),
	),
	...tables.flatMap((table) => (table.constraints.indexes ?? []).map((index) => sql.createIndex(table, index))),
	...routines.map((routine) => routine.ddl),
	...triggers.flatMap((item) => sql.trigger.create(item)),
	sql.update(versions, { version: revision }).where(versions.c.id),
];

/** The schema's columns as PostgreSQL reports them. */
const columns = sql.schema('information_schema').table('columns', {
	table_schema: sql.column(types.text()),
	table_name: sql.column(types.text()),
	column_name: sql.column(types.text()),
	data_type: sql.column(types.text()),
});

/** Every column of the installed workflow schema, for comparison with {@link expected}. */
export const installed: sql.Statement<{ table: string; column: string; type: string }> = sql.select({
	table: columns.c.table_name,
	column: columns.c.column_name,
	type: columns.c.data_type,
}).from(columns).where(columns.c.table_schema.eq(name));

/** `information_schema` names for the SQL types the tables use. */
const reported: Readonly<Record<string, string>> = { timestamptz: 'timestamp with time zone', bigserial: 'bigint' };

/** Every column this revision defines, as `table.column type`, which {@link installed} must contain. */
export const expected: ReadonlySet<string> = new Set(
	tables.flatMap((table) =>
		Object.entries(table.columns).map(([column, def]) =>
			`${table.name}.${column} ${reported[def.type.name] ?? def.type.name}`
		)
	),
);
