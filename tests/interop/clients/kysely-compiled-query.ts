/** The `kysely-compiled-query` client. @module */
import type { CompiledType, Executor, RunOptions } from '@okikio/sql/postgres';
import { aborting, type ClientType, port, urlOf } from './types.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
	name: 'kysely-compiled-query',
	about: 'Kysely 0.29 by hand with `CompiledQuery.raw(text, values)`, passing the signal to `executeQuery`.',
	reach: 'url',
	runtime: 'node',
	async open(started) {
		const { default: pg } = await import('pg');
		const { Kysely, PostgresDialect, CompiledQuery } = await import('kysely');
		const db = new Kysely<Record<string, never>>({
			dialect: new PostgresDialect({
				pool: new pg.Pool({ connectionString: urlOf(started), max: 4 }),
			}),
		});
		type Target = Pick<typeof db, 'executeQuery'>;
		const run = (target: Target) => (query: CompiledType, options?: RunOptions) =>
			aborting(options, async (signal) =>
				(await target.executeQuery(
					CompiledQuery.raw(query.text, [...query.values]),
					signal ? { signal, inflightQueryAbortStrategy: 'cancel query' } : undefined,
				)).rows as Rows);
		return {
			db: port(run(db), (work, options) => {
				const builder = options?.isolation ? db.transaction().setIsolationLevel(options.isolation) : db.transaction();
				return builder.execute((trx) => work({ run: run(trx) } as Executor));
			}),
			close: () => db.destroy(),
		};
	},
};
