/**
 * The workflow triggers. They hold three invariants for every writer, including older workers and operator SQL:
 *
 * - **Wake-ups.** A change that can make work runnable sends `pg_notify('utils_workflow', namespace)`. PostgreSQL
 *   delivers it after commit and merges identical notices in one transaction. It never carries business data, and
 *   lease renewal or progress reports never send one.
 * - **Run times.** `updated_at` moves when a run's visible state changes, and `finished_at` is set when the run
 *   reaches a terminal state, so retention counts from completion, not acceptance.
 * - **History.** Every run, job and operator change appends one `run_events` row with the next sequence of its run.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { trigger, types } from '@okikio/sql/postgres';
import { audit, hosts, instructions, jobs, name, runEvents, runs, terminal } from './tables.ts';

const notice = sql.declare('pg_notify', [types.text(), types.text()], types.empty);
const clock = sql.fn.clockTimestamp();
const op = trigger.operation;

/** Send the namespace of the changed row as a wake-up hint. */
export const notify: trigger.RoutineType = trigger.routine(name, 'notify', [
	trigger.perform(notice(name, trigger.changed(hosts, 'new').c.namespace)),
	trigger.result('null'),
]);

const fresh = trigger.changed(runs, 'new').c;
const prior = trigger.changed(runs, 'old').c;

/** The run columns whose change is visible to operators and history. */
const visible = (row: typeof fresh | typeof prior) =>
	sql.row(
		row.state,
		row.outcome,
		row.reason,
		row.paused,
		row.control_revision,
		row.epoch,
		row.continued_to,
		row.continuation,
	);

/** The update columns that fire the run triggers: the same columns as {@link visible}. */
const watched = [
	runs.c.state,
	runs.c.outcome,
	runs.c.reason,
	runs.c.paused,
	runs.c.control_revision,
	runs.c.epoch,
	runs.c.continued_to,
	runs.c.continuation,
];

/** Keep `chain_root`, `updated_at` and `finished_at` before the run row is written. */
export const touchRun: trigger.RoutineType = trigger.routine(name, 'touch_run', [
	trigger.branch(op.eq('INSERT'), [
		trigger.assign(fresh.chain_root, sql.coalesce(fresh.chain_root, fresh.id)),
		trigger.assign(fresh.updated_at, clock),
	], [
		trigger.branch(visible(prior).distinct(visible(fresh)), [trigger.assign(fresh.updated_at, clock)]),
	]),
	// Completion time moves only on the transition into a terminal state; leaving one clears it.
	trigger.branch(fresh.state.in(terminal), [
		trigger.branch(sql.or(op.eq('INSERT'), sql.not(prior.state.in(terminal))), [
			trigger.assign(fresh.finished_at, clock),
		]),
	], [trigger.assign(fresh.finished_at, null)]),
	trigger.result('new'),
]);

const history = runEvents.c;

/** The next history sequence of a run. The caller already holds the run lock, which serializes these numbers. */
function next(namespace: sql.Expr<string, 'new'>, run: sql.Expr<string, 'new'>): sql.Expr<number, 'new'> {
	return sql.aggregate(
		sql.select({ next: sql.add(sql.coalesce(sql.fn.max(history.sequence), 0), 1) }).from(runEvents).where(
			history.namespace.eq(namespace),
			history.run.eq(run),
		),
	);
}

/** Record a visible run change. An update that changes none of the visible columns records nothing. */
export const recordRun: trigger.RoutineType = trigger.routine(name, 'record_run', [
	trigger.branch(sql.and(op.eq('UPDATE'), visible(prior).same(visible(fresh))), [trigger.result('new')]),
	trigger.run(sql.insert(runEvents, {
		namespace: fresh.namespace,
		run: fresh.id,
		sequence: next(fresh.namespace, fresh.id),
		kind: 'run',
		prior_state: sql.choose(op.eq('UPDATE'), prior.state, null),
		state: fresh.state,
		paused: fresh.paused,
		control_revision: fresh.control_revision,
		epoch: fresh.epoch,
	})),
	trigger.result('new'),
]);

const job = trigger.changed(jobs, 'new').c;
const before = trigger.changed(jobs, 'old').c;
const owner = runs.c;

