/**
 * Keep one version-checked Context snapshot in PostgreSQL through a borrowed pool.
 * Construction is inert; migrate() explicitly installs the schema before first use.
 *
 * The tables are defined in `schema.ts` and every statement is built in `statements.ts` with `@okikio/sql`, without
 * SQL strings. Pass a Postgres.js pool, or any `@okikio/sql` database for another client.
 * @module
 */
import type { ReservedSql } from 'postgres';
import { AsyncDisposableStack } from '@okikio/dispose';
import { SnapshotSchema } from '@okikio/context/state';
import type { OperationOptions, SaveOptions, SnapshotType, Store } from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as sql from '@okikio/sql/postgres';
import type { Database, Executor } from '@okikio/sql/postgres';
import * as postgres from '@okikio/sql/postgres/postgresjs';
import type { Pool } from '@okikio/sql/postgres/postgresjs';
import * as tables from './schema.ts';
import * as statements from './statements.ts';

/** A Postgres.js pool that can reserve one connection, so cancellation can roll back on that connection. */
interface Reserving extends Pool {
	reserve(): Promise<ReservedSql>;
}

/** Select the persistent identity while leaving connection ownership with the application. */
export interface Options {
	/**
	 * Borrowed Postgres.js pool, or any `@okikio/sql` database. The adapter never calls end() or cancels unrelated
	 * pooled queries.
	 */
	readonly database: Pool | Database;
	/**
	 * Nonblank application-owned partition, from 1 through 128 Unicode code points; it grants no
	 * authorization.
	 */
	readonly namespace: string;
	/**
	 * Nonblank durable identity, from 1 through 512 Unicode code points. Reopening loads the last
	 * accepted version.
	 */
	readonly key: string;
	/**
	 * Transaction-local PostgreSQL statement timeout in whole milliseconds, from 1 through 60000.
	 * @default 5000
	 */
	readonly statementTimeoutMilliseconds?: number;
}

/**
 * Install state tables or accept a recognized revision with its required snapshot table.
 *
 * Concurrent migrations serialize on a dedicated advisory transaction lock.
 * Existing unknown revisions reject before DDL. The application explicitly
 * chooses the database and migration time; importing or opening a store never
 * changes schema. This check is not a structural audit of manually altered
 * columns or constraints. No existing snapshot is rewritten or removed.
 */
export async function migrate(
	options: { readonly database: Pool | Database; readonly signal?: AbortSignal },
): Promise<void> {
	await transaction(options.database, options.signal, 5000, async (tx) => {
		await sql.execute(tx, tables.migrationLock);
		if ((await sql.one(tx, tables.installed))!.present) {
			const current = await sql.one(tx, tables.stored);
			if (current?.revision !== tables.revision) throw new TypeError('Unsupported persistent state schema revision.');
			if (!(await sql.one(tx, tables.complete))!.present) {
				throw new TypeError('Persistent state snapshots table is missing.');
			}
			return;
		}
		// The advisory lock belongs to this transaction, so concurrent startup cannot
		// interleave a second install between schema creation and revision publication.
		for (const statement of tables.install) await sql.execute(tx, statement);
	});
}

/**
 * Construct one persistent slot without reserving a connection or issuing SQL.
 *
 * Each save owns a short READ COMMITTED transaction. Initial creation uses the
 * primary key's conflict handling; replacement uses a version predicate on the
 * same row. PostgreSQL rechecks that predicate after a competing writer commits,
 * so two owners cannot both replace the same expected version.
 *
 * Cancellation before COMMIT causes rollback when the connection remains
 * usable. Once COMMIT is sent its driver result is authoritative; a connection
 * failure can leave its outcome unknown. Operations join their reserved session
 * and cleanup instead of calling query.cancel(), which can race with other work
 * in the selected driver. Cancellation can therefore wait for a statement,
 * connection attempt, or pool reservation. The supplied pool's connection and
 * queue timeouts remain application policy; the statement timeout is local to
 * this transaction and does not change the borrowed pool's defaults.
 *
 * Only the current row is retained for each namespace/key. No event or revision
 * history accumulates. The application owns retention and deletion of keys once
 * their business lifetime ends. Disposing a cell leaves the saved row and pool.
 *
 * @example
 * ```ts
 * import * as snapshots from '@okikio/storage/state/postgres';
 * // database is an application-owned Postgres.js pool.
 * const store = snapshots.open({ database, namespace: 'crawl', key: 'catalog-cursor' });
 * ```
 */
