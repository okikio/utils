/** The `drizzle-postgresjs` client. @module */
import { type ClientType, urlOf } from './types.ts';

export const client: ClientType = {
	name: 'drizzle-postgresjs',
	about: 'Drizzle 0.45 on Postgres.js through the package binding.',
	reach: 'url',
	runtime: 'node',
	async open(started) {
		const { default: postgres } = await import('postgres');
		const { drizzle } = await import('drizzle-orm/postgres-js');
		const { sql: tag } = await import('drizzle-orm');
		const bridge = await import('@okikio/sql/postgres/drizzle');
		const client = postgres(urlOf(started), { max: 4, onnotice: () => {} });
		return {
			db: bridge.database(drizzle({ client }), tag),
			close: () => client.end(),
		};
	},
};
