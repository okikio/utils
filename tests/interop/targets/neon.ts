/** Neon's proxy in front of PostgreSQL, for Neon's serverless driver. @module */
import { GenericContainer, Network, Wait } from 'testcontainers';
import { images } from './images.ts';
import { password, server } from './server.ts';
import type { StartedType, TargetType } from './types.ts';

/** One client at a time: each HTTP statement opens its own server connection, so clients side by side exceed `max_connections`. */
export const concurrency = 1;

/**
 * Neon's own proxy, built from Neon's source, in front of PostgreSQL 18. It serves the HTTP endpoint and the
 * WebSocket tunnel that `@neondatabase/serverless` uses, so the serverless driver runs exactly as it does against
 * Neon. Neon hosts the database itself as ordinary PostgreSQL, which the `postgres-*` targets cover.
 */
export const target: TargetType = {
	name: 'neon-proxy',
	about: "Neon's proxy (HTTP and WebSocket) in front of PostgreSQL 18, for the serverless driver.",
	kind: 'serverless',
	reach: 'neon',
	images: [images.postgres18, images.neonProxy],
	async start(): Promise<StartedType> {
		const network = await new Network().start();
		const database = await server(images.postgres18, { network });
		const proxy = await new GenericContainer(images.neonProxy)
			.withNetwork(network)
			.withEnvironment({
				PG_CONNECTION_STRING: `postgres://postgres:${password}@db:5432/postgres`,
			})
			.withExposedPorts(4444)
			.withWaitStrategy(Wait.forListeningPorts())
			.withStartupTimeout(120_000)
			.start();
		const base = `${proxy.getHost()}:${proxy.getMappedPort(4444)}`;
		return {
			// The proxy routes on the endpoint name in the host, so the string names `db.localtest.me`; the driver sends it
			// to the proxy rather than resolving it.
			neon: {
				http: `http://${base}/sql`,
				ws: `${base}/v1`,
				connection: `postgres://postgres:${password}@db.localtest.me:5432/postgres`,
			},
			version: `Neon proxy → ${database.version}`,
			stop: async () => {
				await proxy.stop();
				await database.container.stop();
				await network.stop();
			},
		};
	},
};
