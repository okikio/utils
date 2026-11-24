/** Wire-protocol drivers: Postgres.js, node-postgres, and the SQL clients built into Bun and Deno. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port, urlOf } from './types.ts';

type PgClient = import('pg').PoolClient;

/** node-postgres through a hand-written adapter, as an application without the binding would write it. */
function pgByHand(
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

export const drivers: readonly ClientType[] = [
	{
		name: 'postgresjs',
		about: 'Postgres.js 4 through the package binding, with named prepared statements.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: postgres } = await import('postgres');
			const { database } = await import('@okikio/sql/postgres/postgresjs');
			const pool = postgres(urlOf(started), { max: 4, onnotice: () => {} });
			return { db: database(pool), close: () => pool.end() };
		},
	},
	{
		name: 'postgresjs-unprepared',
		about: 'Postgres.js 4 through the package binding with `prepare: false`, as poolers often require.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: postgres } = await import('postgres');
			const { database } = await import('@okikio/sql/postgres/postgresjs');
			const pool = postgres(urlOf(started), {
				max: 4,
				prepare: false,
				onnotice: () => {},
			});
			return { db: database(pool), close: () => pool.end() };
		},
	},
	{
		name: 'pg',
		about: 'node-postgres 8 through the package binding, which cancels by signal.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: pg } = await import('pg');
			const { database } = await import('@okikio/sql/postgres/pg');
			const pool = new pg.Pool({ connectionString: urlOf(started), max: 4 });
			return { db: database(pool), close: () => pool.end() };
		},
	},
	pgByHand(
		'pg-by-hand',
		'node-postgres 8 through a hand-written adapter: `pool.query(text, values)`.',
		() => ({ max: 4 }),
	),
	pgByHand(
		'pg-one-connection',
		'node-postgres 8 by hand with a pool of one connection.',
		() => ({ max: 1 }),
	),
	pgByHand(
		'pg-type-parsers',
		'node-postgres 8 by hand with type parsers for int8 and timestamptz, as many apps set.',
		(pg) => ({
			max: 4,
			types: {
				getTypeParser: (oid: number, format: 'text' | 'binary') => {
					if (oid === 20) return (value: string) => BigInt(value);
					if (oid === 1184) return (value: string) => new Date(value);
					return pg.types.getTypeParser(oid, format);
				},
			},
		}),
	),
	{
		name: 'bun-sql',
		about: "Bun's built-in SQL client with `unsafe(text, values)`, run in Bun.",
		reach: 'url',
		runtime: 'bun',
	},
	{
		name: 'bun-sql-unprepared',
		about: "Bun's built-in SQL client with `prepare: false`, run in Bun.",
		reach: 'url',
		runtime: 'bun',
	},
	{
		name: 'bun-sql-template',
		about: "Bun's built-in SQL client called as a tag with the template pieces, run in Bun.",
		reach: 'url',
		runtime: 'bun',
	},
	{
		name: 'deno-postgres',
		about: "Deno's `@db/postgres` 0.19, run in Deno.",
		reach: 'url',
		runtime: 'deno',
	},
];
