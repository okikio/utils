/** PostgreSQL itself, every supported major version, and distributions built on it. @module */
import { GenericContainer, type StartedNetwork, type StartedTestContainer, Wait } from 'testcontainers';
import { images } from './images.ts';
import { ready, type StartedType, type TargetType } from './types.ts';

export const password = 'interop';

/** Start a container that follows the official image's conventions, optionally on a network under the alias `db`. */
export async function server(
	image: string,
	options: {
		readonly network?: StartedNetwork;
		readonly env?: Readonly<Record<string, string>>;
		readonly command?: readonly string[];
		readonly files?: readonly {
			readonly content: string;
			readonly target: string;
		}[];
	} = {},
): Promise<{ container: StartedTestContainer; url: string; version: string }> {
	let builder = new GenericContainer(image)
		.withEnvironment({ POSTGRES_PASSWORD: password, ...options.env })
		.withExposedPorts(5432)
		.withWaitStrategy(Wait.forListeningPorts())
		.withStartupTimeout(180_000);
	if (options.network) {
		builder = builder.withNetwork(options.network).withNetworkAliases('db');
	}
	if (options.command) builder = builder.withCommand([...options.command]);
	if (options.files) {
		builder = builder.withCopyContentToContainer([...options.files]);
	}
	const container = await builder.start();
	const url = `postgres://postgres:${password}@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
	try {
		// The official entrypoint restarts the server once after initialization; wait for the final one.
		const version = await ready(url);
		return { container, url, version };
	} catch (error) {
		await container.stop();
		throw error;
	}
}

/** A target for one image that behaves like the official PostgreSQL image. */
function plain(
	name: string,
	image: string,
	about: string,
	kind: TargetType['kind'],
	options: Parameters<typeof server>[1] = {},
): TargetType {
	return {
		name,
		about,
		kind,
		async start(): Promise<StartedType> {
			const { container, url, version } = await server(image, options);
			return { url, version, stop: async () => void await container.stop() };
		},
	};
}

export const postgres: readonly TargetType[] = [
	plain(
		'postgres-14',
		images.postgres14,
		'PostgreSQL 14, the oldest version the package reads exactly.',
		'postgres',
	),
	plain('postgres-15', images.postgres15, 'PostgreSQL 15.', 'postgres'),
	plain('postgres-16', images.postgres16, 'PostgreSQL 16.', 'postgres'),
	plain('postgres-17', images.postgres17, 'PostgreSQL 17.', 'postgres'),
	plain('postgres-18', images.postgres18, 'PostgreSQL 18.', 'postgres'),
	plain('postgres-19', images.postgres19, 'PostgreSQL 19.', 'postgres'),
];

export const distributions: readonly TargetType[] = [
	plain(
		'timescaledb',
		images.timescale,
		'TimescaleDB 2 on PostgreSQL 18, with its extension loaded.',
		'distribution',
	),
	plain(
		'citus',
		images.citus,
		'Citus 14 single node: distributed tables are opt-in, so plain tables behave as usual.',
		'distribution',
	),
	plain(
		'paradedb',
		images.paradedb,
		'ParadeDB on PostgreSQL 18, with pg_search loaded.',
		'distribution',
	),
	plain(
		'alloydb-omni',
		images.alloydb,
		"AlloyDB Omni 17, Google's PostgreSQL-compatible engine.",
		'distribution',
	),
	plain(
		'supabase-postgres',
		images.supabase,
		"Supabase's PostgreSQL 17 image with its extensions and roles, connected directly.",
		'distribution',
		{
			command: [
				'postgres',
				'-c',
				'config_file=/etc/postgresql/postgresql.conf',
			],
		},
	),
];
