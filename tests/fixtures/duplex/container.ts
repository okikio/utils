/** Own one resource-capped container, copied application bundle and temporary build output. @module */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'tsdown';
import { GenericContainer, PullPolicy, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import * as schema from '@okikio/schema';

/** Pinned official Node image; an explicit local override may select a cached runtime for verification. */
export const Image =
	'node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3';
/** Metrics come from the application inside the container, not a host-side simulation. */
export const MetricsSchema = schema.object({
	pid: schema.number({ integer: true, minimum: 1 }),
	runtime: schema.string(),
	/** The most recent 256 provider entries; this history is not a durable acceptance ledger. */
	started: schema.array(schema.string()),
	/** Every currently owned provider scope, independently of bounded historical receipts. */
	active: schema.array(schema.string()),
	/** Active wait-mode scopes whose heartbeat replies have already been accepted. */
	waiting: schema.array(schema.string()),
	/** Recent entries into provider finally; manual gates may still be holding cleanup here. */
	cleanup: schema.array(schema.string()),
	/** Recent completed finally blocks, after any manual gate was released. */
	closed: schema.array(schema.string()),
	/** Recent finally blocks that threw after cancellation; these are not successful cleanup receipts. */
	failed: schema.array(schema.string()),
	/** Successful-origin OPTIONS requests, observed inside the container. */
	preflights: schema.number({ integer: true, minimum: 0 }),
	/** Credentialed calls that reached the duplex handler's authentication callback. */
	authenticatedPosts: schema.number({ integer: true, minimum: 0 }),
	/** Requests refused by the wrapper's exact-origin policy before provider admission. */
	deniedOrigins: schema.number({ integer: true, minimum: 0 }),
});
/** Checked application lifecycle receipts returned over the container's administrative route. */
export type MetricsType = schema.Output<typeof MetricsSchema>;
/** One owned application. Its origin is browser-accessible; token is a per-run fixture credential. */
export interface Host {
	readonly origin: string;
	readonly url: string;
	readonly token: string;
	readonly image: string;
	metrics(): Promise<MetricsType>;
	release(id: string): Promise<void>;
	[Symbol.asyncDispose](): Promise<void>;
}
/** Start one copied native Node application; there is no host-source mount or package download in the container. */
export async function start(options: {
	readonly allowedOrigin?: string;
	/** An owning proxy fixture can reach this application through the private duplex network alias. */
	readonly network?: string;
} = {}): Promise<Host> {
	const root = fileURLToPath(new URL('../../../', import.meta.url));
	const base = new URL('../../../.tmp/tests/duplex/', import.meta.url);
	await mkdir(base, { recursive: true });
	const output = await mkdtemp(fileURLToPath(new URL('container-', base)));
	const token = crypto.randomUUID();
	const name = `utils-duplex-${crypto.randomUUID()}`;
	const image = process.env.UTILS_DUPLEX_NODE_IMAGE ?? Image;
	let container: StartedTestContainer | undefined;
	let log = '';
	try {
		const results = await build({
			config: false,
			cwd: root,
			entry: ['tests/fixtures/duplex/host.ts'],
			outDir: output,
			platform: 'node',
			target: 'node26',
			format: ['esm'],
			dts: false,
			deps: { alwaysBundle: [/.*/] },
			inputOptions: { resolve: { mainFields: ['module', 'main'] } },
			publint: false,
			attw: false,
			sourcemap: false,
		});
		let entry: string | undefined;
		for (const result of results) {
			for (const chunk of result.chunks) if (chunk.type === 'chunk' && chunk.isEntry) entry = chunk.fileName;
			await result[Symbol.asyncDispose]();
		}
		if (!entry) throw new Error('The container application bundle has no entry.');
		let builder = new GenericContainer(image)
			.withName(name)
			.withLabels({ 'okikio.owner': 'utils-duplex-tests' })
			// Explicit cleanup avoids provisioning a second Ryuk container for this one-container fixture.
			.withAutoCleanup(false).withAutoRemove(true)
			.withPullPolicy(PullPolicy.neverPull())
			.withEntrypoint(['node']).withCommand([`/app/${entry}`])
			.withWorkingDir('/app').withCopyDirectoriesToContainer([{ source: output, target: '/app' }])
			.withEnvironment({
				DUPLEX_TOKEN: token,
				...(options.allowedOrigin ? { DUPLEX_ORIGIN: options.allowedOrigin } : {}),
			})
			.withResourcesQuota({ memory: 0.5, cpu: 1 })
			.withDroppedCapabilities('ALL').withSecurityOpt('no-new-privileges')
			.withExposedPorts(8080).withWaitStrategy(Wait.forHttp('/ready', 8080)).withStartupTimeout(30_000)
			.withLogConsumer((stream) => {
				stream.on('data', (chunk) => {
					log = (log + String(chunk)).slice(-32_768);
				});
			});
		if (options.network) builder = builder.withNetworkMode(options.network).withNetworkAliases('duplex');
		container = await builder.start();
		const origin = `http://${container.getHost()}:${container.getMappedPort(8080)}`;
		/** Administrative calls use the same per-run credential, finite deadline and explicit response check. */
		const request = async (path: string, body?: unknown): Promise<Response> => {
			const response = await fetch(`${origin}${path}`, {
				method: body === undefined ? 'GET' : 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error(`Container administration ${path} returned ${response.status}.`);
			}
			return response;
		};
		return {
			origin,
			url: `${origin}/attempt`,
			token,
			image,
			async metrics() {
				return await schema.parse(MetricsSchema, await (await request('/metrics')).json());
			},
			async release(id) {
				const response = await request('/release', { id });
				await response.body?.cancel();
			},
			async [Symbol.asyncDispose]() {
				try {
					const response = await request('/shutdown', {});
					await response.body?.cancel();
				} finally {
					try {
						await container!.stop({ timeout: 2000 });
					} finally {
						await rm(output, { recursive: true, force: true });
					}
				}
			},
		};
	} catch (cause) {
		try {
			if (container) await container.stop({ timeout: 0 });
			else {
				// Readiness can fail after creation, before Testcontainers returns its handle.
				// Only remove the exact random name owned by this invocation.
				const command = promisify(execFile);
				const remaining = await command('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], { timeout: 15000 });
				if (remaining.stdout.trim()) await command('docker', ['rm', '-f', name], { timeout: 15000 });
			}
		} finally {
			await rm(output, { recursive: true, force: true });
		}
		throw new Error(`Duplex container failed to start. ${log}`, { cause });
	}
}
