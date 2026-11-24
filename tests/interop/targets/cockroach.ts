/** CockroachDB, a distributed SQL database that speaks the PostgreSQL protocol. @module */
import { GenericContainer, Wait } from 'testcontainers';
import { images } from './images.ts';
import { ready, type StartedType, type TargetType } from './types.ts';

/** CockroachDB, single node, without TLS. It speaks the PostgreSQL protocol and implements its own SQL engine. */
export const target: TargetType = {
	name: 'cockroachdb',
	about: 'CockroachDB 26.4, single node, with floats read through `@okikio/sql/postgres/cockroach`.',
	kind: 'distributed',
	flavor: 'cockroach',
	images: [images.cockroach],
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
