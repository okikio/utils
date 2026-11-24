/**
 * Run statements: reads, admission and every state transition of a run.
 *
 * Each transition names what it means, so the committed SQL shows every change a run can make. Triggers keep
 * `updated_at`, `finished_at` and history for each of them.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { json, types } from '@okikio/sql';
import { hosts, runs, terminal } from '../schema/mod.ts';
import { after, clock } from './shared.ts';

const r = runs.c;

/** The run with this ID in the namespace. */
function owned(namespace: string, id: string): sql.Expr<boolean> {
	return sql.and(r.namespace.eq(namespace), r.id.eq(id));
}

/** Every column of a run. */
export const row = r;

/** One run, optionally locked for an update. */
export function run(namespace: string, id: string, lock = false) {
	const query = sql.select(r).from(runs).where(owned(namespace, id));
	return lock ? query.for() : query;
}

/** The run a command key already admitted, if any. */
export function keyed(
	namespace: string,
	key: { scope: string; kind: 'activity' | 'workflow'; definition: string; key: string },
) {
	return sql.select(r).from(runs).where(
		r.namespace.eq(namespace),
		r.scope.eq(key.scope),
		r.kind.eq(key.kind),
		r.definition.eq(key.definition),
		r.key.eq(key.key),
	);
}

/**
 * Reservations of live families under one policy. A family's root reservation counts once while any member is live,
 * including after the root itself completes.
 */
export function usage(namespace: string, policy: { id: string; version: string }) {
	const families = sql.cte(
		'live_families',
		sql.select({ family: r.family }).distinct().from(runs).where(
			r.namespace.eq(namespace),
			sql.not(r.state.in(terminal)),
		),
		{ materialized: true },
	);
	const reserved = (name: string) => sql.coalesce(sql.fn.sum(json.text(r.reservation, name).cast(types.integer)), 0);
	return sql.select({
		roots: sql.fn.count(),
		successors: reserved('successors'),
		children: reserved('children'),
		finalizers: reserved('finalizers'),
	}).with(families).from(families).join(runs, sql.and(r.namespace.eq(namespace), r.id.eq(families.c.family))).where(
		r.id.eq(r.family),
		json.text(r.policy, 'id').eq(policy.id),
		json.text(r.policy, 'version').eq(policy.version),
	);
}

/** Count one more successor admitted by a parent. */
export function addSuccessor(namespace: string, id: string) {
	return sql.update(runs, { successors: sql.add(r.successors, 1) }).where(owned(namespace, id));
}

/** Count one more child admitted by a parent. */
export function addChild(namespace: string, id: string) {
	return sql.update(runs, { children: sql.add(r.children, 1) }).where(owned(namespace, id));
}

/** Children of one definition version that a parent already admitted. */
export function children(
	namespace: string,
	parent: string,
	definition: { kind: 'activity' | 'workflow'; id: string; version: string },
) {
	return sql.select({ count: sql.fn.count() }).from(runs).where(
		r.namespace.eq(namespace),
		r.parent.eq(parent),
		r.kind.eq(definition.kind),
		r.definition.eq(definition.id),
		r.version.eq(definition.version),
	);
}

/** Save a new run. The insert trigger sets its chain root, times and first history entry. */
export function admit(input: sql.InsertRow<typeof runs.columns>) {
	return sql.insert(runs, input);
}

/** Running activations of one host lifetime, with the host's limit. */
export function activations(namespace: string, host: string) {
	const h = hosts.c;
	const running = sql.aggregate(
		sql.select({ count: sql.fn.count() }).from(runs).where(
			r.namespace.eq(h.namespace),
			r.host.eq(h.id),
			r.host_generation.eq(h.generation),
			r.state.eq('advancing'),
			r.expires.gt(clock),
		),
	);
	return sql.select({ limit: h.activations, active: running }).from(hosts).where(
		h.namespace.eq(namespace),
		h.id.eq(host),
	);
}

/**
 * The oldest ready workflow run this host may advance, locked and skipped by other hosts. A run whose exact version no
 * live host serves is also returned, so the host can block it as `missing_version` instead of leaving it waiting.
 */
