/** node-postgres through a hand-written adapter, shared by the by-hand clients. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port, urlOf } from '../types.ts';

type PgClient = import('pg').PoolClient;

/** node-postgres through a hand-written adapter, as an application without the binding would write it. */
export function pgByHand(
	name: string,
	about: string,
	options: (pg: typeof import('pg').default) => Record<string, unknown>,
): ClientType {
	return {
		name,
		about,
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: pg } = await import('pg');
			const pool = new pg.Pool({
				connectionString: urlOf(started),
				...options(pg),
			});
			const run = (target: { query: PgClient['query'] }) => async (query: CompiledType) =>
				(await target.query(query.text, [...query.values])).rows;
			const db = port(run(pool), async (work, begin) => {
				const client = await pool.connect();
				try {
					await client.query(
						begin?.isolation ? `begin isolation level ${begin.isolation}` : 'begin',
					);
					try {
						const result = await work({ run: run(client) } as Executor);
						await client.query('commit');
						return result;
					} catch (error) {
						await client.query('rollback');
						throw error;
					}
				} finally {
					client.release();
				}
			});
			return { db, close: () => pool.end() };
		},
	};
}
