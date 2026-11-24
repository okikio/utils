/**
 * Saved cleanup, write receipts and operator audit statements.
 *
 * Cleanup runs one registration at a time, in reverse registration order (`ordinal`), within a scope and its nested
 * scopes. A nested scope is written `parent/child`, so `starts_with(scope, 'parent/')` selects it.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { audit, cleanups, receipts, runs } from '../schema/mod.ts';
import { live } from './shared.ts';

const c = cleanups.c;

/** A scope and every scope nested in it. */
function within(scope: string): sql.Expr<boolean> {
	return sql.or(c.scope.eq(scope), sql.fn.startsWith(c.scope, `${scope}/`));
}

/** Register cleanup for later. */
export function defer(item: { namespace: string; run: string; path: string; scope: string | null; request: unknown }) {
	return sql.insert(cleanups, item);
}

/** One unfinished cleanup of a run, or of one scope, if any. */
export function unfinished(namespace: string, run: string, scope?: string) {
	return sql.select({ path: c.path }).from(cleanups).where(
		c.namespace.eq(namespace),
		c.run.eq(run),
		...(scope === undefined ? [] : [within(scope)]),
		c.state.ne('completed'),
	).limit(1);
}

/** Every unfinished cleanup of a run, or of one scope, newest registration first, locked. */
export function queue(namespace: string, run: string, scope?: string) {
	return sql.select(c).from(cleanups).where(
		c.namespace.eq(namespace),
		c.run.eq(run),
		c.state.ne('completed'),
		...(scope === undefined ? [] : [within(scope)]),
	).orderBy(c.ordinal.desc()).for();
}

/** Mark a cleanup as running, with the job or child run that performs it. */
export function start(
	namespace: string,
	run: string,
	path: string,
	work: { job: string | null; child: string | null },
) {
	return sql.update(cleanups, { state: 'running', ...work }).where(
		c.namespace.eq(namespace),
		c.run.eq(run),
		c.path.eq(path),
	);
}

/** Save a cleanup's result. */
export function end(namespace: string, run: string, path: string, state: 'completed' | 'failed', outcome: unknown) {
	return sql.update(cleanups, { state, outcome }).where(c.namespace.eq(namespace), c.run.eq(run), c.path.eq(path));
}

/** The cleanup a job performs, if any. */
export function of(namespace: string, run: string, job: string) {
	return sql.select(c).from(cleanups).where(c.namespace.eq(namespace), c.run.eq(run), c.job.eq(job));
}

/** One failed cleanup that a child run performed; a repair cannot replace it. */
export function failedChild(namespace: string, run: string) {
	return sql.select({ path: c.path }).from(cleanups).where(
		c.namespace.eq(namespace),
		c.run.eq(run),
		c.state.eq('failed'),
		c.child.isNotNull(),
	).limit(1);
}

/** A cleanup's state, locked. */
export function state(namespace: string, run: string, path: string) {
	return sql.select({ state: c.state }).from(cleanups).where(c.namespace.eq(namespace), c.run.eq(run), c.path.eq(path))
		.for();
}

/**
 * Running child cleanups whose child ended, or became blocked without the parent noting it yet. Recovery observes each
 * child without holding the child and parent locks together.
 */
export function finished(namespace: string, limit: number) {
	const child = runs.as('r');
	const parent = runs.as('p');
	return sql.select({ run: c.run, path: c.path, scope: c.scope, child: c.child }).from(cleanups)
		.join(child, sql.and(child.c.namespace.eq(c.namespace), child.c.id.eq(c.child)))
		.join(parent, sql.and(parent.c.namespace.eq(c.namespace), parent.c.id.eq(c.run)))
		.where(
			c.namespace.eq(namespace),
			c.state.eq('running'),
			parent.c.state.in(live),
			sql.or(
				child.c.state.in(['completed', 'failed', 'cancelled']),
				sql.and(child.c.state.eq('blocked'), parent.c.reason.distinct('cleanup_child_blocked')),
			),
		).orderBy(c.ordinal, c.run, c.path).limit(limit);
}

const w = receipts.c;

/** The saved receipt of one write of a job. */
export function receipt(namespace: string, job: string, key: string) {
	return sql.select(w).from(receipts).where(w.namespace.eq(namespace), w.job.eq(job), w.key.eq(key));
}

/** Save a write receipt in the business transaction. */
export function save(item: Omit<sql.InsertRow<typeof receipts.columns>, 'created'>) {
	return sql.insert(receipts, item);
}

/** Record an operator decision; a trigger adds it to the run history. */
export function decide(item: Omit<sql.InsertRow<typeof audit.columns>, 'created'>) {
	return sql.insert(audit, item);
}
