/** The `drizzle-neon-websocket` client. @module */
import { neonDriver } from './shared/neon.ts';
import { type ClientType } from './types.ts';

export const client: ClientType = {
	name: 'drizzle-neon-websocket',
	about: 'Drizzle on Neon over WebSockets through the package binding.',
	reach: 'neon',
	runtime: 'node',
	async open(started) {
		const { neon, connection } = await neonDriver(started);
		const { drizzle } = await import('drizzle-orm/neon-serverless');
		const { sql: tag } = await import('drizzle-orm');
		const bridge = await import('@okikio/sql/postgres/drizzle');
		const pool = new neon.Pool({ connectionString: connection, max: 4 });
		return {
			db: bridge.database(drizzle({ client: pool }) as never, tag),
			close: () => pool.end(),
		};
	},
};
