/** The `postgresjs-unprepared` client. @module */
import { type ClientType, urlOf } from './types.ts';

export const client: ClientType = {
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
};
