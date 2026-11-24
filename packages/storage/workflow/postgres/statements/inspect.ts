/**
 * Read-only inspection statements. Each one selects declared metadata columns only; saved business JSON never reaches
 * an operator response. Every list orders by a unique key and reads one row past the page, so a cursor can resume it.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { json } from '@okikio/sql/postgres';
import type { Temporal } from '@okikio/duration/temporal';
import { attempts, hosts, instructions, jobs, progress, runEvents, runs, type runStates } from '../schema/mod.ts';

/** A run state. */
type StateType = (typeof runStates)[number];

const r = runs.c;
const j = jobs.c;
const now = sql.fn.transactionTimestamp();

/** Instruction types that wait: timers, named events and child runs. */
const waits = ['sleep', 'sleep-until', 'wait-event', 'child-workflow'];

/** The run metadata an inspection shows. */
const projection = {
	id: r.id,
	namespace: r.namespace,
	scope: r.scope,
	kind: r.kind,
	definition: r.definition,
	version: r.version,
	state: r.state,
	paused: r.paused,
	control_revision: r.control_revision,
	epoch: r.epoch,
	generation: r.generation,
	family: r.family,
	parent: r.parent,
	chain_root: r.chain_root,
	chain_index: r.chain_index,
	continued_to: r.continued_to,
	created: r.created,
	updated_at: r.updated_at,
	finished_at: r.finished_at,
	expires: r.expires,
	host: r.host,
	host_generation: r.host_generation,
	outcome_type: json.text(r.outcome, 'type'),
	has_reason: r.reason.isNotNull(),
	policy_id: json.text(r.policy, 'id'),
	policy_version: json.text(r.policy, 'version'),
};

/** A run as an inspection reads it. */
export type RunRow = sql.RowOfShape<typeof projection>;

/** The snapshot's statement limit and time; every age is measured from this time. */
export const timeout: sql.Statement<{ value: string }> = sql.select({
	value: sql.fn.setLocal('statement_timeout', '5s'),
});
export const observed: sql.Statement<{ at: Temporal.Instant }> = sql.select({ at: now });

/** The run, only when every part of the reference matches what was saved. */
export function owner(
	namespace: string,
	ref: { id: string; scope: string; definition: { kind: 'activity' | 'workflow'; id: string; version: string } },
) {
	return sql.select(projection).from(runs).where(
		r.namespace.eq(namespace),
		r.id.eq(ref.id),
		r.scope.eq(ref.scope),
		r.kind.eq(ref.definition.kind),
		r.definition.eq(ref.definition.id),
		r.version.eq(ref.definition.version),
	);
}

/** One page of a run's jobs by ID. */
export function jobPage(namespace: string, run: string, after: string | null, limit: number) {
	return sql.select({
		id: j.id,
		path: j.path,
		definition: j.definition,
		state: j.state,
		finalizer: j.finalizer,
		generation: j.generation,
		sequence: j.sequence,
		budget: j.budget,
		available: j.available,
		deadline: j.deadline,
		expires: j.expires,
		host: j.host,
		host_generation: j.host_generation,
		outcome_type: json.text(j.outcome, 'type'),
	}).from(jobs).where(j.namespace.eq(namespace), j.run.eq(run), ...(after === null ? [] : [j.id.gt(after)]))
		.orderBy(j.id).limit(limit);
}

