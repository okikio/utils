/** The `neon-websocket` client. @module */
import { neonDriver } from './shared/neon.ts';
import { type ClientType } from './types.ts';

export const client: ClientType = {
	name: 'neon-websocket',
	about: "Neon's serverless driver over WebSockets: its pg-compatible `Pool` through the package's `pg` binding.",
	reach: 'neon',
	runtime: 'node',
	async open(started) {
		const { neon, connection } = await neonDriver(started);
		const { database } = await import('@okikio/sql/postgres/pg');
		const pool = new neon.Pool({ connectionString: connection, max: 4 });
		return { db: database(pool as never), close: () => pool.end() };
	},
};
