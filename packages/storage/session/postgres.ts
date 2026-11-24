/**
 * Save resource-session ownership and borrowing permission in PostgreSQL.
 * Each change to one session runs alone under a transaction lock. Database time
 * decides lease expiry, so owners with different local clocks agree on it.
 * This stores portable records, not the live resource itself. Imports issue no SQL.
 * Tables live in `schema.ts` and statements in `statements.ts`, built with `@okikio/sql` and no SQL strings.
 * @module
 */
import { RecordSchema } from '@okikio/capability/resource/session';
import type { Store } from '@okikio/capability/resource/session';
import * as sql from '@okikio/sql/postgres';
import type { Database } from '@okikio/sql/postgres';
import * as postgres from '@okikio/sql/postgres/postgresjs';
import type { Pool } from '@okikio/sql/postgres/postgresjs';
import * as tables from './schema.ts';
import * as statements from './statements.ts';

/** Borrowed pool and explicit application partition. A namespace grants no authorization. */
export interface Options {
	/** Application-owned Postgres.js pool, or any `@okikio/sql` database. This adapter never closes it. */
	readonly database: Pool | Database;
	/** Nonblank application partition, at most 128 code points. Applications own reference retention and remove terminal IDs explicitly. */
	readonly namespace: string;
	/** Per-transaction statement timeout, whole milliseconds. Connection/queue timeouts remain pool-owner policy. @default 5000 */
	readonly statementTimeoutMs?: number;
}
/** Explicitly install revision one. No existing workflow/state schema is changed and unknown revisions fail closed. */
export async function migrate(options: { readonly database: Pool | Database }): Promise<void> {
	await postgres.toDatabase(options.database).begin(async (tx) => {
		await sql.execute(tx, tables.migrationLock);
		if ((await sql.one(tx, tables.installed))!.present) {
			if ((await sql.one(tx, tables.stored))?.revision !== tables.revision) {
				throw new TypeError('Unsupported resource session schema revision.');
			}
			if (!(await sql.one(tx, tables.complete))!.present) {
				throw new TypeError('Resource session records table is missing.');
			}
			return;
		}
		for (const statement of tables.install) await sql.execute(tx, statement);
	});
}
/**
 * Open inert authority over a caller-owned pool. Each transition locks one
 * namespace/ID, reads database time, applies a synchronous change and commits.
 * Hash collisions only serialize unrelated IDs. No client clock decides expiry.
 * A failed commit may have an unknown outcome; callers must inspect/reconcile,
 * never assume a failed request grants borrowing or resurrects an old session.
 */
export function open(options: Options): Store {
	const namespace = options.namespace, timeout = options.statementTimeoutMs ?? 5000;
	const database = postgres.toDatabase(options.database);
	if (!namespace.trim() || [...namespace].length > 128) throw new TypeError('Invalid session namespace.');
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000) {
		throw new RangeError('Invalid session statement timeout.');
	}
	return {
		async change(id, change) {
			if (!id || [...id].length > 192) throw new TypeError('Invalid session ID.');
			const result = await database.begin(async (tx) => {
				await sql.one(tx, statements.timeout(timeout));
				// Lock even an absent record: two first creators must not both grant
				// ownership before either has inserted the session row.
				await sql.execute(tx, tables.guard(JSON.stringify([namespace, id])));
				const row = await sql.one(tx, statements.load(namespace, id));
				const clock = (await sql.one(tx, statements.now))!.now;
				// Make the ownership decision against the locked record and database
				// clock together, then persist that decision before returning it.
				const next = change(row?.value, Math.floor(clock));
				if (next) {
					const value = RecordSchema.parse(next);
					if (value.reference.id !== id) throw new TypeError('Session record ID differs from its storage key.');
					await sql.execute(tx, statements.save(namespace, id, value));
					return value;
				}
				await sql.execute(tx, statements.remove(namespace, id));
				return undefined;
			});
			return result;
		},
	};
}
