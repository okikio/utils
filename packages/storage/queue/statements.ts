/**
 * Every statement the PostgreSQL queue sends, built with `@okikio/sql`.
 *
 * Each function returns a typed statement for one namespace. Database time owns every lease: claim, renewal and expiry
 * compare against `clock_timestamp()`, never a host clock.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import type { Temporal } from '@okikio/duration/temporal';
import { active, items, policies } from './schema.ts';

const c = items.c;

/** The time after `milliseconds` from now, in database time. */
function after(milliseconds: number): sql.Expr<Temporal.Instant> {
	return sql.later(sql.fn.clockTimestamp(), milliseconds);
}

/** Whether a worker may claim the item now: it is queued and due, or its claim expired. */
const claimable: sql.Expr<boolean, typeof items.key> = sql.or(
	sql.and(c.state.eq('queued'), c.available.lte(sql.fn.clockTimestamp())),
	sql.and(c.state.eq('claimed'), c.expires.lte(sql.fn.clockTimestamp())),
);

/** The exact live claim: same item, claim and owner, still claimed and not expired. */
function live(namespace: string, claim: ClaimRef): sql.Expr<boolean, typeof items.key> {
	return sql.and(
		c.namespace.eq(namespace),
		c.id.eq(claim.itemId),
		c.claim.eq(claim.id),
		c.owner.eq(claim.owner),
		c.state.eq('claimed'),
		c.expires.gt(sql.fn.clockTimestamp()),
	);
}

/** Clears every claim field, for a transition out of `claimed`. */
const released = { claim: null, owner: null, claimed: null, expires: null } as const;

/** The fields that identify a claim. */
export interface ClaimRef {
	readonly id: string;
	readonly itemId: string;
	readonly owner: string;
}

/** Register a namespace's policy unless it exists. */
export function addPolicy(policy: {
	namespace: string;
	contract: string;
	capacity: number;
	retained: number;
	ttl: number;
}) {
	return sql.insert(policies, policy).onConflict({ target: [policies.c.namespace], action: 'nothing' });
}

/** A namespace's saved policy. Pass `lock` to hold the row until the transaction ends. */
export function policy(namespace: string, lock = false) {
	const query = sql.select({
		contract: policies.c.contract,
		capacity: policies.c.capacity,
		retained: policies.c.retained,
		ttl: policies.c.ttl,
	}).from(policies).where(policies.c.namespace.eq(namespace));
	return lock ? query.for() : query;
}

/** Lock one item row, so the next statement checks its lease after any wait. */
export function lockItem(namespace: string, id: string) {
	return sql.select({ id: c.id }).from(items).where(c.namespace.eq(namespace), c.id.eq(id)).for();
}

/** The item with a key, if any. */
export function keyed(namespace: string, key: string) {
	return sql.select({ id: c.id, redriven_from: c.redriven_from }).from(items).where(
		c.namespace.eq(namespace),
		c.key.eq(key),
	);
}

/** The number of items that hold capacity. */
export function occupied(namespace: string) {
	return sql.select({ count: sql.fn.count() }).from(items).where(c.namespace.eq(namespace), c.state.in(active));
}

/** Add a queued item. */
export function add(item: {
	namespace: string;
	id: string;
	key: string | null;
	input: unknown;
	priority: number;
	available?: Temporal.Instant;
}) {
	return sql.insert(items, { ...item, state: 'queued' });
}

/** Copy a terminal item's input and priority into a new queued item under a new key. */
export function redrive(namespace: string, source: string, id: string, key: string) {
	return sql.insert(
		items,
		sql.select({
			namespace: c.namespace,
			id: sql.value(id, types.uuid),
			key: sql.value(key, types.text()),
			input: c.input,
			priority: c.priority,
			state: sql.value('queued', items.columns.state.type),
			redriven_from: c.id,
		}).from(items).where(c.namespace.eq(namespace), c.id.eq(source)),
	);
}

/** One item and whether a worker could claim it now. */
export function item(namespace: string, id: string) {
	return sql.select({ ...c, claimable }).from(items).where(c.namespace.eq(namespace), c.id.eq(id));
}

/**
 * Claim up to `limit` claimable items in priority, then admission, order. Rows other workers hold are skipped, so
 * concurrent workers never wait on each other. Each claim gets a new identity and a lease from database time.
 */
export function claim(options: {
	namespace: string;
	ref?: string;
	limit: number;
	owner: string;
	lease: number;
}) {
	const conditions = [c.namespace.eq(options.namespace), claimable];
	if (options.ref !== undefined) conditions.push(c.id.eq(options.ref));
	const candidates = sql.cte(
		'candidates',
		sql.select({ id: c.id }).from(items).where(...conditions).orderBy(c.priority.desc(), c.sequence)
			.limit(options.limit).for({ skipLocked: true }),
	);
	return sql.update(items, {
		state: 'claimed',
		claim: sql.fn.randomUuid(),
		owner: options.owner,
		claimed: sql.fn.clockTimestamp(),
		expires: after(options.lease),
		attempt: sql.add(c.attempt, 1),
	}).with(candidates).from(candidates).where(c.namespace.eq(options.namespace), c.id.eq(candidates.c.id))
		.returning(c);
}

