/** The `postgresjs` client. @module */
import { type ClientType, urlOf } from './types.ts';

export const client: ClientType = {
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
};
