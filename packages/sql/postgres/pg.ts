/**
 * Bind node-postgres (`pg`) to the {@link Executor} and {@link Database} ports, with cancellation.
 *
 * This module only describes the parts of `pg` it calls, so the package does not depend on `pg`. Drizzle's
 * `node-postgres` driver, Kysely's `PostgresDialect`, TypeORM, Sequelize, knex and MikroORM all sit on a `pg` pool, so
 * passing that same pool here shares its connections.
 *
 * **Cancellation.** PostgreSQL cancels a statement from outside its connection: `pg_cancel_backend(pid)` on another
 * connection stops whatever that backend runs. So a statement with a `signal` runs on a checked-out connection, and an
 * abort asks the pool for a second one to send the cancel. The run then rejects with the signal's reason. A cancel that
 * arrives after the statement finished may stop the next statement on that connection; the binding sends it only while
 * the statement is still pending, which keeps that window short but cannot close it.
 *
 * @example
 * ```ts ignore
 * import pg from 'pg';
 * import { database } from '@okikio/sql/postgres/pg';
 *
 * const db = database(new pg.Pool({ connectionString }));
 * const rows = await sql.rows(db, query, { signal: AbortSignal.timeout(5_000) });
 * await db.begin(async (tx) => { … }, { isolation: 'serializable' });
 * ```
 *
 * @module
 */
import type { CompiledType } from '../fragment.ts';
import type { BeginOptions, Database, Executor, IsolationType, RawRow, RunOptions } from '../run.ts';

/** The result `pg` returns for a query. */
export interface ResultType {
	readonly rows: readonly RawRow[];
}

/** A `pg` client or a client checked out of a pool. `processID` is the backend's pid once connected. */
export interface Client {
	query(text: string, values?: readonly unknown[]): Promise<ResultType>;
	readonly processID?: number | null;
}

/** A checked-out pool client, which must be released. `release(error)` discards a broken connection. */
export interface PoolClient extends Client {
	release(error?: Error | boolean): void;
}

/** A `pg` pool. */
export interface Pool {
	query(text: string, values?: readonly unknown[]): Promise<ResultType>;
	connect(): Promise<PoolClient>;
}

/** PostgreSQL's error code for a statement stopped by a cancel request. */
const cancelled = '57014';

/** The isolation statement, from a fixed list. */
const levels: Readonly<Record<IsolationType, string>> = {
	'read committed': 'begin isolation level read committed',
	'repeatable read': 'begin isolation level repeatable read',
	serializable: 'begin isolation level serializable',
};

/** Send `pg_cancel_backend` for a backend through another connection of the pool. */
function canceller(pool: Pool | undefined): ((pid: number) => Promise<void>) | undefined {
	if (!pool) return undefined;
	return async (pid) => {
		await pool.query('select pg_cancel_backend($1::integer)', [pid]);
	};
}

/** Run one query on a client, and cancel it through `cancel` when the signal aborts. */
async function send(
	client: Client,
	query: CompiledType,
	signal: AbortSignal | undefined,
	cancel: ((pid: number) => Promise<void>) | undefined,
): Promise<readonly RawRow[]> {
	signal?.throwIfAborted();
	const pending = client.query(query.text, query.values);
	if (!signal || !cancel || !client.processID) return (await pending).rows;
	let settled = false;
	const pid = client.processID;
	const abort = () => {
		if (!settled) cancel(pid).catch(() => {/* The statement may have finished; its result stays authoritative. */});
	};
	signal.addEventListener('abort', abort, { once: true });
	try {
		return (await pending).rows;
	} catch (error) {
		if (signal.aborted && (error as { code?: unknown } | null)?.code === cancelled) throw signal.reason;
		throw error;
	} finally {
		settled = true;
		signal.removeEventListener('abort', abort);
	}
}

/**
 * Run statements on one `pg` client, such as a checked-out pool client inside your own transaction. Pass the `pool`
 * the client came from to make `signal` cancel the statement; without it the signal is checked only before sending.
 */
export function executor(client: Client, pool?: Pool): Executor {
	const cancel = canceller(pool);
	return Object.freeze({
		run: (query: CompiledType, options?: RunOptions) => send(client, query, options?.signal, cancel),
	});
}

/** Run a piece of work on a checked-out client, releasing it, and discarding it if the work broke the connection. */
async function using<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await pool.connect();
	let broken: Error | undefined;
	try {
		return await work(client);
	} catch (error) {
		// A cancelled or failed statement leaves the connection usable; only a failed rollback or commit breaks it.
		if ((error as { broken?: boolean } | null)?.broken) broken = error as Error;
		throw error;
	} finally {
		client.release(broken);
	}
}

/** A failure that leaves the connection in an unknown transaction state, so the pool must discard it. */
function brokenBy(error: unknown): Error {
	return Object.assign(error instanceof Error ? error : new Error(String(error)), { broken: true });
}

/** Run statements on a `pg` pool, cancel them by signal, and open transactions on it. */
export function database(pool: Pool): Database {
	const cancel = canceller(pool);
	return Object.freeze({
		async run(query: CompiledType, options?: RunOptions): Promise<readonly RawRow[]> {
			// `pool.query` hides which backend runs the statement, so a cancellable run checks one out.
			if (!options?.signal) return (await pool.query(query.text, query.values)).rows;
			return await using(pool, (client) => send(client, query, options.signal, cancel));
		},
		async begin<T>(work: (tx: Executor) => Promise<T>, options?: BeginOptions): Promise<T> {
			return await using(pool, async (client) => {
				await client.query(options?.isolation ? levels[options.isolation] : 'begin');
				let result: T;
				try {
					result = await work(Object.freeze({
						run: (query: CompiledType, runOptions?: RunOptions) => send(client, query, runOptions?.signal, cancel),
					}));
				} catch (error) {
					try {
						await client.query('rollback');
					} catch (rollback) {
						throw brokenBy(rollback);
					}
					throw error;
				}
				// A failed commit, such as a serialization failure, ends the transaction and leaves the connection usable.
				await client.query('commit');
				return result;
			});
		},
	});
}
