/**
 * The workflow tables in `utils_workflow`, defined once with `@okikio/sql`.
 *
 * Each definition is the current revision. A database from an older revision gets the newer columns from
 * `addColumn` in the migration, so a column added after revision 1 must allow NULL or have a default. Application
 * domain tables never appear here.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { types } from '@okikio/sql';

const space = sql.schema('utils_workflow');

/** The schema that holds every table, function and trigger. */
export const name = 'utils_workflow';

/** Run states. `continued` ends a run that handed its work to a successor in the same chain. */
export const runStates = [
	'ready',
	'advancing',
	'waiting',
	'settling',
	'blocked',
	'completed',
	'failed',
	'cancelled',
	'continued',
] as const;

/** Run states that end a run. A family is retained until every member reaches one. */
export const terminal = ['completed', 'failed', 'cancelled', 'continued'] as const;

/** Job states. */
export const jobStates = ['ready', 'claimed', 'completed', 'failed', 'blocked'] as const;

/** Kinds of history entries. `baseline` is the one entry for a run accepted by a revision without history. */
export const eventKinds = ['baseline', 'run', 'job', 'operator'] as const;

const clock = sql.fn.clockTimestamp();

/** One row that records the installed revision. */
export const version = space.table('version', {
	id: sql.column(types.boolean).default(true),
	version: sql.column(types.integer),
}, (c) => ({ primaryKey: [c.id], checks: [c.id] }));

/**
 * One executor lifetime per host ID. A replacement gets the next `generation`, so claims of the old lifetime fail.
 * `compute` is the host's ancestor path, locked root first by every guarded operation.
 */
export const hosts = space.table('hosts', {
	namespace: sql.column(types.text()),
	id: sql.column(types.text()),
	generation: sql.column(types.integer),
	definitions: sql.column(types.jsonb()),
	engine: sql.column(types.text()),
	activations: sql.column(types.integer),
	activities: sql.column(types.integer),
	expires: sql.column(types.timestamptz),
	draining: sql.column(types.boolean).default(false),
	compute: sql.column(types.jsonb()).default([]),
	affinity: sql.column(types.jsonb()).default({}),
}, (c) => ({
	primaryKey: [c.namespace, c.id],
	indexes: [{ name: 'hosts_compute', on: [c.compute], method: 'gin' }],
}));

/**
 * Runs of workflows and activities. A run's `family` is its root; a family is retained and pruned as one unit.
 * Triggers keep `updated_at`, `finished_at` and `chain_root` and write `run_events`; the adapter never sets them.
 */
export const runs = space.table('runs', {
	namespace: sql.column(types.text()),
	id: sql.column(types.uuid),
	scope: sql.column(types.text()),
	key: sql.column(types.text()),
	kind: sql.column(types.text(['activity', 'workflow'] as const)),
	definition: sql.column(types.text()),
	version: sql.column(types.text()),
	input: sql.column(types.jsonb()),
	fingerprint: sql.column(types.text()),
	policy: sql.column(types.jsonb()),
	policyhash: sql.column(types.text()),
	state: sql.column(types.text(runStates)),
	epoch: sql.column(types.integer).default(1),
	generation: sql.column(types.integer).default(0),
	host: sql.column(types.text()).nullable(),
	host_generation: sql.column(types.integer).nullable(),
	expires: sql.column(types.timestamptz).nullable(),
	outcome: sql.column(types.jsonb()).nullable(),
	reason: sql.column(types.text()).nullable(),
	family: sql.column(types.uuid),
	parent: sql.column(types.uuid).nullable(),
	cancellation: sql.column(types.text()).nullable(),
	reservation: sql.column(types.jsonb()),
	successors: sql.column(types.integer).default(0),
	children: sql.column(types.integer).default(0),
	created: sql.column(types.timestamptz).default(clock),
	/** Optional diagnostic context. Rows from older workers have none. */
	trace: sql.column(types.jsonb()).nullable(),
	paused: sql.column(types.boolean).default(false),
	control_revision: sql.column(types.integer).default(0),
	updated_at: sql.column(types.timestamptz).default(clock),
	/** Set by a trigger when the run reaches a terminal state; retention counts from here. */
	finished_at: sql.column(types.timestamptz).nullable(),
	/** The first run of a continuation chain. The insert trigger fills it with the run's own ID when it is omitted. */
	chain_root: sql.column(types.uuid).filled(),
	chain_index: sql.column(types.integer).default(0),
	continued_to: sql.column(types.uuid).nullable(),
	continuation: sql.column(types.jsonb()).nullable(),
	location: sql.column(types.jsonb()).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.id],
	unique: [[c.namespace, c.scope, c.kind, c.definition, c.key]],
	checks: [c.kind.in(['activity', 'workflow']), c.state.in(runStates)],
	indexes: [
		{ name: 'runs_ready', on: [c.namespace, c.state, c.created] },
		{ name: 'runs_expiry', on: [c.namespace, c.expires], where: c.state.eq('advancing') },
		{ name: 'runs_family', on: [c.namespace, c.family, c.state] },
		{ name: 'runs_parent', on: [c.namespace, c.parent] },
		{
			name: 'runs_finished',
			on: [c.namespace, c.finished_at, c.id],
			where: sql.and(c.id.eq(c.family), c.state.in(terminal)),
		},
	],
}));

