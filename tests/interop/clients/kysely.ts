/** The `kysely` client. @module */
import { type ClientType, urlOf } from './types.ts';

export const client: ClientType = {
	name: 'kysely',
	about: "Kysely 0.29 on node-postgres through the package binding and Kysely's `sql` tag.",
	reach: 'url',
	runtime: 'node',
	async open(started) {
		const { default: pg } = await import('pg');
		const { Kysely, PostgresDialect, sql: tag } = await import('kysely');
		const bridge = await import('@okikio/sql/postgres/kysely');
		const db = new Kysely<Record<string, never>>({
			dialect: new PostgresDialect({
				pool: new pg.Pool({ connectionString: urlOf(started), max: 4 }),
			}),
		});
		return { db: bridge.database(db, tag), close: () => db.destroy() };
	},
};
