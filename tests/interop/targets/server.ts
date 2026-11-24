/** Start a server container the way the official PostgreSQL image expects, and wait until it answers. @module */
import { GenericContainer, type StartedNetwork, type StartedTestContainer, Wait } from 'testcontainers';
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
export function plain(
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
		images: [image],
		async start(): Promise<StartedType> {
			const { container, url, version } = await server(image, options);
			return { url, version, stop: async () => void await container.stop() };
		},
	};
}