/** Activity jobs of a run, including finalizers. `generation` changes with every claim. */
export const jobs = space.table('jobs', {
	namespace: sql.column(types.text()),
	id: sql.column(types.uuid),
	run: sql.column(types.uuid),
	path: sql.column(types.text()),
	definition: sql.column(types.jsonb()),
	input: sql.column(types.jsonb()),
	rules: sql.column(types.jsonb()),
	state: sql.column(types.text(jobStates)),
	finalizer: sql.column(types.boolean).default(false),
	generation: sql.column(types.integer).default(0),
	sequence: sql.column(types.integer).default(0),
	budget: sql.column(types.integer),
	host: sql.column(types.text()).nullable(),
	host_generation: sql.column(types.integer).nullable(),
	expires: sql.column(types.timestamptz).nullable(),
	deadline: sql.column(types.timestamptz).nullable(),
	available: sql.column(types.timestamptz).default(clock),
	outcome: sql.column(types.jsonb()).nullable(),
	location: sql.column(types.jsonb()).nullable(),
	affinity: sql.column(types.jsonb()).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.id],
	unique: [[c.namespace, c.run, c.path]],
	checks: [c.state.in(jobStates)],
	foreignKeys: [{ columns: [c.namespace, c.run], references: runs, to: [runs.c.namespace, runs.c.id] }],
	indexes: [
		{ name: 'jobs_due', on: [c.namespace, c.state, c.available] },
		{ name: 'jobs_expiry', on: [c.namespace, c.expires], where: c.state.eq('claimed') },
		{ name: 'jobs_host', on: [c.namespace, c.host, c.host_generation, c.state] },
	],
}));

/** One row per claim of a job. */
export const attempts = space.table('attempts', {
	namespace: sql.column(types.text()),
	job: sql.column(types.uuid),
	generation: sql.column(types.integer),
	sequence: sql.column(types.integer),
	state: sql.column(types.text()),
	outcome: sql.column(types.jsonb()).nullable(),
	started: sql.column(types.timestamptz).default(clock),
	ended: sql.column(types.timestamptz).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.job, c.generation],
	foreignKeys: [{ columns: [c.namespace, c.job], references: jobs, to: [jobs.c.namespace, jobs.c.id] }],
}));

/** Replay history: one row per workflow instruction, keyed by its path in the run. */
export const instructions = space.table('instructions', {
	namespace: sql.column(types.text()),
	run: sql.column(types.uuid),
	path: sql.column(types.text()),
	fingerprint: sql.column(types.text()),
	type: sql.column(types.text()),
	job: sql.column(types.uuid).nullable(),
	child: sql.column(types.uuid).nullable(),
	due: sql.column(types.timestamptz).nullable(),
	discard: sql.column(types.boolean).default(false),
	outcome: sql.column(types.jsonb()).nullable(),
	bytes: sql.column(types.integer),
	/** The enclosing control step, so root instruction counts stay stable when controls add nested steps. */
	parent: sql.column(types.text()).nullable(),
	branches: sql.column(types.jsonb()).nullable(),
	/** A named event wait. Events can arrive before the wait and survive worker replacement. */
	event: sql.column(types.text()).nullable(),
	event_key: sql.column(types.text()).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.run, c.path],
	foreignKeys: [{ columns: [c.namespace, c.run], references: runs, to: [runs.c.namespace, runs.c.id] }],
	indexes: [
		{ name: 'instructions_timers', on: [c.namespace, c.due], where: sql.and(c.outcome.isNull(), c.due.isNotNull()) },
		{ name: 'instructions_child', on: [c.namespace, c.child], where: c.outcome.isNull() },
		{ name: 'instructions_parent', on: [c.namespace, c.run, c.parent] },
		{
			name: 'instructions_event',
			on: [c.namespace, c.run, c.event, c.event_key],
			unique: true,
			where: c.event.isNotNull(),
		},
	],
}));

/** Saved scope cleanup. It is separate from registration and survives process loss; `ordinal` keeps its order. */
export const cleanups = space.table('cleanups', {
	namespace: sql.column(types.text()),
	run: sql.column(types.uuid),
	path: sql.column(types.text()),
	scope: sql.column(types.text()).nullable(),
	ordinal: sql.column(types.long).serial(),
	request: sql.column(types.jsonb()),
	state: sql.column(types.text()).default('pending'),
	job: sql.column(types.uuid).nullable(),
	child: sql.column(types.uuid).nullable(),
	outcome: sql.column(types.jsonb()).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.run, c.path],
	foreignKeys: [{ columns: [c.namespace, c.run], references: runs, to: [runs.c.namespace, runs.c.id] }],
	indexes: [{ name: 'cleanups_pending', on: [c.namespace, c.run, c.state, c.ordinal] }],
}));

