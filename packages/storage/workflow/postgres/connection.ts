/**
 * What the workflow store runs on: a borrowed Postgres.js pool, or any `@okikio/sql` database.
 *
 * A Postgres.js pool keeps every feature: transactions hand domain SQL the native `TransactionSql`, and subscriptions
 * wake workers through `LISTEN`. Any other database, such as `pg.database(pool)` from `@okikio/sql/postgres/pg` or
 * a Drizzle or Kysely binding, runs the same statements; its transactions hand out an `Executor`, and workers poll
 * because the port has no `LISTEN`.
 *
 * @module
 */
import type { Sql } from 'postgres';
import * as sql from '@okikio/sql/postgres';
import type { Database, Executor } from '@okikio/sql/postgres';
import { executor, isClient } from '@okikio/sql/postgres/postgresjs';

/** A borrowed Postgres.js pool or an `@okikio/sql` database. */
export type Source = Sql | Database;

/** Whether the source is a Postgres.js pool, which can also `LISTEN`. */
export const isPool = (source: Source): source is Sql => isClient(source);

/**
 * Run `work` in one read-only, repeatable-read transaction, so every read sees one snapshot. Postgres.js takes the mode
 * in `begin`; any other database sets it as the transaction's first statement.
 */
export async function readOnly<Value>(source: Source, work: (tx: Executor) => Promise<Value>): Promise<Value> {
	if (isPool(source)) {
		return await source.begin('isolation level repeatable read read only', (native) => work(executor(native))) as Value;
	}
	return await source.begin(async (tx) => {
		await sql.execute(tx, sql.select({ value: sql.fn.setLocal('transaction_read_only', 'on') }));
		return await work(tx);
	}, { isolation: 'repeatable read' });
}
