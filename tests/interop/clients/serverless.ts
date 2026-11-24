/** Neon's serverless driver over HTTP and WebSockets, the ORMs on top of it, and PGlite in process. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import type { StartedType } from '../targets/mod.ts';
import { prisma } from './orms.ts';
import { aborting, type ClientType, port } from './types.ts';

type Rows = readonly Record<string, unknown>[];

/** Point Neon's driver at the local proxy. The settings are global, and the suite opens one client at a time. */
async function neonDriver(started: StartedType) {
	if (!started.neon) throw new Error('This target has no Neon proxy.');
	const neon = await import('@neondatabase/serverless');
	const { default: ws } = await import('ws');
	const endpoints = started.neon;
	neon.neonConfig.fetchEndpoint = () => endpoints.http;
	neon.neonConfig.wsProxy = () => endpoints.ws;
	neon.neonConfig.useSecureWebSocket = false;
	neon.neonConfig.pipelineTLS = false;
	neon.neonConfig.pipelineConnect = false;
	neon.neonConfig.webSocketConstructor = ws;
	return { neon, connection: endpoints.connection };
}

export const serverless: readonly ClientType[] = [
	{
		name: 'neon-http',
		about:
			"Neon's serverless driver over HTTP: `neon(url).query(text, values)`, with the signal on the request. HTTP " +
			'has no interactive transactions.',
		reach: 'neon',
		runtime: 'node',
		async open(started) {
			const { neon, connection } = await neonDriver(started);
			const client = neon.neon(connection);
			const db = port(
				(query, options) =>
					aborting(
						options,
						async (signal) =>
							await client.query(
								query.text,
								[...query.values],
								signal ? { fetchOptions: { signal } } : undefined,
							) as Rows,
					),
				() =>
					Promise.reject(
						new Error(
							'Neon over HTTP runs each statement alone; it has no interactive transactions.',
						),
					),
			);
			return { db, close: () => Promise.resolve() };
		},
	},
	{
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
	},
	{
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
	},
	{
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
	},
	{
		name: 'prisma-neon',
		about: 'Prisma 7 with `@prisma/adapter-neon` over WebSockets, through `$queryRawUnsafe`.',
		reach: 'neon',
		runtime: 'node',
		async open(started) {
			const { connection } = await neonDriver(started);
			const { PrismaNeon } = await import('@prisma/adapter-neon');
			return await prisma(new PrismaNeon({ connectionString: connection }));
		},
	},
	{
		name: 'pglite',
		about: 'PGlite 0.6 in this process through `query(text, values)`.',
		reach: 'embedded',
		runtime: 'node',
		async open() {
			const { PGlite } = await import('@electric-sql/pglite');
			const db = await PGlite.create();
			type Target = {
				query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
			};
			const run = (target: Target) => async (query: CompiledType) =>
				(await target.query(query.text, [...query.values])).rows as Rows;
			return {
				db: port(run(db), (work, options) =>
					db.transaction(async (tx) => {
						if (options?.isolation) {
							await tx.exec(
								`set transaction isolation level ${options.isolation}`,
							);
						}
						return await work({ run: run(tx) } as Executor);
					})),
				close: () => db.close(),
			};
		},
	},
];
