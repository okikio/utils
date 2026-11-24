/**
 * Job and attempt statements. A job's `generation` changes with every claim and every revocation, so a stale claim
 * can never match the guard again.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { json, types } from '@okikio/sql/postgres';
import { attempts, hosts, jobs, runs } from '../schema/mod.ts';
import { after, clock, live } from './shared.ts';

const j = jobs.c;
const a = attempts.c;
const r = runs.c;
const h = hosts.c;

/** Every column of a job. */
export const row = j;

/** Save a new ready job. No activity code runs until a host takes it. */
export function add(job: sql.InsertRow<typeof jobs.columns, never>) {
	return sql.insert(jobs, job);
}

/** Running activity attempts of one host lifetime, with the host's limit. */
export function slots(namespace: string, host: string) {
	const running = sql.aggregate(
		sql.select({ count: sql.fn.count() }).from(jobs).where(
			j.namespace.eq(h.namespace),
			j.host.eq(h.id),
			j.host_generation.eq(h.generation),
			j.state.eq('claimed'),
			j.expires.gt(clock),
		),
	);
	return sql.select({ limit: h.activities, active: running }).from(hosts).where(
		h.namespace.eq(namespace),
		h.id.eq(host),
	);
}

/** Running attempts on every host below one compute node. */
export function occupied(namespace: string, node: { id: string; generation: number }) {
	return sql.select({ active: sql.fn.count() }).from(jobs).join(
		hosts,
		sql.and(h.namespace.eq(j.namespace), h.id.eq(j.host), h.generation.eq(j.host_generation)),
	).where(
		j.namespace.eq(namespace),
		j.state.eq('claimed'),
		j.expires.gt(clock),
		json.contains(h.compute, sql.value([node], types.jsonb())),
	);
}

/**
 * Up to 32 ready jobs this host may take, finalizers first. Runs that other hosts hold are skipped before the limit,
 * then each candidate is taken under its own run lock.
 */
export function candidates(
	namespace: string,
	host: { definitions: readonly unknown[]; lineage: readonly unknown[]; affinity: unknown; finalizer?: boolean },
) {
	const d = json.elements(sql.value(host.definitions, types.jsonb()), 'd');
	const within = sql.coalesce(json.get(j.location, 'within'), sql.value([], types.jsonb()));
	const on = json.get(j.location, 'on');
	return sql.select({ id: j.id, run: j.run }).from(jobs).join(
		runs,
		sql.and(r.namespace.eq(j.namespace), r.id.eq(j.run)),
	)
		.where(
			j.namespace.eq(namespace),
			j.state.eq('ready'),
			j.available.lte(clock),
			r.state.in(live),
			sql.or(sql.not(r.paused), j.finalizer),
			...(host.finalizer === undefined ? [] : [j.finalizer.eq(host.finalizer)]),
			sql.exists(sql.select({}).from(d).where(d.c.value.eq(j.definition))),
			sql.or(
				j.location.isNull(),
				sql.and(
					json.within(within, sql.value(host.lineage, types.jsonb())),
					sql.or(on.isNull(), json.contains(sql.value(host.lineage.at(-1) ?? {}, types.jsonb()), on)),
				),
			),
			sql.or(j.affinity.isNull(), json.within(j.affinity, sql.value(host.affinity, types.jsonb()))),
		).orderBy(j.finalizer.desc(), j.available, j.id).limit(32).for({ of: [runs], skipLocked: true });
}

/** One ready, due job, locked for the claim. */
export function due(namespace: string, id: string) {
	return sql.select(j).from(jobs).where(
		j.namespace.eq(namespace),
		j.id.eq(id),
		j.state.eq('ready'),
		j.available.lte(clock),
	).for();
}

/**
 * Claim a job for one attempt. The lease never passes the attempt's deadline, and the deadline is fixed here:
 * renewal extends permission to work, not the total time to finish.
 */
export function claim(
	namespace: string,
	id: string,
	claim: {
		generation: number;
		sequence: number;
		host: string;
		hostGeneration: number;
		lease: number;
		deadline: number;
	},
) {
	return sql.update(jobs, {
		state: 'claimed',
		generation: claim.generation,
		sequence: claim.sequence,
		host: claim.host,
		host_generation: claim.hostGeneration,
		expires: sql.fn.least(after(claim.lease), after(claim.deadline)),
		deadline: after(claim.deadline),
	}).where(j.namespace.eq(namespace), j.id.eq(id));
}

/** Record a started attempt. */
export function start(namespace: string, job: string, generation: number, sequence: number) {
	return sql.insert(attempts, { namespace, job, generation, sequence, state: 'started' });
}

/** The job a live claim holds, locked. A claim past its lease or deadline does not match. */
export function guard(
	namespace: string,
	claim: { job: string; run: string; generation: number; host: string; hostGeneration: number },
) {
	return sql.select(j).from(jobs).where(
		j.namespace.eq(namespace),
		j.id.eq(claim.job),
		j.run.eq(claim.run),
		j.state.eq('claimed'),
		j.generation.eq(claim.generation),
		j.host.eq(claim.host),
		j.host_generation.eq(claim.hostGeneration),
		j.expires.gt(clock),
		j.deadline.gt(clock),
	).for();
}

/** Extend an attempt lease from now, but never past its deadline. */
export function extend(namespace: string, id: string, lease: number) {
	return sql.update(jobs, { expires: sql.fn.least(j.deadline, after(lease)) }).where(
		j.namespace.eq(namespace),
		j.id.eq(id),
	);
}

/** The job saved at a path of a run, such as the finalizer. */
export function at(namespace: string, run: string, path: string) {
	return sql.select({ id: j.id }).from(jobs).where(j.namespace.eq(namespace), j.run.eq(run), j.path.eq(path));
}

