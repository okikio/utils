/** The `drizzle-neon-http` client. @module */
import { neonDriver } from './shared/neon.ts';
import { type ClientType } from './types.ts';

export const client: ClientType = {
	name: 'drizzle-neon-http',
	about: 'Drizzle on Neon over HTTP through the package binding.',
	reach: 'neon',
	runtime: 'node',
	async open(started) {
		const { neon, connection } = await neonDriver(started);
		const { drizzle } = await import('drizzle-orm/neon-http');
		const { sql: tag } = await import('drizzle-orm');
		const bridge = await import('@okikio/sql/postgres/drizzle');
		return {
			db: bridge.database(
				drizzle({ client: neon.neon(connection) }) as never,
				tag,
			),
			close: () => Promise.resolve(),
		};
	},
};