export function open(options: Options): Store {
	const database = options.database;
	const namespace = text(options.namespace, 'State namespace', 128);
	const key = text(options.key, 'State key', 512);
	const timeout = options.statementTimeoutMilliseconds ?? 5000;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) {
		throw new RangeError('Statement timeout must be 1 through 60000 milliseconds.');
	}
	return Object.freeze(
		{
			concurrency: 'atomic',
			load(options: OperationOptions = {}): Promise<SnapshotType | undefined> {
				return transaction(database, options.signal, timeout, async (tx) => {
					return (await sql.one(tx, statements.load(namespace, key)))?.snapshot;
				});
			},
			/**
			 * Replace the current snapshot only if its stored version matches the caller's expected version. A
			 * competing accepted write returns false instead of being overwritten.
			 */
			async save(input: SnapshotType, options: SaveOptions): Promise<boolean> {
				const { expectedVersion, signal } = options;
				signal?.throwIfAborted();
				const snapshot = SnapshotSchema.parse(input);
				if (snapshot.version === expectedVersion) {
					throw new TypeError(
						'A state replacement requires a fresh version.',
					);
				}
				return await transaction(database, signal, timeout, async (tx) => {
					const rows = expectedVersion === undefined
						? await sql.rows(tx, statements.create(namespace, key, snapshot))
						: await sql.rows(tx, statements.replace(namespace, key, snapshot, expectedVersion));
					return rows.length === 1;
				});
			},
		} satisfies Store,
	);
}

/**
 * Run `work` in one READ COMMITTED transaction with a transaction-local statement timeout.
 *
 * With a Postgres.js pool, the transaction runs on one reserved connection through COMMIT or awaited rollback, then
 * releases it once. A reserved session keeps every statement on the same physical connection and avoids a transaction
 * callback outliving a rejected outer driver transaction. The stack attempts rollback before release even after a
 * statement or cancellation failure; language-level disposal keeps both the operation error and any rollback or
 * release error through SuppressedError. Another client's database runs `work` through its own `begin`.
 */
async function transaction<Value>(
	database: Pool | Database,
	signal: AbortSignal | undefined,
	timeout: number,
	work: (tx: Executor) => Promise<Value>,
): Promise<Value> {
	signal?.throwIfAborted();
	if (!postgres.isClient(database) || typeof (database as Partial<Reserving>).reserve !== 'function') {
		return await postgres.toDatabase(database).begin(async (tx) => {
			await sql.one(tx, statements.timeout(timeout));
			signal?.throwIfAborted();
			const value = await work(tx);
			signal?.throwIfAborted();
			return value;
		}, { isolation: 'read committed' });
	}
	await using resources = new AsyncDisposableStack();
	const connection = await (database as Reserving).reserve();
	resources.defer(() => connection.release());
	signal?.throwIfAborted();
	const tx = postgres.executor(connection);
	let committed = false;
	resources.defer(async () => {
		if (!committed) await sql.execute(tx, statements.rollback);
	});
	await sql.execute(tx, statements.begin);
	await sql.one(tx, statements.timeout(timeout));
	signal?.throwIfAborted();
	const value = await work(tx);
	signal?.throwIfAborted();
	await sql.execute(tx, statements.commit);
	committed = true;
	return value;
}

/** Validate application partition/key policy before the adapter can reserve a database connection. */
function text(value: string, name: string, maximum: number): string {
	try {
		return schema.string({ minLength: 1, maxLength: maximum, pattern: /\S/u }).parse(value);
	} catch (cause) {
		throw new TypeError(`${name} must contain 1 through ${maximum} Unicode code points and not be blank.`, { cause });
	}
}
