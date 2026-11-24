/**
 * Run this package's statements through a Kysely instance or transaction.
 *
 * Each statement goes through Kysely's own `sql` tag, so its values stay parameters and Kysely's plugins and logger see
 * it. Pass that tag in; this package does not depend on Kysely. Inside `db.transaction().execute`, wrap the `trx`
 * Kysely hands you with {@link executor} to run both kinds of statement in one transaction.
 *
 * Kysely tables are plain TypeScript interfaces with nothing to read at run time, so adopt them through `inspect` and
 * `generate` from `@okikio/sql/postgres/adopt`.
 *
 * **Cancellation.** Kysely 0.29 and later take a `signal` and cancel the statement in the database with
 * `inflightQueryAbortStrategy: 'cancel query'`, when the dialect supports it. Older versions ignore it, and the signal
 * is then only checked before the statement is sent.
 *
 * @example
 * ```ts ignore
 * import { sql as tag } from 'kysely';
 * import * as kysely from '@okikio/sql/postgres/kysely';
 *
 * const db = kysely.database(orm, tag);
 * await orm.transaction().execute(async (trx) => {
 *   await sql.execute(kysely.executor(trx, tag), sql.insert(accounts, { displayName: 'Ada' }));
 * });
 * ```
 *
 * @module
 */
import type { CompiledType } from '../fragment.ts';
import type { BeginOptions, Database, Executor, IsolationType, RawRow, RunOptions } from '../run.ts';

/** What Kysely's `sql` tag returns: a statement to run on an instance or transaction. */
export interface Raw {
	execute(session: never, options?: { signal?: AbortSignal; inflightQueryAbortStrategy?: string }): PromiseLike<{
		readonly rows: readonly unknown[];
	}>;
}

/** Kysely's `sql` tag, from `kysely`. */
export type Tag = (strings: TemplateStringsArray, ...values: unknown[]) => Raw;

/** A Kysely instance or transaction. The tag's `execute` is the only thing that reads it. */
export type Session = object;

/** A Kysely transaction being configured. */
interface TransactionBuilder {
	setIsolationLevel(level: IsolationType): TransactionBuilder;
	execute<T>(work: (trx: Session) => Promise<T>): Promise<T>;
}

/** A Kysely instance, which can open transactions. */
export interface KyselyDatabase {
	transaction(): TransactionBuilder;
}

async function send(session: Session, tag: Tag, query: CompiledType, options?: RunOptions) {
	const signal = options?.signal;
	signal?.throwIfAborted();
	try {
		const result = await tag(query.strings, ...query.values).execute(
			session as never,
			signal ? { signal, inflightQueryAbortStrategy: 'cancel query' } : undefined,
		);
		return result.rows as readonly RawRow[];
	} catch (error) {
		if (signal?.aborted) throw signal.reason;
		throw error;
	}
}

/** Run statements on a Kysely instance or on the `trx` of a Kysely transaction. */
export function executor(session: Session, tag: Tag): Executor {
	return Object.freeze({ run: (query: CompiledType, options?: RunOptions) => send(session, tag, query, options) });
}

/** Run statements on a Kysely instance, and open transactions with `db.transaction()`. */
export function database(db: KyselyDatabase, tag: Tag): Database {
	return Object.freeze({
		run: (query: CompiledType, options?: RunOptions): Promise<readonly RawRow[]> => send(db, tag, query, options),
		begin<T>(work: (tx: Executor) => Promise<T>, options?: BeginOptions): Promise<T> {
			const builder = options?.isolation ? db.transaction().setIsolationLevel(options.isolation) : db.transaction();
			return builder.execute((trx) => work(executor(trx, tag)));
		},
	});
}