/** Counts of a run's jobs, waits, attempts, progress and history. */
export function totals(namespace: string, run: string) {
	const i = instructions.c;
	const a = attempts.c;
	const p = progress.c;
	const e = runEvents.as('e');
	const counted = <Q extends sql.Subquery<{ count: number }>>(query: Q) => sql.aggregate(query);
	const ofJobs = (...more: sql.Expr<boolean, typeof jobs.key>[]) =>
		counted(sql.select({ count: sql.fn.count() }).from(jobs).where(j.namespace.eq(namespace), j.run.eq(run), ...more));
	return sql.select({
		jobs: ofJobs(),
		ready: ofJobs(j.state.eq('ready')),
		claimed: ofJobs(j.state.eq('claimed')),
		waiting: counted(
			sql.select({ count: sql.fn.count() }).from(instructions).where(
				i.namespace.eq(namespace),
				i.run.eq(run),
				i.type.in(waits),
				i.outcome.isNull(),
			),
		),
		attempts: counted(
			sql.select({ count: sql.fn.count() }).from(attempts).join(
				jobs,
				sql.and(j.namespace.eq(a.namespace), j.id.eq(a.job)),
			).where(j.namespace.eq(namespace), j.run.eq(run)),
		),
		progress: counted(
			sql.select({ count: sql.fn.count() }).from(progress).where(p.namespace.eq(namespace), p.run.eq(run)),
		),
		history_events: counted(
			sql.select({ count: sql.fn.count() }).from(e).where(e.c.namespace.eq(namespace), e.c.run.eq(run)),
		),
		history_bytes: counted(
			sql.select({ count: sql.coalesce(sql.fn.sum(sql.fn.size(e)), 0) }).from(e).where(
				e.c.namespace.eq(namespace),
				e.c.run.eq(run),
			),
		),
	});
}

/** A job of the run, to check an attempts filter. */
export function job(namespace: string, run: string, id: string) {
	return sql.select({ id: j.id }).from(jobs).where(j.namespace.eq(namespace), j.run.eq(run), j.id.eq(id));
}

/** One page of a run's attempts by job and generation. */
export function attemptPage(
	namespace: string,
	run: string,
	options: { job: string | null; after: { job: string; generation: number } | null; limit: number },
) {
	const a = attempts.c;
	return sql.select({
		job: a.job,
		path: j.path,
		generation: a.generation,
		sequence: a.sequence,
		state: a.state,
		started: a.started,
		ended: a.ended,
		outcome_type: json.text(a.outcome, 'type'),
	}).from(attempts).join(jobs, sql.and(j.namespace.eq(a.namespace), j.id.eq(a.job))).where(
		j.namespace.eq(namespace),
		j.run.eq(run),
		...(options.job === null ? [] : [a.job.eq(options.job)]),
		...(options.after === null ? [] : [sql.row(a.job, a.generation).gt([options.after.job, options.after.generation])]),
	).orderBy(a.job, a.generation).limit(options.limit);
}

/** One page of a run's waits by path. */
export function waitPage(namespace: string, run: string, after: string | null, limit: number) {
	const i = instructions.c;
	return sql.select({
		path: i.path,
		type: i.type,
		due: i.due,
		child: i.child,
		event: i.event,
		resolved: i.outcome.isNotNull(),
		outcome_type: json.text(i.outcome, 'type'),
	}).from(instructions).where(
		i.namespace.eq(namespace),
		i.run.eq(run),
		i.type.in(waits),
		...(after === null ? [] : [i.path.gt(after)]),
	).orderBy(i.path).limit(limit);
}

/** One page of a run's progress reports by job and effect. */
export function progressPage(
	namespace: string,
	run: string,
	after: { job: string; effect: string } | null,
	limit: number,
) {
	const p = progress.c;
	return sql.select({
		job: p.job,
		path: j.path,
		effect: p.effect,
		generation: p.generation,
		attempt: p.attempt,
		sequence: p.sequence,
		revision: p.revision,
		reported_at: p.reported_at,
		bytes: p.bytes,
	}).from(progress).join(jobs, sql.and(j.namespace.eq(p.namespace), j.id.eq(p.job))).where(
		p.namespace.eq(namespace),
		p.run.eq(run),
		...(after === null ? [] : [sql.row(p.job, p.effect).gt([after.job, after.effect])]),
	).orderBy(p.job, p.effect).limit(limit);
}

