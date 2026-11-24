/** The `drizzle` client. @module */
import { type ClientType, urlOf } from './types.ts';

export const client: ClientType = {
	name: 'drizzle',
	about: "Drizzle 0.45 on node-postgres through the package binding and Drizzle's `sql` tag.",
	reach: 'url',
	runtime: 'node',
	async open(started) {
		const { default: pg } = await import('pg');
		const { drizzle } = await import('drizzle-orm/node-postgres');
		const { sql: tag } = await import('drizzle-orm');
		const bridge = await import('@okikio/sql/postgres/drizzle');
		const pool = new pg.Pool({ connectionString: urlOf(started), max: 4 });
		return {
			db: bridge.database(drizzle({ client: pool }), tag),
			close: () => pool.end(),
		};
	},
};
