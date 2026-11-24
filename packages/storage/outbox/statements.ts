/**
 * Every statement the outbox runs after migration, built from the typed tables in `schema.ts`.
 *
 * Each function returns a statement with typed parameters and typed result columns. The adapter only chooses which to
 * run. `statements.sql` beside this file holds the compiled SQL of every one, and the outbox tests compare it and ask
 * PostgreSQL to describe each statement, so a changed or wrong statement fails before it ships.
 *
 * @module
 */
import * as sql from '@okikio/sql';
import { hash, lock, messages, policies, repairs, type states } from './schema.ts';

const m = messages.c, p = policies.c, r = repairs.c;

/** A message identity within its namespace. */
export interface MessageKeyType {
	readonly namespace: string;
	readonly id: string;
	readonly key: string;
}

/** The message with this identity. */
function at(message: MessageKeyType): sql.Expr<boolean> {
	return sql.and(m.namespace.eq(message.namespace), m.id.eq(message.id), m.key.eq(message.key));
}

/** Serializes append, claim, redrive, retirement and resize for one namespace, until the transaction ends. */
export function guard(namespace: string): sql.Statement<{ locked: undefined }> {
	return sql.select({ locked: lock(hash(`outbox:${namespace}`, 0n)) });
}

/** Database time in epoch milliseconds, read after any lock so it follows every earlier change. */
export const now: sql.Statement<{ now: number }> = sql.select({
	now: sql.fn.epochMilliseconds(sql.fn.clockTimestamp()),
});

/** Record a namespace's policy the first time any view uses it. */
export function addPolicy(
	namespace: string,
	policy: { readonly maximum: number; readonly bytes: number; readonly attempts: number },
): sql.Statement<unknown> {
	return sql.insert(policies, { namespace, ...policy }).onConflict({ action: 'nothing' });
}

/** A namespace's stored policy, locked until the transaction ends when `locked` is set. */
export function policy(
	namespace: string,
	locked = false,
): sql.Statement<{ maximum: number; bytes: number; attempts: number }> {
	const query = sql.select({ maximum: p.maximum, bytes: p.bytes, attempts: p.attempts }).from(policies)
		.where(p.namespace.eq(namespace));
	return locked ? query.for() : query;
}

/** Change only the stored maximum. */
export function setMaximum(namespace: string, maximum: number): sql.Statement<unknown> {
	return sql.update(policies, { maximum }).where(p.namespace.eq(namespace));
}

/** The payload of a retained message, for comparing a repeated append. */
export function payload(message: MessageKeyType): sql.Statement<{ value: unknown }> {
	return sql.select({ value: m.value }).from(messages).where(at(message));
}

/** Retained messages in a namespace, terminal ones included. */
export function size(namespace: string): sql.Statement<{ count: number }> {
	return sql.select({ count: sql.fn.count() }).from(messages).where(m.namespace.eq(namespace));
}

/** Accept a new message. */
export function insert(
	message: MessageKeyType & { readonly value: unknown; readonly time: number },
): sql.Statement<unknown> {
	const { namespace, id, key, value, time } = message;
	return sql.insert(messages, { namespace, id, key, value, state: 'pending', due: time, updated: time });
}

/** One message's delivery state, locked until the transaction ends. */
export function lease(message: MessageKeyType): sql.Statement<{
	state: (typeof states)[number];
	token: string | null;
	expires: number | null;
	attempt: number;
	budget: number;
}> {
	return sql.select({ state: m.state, token: m.token, expires: m.expires, attempt: m.attempt, budget: m.budget })
		.from(messages).where(at(message)).for();
}

/** End a reservation: complete, pending again or failed. */
export function settle(
	message: MessageKeyType & {
		readonly state: 'complete' | 'pending' | 'failed';
		readonly due: number;
		readonly time: number;
		readonly failure: string | null;
	},
): sql.Statement<unknown> {
	const { state, due, time, failure } = message;
	return sql.update(messages, { state, due, updated: time, expires: null, failure }).where(at(message));
}

/** Fail expired reservations whose budget is spent, so claim never redelivers them. */
export function exhaust(namespace: string, time: number, attempts: number): sql.Statement<unknown> {
	return sql.update(messages, { state: 'failed', expires: null, updated: time }).where(
		m.namespace.eq(namespace),
		m.state.eq('leased'),
		m.expires.lte(time),
		sql.subtract(m.attempt, m.budget).gte(attempts),
	);
}

/** Due or expired messages with budget left, oldest first, locked and skipped by concurrent claims. */
export function candidates(
	namespace: string,
	options: { readonly time: number; readonly attempts: number; readonly limit: number },
): sql.Statement<{ id: string; key: string; value: unknown; attempt: number }> {
	return sql.select({ id: m.id, key: m.key, value: m.value, attempt: m.attempt }).from(messages).where(
		m.namespace.eq(namespace),
		sql.subtract(m.attempt, m.budget).lt(options.attempts),
		sql.or(
			sql.and(m.state.eq('pending'), m.due.lte(options.time)),
			sql.and(m.state.eq('leased'), m.expires.lte(options.time)),
		),
	).orderBy(m.due, m.id, m.key).limit(options.limit).for({ skipLocked: true });
}