/** Business write receipts, saved in the same transaction as the write. */
export const receipts = space.table('receipts', {
	namespace: sql.column(types.text()),
	job: sql.column(types.uuid),
	key: sql.column(types.text()),
	contract: sql.column(types.text()),
	fingerprint: sql.column(types.text()),
	value: sql.column(types.jsonb()),
	created: sql.column(types.timestamptz).default(clock),
}, (c) => ({
	primaryKey: [c.namespace, c.job, c.key],
	foreignKeys: [{ columns: [c.namespace, c.job], references: jobs, to: [jobs.c.namespace, jobs.c.id] }],
}));

/** Operator decisions, each recorded in run history by a trigger. */
export const audit = space.table('audit', {
	namespace: sql.column(types.text()),
	id: sql.column(types.uuid),
	run: sql.column(types.uuid),
	epoch: sql.column(types.integer),
	actor: sql.column(types.text()),
	reason: sql.column(types.text()),
	action: sql.column(types.text()),
	created: sql.column(types.timestamptz).default(clock),
}, (c) => ({
	primaryKey: [c.namespace, c.id],
	foreignKeys: [{ columns: [c.namespace, c.run], references: runs, to: [runs.c.namespace, runs.c.id] }],
}));

/** Named events delivered to a run, kept until the run consumes them. */
export const events = space.table('events', {
	namespace: sql.column(types.text()),
	run: sql.column(types.uuid),
	event: sql.column(types.text()),
	key: sql.column(types.text()),
	value: sql.column(types.jsonb()),
	fingerprint: sql.column(types.text()),
	bytes: sql.column(types.integer),
	created: sql.column(types.timestamptz).default(clock),
}, (c) => ({
	primaryKey: [c.namespace, c.run, c.event, c.key],
	foreignKeys: [{ columns: [c.namespace, c.run], references: runs, to: [runs.c.namespace, runs.c.id] }],
}));

/** The latest progress report for each activity and declared effect. Older reports are replaced. */
export const progress = space.table('progress', {
	namespace: sql.column(types.text()),
	run: sql.column(types.uuid),
	job: sql.column(types.uuid),
	effect: sql.column(types.text()),
	generation: sql.column(types.integer),
	sequence: sql.column(types.integer),
	attempt: sql.column(types.integer),
	revision: sql.column(types.uuid),
	occurrence: sql.column(types.jsonb()),
	bytes: sql.column(types.integer),
	reported_at: sql.column(types.timestamptz).default(clock),
}, (c) => ({
	primaryKey: [c.namespace, c.run, c.job, c.effect],
	foreignKeys: [{ columns: [c.namespace, c.job], references: jobs, to: [jobs.c.namespace, jobs.c.id] }],
}));

/**
 * Operational history, written only by triggers. It has its own retention and does not copy replay inputs, outcomes
 * or progress payloads. `sequence` counts from 1 for each run.
 */
export const runEvents = space.table('run_events', {
	namespace: sql.column(types.text()),
	run: sql.column(types.uuid),
	sequence: sql.column(types.long),
	recorded_at: sql.column(types.timestamptz).default(clock),
	kind: sql.column(types.text(eventKinds)),
	job_id: sql.column(types.uuid).nullable(),
	prior_state: sql.column(types.text()).nullable(),
	state: sql.column(types.text()),
	paused: sql.column(types.boolean),
	control_revision: sql.column(types.integer),
	epoch: sql.column(types.integer),
	action: sql.column(types.text()).nullable(),
	actor: sql.column(types.text()).nullable(),
	reason: sql.column(types.text()).nullable(),
}, (c) => ({
	primaryKey: [c.namespace, c.run, c.sequence],
	checks: [c.kind.in(eventKinds)],
	foreignKeys: [{ columns: [c.namespace, c.run], references: runs, to: [runs.c.namespace, runs.c.id] }],
}));

/** Saved compute placement nodes. A node's `generation` only grows; a replaced node fails older hosts. */
export const compute = space.table('compute', {
	namespace: sql.column(types.text()),
	id: sql.column(types.text()),
	generation: sql.column(types.long),
	value: sql.column(types.jsonb()),
}, (c) => ({ primaryKey: [c.namespace, c.id] }));

/** Every table, in the order the migration creates them. */
export const tables = [
	version,
	hosts,
	runs,
	jobs,
	attempts,
	instructions,
	cleanups,
	receipts,
	audit,
	events,
	progress,
	runEvents,
	compute,
] as const;
