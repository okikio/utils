/**
 * Expressions and locks that several workflow statement modules share.
 *
 * @module
 */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import type { Temporal } from '@okikio/duration/temporal';
import { events, instructions, progress } from '../schema/mod.ts';

/** Run states in which jobs, waits and cleanup can still make progress. */
export const live = ['ready', 'waiting', 'advancing', 'settling'] as const;

/** The database clock. Leases and timers always use it, never a host clock. */
export const clock: sql.Expr<Temporal.Instant> = sql.fn.clockTimestamp();

/** The time `milliseconds` after now, in database time. */
export function after(milliseconds: number): sql.Expr<Temporal.Instant> {
	return sql.later(clock, milliseconds);
}

const hash = sql.declare('hashtextextended', [types.text(), types.bigint], types.bigint);
const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);

/** Advisory lock keys. Each lock serializes one kind of decision in a namespace. */
export const keys = {
	/** Admission: queue limits and command keys. */
	admission: 776161004n,
	/** One host's free-slot check. */
	capacity: 776161005n,
	/** Shared ancestor admission and topology replacement. */
	placement: 776161009n,
} as const;

/** Hold a transaction lock named by text and a fixed key, until the transaction ends. */
export function named(name: string, key: bigint): sql.Statement<{ locked: undefined }> {
	return sql.select({ locked: lock(hash(name, key)) });
}

/** Bytes of retained history for a run: instructions, events and progress reports share one budget. */
export function history(namespace: string, run: string): sql.Statement<{ bytes: number }> {
	const total = (table: typeof instructions | typeof events | typeof progress) =>
		sql.aggregate(
			sql.select({ bytes: sql.coalesce(sql.fn.sum(table.c.bytes), 0) }).from(table).where(
				table.c.namespace.eq(namespace),
				table.c.run.eq(run),
			),
		);
	return sql.select({ bytes: sql.add(sql.add(total(instructions), total(events)), total(progress)) });
}

/** Whether a saved time has passed, by the database clock. */
export function due(at: Temporal.Instant): sql.Statement<{ due: boolean }> {
	return sql.select({ due: sql.value(at, types.timestamptz).lte(clock) });
}

/** The database time `milliseconds` from now. */
export function later(milliseconds: number): sql.Statement<{ at: Temporal.Instant }> {
	return sql.select({ at: after(milliseconds) });
}

/** Bound waits inside an adapter transaction; the borrowed pool's defaults stay unchanged. */
export function limits(): readonly sql.Statement<{ value: string }>[] {
	return [
		sql.select({ value: sql.fn.setLocal('statement_timeout', '5000ms') }),
		sql.select({ value: sql.fn.setLocal('lock_timeout', '2000ms') }),
		sql.select({ value: sql.fn.setLocal('idle_in_transaction_session_timeout', '10000ms') }),
		sql.select({ value: sql.fn.setLocal('transaction_timeout', '10000ms') }),
	];
}