/** Which jobs of a run a revocation covers. */
export type ScopeType = { readonly prefix: string } | { readonly ordinary: true };

function covered(scope: ScopeType): sql.Expr<boolean, typeof jobs.key> {
	return 'prefix' in scope ? sql.fn.startsWith(j.path, scope.prefix) : sql.not(j.finalizer);
}

/** End the running attempts of revoked jobs: a race's losing branch, or every ordinary job of a finished run. */
export function revokeAttempts(namespace: string, run: string, scope: ScopeType) {
	return sql.update(attempts, { state: 'cancelled', ended: clock }).from(jobs).where(
		j.namespace.eq(namespace),
		j.run.eq(run),
		covered(scope),
		j.state.eq('claimed'),
		a.namespace.eq(j.namespace),
		a.job.eq(j.id),
		a.generation.eq(j.generation),
	);
}

/** Fail revoked jobs. A new generation makes their claims stale. */
export function revoke(namespace: string, run: string, scope: ScopeType, outcome: unknown) {
	return sql.update(jobs, { state: 'failed', outcome, expires: null, generation: sql.add(j.generation, 1) }).where(
		j.namespace.eq(namespace),
		j.run.eq(run),
		covered(scope),
		j.state.in(['ready', 'claimed']),
	);
}

/** On cancellation, end every started attempt of the run's ordinary jobs with the cancellation outcome. */
export function cancelAttempts(namespace: string, run: string, outcome: unknown) {
	return sql.update(attempts, { state: 'cancelled', outcome, ended: clock }).where(
		a.namespace.eq(namespace),
		a.state.eq('started'),
		sql.exists(
			sql.select({}).from(jobs).where(
				j.namespace.eq(a.namespace),
				j.id.eq(a.job),
				j.run.eq(run),
				sql.not(j.finalizer),
			),
		),
	);
}

/** On cancellation, fail every ordinary job that has not ended, including blocked ones. */
export function cancel(namespace: string, run: string, outcome: unknown) {
	return sql.update(jobs, { state: 'failed', outcome, generation: sql.add(j.generation, 1), expires: null }).where(
		j.namespace.eq(namespace),
		j.run.eq(run),
		sql.not(j.finalizer),
		j.state.in(['ready', 'claimed', 'blocked']),
	);
}

/** Save an attempt's result. */
export function settle(namespace: string, job: string, generation: number, state: string, outcome: unknown) {
	return sql.update(attempts, { state, outcome, ended: clock }).where(
		a.namespace.eq(namespace),
		a.job.eq(job),
		a.generation.eq(generation),
	);
}

/** Mark an attempt that lost its authority. */
export function abandon(namespace: string, job: string, generation: number) {
	return sql.update(attempts, { state: 'abandoned' }).where(
		a.namespace.eq(namespace),
		a.job.eq(job),
		a.generation.eq(generation),
	);
}

/** Hold a job whose effect is unknown until an operator reconciles it. */
export function block(namespace: string, id: string, outcome: unknown) {
	return sql.update(jobs, { state: 'blocked', outcome, expires: null }).where(j.namespace.eq(namespace), j.id.eq(id));
}

/** Make a job ready again after `delay` milliseconds. */
export function retry(namespace: string, id: string, outcome: unknown, delay: number) {
	return sql.update(jobs, { state: 'ready', outcome, expires: null, available: after(delay) }).where(
		j.namespace.eq(namespace),
		j.id.eq(id),
	);
}

/** End a job with its final result. */
export function finish(namespace: string, id: string, state: 'completed' | 'failed', outcome: unknown) {
	return sql.update(jobs, { state, outcome, expires: null }).where(j.namespace.eq(namespace), j.id.eq(id));
}

/** A live host still owns this claim. */
function owned(): sql.Expr<boolean, typeof jobs.key> {
	return sql.exists(
		sql.select({}).from(hosts).where(
			h.namespace.eq(j.namespace),
			h.id.eq(j.host),
			h.generation.eq(j.host_generation),
			sql.not(h.draining),
			h.expires.gt(clock),
		),
	);
}

/** A claim past its lease or deadline, or whose host lifetime ended. */
const lost = sql.or(j.expires.lte(clock), j.deadline.lte(clock), sql.not(owned()));

/**
 * Claimed jobs that lost their authority, oldest lease first. Inactive owners are filtered before the limit, so
 * retained history cannot starve recovery.
 */
export function lostClaims(namespace: string, limit: number) {
	return sql.select({ id: j.id, run: j.run }).from(jobs).join(
		runs,
		sql.and(r.namespace.eq(j.namespace), r.id.eq(j.run)),
	)
		.where(j.namespace.eq(namespace), j.state.eq('claimed'), r.state.in(live), lost).orderBy(j.expires).limit(limit);
}

/** One job that still lost its authority, locked; another host may have recovered it since discovery. */
export function lostClaim(namespace: string, id: string) {
	return sql.select(j).from(jobs).where(j.namespace.eq(namespace), j.id.eq(id), j.state.eq('claimed'), lost).for();
}

/** Jobs an operator repair can restart, finalizers first. */
export function repairable(namespace: string, run: string) {
	return sql.select(j).from(jobs).where(j.namespace.eq(namespace), j.run.eq(run), j.state.in(['blocked', 'failed']))
		.orderBy(j.finalizer.desc(), j.id).for();
}

/** Restart a job with `attempts` more tries. */
export function restart(namespace: string, id: string, attempts: number) {
	return sql.update(jobs, {
		state: 'ready',
		budget: sql.add(j.sequence, attempts),
		generation: sql.add(j.generation, 1),
		available: clock,
		expires: null,
	}).where(j.namespace.eq(namespace), j.id.eq(id));
}
