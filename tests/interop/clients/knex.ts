/** The `knex` client. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port, positional, urlOf } from './types.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
	name: 'knex',
	about: 'knex 3 through `raw(text, values)` with `?` placeholders.',
	reach: 'url',
	runtime: 'node',
	async open(started) {
		const { default: knex } = await import('knex');
		const db = knex({
			// knex's `pg` dialect reads the server version from `select version()` and fails on CockroachDB's.
			client: started.flavor === 'cockroach' ? 'cockroachdb' : 'pg',
			connection: urlOf(started),
			pool: { min: 0, max: 4 },
		});
		type Target = {
			raw(text: string, values: unknown[]): Promise<{ rows: Rows }>;
		};
		const run = (target: Target) => async (query: CompiledType) =>
			(await target.raw(positional(query), [...query.values])).rows;
		return {
			db: port(
				run(db as unknown as Target),
				(work, options) =>
					db.transaction(
						(trx) => work({ run: run(trx as unknown as Target) } as Executor),
						options?.isolation ? { isolationLevel: options.isolation } : undefined,
					),
			),
			close: () => db.destroy(),
		};
	},
};
