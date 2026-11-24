/**
 * Statements that find work and old data without any live process state: saved deadlines, expired activations,
 * children to cancel, and families old enough to prune.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { json, types } from '@okikio/sql/postgres';
import {
	attempts,
	audit,
	cleanups,
	events,
	instructions,
	jobs,
	progress,
	receipts,
	runEvents,
	runs,
	terminal,
} from '../schema/mod.ts';
import { clock, live } from './shared.ts';

const r = runs.c;
const j = jobs.c;
const i = instructions.c;

/** The definitions a worker can run. Without a filter, every definition counts. */
export interface FilterType {
	readonly workflows?: readonly unknown[];
	readonly activities: readonly unknown[];
	readonly finalizers: readonly unknown[];
}

/**
 * The earliest saved deadline this worker could act on, and the database time. A workflow that is ready now counts as
 * due now. The caller waits until the deadline, so no live JavaScript timer is needed to recover work.
 */
export function next(namespace: string, filter?: FilterType) {
	const withJob = sql.and(r.namespace.eq(j.namespace), r.id.eq(j.run));
	const branches = [];
	if (filter === undefined || (filter.workflows?.length ?? 0) > 0) {
		const d = json.elements(sql.value(filter?.workflows ?? [], types.jsonb()), 'd');
		branches.push(
			sql.select({ due: clock }).from(runs).where(
				r.namespace.eq(namespace),
				r.kind.eq('workflow'),
				r.state.eq('ready'),
				sql.not(r.paused),
				...(filter === undefined ? [] : [
					sql.exists(
						sql.select({}).from(d).where(
							json.text(d.c.value, 'id').eq(r.definition),
							json.text(d.c.value, 'version').eq(r.version),
						),
					),
				]),
			).limit(1),
		);
	}
	branches.push(
		sql.select({ due: r.expires }).from(runs).where(r.namespace.eq(namespace), r.state.eq('advancing'))
			.orderBy(r.expires).limit(1),
		sql.select({ due: j.expires }).from(jobs).join(runs, withJob).where(
			j.namespace.eq(namespace),
			j.state.eq('claimed'),
			r.state.in(live),
		).orderBy(j.expires).limit(1),
	);
	if (filter === undefined || filter.activities.length > 0 || filter.finalizers.length > 0) {
		const kinds = (list: readonly unknown[], finalizer: boolean) => {
			const d = json.elements(sql.value(list, types.jsonb()), finalizer ? 'f' : 'a');
			return sql.exists(
				sql.select({}).from(d).where(d.c.value.eq(j.definition), finalizer ? j.finalizer : sql.not(j.finalizer)),
			);
		};
		branches.push(
			sql.select({ due: j.available }).from(jobs).join(runs, withJob).where(
				j.namespace.eq(namespace),
				j.state.eq('ready'),
				r.state.in(live),
				sql.or(sql.not(r.paused), j.finalizer),
				...(filter === undefined ? [] : [sql.or(kinds(filter.activities, false), kinds(filter.finalizers, true))]),
			).orderBy(j.available).limit(1),
		);
	}
	branches.push(
		sql.select({ due: i.due }).from(instructions).join(runs, sql.and(r.namespace.eq(i.namespace), r.id.eq(i.run)))
			.where(
				i.namespace.eq(namespace),
				i.outcome.isNull(),
				i.due.isNotNull(),
				r.state.in(['ready', 'waiting', 'advancing']),
				sql.not(r.paused),
			).orderBy(i.due).limit(1),
	);
	const deadlines = sql.cte('deadlines', sql.unionAll(branches[0]!, ...branches.slice(1)));
	return sql.select({ due: sql.fn.min(deadlines.c.due), now: clock }).with(deadlines).from(deadlines);
}

/** Activations whose lease ended, oldest first, locked and skipped by other recovering hosts. */
export function expired(namespace: string, limit: number) {
	return sql.select({ id: r.id }).from(runs).where(
		r.namespace.eq(namespace),
		r.state.eq('advancing'),
		r.expires.lte(clock),
	).orderBy(r.expires).limit(limit).for({ skipLocked: true });
}

/**
 * Children that follow their parent's cancellation and should end now: the parent was cancelled, or the parent's
 * instruction that waits for the child was cancelled or abandoned when the parent finished.
 */
