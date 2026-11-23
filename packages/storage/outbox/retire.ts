/**
 * Retire completed outbox messages one at a time, inside the application's own transaction.
 *
 * `prune()` removes any terminal row, failed ones included, in a transaction it owns. That suits a
 * plain retention job, but not an application that must first prove its own records are finished.
 * For example, an operation store may keep a message until the operation has expired and every
 * attempt is cleaned up. It needs to:
 *
 * 1. find completed messages that its own tables say are finished ({@link completed}), and
 * 2. lock its own record, check it again, and delete that one message in the same transaction
 *    ({@link remove}).
 *
 * Failed messages are never touched here. They stay for an operator to inspect and redrive.
 *
 * ```ts ignore
 * const found = await box.completed(database, {
 * 	before: Date.now() - 48 * 3600_000,
 * 	where: database`exists (select 1 from app.jobs j where j.id::text = utils_outbox.messages.key and j.done)`,
 * });
 * for (const item of found) {
 * 	await database.begin(async (tx) => {
 * 		// Lock and recheck the application's record here, then:
 * 		await box.remove(tx, item, Date.now() - 48 * 3600_000);
 * 	});
 * }
 * ```
 *
 * @module
 */
import type { Fragment, Sql, TransactionSql } from 'postgres';

/** One completed message, without its payload. */
export interface RetiredType {
	/** Message definition ID. */
	readonly id: string;
	/** Occurrence key within that definition. */
	readonly key: string;
	/** When the message completed, in database epoch milliseconds. */
	readonly updated: number;
}

/** What {@link completed} looks for. */
export interface CompletedOptions {
	/** Only messages that completed before this time, in database epoch milliseconds. */
	readonly before: number;
	/** At most this many rows, from 1 to 1,000. @default 100 */
	readonly limit?: number;
	/**
	 * Extra condition, applied before the limit so rows the application must keep cannot crowd out
	 * rows it may retire. It may refer to the columns of `utils_outbox.messages`: `namespace`, `id`,
	 * `key` and `updated`. Build it with the same Postgres.js instance, so values stay parameters.
	 */
	readonly where?: Fragment;
}

/** Validate an epoch cutoff before it reaches SQL. */
function cutoff(before: number): number {
	if (!Number.isSafeInteger(before) || before < 0) throw new RangeError('Invalid retention cutoff.');
	return before;
}

/**
 * List completed messages, oldest first. Takes no locks, so the caller can lock its own records first.
 * A listed message is only a candidate: {@link remove} checks its state again before deleting.
 */
export async function completed(
	database: Sql | TransactionSql,
	namespace: string,
	options: CompletedOptions,
): Promise<readonly RetiredType[]> {
	const before = cutoff(options.before);
	const limit = options.limit ?? 100;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid limit.');
	const extra = options.where ? database`and (${options.where})` : database``;
	const rows = await database`select id,key,updated from utils_outbox.messages
		where namespace=${namespace} and state='complete' and updated<${before} ${extra}
		order by updated,id,key limit ${limit}`;
	return Object.freeze(
		rows.map((row) => Object.freeze({ id: String(row.id), key: String(row.key), updated: Number(row.updated) })),
	);
}

/**
 * Delete one completed message inside the caller's transaction. Returns `false` and deletes nothing
 * when the message is missing, is not complete, or completed at or after `before`; a failed or
 * redelivered message is therefore safe from a stale candidate. Its repair history goes with it.
 *
 * Takes the namespace lock that append, claim and redrive take, so it cannot interleave with them.
 * Deleting ends deduplication for that key: a later append with the same key is accepted again.
 */
export async function remove(
	tx: TransactionSql,
	namespace: string,
	message: { readonly id: string; readonly key: string },
	before: number,
): Promise<boolean> {
	const time = cutoff(before);
	await tx`select pg_advisory_xact_lock(hashtextextended(${`outbox:${namespace}`},0))`;
	const rows = await tx`delete from utils_outbox.messages
		where namespace=${namespace} and id=${message.id} and key=${message.key}
		and state='complete' and updated<${time} returning id`;
	return rows.length === 1;
}
