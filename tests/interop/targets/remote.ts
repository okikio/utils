/** Neon's proxy, and distributed SQL databases that speak the PostgreSQL protocol. @module */
import { GenericContainer, Network, Wait } from 'testcontainers';
import { images } from './images.ts';
import { password, server } from './postgres.ts';
import { ready, type StartedType, type TargetType } from './types.ts';

/**
 * Neon's own proxy, built from Neon's source, in front of PostgreSQL 18. It serves the HTTP endpoint and the
 * WebSocket tunnel that `@neondatabase/serverless` uses, so the serverless driver runs exactly as it does against
 * Neon. Neon hosts the database itself as ordinary PostgreSQL, which the `postgres-*` targets cover.
 */
const neon: TargetType = {
	name: 'neon-proxy',
	about: "Neon's proxy (HTTP and WebSocket) in front of PostgreSQL 18, for the serverless driver.",
	kind: 'serverless',
	reach: 'neon',
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

/** CockroachDB, single node, without TLS. It speaks the PostgreSQL protocol and implements its own SQL engine. */
const cockroach: TargetType = {
	name: 'cockroachdb',
	about: 'CockroachDB 26.4, single node, with floats read through `@okikio/sql/postgres/cockroach`.',
	kind: 'distributed',
	flavor: 'cockroach',
	async start(): Promise<StartedType> {
		const container = await new GenericContainer(images.cockroach)
			.withCommand([
				'start-single-node',
				'--insecure',
				'--store=type=mem,size=1GiB',
			])
			.withExposedPorts(26257, 8080)
			.withWaitStrategy(Wait.forHttp('/health?ready=1', 8080))
			.withStartupTimeout(180_000)
			.start();
		const url = `postgres://root@${container.getHost()}:${container.getMappedPort(26257)}/defaultdb?sslmode=disable`;
		return {
			url,
			version: await ready(url),
			stop: async () => void await container.stop(),
		};
	},
};

/** YugabyteDB, single node. Its SQL layer reuses PostgreSQL's query layer on a distributed store. */
const yugabyte: TargetType = {
	name: 'yugabytedb',
	about: 'YugabyteDB 2025.2, single node (YSQL).',
	kind: 'distributed',
	async start(): Promise<StartedType> {
		const container = await new GenericContainer(images.yugabyte)
			// YugabyteDB refuses writes when it thinks a disk is nearly full ("insufficient disk space"), which it did on a
			// runner with 5 GB free. The catalog lives on the master, so both servers need the flag.
			.withCommand([
				'bin/yugabyted',
				'start',
				'--background=false',
				'--master_flags=reject_writes_when_disk_full=false',
				'--tserver_flags=reject_writes_when_disk_full=false',
			])
			.withExposedPorts(5433)
			.withWaitStrategy(Wait.forListeningPorts())
			.withStartupTimeout(300_000)
			.start();
		const url = `postgres://yugabyte:yugabyte@${container.getHost()}:${container.getMappedPort(5433)}/yugabyte`;
		return {
			url,
			version: await ready(url, 300_000),
			stop: async () => void await container.stop(),
		};
	},
};

export const remote: readonly TargetType[] = [neon, cockroach, yugabyte];
