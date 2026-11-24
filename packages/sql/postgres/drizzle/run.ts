/**
 * Run this package's statements through a Drizzle database or transaction.
 *
 * Each statement goes through Drizzle's own `sql` tag, so its values stay parameters and Drizzle's logger sees it. Pass
 * that tag in; this package does not depend on Drizzle. Inside `db.transaction`, wrap the `tx` Drizzle hands you with
 * {@link executor} to run both kinds of statement in one transaction.
 *
 * **Cancellation.** Drizzle takes no `AbortSignal`. When the database runs on a `pg` pool or a Postgres.js client,
 * which Drizzle exposes as `db.$client`, {@link database} sends a statement with a `signal` through that client's
 * binding, which cancels it. A Drizzle transaction hides its connection, so inside one the signal is only checked
 * before a statement is sent.
 *
 * @module
 */
import type { CompiledType } from '../../fragment.ts';
import type { BeginOptions, Database, Executor, IsolationType, RawRow, RunOptions } from '../../run.ts';
import * as pg from '../pg.ts';
import * as postgresjs from '../postgresjs.ts';

/** Drizzle's `sql` tag, from `drizzle-orm`. */
export type Tag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

/** A Drizzle database or transaction, as far as this module calls it. */
export interface Session {
	execute(query: never): PromiseLike<unknown>;
}

/** A Drizzle database, which can open transactions. */
export interface DrizzleDatabase extends Session {
	transaction<T>(work: (tx: Session) => Promise<T>, config?: { isolationLevel?: IsolationType }): Promise<T>;
	readonly $client?: unknown;
}

/** The rows of a Drizzle result: node-postgres returns `{ rows }`, Postgres.js returns the rows. */
function rowsOf(result: unknown): readonly RawRow[] {
	if (Array.isArray(result)) return result;
	const rows = (result as { rows?: unknown } | null)?.rows;
	if (!Array.isArray(rows)) throw new TypeError('The Drizzle result has no rows.');
	return rows;
}

async function send(session: Session, tag: Tag, query: CompiledType, options?: RunOptions) {
	options?.signal?.throwIfAborted();
	return rowsOf(await session.execute(tag(query.strings, ...query.values) as never));
}

/** Run statements on a Drizzle database or on the `tx` of a Drizzle transaction. */
export function executor(session: Session, tag: Tag): Executor {
	return Object.freeze({ run: (query: CompiledType, options?: RunOptions) => send(session, tag, query, options) });
}

/** The binding of the client under a Drizzle database, for statements that may be cancelled. */
function driver(client: unknown): Database | undefined {
	if (postgresjs.isClient(client) && typeof (client as { begin?: unknown }).begin === 'function') {
		return postgresjs.database(client as postgresjs.Pool);
	}
	const pool = client as Partial<pg.Pool> | null;
	if (typeof pool?.connect === 'function' && typeof pool.query === 'function' && 'totalCount' in pool) {
		return pg.database(pool as pg.Pool);
	}
	return undefined;
}

/** Run statements on a Drizzle database, and open transactions with `db.transaction`. */
export function database(db: DrizzleDatabase, tag: Tag): Database {
	const cancellable = driver(db.$client);
	return Object.freeze({
		run: (query: CompiledType, options?: RunOptions): Promise<readonly RawRow[]> =>
			options?.signal && cancellable ? cancellable.run(query, options) : send(db, tag, query, options),
		begin: <T>(work: (tx: Executor) => Promise<T>, options?: BeginOptions): Promise<T> =>
			db.transaction(
				(tx) => work(executor(tx, tag)),
				options?.isolation ? { isolationLevel: options.isolation } : undefined,
			),
	});
}
