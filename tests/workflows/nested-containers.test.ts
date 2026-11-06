/** Memory and saved execution run the same stateful work in actual container threads and children. */
import '@okikio/dispose/polyfill';
import { after, before, it } from 'node:test';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, getContainerRuntimeClient, Network, Wait } from 'testcontainers';
import type { StartedNetwork, StartedTestContainer } from 'testcontainers';
import { build } from 'tsdown';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import { Parent, Policy, ReceiptSchema } from '../fixtures/nested-contract.ts';
import { scratch } from './fixtures/evidence.ts';

const NodeImage = 'node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3';
const PostgresImage = 'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db';
const owned = new Set<StartedTestContainer>();
const files = new Map<string, string>();
let output: string;
let network: StartedNetwork;
let database: Sql;
before(async () => {
	output = await scratch('utils-nested-');
	const results = await build({
		config: false,
		cwd: fileURLToPath(new URL('../../', import.meta.url)),
		entry: ['nested-coordinator', 'nested-thread', 'nested-process'].map((name) => `tests/fixtures/${name}.ts`),
		outDir: output,
		platform: 'node',
		target: 'node26',
		format: ['esm'],
		dts: false,
		deps: { alwaysBundle: [/.*/] },
		inputOptions: { resolve: { mainFields: ['module', 'main'] } },
		publint: false,
		attw: false,
	});
	for (const result of results) {
		for (const chunk of result.chunks) {
			if (chunk.type === 'chunk' && chunk.isEntry) files.set(chunk.name, chunk.fileName);
		}
		await result[Symbol.asyncDispose]();
	}
	expect(files.size).toBe(3);
	network = await new Network().start();
	const sql = await new PostgreSqlContainer(PostgresImage).withNetwork(network).withNetworkAliases('database')
		.withDatabase('nested').withUsername('fixture').withPassword('fixture').start();
	owned.add(sql);
	database = postgresjs(sql.getConnectionUri(), { max: 12, onnotice() {} });
	await postgres.migrate({ database });
});
after(async () => {
	await database?.end({ timeout: 2 });
	for (const container of [...owned].reverse()) await container.stop({ timeout: 0 });
	await network?.stop();
	if (output) await rm(output, { recursive: true, force: true });
});
/** A prestarted executor owns its native provider; deployment, not workflow, creates the container. */
async function start(namespace: string, owner: string, kind: string) {
	let diagnostic = '';
	const container = await new GenericContainer(NodeImage).withNetwork(network).withWorkingDir('/app')
		.withCopyDirectoriesToContainer([{ source: output, target: '/app' }])
		.withEnvironment({
			DATABASE_URL: 'postgres://fixture:fixture@database:5432/nested',
			WORKFLOW_NAMESPACE: namespace,
			PLACEMENT_OWNER: owner,
			PLACEMENT_KIND: kind,
			PORT: '8080',
			PLACEMENT_THREAD_MODULE: `./${files.get('nested-thread')!}`,
			PLACEMENT_PROCESS_MODULE: `./${files.get('nested-process')!}`,
		})
		.withCommand(['node', files.get('nested-coordinator')!]).withExposedPorts(8080)
		.withLogConsumer((stream) =>
			stream.on('data', (data) => {
				diagnostic = (diagnostic + String(data)).slice(-32768);
			})
		)
		.withWaitStrategy(Wait.forHttp('/ready', 8080)).withStartupTimeout(30000).start()
		.catch((cause: unknown) => {
			throw new Error(`Nested container startup failed: ${diagnostic}`, { cause });
		});
	owned.add(container);
	const stop = async () => {
		if (!owned.has(container)) return;
		await container.stop({ timeout: 0 });
		owned.delete(container);
	};
	return {
		container,
		origin: `http://${container.getHost()}:${container.getMappedPort(8080)}`,
		stop,
		[Symbol.asyncDispose]: stop,
	};
}
async function until(read: () => Promise<boolean>): Promise<void> {
	const deadline = AbortSignal.timeout(20000);
	while (!await read()) {
		deadline.throwIfAborted();
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
for (const kind of ['thread', 'process'] as const) {
	it(`runs memory and durable nested work in actual container ${kind} hosts, then recovers portable work`, {
		timeout: 120000,
	}, async () => {
		const namespace = crypto.randomUUID();
		await using _wrong = await start(namespace, 'wrong', kind);
		await using right = await start(namespace, 'right', kind);
		await using store = postgres.open({ database, namespace });
		const client = workflow.client({ store, policy: Policy });
		const memory = await fetch(`${right.origin}/memory`, { signal: AbortSignal.timeout(20000) });
		expect(memory.status).toBe(200);
		const raw: unknown = await memory.json();
		if (!Array.isArray(raw) || raw.length !== 2) throw new Error('Expected two resource receipts.');
		const [a, b] = raw.map((value: unknown) => ReceiptSchema.parse(value));
		expect(a!.owner).toBe('right');
		expect(a!.instance).toBe(b!.instance);
		expect(b!.finished).toBe(1);
		if (kind === 'thread') expect(a!.thread).toBeGreaterThan(0);
		else expect(a!.thread).toBe(0);
		const location = workflow.placement.on({ id: `${kind}:right`, generation: 1 });
		const ref = await client.trigger(Parent, 'slow', { scope: 'container', key: 'restart', location });
		await until(async () => {
			const rows = await database`select state from utils_workflow.jobs where namespace=${namespace} order by path`;
			return rows.length === 2 && rows[0]!.state === 'completed' && rows[1]!.state === 'claimed';
		});
		// Kill the physical owner while its second activity is still blocked.
		const runtime = await getContainerRuntimeClient();
		await runtime.container.getById(right.container.getId()).kill({ signal: 'SIGKILL' });
		await right.stop();
		await using _replacement = await start(namespace, 'right', kind);
		const receipts = await client.wait(Parent, ref, { signal: AbortSignal.timeout(20000), intervalMs: 10 });
		expect(receipts).toHaveLength(2);
		expect(receipts[0]!.instance).toBe(a!.instance);
		expect(receipts[1]!.instance).not.toBe(a!.instance);
		for (const receipt of receipts) expect(receipt.owner).toBe('right');
		const jobs = await database`select state,host,location from utils_workflow.jobs where namespace=${namespace}`;
		expect(jobs).toHaveLength(2);
		for (const job of jobs) {
			expect(job.state).toBe('completed');
			expect(job.host).toBe('right');
			expect(job.location).toEqual(location);
		}
	});
}