/** Reserve one message for a new attempt with a fresh token. */
export function reserve(
	message: MessageKeyType & {
		readonly token: string;
		readonly attempt: number;
		readonly expires: number;
		readonly time: number;
	},
): sql.Statement<unknown> {
	const { token, attempt, expires, time } = message;
	return sql.update(messages, { state: 'leased', token, attempt, expires, updated: time }).where(at(message));
}

/** Move a current reservation's deadline. */
export function extend(
	message: MessageKeyType & { readonly expires: number; readonly time: number },
): sql.Statement<unknown> {
	return sql.update(messages, { expires: message.expires, updated: message.time }).where(at(message));
}

/** One message's state, without a lock. */
export function inspect(message: MessageKeyType): sql.Statement<{ state: (typeof states)[number] }> {
	return sql.select({ state: m.state }).from(messages).where(at(message));
}

/**
 * One page of metadata in byte order of identity, independent of the database locale. `after` is the last identity of
 * the previous page. One extra row tells the caller that another page exists.
 */
export function page(
	namespace: string,
	options: {
		readonly state?: (typeof states)[number];
		readonly after?: { readonly id: string; readonly key: string };
		readonly limit: number;
	},
) {
	const id = m.id.collate('C'), key = m.key.collate('C');
	return sql.select({
		id: m.id,
		key: m.key,
		state: m.state,
		attempt: m.attempt,
		budget: m.budget,
		due: m.due,
		updated: m.updated,
		expires: m.expires,
		failure: m.failure,
	}).from(messages).where(
		m.namespace.eq(namespace),
		...(options.state ? [m.state.eq(options.state)] : []),
		...(options.after ? [sql.row(id, key).gt([options.after.id, options.after.key])] : []),
	).orderBy(id, key).limit(options.limit + 1);
}

/** Record one operator decision to grant another delivery budget. */
export function addRepair(
	message: MessageKeyType & {
		readonly attempt: number;
		readonly actor: string;
		readonly reason: string;
		readonly time: number;
	},
): sql.Statement<unknown> {
	const { namespace, id, key, attempt, actor, reason, time } = message;
	return sql.insert(repairs, { namespace, id, key, attempt, actor, reason, updated: time });
}

/** Make a failed message pending again with a new budget; clearing the token fences every older claim. */
export function redrive(message: MessageKeyType & { readonly time: number }): sql.Statement<unknown> {
	const { time } = message;
	return sql.update(messages, {
		state: 'pending',
		budget: m.attempt,
		token: null,
		expires: null,
		due: time,
		updated: time,
	})
		.where(at(message));
}

/** Recovery decisions after an attempt, in attempt order. */
export function history(message: MessageKeyType & { readonly after: number; readonly limit: number }) {
	return sql.select({ attempt: r.attempt, actor: r.actor, reason: r.reason, updated: r.updated }).from(repairs).where(
		r.namespace.eq(message.namespace),
		r.id.eq(message.id),
		r.key.eq(message.key),
		r.attempt.gt(message.after),
	).orderBy(r.attempt).limit(message.limit);
}

/** Delete a bounded batch of terminal messages that changed before a cutoff, oldest first. */
export function prune(namespace: string, options: { readonly before: number; readonly limit: number }) {
	const oldest = sql.select({ namespace: m.namespace, id: m.id, key: m.key }).from(messages).where(
		m.namespace.eq(namespace),
		m.state.in(['complete', 'failed']),
		m.updated.lt(options.before),
	).orderBy(m.updated).limit(options.limit);
	return sql.remove(messages).where(sql.row(m.namespace, m.id, m.key).in(oldest)).returning({ id: m.id });
}

/**
 * Completed messages before a cutoff, oldest first, without locks. `where` is the caller's extra condition, applied
 * before the limit; build it from `messages.c` and the caller's own typed tables.
 */
export function completed(
	namespace: string,
	options: { readonly before: number; readonly limit: number; readonly where?: sql.Expr<boolean> },
) {
	return sql.select({ id: m.id, key: m.key, updated: m.updated }).from(messages).where(
		m.namespace.eq(namespace),
		m.state.eq('complete'),
		m.updated.lt(options.before),
		...(options.where ? [options.where] : []),
	).orderBy(m.updated, m.id, m.key).limit(options.limit);
}

/** Delete one message only if it is still complete and completed before the cutoff. */
export function retire(message: MessageKeyType & { readonly before: number }) {
	return sql.remove(messages).where(at(message), m.state.eq('complete'), m.updated.lt(message.before))
		.returning({ id: m.id });
}