/**
 * Record a job state change with its run's control state.
 *
 * Every adapter job change already holds the run lock before it changes the job, so this trigger reads the run without
 * locking it. That lock also serializes the run's history sequence and avoids a job-to-run lock inversion.
 */
export const recordJob: trigger.RoutineType = trigger.routine(name, 'record_job', [
	trigger.branch(sql.and(op.eq('UPDATE'), before.state.same(job.state)), [trigger.result('new')]),
	trigger.run(sql.insert(
		runEvents,
		sql.select({
			namespace: job.namespace,
			run: job.run,
			sequence: next(job.namespace, job.run),
			kind: sql.value('job', runEvents.columns.kind.type),
			job_id: job.id,
			prior_state: sql.choose(op.eq('UPDATE'), before.state, null),
			state: job.state,
			paused: owner.paused,
			control_revision: owner.control_revision,
			epoch: owner.epoch,
		}).from(runs).where(owner.namespace.eq(job.namespace), owner.id.eq(job.run)),
	)),
	trigger.ensure('The run of a changed workflow job is missing.'),
	trigger.result('new'),
]);

const decision = trigger.changed(audit, 'new').c;

/** Record an operator decision with the run's current state. */
export const recordOperator: trigger.RoutineType = trigger.routine(name, 'record_operator', [
	trigger.run(sql.insert(
		runEvents,
		sql.select({
			namespace: decision.namespace,
			run: decision.run,
			sequence: next(decision.namespace, decision.run),
			kind: sql.value('operator', runEvents.columns.kind.type),
			state: owner.state,
			paused: owner.paused,
			control_revision: owner.control_revision,
			epoch: decision.epoch,
			action: decision.action,
			actor: decision.actor,
			reason: decision.reason,
		}).from(runs).where(owner.namespace.eq(decision.namespace), owner.id.eq(decision.run)),
	)),
	trigger.ensure('The run of an operator decision is missing.'),
	trigger.result('new'),
]);

const host = trigger.changed(hosts, 'new').c;
const lastHost = trigger.changed(hosts, 'old').c;
const step = trigger.changed(instructions, 'new').c;

/** Every trigger, with the function it runs. */
export const triggers: readonly trigger.TriggerType[] = [
	{ name: 'hosts_insert', table: hosts, timing: 'after', events: ['insert'], routine: notify },
	{
		name: 'hosts_change',
		table: hosts,
		timing: 'after',
		events: [{ update: [hosts.c.generation, hosts.c.draining] }],
		condition: sql.or(lastHost.generation.distinct(host.generation), lastHost.draining.distinct(host.draining)),
		routine: notify,
	},
	{ name: 'runs_insert', table: runs, timing: 'after', events: ['insert'], routine: notify },
	{
		name: 'runs_change',
		table: runs,
		timing: 'after',
		events: [{ update: [runs.c.state, runs.c.paused] }],
		condition: sql.or(prior.state.distinct(fresh.state), prior.paused.distinct(fresh.paused)),
		routine: notify,
	},
	{ name: 'jobs_insert', table: jobs, timing: 'after', events: ['insert'], routine: notify },
	{
		name: 'jobs_change',
		table: jobs,
		timing: 'after',
		events: [{ update: [jobs.c.state, jobs.c.available] }],
		condition: sql.or(before.state.distinct(job.state), before.available.distinct(job.available)),
		routine: notify,
	},
	{
		name: 'instructions_insert',
		table: instructions,
		timing: 'after',
		events: ['insert'],
		condition: sql.and(step.outcome.isNull(), step.due.isNotNull()),
		routine: notify,
	},
	{ name: 'runs_touch', table: runs, timing: 'before', events: ['insert', { update: watched }], routine: touchRun },
	{ name: 'runs_events', table: runs, timing: 'after', events: ['insert', { update: watched }], routine: recordRun },
	{
		name: 'jobs_events',
		table: jobs,
		timing: 'after',
		events: ['insert', { update: [jobs.c.state] }],
		routine: recordJob,
	},
	{ name: 'audit_events', table: audit, timing: 'after', events: ['insert'], routine: recordOperator },
];

/** Every trigger function. */
export const routines: readonly trigger.RoutineType[] = [notify, touchRun, recordRun, recordJob, recordOperator];
