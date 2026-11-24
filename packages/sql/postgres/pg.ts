/**
 * Bind node-postgres (`pg`) to the {@link Executor} and {@link Database} ports, with cancellation.
 *
 * This module only describes the parts of `pg` it calls, so the package does not depend on `pg`. Drizzle's
 * `node-postgres` driver, Kysely's `PostgresDialect`, TypeORM, Sequelize, knex and MikroORM all sit on a `pg` pool, so
 * passing that same pool here shares its connections.
 *
 * **Cancellation.** A statement with a `signal` runs on a checked-out connection, and an abort sends PostgreSQL's
 * cancel request for that connection, as `psql` and Postgres.js do: a new connection of the same client class carries
 * the connection's process id and secret key. PgBouncer, Supavisor and Neon's proxy route that request to the right
 * server connection. A client that has no secret key, such as a mock, falls back to `pg_cancel_backend(pid)` on
 * another connection of the pool. The run then rejects with the signal's reason. A cancel that arrives after the
 * statement finished may stop the next statement on that connection; the binding sends it only while the statement is
 * still pending, which keeps that window short but cannot close it.
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

/**
 * A `pg` client or a client checked out of a pool. Once connected, `processID` and `secretKey` are the key the server
 * sent for cancel requests, and `connectionParameters` says where to send one.
 */
export interface Client {
	query(text: string, values?: readonly unknown[]): Promise<ResultType>;
	readonly processID?: number | null;
	readonly secretKey?: number | null;
}

/** The parts of a `pg` client that sending its cancel request reads. They are not in `pg`'s type definitions. */
interface CancellableType {
	readonly processID?: number | null;
	readonly secretKey?: number | null;
	readonly connectionParameters?: object;
}

/** A new client of the same class, used only to carry one cancel request. */
interface CancellerType {
	readonly host?: string;
	readonly port?: number;
	readonly connection?: {
		connect?(...target: unknown[]): unknown;
		cancel?(processID: number, secretKey: number): unknown;
		on?(event: string, listener: () => void): unknown;
	};
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

/** How long to wait for a cancel request's connection to close before treating it as sent. */
const cancelWaitMs = 5000;

/**
 * Send the protocol's cancel request for the statement `client` runs, over the connection of a new client of the same
 * class and settings, so TLS, a WebSocket transport or a pooler in between applies to it as well. This is what `pg`'s
 * own `cancel` does, without reading `Client.activeQuery`, which `pg` 8.21 deprecates: the binding only cancels while
 * its own statement runs. Returns `undefined` when the client lacks what the request needs.
 */
function protocolCancel(client: Client): Promise<void> | undefined {
	const target = client as Client & CancellableType;
	const { processID, secretKey } = target;
	if (!processID || !secretKey || !target.connectionParameters) return undefined;
	const Class = target.constructor as new (config: object) => CancellerType;
	const { connection, host, port } = new Class(target.connectionParameters);
	if (!connection?.connect || !connection.cancel || !connection.on) return undefined;
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, cancelWaitMs);
		const done = () => {
			clearTimeout(timer);
			resolve();
		};
		// The server closes the connection after reading the request; an error means it could not be sent.
		connection.on!('end', done);
		connection.on!('error', done);
		connection.on!('connect', () => connection.cancel!(processID, secretKey));
		if (host?.startsWith('/')) connection.connect!(`${host}/.s.PGSQL.${port}`);
		else connection.connect!(port, host);
	});
}

/** Cancel the statement a client runs: by cancel request, or by `pg_cancel_backend` through the pool. */
function canceller(pool: Pool | undefined): (client: Client) => Promise<void> {
	return async (client) => {
		const sent = protocolCancel(client);
		if (sent) return await sent;
		if (pool && client.processID) {
			await pool.query('select pg_cancel_backend($1::int4)', [client.processID]);
		}
	};
}

/** Run one query on a client, and cancel it through `cancel` when the signal aborts. */
async function send(
	client: Client,
	query: CompiledType,
	signal: AbortSignal | undefined,
	cancel: (client: Client) => Promise<void>,
): Promise<readonly RawRow[]> {
	signal?.throwIfAborted();
	const pending = client.query(query.text, query.values);
	if (!signal) return (await pending).rows;
	let settled = false;
	const abort = () => {
		if (!settled) cancel(client).catch(() => {/* The statement may have finished; its result stays authoritative. */});
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
 * Run statements on one `pg` client, such as a checked-out pool client inside your own transaction. A `signal` cancels
 * the statement with a cancel request. Pass the `pool` the client came from as a fallback for a client without a cancel
 * key, which then cancels with `pg_cancel_backend`.
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