export function orphans(namespace: string, limit: number) {
	const child = runs.as('c');
	const parent = runs.as('p');
	const step = instructions.as('i');
	return sql.select(child.c).from(child).join(
		parent,
		sql.and(parent.c.namespace.eq(child.c.namespace), parent.c.id.eq(child.c.parent)),
	).where(
		child.c.namespace.eq(namespace),
		child.c.cancellation.in(['follow-parent', 'request']),
		sql.or(
			json.text(parent.c.outcome, 'type').eq('cancelled'),
			sql.exists(
				sql.select({}).from(step).where(
					step.c.namespace.eq(child.c.namespace),
					step.c.child.eq(child.c.id),
					sql.or(
						json.text(step.c.outcome, 'type').eq('cancelled'),
						sql.and(parent.c.outcome.isNotNull(), step.c.outcome.isNull(), sql.not(step.c.discard)),
					),
				),
			),
		),
		sql.not(child.c.state.in([...terminal, 'settling'])),
	).limit(limit);
}

/**
 * Root runs whose whole family ended and outlived every retention window its members promised. A member counts until
 * `finished_at` plus the largest of its dedupe, result and audit retention has passed.
 */
function prunable<A extends string>(root: sql.Aliased<typeof runs.columns, A>): sql.Expr<boolean, A> {
	const member = runs.as('m');
	const m = member.c;
	const retention = (name: string) => json.text(json.get(m.policy, 'retention'), name).cast(types.double);
	return sql.and(
		root.c.id.eq(root.c.family),
		root.c.state.in(terminal),
		root.c.finished_at.lte(clock),
		sql.not(sql.exists(
			sql.select({}).from(member).where(
				m.namespace.eq(root.c.namespace),
				m.family.eq(root.c.id),
				sql.or(
					sql.not(m.state.in(terminal)),
					m.finished_at.isNull(),
					sql.later(m.finished_at, sql.fn.greatest(retention('dedupeMs'), retention('resultsMs'), retention('auditMs')))
						.gt(clock),
				),
			),
		)),
	);
}

/** The next family to prune, oldest completion first, locked and skipped by other maintenance. */
export function family(namespace: string) {
	const root = runs.as('r');
	return sql.select({ id: root.c.id }).from(root).where(root.c.namespace.eq(namespace), prunable(root))
		.orderBy(root.c.finished_at, root.c.id).limit(1).for({ of: [root], skipLocked: true });
}

/** Whether another family can be pruned now. */
export function more(namespace: string) {
	const root = runs.as('r');
	return sql.select({
		more: sql.exists(sql.select({}).from(root).where(root.c.namespace.eq(namespace), prunable(root))),
	});
}

/** Tables that reference a job instead of a run; their family is found through the job. */
const byJob = [receipts, attempts] as const;

/** Tables in deletion order: references before the rows they reference. */
export const order = [progress, receipts, attempts, instructions, cleanups, events, audit, runEvents, jobs] as const;

/** Delete up to `limit` rows of one table that belong to a family. Identifiers are fixed here, never caller text. */
export function purge(table: (typeof order)[number], namespace: string, familyId: string, limit: number) {
	const x = (table as sql.Table<sql.Columns>).as('x');
	const key = (table.constraints.primaryKey ?? []) as readonly sql.Column<unknown>[];
	const member = runs.as('m');
	const owner = (byJob as readonly unknown[]).includes(table)
		? sql.exists(
			sql.select({}).from(jobs).join(member, sql.and(member.c.namespace.eq(j.namespace), member.c.id.eq(j.run))).where(
				j.namespace.eq(x.c.namespace as sql.Column<string>),
				j.id.eq(x.c.job as sql.Column<string>),
				member.c.family.eq(familyId),
			),
		)
		: sql.exists(
			sql.select({}).from(member).where(
				member.c.namespace.eq(x.c.namespace as sql.Column<string>),
				member.c.id.eq(x.c.run as sql.Column<string>),
				member.c.family.eq(familyId),
			),
		);
	const chosen = sql.select(Object.fromEntries(key.map((column) => [column.name, x.c[column.name]!])))
		.from(x).where((x.c.namespace as sql.Column<string>).eq(namespace), owner)
		.orderBy(...key.map((column) => x.c[column.name]!)).limit(limit);
	const target = table as sql.Table<sql.Columns>;
	return sql.remove(target).where(
		(target.c.namespace as sql.Column<string>).eq(namespace),
		sql.row(...key).in(chosen),
	).returning({ key: key[0]! });
}

/** Delete up to `limit` runs of a family. The root goes last, so the family stays discoverable until it is empty. */
export function prune(namespace: string, familyId: string, limit: number) {
	const chosen = sql.select({ id: r.id }).from(runs).where(r.namespace.eq(namespace), r.family.eq(familyId))
		.orderBy(r.id.eq(r.family), r.id).limit(limit);
	return sql.remove(runs).where(r.namespace.eq(namespace), r.id.in(chosen)).returning({ id: r.id });
}
