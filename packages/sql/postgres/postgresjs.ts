/**
 * Bind Postgres.js to the {@link Executor} and {@link Database} ports.
 *
 * This module only describes the parts of Postgres.js it calls, so the package does not depend on Postgres.js. The
 * statement goes through the client's own tag, so its values stay parameters.
 *
 * @module
 */
import type { CompiledType } from '../fragment.ts';
import type { BeginOptions, Database, Executor, IsolationType, RawRow, RunOptions } from '../run.ts';

/** A running Postgres.js query. `cancel` asks the server to stop it. */
export interface PendingType extends PromiseLike<readonly RawRow[]> {
	cancel?(): unknown;
}

/** The Postgres.js calls this binding uses: the tag, and `begin` on a pool. */
export interface Client {
	(strings: TemplateStringsArray, ...values: never[]): PendingType;
	readonly unsafe: unknown;
}

/** A Postgres.js pool, which can also open transactions. */
export interface Pool extends Client {
	begin<T>(work: (tx: Client) => Promise<T>): PromiseLike<T>;
	begin<T>(options: string, work: (tx: Client) => Promise<T>): PromiseLike<T>;
}

/** PostgreSQL's error code for a statement stopped by a cancel request. */
const cancelled = '57014';

/** Whether a value is a Postgres.js client rather than an executor. */
export function isClient(value: unknown): value is Client {
	return typeof value === 'function' && typeof (value as { unsafe?: unknown }).unsafe === 'function';
}

/**
 * Run one query, and cancel it when the signal aborts.
 *
 * A cancel request addresses the connection, not the statement. If the statement has already finished, a late cancel
 * may stop the next statement on that connection, so the listener is removed as soon as this query settles.
 */
async function send(client: Client, query: CompiledType, signal?: AbortSignal): Promise<readonly RawRow[]> {
	signal?.throwIfAborted();
	const pending = client(query.strings, ...(query.values as never[]));
	if (!signal) return await pending;
	const cancel = () => {
		try {
			pending.cancel?.();
		} catch { /* The query may already have finished; its result stays authoritative. */ }
	};
	signal.addEventListener('abort', cancel, { once: true });
	try {
		return await pending;
	} catch (error) {
		if (signal.aborted && (error as { code?: unknown } | null)?.code === cancelled) throw signal.reason;
		throw error;
	} finally {
		signal.removeEventListener('abort', cancel);
	}
}

/** Run statements on a Postgres.js pool, connection or transaction. */
export function executor(client: Client): Executor {
	return Object.freeze({
		run: (query: CompiledType, options?: RunOptions) => send(client, query, options?.signal),
	});
}

/** The `begin` option text for an isolation level, from a fixed list. */
function level(isolation: IsolationType): string {
	return `isolation level ${isolation}`;
}

/** Run statements on a Postgres.js pool and open transactions on it. */
export function database(pool: Pool): Database {
	return Object.freeze({
		run: (query: CompiledType, options?: RunOptions) => send(pool, query, options?.signal),
		async begin<T>(work: (tx: Executor) => Promise<T>, options?: BeginOptions): Promise<T> {
			const body = (tx: Client) => work(executor(tx));
			return await (options?.isolation ? pool.begin(level(options.isolation), body) : pool.begin(body));
		},
	});
}

/** Accept a Postgres.js client or an executor. */
export function toExecutor(value: Client | Executor): Executor {
	return isClient(value) ? executor(value) : value;
}

/** Accept a Postgres.js pool or a database port. */
export function toDatabase(value: Pool | Database): Database {
	return isClient(value) ? database(value as Pool) : value as Database;
}