/** Put a live claim back in the queue, due at `available` or after `delay` milliseconds. */
export function retry(
	namespace: string,
	claim: ClaimRef,
	options: { available?: Temporal.Instant; delay: number; priority?: number },
) {
	return sql.update(items, {
		...released,
		state: 'queued',
		available: options.available ?? after(options.delay),
		...(options.priority === undefined ? {} : { priority: options.priority }),
	}).where(live(namespace, claim)).returning({ available: c.available });
}

/** Extend a live claim's lease from now. */
export function renew(namespace: string, claim: ClaimRef, lease: number) {
	return sql.update(items, { expires: after(lease) }).where(live(namespace, claim)).returning(c);
}

/** End a live claim as completed or failed. */
export function finish(
	namespace: string,
	claim: ClaimRef,
	result: { state: 'completed'; output: unknown } | { state: 'failed'; failure: unknown },
) {
	return sql.update(items, {
		...released,
		...result,
		finished: sql.fn.clockTimestamp(),
	}).where(live(namespace, claim)).returning({ id: c.id });
}

/** Cancel an active item. With `claim`, only that live claim may cancel it. */
export function cancel(namespace: string, id: string, reason: string | null, claim?: ClaimRef) {
	const conditions = claim === undefined
		? [c.namespace.eq(namespace), c.id.eq(id), c.state.in(active)]
		: [live(namespace, claim)];
	return sql.update(items, {
		...released,
		state: 'cancelled',
		finished: sql.fn.clockTimestamp(),
		cancellation: reason,
	}).where(...conditions).returning({ id: c.id });
}

/** Whether an item exists. */
export function exists(namespace: string, id: string) {
	return sql.select({ id: c.id }).from(items).where(c.namespace.eq(namespace), c.id.eq(id));
}

/** Item counts by state. An expired claim counts as queued, because a worker can claim it again. */
export function stats(namespace: string) {
	return sql.select({
		queued: sql.fn.count(claimable),
		claimed: sql.fn.count(sql.and(c.state.eq('claimed'), c.expires.gt(sql.fn.clockTimestamp()))),
		completed: sql.fn.count(c.state.eq('completed')),
		failed: sql.fn.count(c.state.eq('failed')),
		cancelled: sql.fn.count(c.state.eq('cancelled')),
	}).from(items).where(c.namespace.eq(namespace));
}

/** The highest admission sequence, or 0 for an empty namespace. */
export function last(namespace: string) {
	return sql.select({ last: sql.coalesce(sql.fn.max(c.sequence), 0n) }).from(items).where(c.namespace.eq(namespace));
}

/** Items admitted after `after` and up to `through`, in admission order. */
export function page(namespace: string, after: bigint, through: bigint, limit: number) {
	return sql.select({
		id: c.id,
		state: c.state,
		priority: c.priority,
		attempt: c.attempt,
		sequence: c.sequence,
		redriven_from: c.redriven_from,
	}).from(items).where(c.namespace.eq(namespace), c.sequence.gt(after), c.sequence.lte(through))
		.orderBy(c.sequence).limit(limit);
}

/** How many terminal items to keep, and for how long. */
export interface RetentionType {
	readonly retained: number;
	readonly ttl: number;
}

/** Whether a terminal item has outlived the retention time. */
function expired<X extends sql.Expr<Temporal.Instant | null, string>>(
	finished: X,
	ttl: number,
): sql.Expr<boolean, sql.OwnersOf<X>> {
	return finished.lte(after(-ttl)) as sql.Expr<boolean, sql.OwnersOf<X>>;
}

/**
 * Delete up to `limit` terminal items beyond the newest `retained`, or older than `ttl` milliseconds, oldest first.
 * Rows another transaction holds are skipped and left for a later prune.
 */
export function prune(namespace: string, retention: RetentionType, limit: number) {
	const ranked = sql.cte(
		'ranked',
		sql.select({
			id: c.id,
			finished: c.finished,
			position: sql.fn.rowNumber(c.finished.desc(), c.sequence.desc()),
		}).from(items).where(c.namespace.eq(namespace), c.finished.isNotNull()),
	);
	const selected = sql.cte(
		'selected',
		sql.select({ id: c.id }).from(items).join(ranked, c.id.eq(ranked.c.id)).where(
			c.namespace.eq(namespace),
			sql.or(ranked.c.position.gt(retention.retained), expired(ranked.c.finished, retention.ttl)),
		).orderBy(c.finished, c.sequence).limit(limit).for({ of: [items], skipLocked: true }),
	);
	return sql.remove(items).with(ranked, selected).using(selected)
		.where(c.namespace.eq(namespace), c.id.eq(selected.c.id)).returning({ id: c.id });
}

/** Whether terminal items beyond the retention limits remain after a prune. */
export function more(namespace: string, retention: RetentionType) {
	return sql.select({
		more: sql.or(
			sql.fn.count().gt(retention.retained),
			sql.coalesce(expired(sql.fn.min(c.finished), retention.ttl), false),
		),
	}).from(items).where(c.namespace.eq(namespace), c.finished.isNotNull());
}
