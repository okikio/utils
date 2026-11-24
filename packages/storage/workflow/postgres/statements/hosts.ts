/**
 * Host and compute statements. A host lifetime is its ID and generation; a compute node's generation only grows.
 *
 * Lock order: compute ancestors root first, then the host row, then the run, then the job. Registration and every
 * guarded operation follow it, so two transactions never wait on each other in opposite order.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { compute, hosts } from '../schema/mod.ts';
import { after, clock } from './shared.ts';

const h = hosts.c;
const n = compute.c;

/** A saved compute node, locked for an update. */
export function node(namespace: string, id: string) {
	return sql.select({ generation: n.generation, value: n.value }).from(compute).where(
		n.namespace.eq(namespace),
		n.id.eq(id),
	).for();
}

/** Save or replace a compute node. */
export function saveNode(namespace: string, node: { id: string; generation: number; value: unknown }) {
	return sql.insert(compute, { namespace, ...node }).onConflict({
		target: [n.namespace, n.id],
		action: 'update',
		set: { generation: sql.excluded(compute).c.generation, value: sql.excluded(compute).c.value },
	});
}

/** A compute node's generation, held against replacement until the transaction ends. */
export function nodeShare(namespace: string, id: string) {
	return sql.select({ generation: n.generation }).from(compute).where(n.namespace.eq(namespace), n.id.eq(id)).for({
		mode: 'share',
	});
}

/** Publish a host lifetime. A known host ID gets the next generation and stops draining. */
export function register(host: {
	namespace: string;
	id: string;
	definitions: unknown;
	engine: string;
	activations: number;
	activities: number;
	lease: number;
	compute: unknown;
	affinity: unknown;
}) {
	const fresh = sql.excluded(hosts).c;
	return sql.insert(hosts, {
		namespace: host.namespace,
		id: host.id,
		generation: 1,
		definitions: host.definitions,
		engine: host.engine,
		activations: host.activations,
		activities: host.activities,
		expires: after(host.lease),
		compute: host.compute,
		affinity: host.affinity,
	}).onConflict({
		target: [h.namespace, h.id],
		action: 'update',
		set: {
			generation: sql.add(h.generation, 1),
			definitions: fresh.definitions,
			engine: fresh.engine,
			activations: fresh.activations,
			activities: fresh.activities,
			expires: fresh.expires,
			compute: fresh.compute,
			affinity: fresh.affinity,
			draining: false,
		},
	}).returning({ generation: h.generation });
}

/** The ancestor path of one host lifetime, whether or not it is still live. */
export function lineage(namespace: string, host: { id: string; generation: number }) {
	return sql.select({ compute: h.compute }).from(hosts).where(
		h.namespace.eq(namespace),
		h.id.eq(host.id),
		h.generation.eq(host.generation),
	);
}

/** The placement data of a host. */
export function placement(namespace: string, id: string) {
	return sql.select({ compute: h.compute, affinity: h.affinity }).from(hosts).where(
		h.namespace.eq(namespace),
		h.id.eq(id),
	);
}

/**
 * A live, non-draining host lifetime, locked. `share` lets independent attempts of the host run together; renewal
 * takes `update` at once, because two shared locks cannot both upgrade.
 */
export function guard(namespace: string, host: { id: string; generation: number }, mode: 'share' | 'update') {
	return sql.select({ id: h.id }).from(hosts).where(
		h.namespace.eq(namespace),
		h.id.eq(host.id),
		h.generation.eq(host.generation),
		h.expires.gt(clock),
		sql.not(h.draining),
	).for({ mode });
}

/** Extend a host lifetime from now. */
export function renew(namespace: string, host: { id: string; generation: number }, lease: number) {
	return sql.update(hosts, { expires: after(lease) }).where(
		h.namespace.eq(namespace),
		h.id.eq(host.id),
		h.generation.eq(host.generation),
	);
}

/** Stop admission for this lifetime only; an older lifetime cannot drain its replacement. */
export function drain(namespace: string, host: { id: string; generation: number }) {
	return sql.update(hosts, { draining: true }).where(
		h.namespace.eq(namespace),
		h.id.eq(host.id),
		h.generation.eq(host.generation),
	);
}
