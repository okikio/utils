/** The `pg` client. @module */
import { type ClientType, urlOf } from './types.ts';

export const client: ClientType = {
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
};
