/**
 * Keep one version-checked Context snapshot in PostgreSQL through a borrowed Postgres.js pool.
 * Construction is inert; migrate() explicitly installs the schema before first use.
 * @module
 */
import type { ReservedSql, Sql } from 'postgres';
import { AsyncDisposableStack } from '@okikio/dispose';
import { SnapshotSchema } from '@okikio/context/state';
import type { OperationOptions, SaveOptions, SnapshotType, Store } from '@okikio/context/state';
import * as schema from '@okikio/schema';
import { ddl, revision } from './schema.ts';

/** PostgreSQL values remain unknown until the shared Context envelope validates them. */
type Row = Record<string, unknown>;

/** Select the persistent identity while leaving connection ownership with the application. */
export interface Options {
	/** Borrowed Postgres.js pool. The adapter never calls end() or cancels unrelated pooled queries. */
	readonly database: Sql;
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
export async function migrate(options: { readonly database: Sql; readonly signal?: AbortSignal }): Promise<void> {
	await transaction(options.database, options.signal, 5000, async (connection) => {
		await query(connection, 'select pg_advisory_xact_lock(776161005)');
		const present = await query(connection, "select to_regclass('utils_state.version') as version");
		if (present[0]?.version !== null) {
			const current = await query(connection, 'select revision from utils_state.version where id');
			if (current[0]?.revision !== revision) throw new TypeError('Unsupported persistent state schema revision.');
			const tables = await query(connection, "select to_regclass('utils_state.snapshots') as snapshots");
			if (tables[0]?.snapshots === null) throw new TypeError('Persistent state snapshots table is missing.');
			return;
		}
		// The advisory lock belongs to this transaction, so concurrent startup cannot
		// interleave a second install between schema creation and revision publication.
		for (const statement of ddl) await query(connection, statement);
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
				return transaction(database, options.signal, timeout, async (connection) => {
					const rows = await query(
						connection,
						'select snapshot from utils_state.snapshots where namespace=$1 and key=$2',
						[namespace, key],
					);
					return rows.length === 0 ? undefined : SnapshotSchema.parse(rows[0]!.snapshot);
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
				// The selected driver serializes jsonb parameters itself. Passing already
				// stringified text would persist a JSON string instead of the envelope object.
				const encoded = database.json(snapshot);
				return await transaction(database, signal, timeout, async (connection) => {
					const rows = expectedVersion === undefined
						? await query(
							connection,
							'insert into utils_state.snapshots(namespace,key,snapshot) values($1,$2,$3::jsonb) on conflict(namespace,key) do nothing returning key',
							[namespace, key, encoded],
						)
						: await query(
							connection,
							"update utils_state.snapshots set snapshot=$3::jsonb where namespace=$1 and key=$2 and snapshot->>'version'=$4 returning key",
							[namespace, key, encoded, expectedVersion],
						);
					return rows.length === 1;
				});
			},
		} satisfies Store,
	);
}

/**
 * Reserve one session through COMMIT or awaited rollback, then release it once.
 *
 * A reserved session keeps all statements on the same physical connection and
 * avoids a transaction callback outliving a rejected outer driver transaction.
 * The stack attempts rollback before release even after a query or cancellation
 * failure. Language-level disposal retains both the operation error and any
 * rollback/release error through SuppressedError.
 */
async function transaction<Value>(
	database: Sql,
	signal: AbortSignal | undefined,
	timeout: number,
	work: (connection: ReservedSql) => Promise<Value>,
): Promise<Value> {
	signal?.throwIfAborted();
	await using resources = new AsyncDisposableStack();
	const connection = await database.reserve();
	resources.defer(() => connection.release());
	signal?.throwIfAborted();
	let committed = false;
	resources.defer(async () => {
		if (!committed) await query(connection, 'rollback');
	});
	await query(connection, 'begin isolation level read committed');
	await query(connection, "select set_config('statement_timeout',$1,true)", [String(timeout)]);
	signal?.throwIfAborted();
	const value = await work(connection);
	signal?.throwIfAborted();
	await query(connection, 'commit');
	committed = true;
	return value;
}

/**

 * Parameters stay separate from fixed SQL text; awaiting the driver includes its ReadyForQuery

 * acknowledgement.

 */
async function query(connection: ReservedSql, statement: string, parameters: readonly unknown[] = []): Promise<Row[]> {
	return await connection.unsafe(statement, parameters as NonNullable<Parameters<Sql['unsafe']>[1]>) as Row[];
}

/** Validate application partition/key policy before the adapter can reserve a database connection. */
function text(value: string, name: string, maximum: number): string {
	try {
		return schema.string({ minLength: 1, maxLength: maximum, pattern: /\S/u }).parse(value);
	} catch (cause) {
		throw new TypeError(`${name} must contain 1 through ${maximum} Unicode code points and not be blank.`, { cause });
	}
}
