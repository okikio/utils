/** YugabyteDB, a distributed SQL database built on PostgreSQL's query layer. @module */
import { GenericContainer, Wait } from 'testcontainers';
import { images } from './images.ts';
import { ready, type StartedType, type TargetType } from './types.ts';

/**
 * One client at a time. With four clients side by side on a CI runner, most clients failed within seconds and four hung
 * until their 15-minute timeout; one at a time, every case passes.
 */
export const concurrency = 1;

/** YugabyteDB, single node. Its SQL layer reuses PostgreSQL's query layer on a distributed store. */
export const target: TargetType = {
	name: 'yugabytedb',
	about: 'YugabyteDB 2025.2, single node (YSQL).',
	kind: 'distributed',
	images: [images.yugabyte],
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