export function ready(namespace: string, definitions: readonly unknown[]) {
	const served = sql.value(definitions, types.jsonb());
	const d = json.elements(served, 'd');
	const h = hosts.c;
	const offered = (version: boolean) =>
		sql.exists(
			sql.select({}).from(d).where(
				json.text(d.c.value, 'id').eq(r.definition),
				...(version ? [json.text(d.c.value, 'version').eq(r.version)] : []),
			),
		);
	const anyHost = sql.exists(
		sql.select({}).from(hosts).where(
			h.namespace.eq(r.namespace),
			sql.not(h.draining),
			h.expires.gt(clock),
			json.contains(
				h.definitions,
				json.array(json.object({ kind: sql.value('workflow', types.text()), id: r.definition, version: r.version })),
			),
		),
	);
	return sql.select(r).from(runs).where(
		r.namespace.eq(namespace),
		r.state.eq('ready'),
		r.kind.eq('workflow'),
		sql.not(r.paused),
		offered(false),
		sql.or(offered(true), sql.not(anyHost)),
	).orderBy(r.created).limit(1).for({ skipLocked: true });
}

/** Start an activation: the run is advancing on this host lifetime until the lease ends. */
export function advance(
	namespace: string,
	id: string,
	claim: { generation: number; host: string; hostGeneration: number; lease: number },
) {
	return sql.update(runs, {
		state: 'advancing',
		generation: claim.generation,
		host: claim.host,
		host_generation: claim.hostGeneration,
		expires: after(claim.lease),
	}).where(owned(namespace, id));
}

/** Check that an activation still holds its run. */
export function activation(
	namespace: string,
	id: string,
	claim: { generation: number; host: string; hostGeneration: number },
) {
	return sql.select({ id: r.id }).from(runs).where(
		owned(namespace, id),
		r.state.eq('advancing'),
		r.generation.eq(claim.generation),
		r.host.eq(claim.host),
		r.host_generation.eq(claim.hostGeneration),
		r.expires.gt(clock),
	);
}

/** Extend an activation lease from now. */
export function extend(namespace: string, id: string, lease: number) {
	return sql.update(runs, { expires: after(lease) }).where(owned(namespace, id));
}

/** Stop advancing and wait in `ready` or `waiting`, releasing the activation lease. */
export function rest(namespace: string, id: string, state: 'ready' | 'waiting') {
	return sql.update(runs, { state, expires: null }).where(owned(namespace, id));
}

/**
 * Make the run ready for another activation. An advancing run keeps its state and lease, because its activation will
 * see the new result before it parks. Pass `lease` to also release the lease of a run that is not advancing.
 */
export function wake(namespace: string, id: string, lease = true) {
	const advancing = r.state.eq('advancing');
	return sql.update(runs, {
		state: sql.choose(advancing, r.state, 'ready'),
		...(lease ? { expires: sql.choose(advancing, r.expires, null) } : {}),
	}).where(owned(namespace, id));
}

/** Stop the run until an operator repairs it. Pass `release` to also end an activation lease. */
export function block(namespace: string, id: string, reason: string, release = false) {
	return sql.update(runs, { state: 'blocked', reason, ...(release ? { expires: null } : {}) }).where(
		owned(namespace, id),
	);
}

/** Record a diagnostic reason without changing the state. */
export function note(namespace: string, id: string, reason: string) {
	return sql.update(runs, { reason }).where(owned(namespace, id));
}

/** Freeze the intended outcome while cleanup and finalization run. */
export function settle(namespace: string, id: string, outcome: unknown) {
	return sql.update(runs, { state: 'settling', outcome, expires: null, reason: null }).where(owned(namespace, id));
}

/** End the run in a terminal state. */
export function close(namespace: string, id: string, state: 'completed' | 'failed' | 'cancelled') {
	return sql.update(runs, { state, reason: null }).where(owned(namespace, id));
}

/** Change the pause control and its revision. */
export function control(namespace: string, id: string, paused: boolean, revision: number) {
	return sql.update(runs, { paused, control_revision: revision }).where(owned(namespace, id));
}

/** Start a new recovery epoch after a repair, so claims from the old epoch fail. */
export function repair(namespace: string, id: string, state: 'settling' | 'waiting' | 'ready') {
	return sql.update(runs, {
		epoch: sql.add(r.epoch, 1),
		generation: sql.add(r.generation, 1),
		state,
		reason: null,
		expires: null,
	}).where(owned(namespace, id));
}
