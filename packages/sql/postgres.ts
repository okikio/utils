/**
 * Bind Postgres.js to the {@link Executor} and {@link Database} ports.
 *
 * This module only describes the parts of Postgres.js it calls, so the package does not depend on Postgres.js. The
 * statement goes through the client's own tag, so its values stay parameters.
 *
 * @module
 */
import type { CompiledType } from './fragment.ts';
import type { Database, Executor, RawRow } from './run.ts';

/** The Postgres.js calls this binding uses: the tag, and `begin` on a pool. */
export interface Client {
	(strings: TemplateStringsArray, ...values: never[]): PromiseLike<readonly RawRow[]>;
	readonly unsafe: unknown;
}

/** A Postgres.js pool, which can also open transactions. */
export interface Pool extends Client {
	begin<T>(work: (tx: Client) => Promise<T>): PromiseLike<T>;
}

/** Whether a value is a Postgres.js client rather than an executor. */
export function isClient(value: unknown): value is Client {
	return typeof value === 'function' && typeof (value as { unsafe?: unknown }).unsafe === 'function';
}

/** Run statements on a Postgres.js pool, connection or transaction. */
export function executor(client: Client): Executor {
	return Object.freeze({
		async run(query: CompiledType): Promise<readonly RawRow[]> {
			return await client(query.strings, ...(query.values as never[]));
		},
	});
}

/** Run statements on a Postgres.js pool and open transactions on it. */
export function database(pool: Pool): Database {
	const run = executor(pool);
	return Object.freeze({
		run: run.run,
		async begin<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
			return await pool.begin((tx) => work(executor(tx)));
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
