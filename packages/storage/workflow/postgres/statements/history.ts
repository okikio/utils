/**
 * Replay history statements: instructions, named events and progress reports. All three share a run's history byte
 * budget, which the caller checks under the run lock before it adds bytes.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { types } from '@okikio/sql';
import type { Temporal } from '@okikio/duration/temporal';
import { events, instructions, jobs, progress, runs } from '../schema/mod.ts';
import { clock } from './shared.ts';

const i = instructions.c;
const e = events.c;
const p = progress.c;

function step(namespace: string, run: string): sql.Expr<boolean>[] {
	return [i.namespace.eq(namespace), i.run.eq(run)];
}

/** One saved instruction. */
export function instruction(namespace: string, run: string, path: string) {
	return sql.select(i).from(instructions).where(...step(namespace, run), i.path.eq(path));
}

/** A saved race control step. */
export function race(namespace: string, run: string, path: string) {
	return sql.select(i).from(instructions).where(...step(namespace, run), i.path.eq(path), i.type.eq('control'));
}

/** How many instructions a run saved: all, the root ones, or the ones nested under one control step. */
export function count(namespace: string, run: string, parent?: string | null) {
	const nested = parent === undefined ? [] : [parent === null ? i.parent.isNull() : i.parent.eq(parent)];
	return sql.select({ count: sql.fn.count() }).from(instructions).where(...step(namespace, run), ...nested);
}

/** Save a requested instruction, with its result when it already has one. */
export function add(step: sql.InsertRow<typeof instructions.columns>) {
	return sql.insert(instructions, step);
}

/** Save the result of a pending instruction and count its bytes. A recorded result is never replaced. */
export function record(namespace: string, run: string, path: string, outcome: unknown, bytes: number) {
	return sql.update(instructions, { outcome, bytes: sql.add(i.bytes, bytes) }).where(
		...step(namespace, run),
		i.path.eq(path),
		i.outcome.isNull(),
	);
}

/** The saved results of the given paths. */
export function outcomes(namespace: string, run: string, paths: readonly string[]) {
	return sql.select({ path: i.path, outcome: i.outcome }).from(instructions).where(
		...step(namespace, run),
		i.path.in(paths),
	);
}

/** The wait for a named event and key, and whether its timeout passed. */
export function waiting(namespace: string, run: string, event: string, key: string) {
	return sql.select({
		path: i.path,
		outcome: i.outcome,
		due: i.due,
		expired: sql.coalesce(i.due.lte(clock), false),
	}).from(instructions).where(...step(namespace, run), i.event.eq(event), i.event_key.eq(key));
}

/** Pending instructions under a race branch that lost. */
export function abandoned(namespace: string, run: string, prefix: string) {
	return sql.select({ path: i.path }).from(instructions).where(
		...step(namespace, run),
		sql.fn.startsWith(i.path, prefix),
		i.outcome.isNull(),
	);
}

/** One pending instruction, locked while recovery records its result. */
export function pending(namespace: string, run: string, path: string) {
	return sql.select(i).from(instructions).where(...step(namespace, run), i.path.eq(path), i.outcome.isNull()).for();
}

/**
 * Pending timers that passed and child waits whose child ended, in runs that can still advance. Recovery wakes
 * them without any live JavaScript timer.
 */
export function wakeable(namespace: string, limit: number) {
	const r = runs.c;
	const child = runs.as('c');
	return sql.select({ run: i.run, path: i.path }).from(instructions).join(
		runs,
		sql.and(r.namespace.eq(i.namespace), r.id.eq(i.run)),
	).where(
		i.namespace.eq(namespace),
		r.state.in(['waiting', 'ready', 'advancing']),
		i.outcome.isNull(),
		sql.or(
			sql.and(i.due.isNotNull(), i.due.lte(clock)),
			sql.and(
				i.child.isNotNull(),
				sql.exists(
					sql.select({}).from(child).where(
						child.c.namespace.eq(i.namespace),
						child.c.id.eq(i.child),
						child.c.state.in(['completed', 'failed', 'cancelled']),
					),
				),
			),
		),
	).orderBy(i.run, i.path).limit(limit);
}

/** The fingerprint of a delivered event, if any. */
export function event(namespace: string, run: string, name: string, key: string) {
	return sql.select({ fingerprint: e.fingerprint }).from(events).where(
		e.namespace.eq(namespace),
		e.run.eq(run),
		e.event.eq(name),
		e.key.eq(key),
	);
}

/** Save a delivered event. */
export function deliver(item: sql.InsertRow<typeof events.columns>) {
	return sql.insert(events, item);
}

/** The value of a delivered event, optionally only one delivered no later than `before`. */
export function received(namespace: string, run: string, name: string, key: string, before?: Temporal.Instant) {
	return sql.select({ value: e.value }).from(events).where(
		e.namespace.eq(namespace),
		e.run.eq(run),
		e.event.eq(name),
		e.key.eq(key),
		...(before === undefined ? [] : [e.created.lte(before)]),
	);
}

/** The saved progress report of one activity effect. */
export function report(namespace: string, run: string, job: string, effect: string) {
	return sql.select(p).from(progress).where(
		p.namespace.eq(namespace),
		p.run.eq(run),
		p.job.eq(job),
		p.effect.eq(effect),
	);
}

/** Save the latest progress report of an effect, replacing an older one. */
export function saveReport(item: Omit<sql.InsertRow<typeof progress.columns>, 'reported_at'>) {
	const fresh = sql.excluded(progress).c;
	return sql.insert(progress, item).onConflict({
		target: [p.namespace, p.run, p.job, p.effect],
		action: 'update',
		set: {
			generation: fresh.generation,
			sequence: fresh.sequence,
			attempt: fresh.attempt,
			revision: fresh.revision,
			occurrence: fresh.occurrence,
			bytes: fresh.bytes,
			reported_at: clock,
		},
	});
}

/**
 * Progress reports of a run, and with `children` of its descendants in the same scope, by job and effect. One row past
 * the 1,000 shown tells the caller the list was cut.
 */
export function reports(namespace: string, run: { id: string; scope: string }, children: boolean) {
	const r = runs.c;
	const j = jobs.c;
	const root = sql.select({ id: r.id }).from(runs).where(r.namespace.eq(namespace), r.id.eq(run.id));
	const tree = children
		? sql.recursive('tree', { id: types.uuid }, (self) =>
			sql.unionAll(
				root,
				sql.select({ id: r.id }).from(runs).join(self, r.parent.eq(self.c.id)).where(
					r.namespace.eq(namespace),
					r.scope.eq(run.scope),
				),
			))
		: sql.cte('tree', root);
	return sql.select({ ...p, path: j.path, scope: r.scope, kind: r.kind, definition: r.definition, version: r.version })
		.with(tree).from(tree).join(progress, sql.and(p.namespace.eq(namespace), p.run.eq(tree.c.id)))
		.join(runs, sql.and(r.namespace.eq(p.namespace), r.id.eq(p.run)))
		.join(jobs, sql.and(j.namespace.eq(p.namespace), j.id.eq(p.job)))
		.orderBy(p.job, p.effect).limit(1001);
}