/** The retained history range of a run, its size and the first entry's kind. */
export function historyRange(namespace: string, run: string) {
	const e = runEvents.as('e');
	const first = sql.scalar(
		sql.select({ kind: e.c.kind }).from(e).where(e.c.namespace.eq(namespace), e.c.run.eq(run))
			.orderBy(e.c.sequence).limit(1),
	);
	return sql.select({
		first: sql.fn.min(e.c.sequence),
		last: sql.fn.max(e.c.sequence),
		count: sql.fn.count(),
		bytes: sql.coalesce(sql.fn.sum(sql.fn.size(e)), 0),
		kind: first,
	}).from(e).where(e.c.namespace.eq(namespace), e.c.run.eq(run));
}

/** One page of a run's history after a sequence. */
export function historyPage(namespace: string, run: string, after: number | null, limit: number) {
	const e = runEvents.c;
	return sql.select({
		sequence: e.sequence,
		recorded_at: e.recorded_at,
		kind: e.kind,
		job_id: e.job_id,
		prior_state: e.prior_state,
		state: e.state,
		paused: e.paused,
		control_revision: e.control_revision,
		epoch: e.epoch,
		action: e.action,
		actor: e.actor,
		has_reason: e.reason.isNotNull(),
	}).from(runEvents).where(
		e.namespace.eq(namespace),
		e.run.eq(run),
		...(after === null ? [] : [e.sequence.gt(after)]),
	).orderBy(e.sequence).limit(limit);
}

/** Runs of a scope in the given states, by creation time and ID. */
export function queuePage(
	namespace: string,
	scope: string,
	states: readonly StateType[],
	after: { created: Temporal.Instant; id: string } | null,
	limit: number,
) {
	return sql.select(projection).from(runs).where(
		r.namespace.eq(namespace),
		r.scope.eq(scope),
		r.state.in(states),
		...(after === null ? [] : [sql.row(r.created, r.id).gt([after.created, after.id])]),
	).orderBy(r.created, r.id).limit(limit);
}

/** Run counts of a scope in the given states. */
export function queueTotals(namespace: string, scope: string, states: readonly StateType[]) {
	return sql.select({ runs: sql.fn.count(), paused: sql.fn.count(r.paused), oldest: sql.fn.min(r.created) }).from(runs)
		.where(r.namespace.eq(namespace), r.scope.eq(scope), r.state.in(states));
}

/** Due ready jobs of a scope's runs in the given states. */
export function queueDue(namespace: string, scope: string, states: readonly StateType[]) {
	return sql.select({ jobs: sql.fn.count(), oldest: sql.fn.min(j.available) }).from(jobs).join(
		runs,
		sql.and(r.namespace.eq(j.namespace), r.id.eq(j.run)),
	).where(
		r.namespace.eq(namespace),
		r.scope.eq(scope),
		r.state.in(states),
		j.state.eq('ready'),
		j.available.lte(now),
	);
}

/** One page of hosts by ID, with running and expired claims. */
export function hostPage(namespace: string, after: string | null, limit: number) {
	const h = hosts.c;
	const claims = (table: 'runs' | 'jobs', live: boolean) => {
		const [owner, state, expires] = table === 'runs'
			? [r, r.state.eq('advancing'), r.expires]
			: [j, j.state.eq('claimed'), j.expires];
		return sql.aggregate(
			sql.select({ count: sql.fn.count() }).from(table === 'runs' ? runs : jobs).where(
				owner.namespace.eq(h.namespace),
				owner.host.eq(h.id),
				owner.host_generation.eq(h.generation),
				state,
				live ? expires.gt(now) : expires.lte(now),
			),
		);
	};
	return sql.select({
		id: h.id,
		generation: h.generation,
		engine: h.engine,
		definitions: json.length(h.definitions),
		draining: h.draining,
		expires: h.expires,
		live: h.expires.gt(now),
		activations: h.activations,
		activities: h.activities,
		active_runs: claims('runs', true),
		expired_runs: claims('runs', false),
		active_jobs: claims('jobs', true),
		expired_jobs: claims('jobs', false),
	}).from(hosts).where(h.namespace.eq(namespace), ...(after === null ? [] : [h.id.gt(after)])).orderBy(h.id)
		.limit(limit);
}
