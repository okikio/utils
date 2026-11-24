/**
 * Continuation statements. A continuation ends one run segment and starts the next run of the same chain, under the
 * old segment's run lock.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { jobs, runs, terminal } from '../schema/mod.ts';

const r = runs.c;
const j = jobs.c;

/** Whether ordinary jobs or other family runs are still unfinished; a segment can continue only without them. */
export function busy(namespace: string, run: { id: string; family: string }) {
	return sql.select({
		jobs: sql.exists(
			sql.select({}).from(jobs).where(
				j.namespace.eq(namespace),
				j.run.eq(run.id),
				sql.not(j.finalizer),
				j.state.in(['ready', 'claimed', 'blocked']),
			),
		),
		relatives: sql.exists(
			sql.select({}).from(runs).where(
				r.namespace.eq(namespace),
				r.family.eq(run.family),
				r.id.ne(run.id),
				sql.not(r.state.in(terminal)),
			),
		),
	});
}

/** Save the requested continuation; the segment settles before the next one starts. */
export function request(namespace: string, id: string, continuation: unknown) {
	return sql.update(runs, { state: 'settling', continuation, expires: null, reason: null }).where(
		r.namespace.eq(namespace),
		r.id.eq(id),
	);
}

/**
 * Start the next segment as a copy of the old one with new input. It keeps the family, scope, policy, controls, trace,
 * placement and chain root, and counts one more in the chain.
 */
export function next(namespace: string, from: string, segment: { id: string; input: unknown; fingerprint: string }) {
	return sql.insert(
		runs,
		sql.select({
			namespace: r.namespace,
			id: sql.value(segment.id, types.uuid),
			scope: r.scope,
			key: sql.value(`continue:${segment.id}`, types.text()),
			kind: r.kind,
			definition: r.definition,
			version: r.version,
			input: sql.value(segment.input, types.jsonb()),
			fingerprint: sql.value(segment.fingerprint, types.text()),
			policy: r.policy,
			policyhash: r.policyhash,
			state: sql.value('ready', runs.columns.state.type),
			family: r.family,
			parent: r.id,
			cancellation: sql.value('independent', types.text()),
			reservation: r.reservation,
			trace: r.trace,
			paused: r.paused,
			control_revision: r.control_revision,
			chain_root: r.chain_root,
			chain_index: sql.add(r.chain_index, 1),
			location: r.location,
		}).from(runs).where(r.namespace.eq(namespace), r.id.eq(from)),
	);
}

/** End the old segment, linked to the next one. */
export function link(namespace: string, from: string, to: string) {
	return sql.update(runs, { state: 'continued', continued_to: to, continuation: null, expires: null, reason: null })
		.where(r.namespace.eq(namespace), r.id.eq(from));
}
