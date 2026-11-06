/** Queue work through HTTP, then recover it across real service and worker containers. @module */
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait } from 'testcontainers';
import type { StartedNetwork, StartedTestContainer } from 'testcontainers';
import { build } from 'tsdown';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import * as schemaCore from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import { SnapshotSchema } from '@okikio/workflow/execution';
import * as postgres from '@okikio/storage/workflow/postgres';
import { Parent as PlacementParent, Policy as PlacementPolicy } from './scenarios/placement.ts';
import { scratch } from './fixtures/evidence.ts';

const PostgresImage = 'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db';
const NodeImage = 'node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3';
const root = fileURLToPath(new URL('../../', import.meta.url));
const containers = new Set<StartedTestContainer>();
const files = new Map<string, string>();

let network: StartedNetwork;
let sql: Sql;
let output: string;
let collectorOrigin: string;
const databaseUrl = 'postgres://fixture:fixture@database:5432/workflows';

/** Poll a visible condition. A failed condition must explain the last observation before its deadline. */
async function until<Value>(read: () => Promise<Value | false | undefined>, timeout = 20_000): Promise<Value> {
	const deadline = AbortSignal.timeout(timeout);
	let last: unknown;
	while (!deadline.aborted) {
		try {
			const value = await read();
			if (value !== undefined && value !== false) return value;
		} catch (error) {
			last = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error('Container scenario did not reach the expected condition', { cause: last });
}

/** Copy bundled code into each container. No host process, source mount, or runtime package download supplies the worker. */
async function start(
	file: 'host' | 'provider' | 'service' | 'collector' | 'placement',
	namespace: string,
	environment: Record<string, string> = {},
) {
	let log = '';
	const container = await new GenericContainer(NodeImage)
		.withNetwork(network)
		.withNetworkAliases(['provider', 'collector'].includes(file) ? file : `worker-${crypto.randomUUID()}`)
		.withWorkingDir('/app')
		.withCopyDirectoriesToContainer([{ source: output, target: '/app' }])
		.withEnvironment({
			DATABASE_URL: databaseUrl,
			WORKFLOW_NAMESPACE: namespace,
			PROVIDER_URL: 'http://provider:8080',
			TELEMETRY_URL: 'http://collector:8080',
			WORKER_ID: crypto.randomUUID(),
			PORT: '8080',
			BIND: '0.0.0.0',
			...environment,
		})
		.withCommand(['node', files.get(file)!])
		.withExposedPorts(8080)
		.withLogConsumer((stream) => {
			stream.on('data', (chunk: string | Uint8Array) => {
				log = (log + (typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))).slice(-65_536);
			});
		})
		.withWaitStrategy(Wait.forHttp('/ready', 8080))
		.withStartupTimeout(30_000)
		.start().catch((cause: unknown) => {
			throw new Error(`${file} failed to start:\n${log}`, { cause });
		});
	containers.add(container);
	return {
		container,
		origin: `http://${container.getHost()}:${container.getMappedPort(8080)}`,
		async event(name: string) {
			await until(async () => log.includes(`"name":"${name}"`));
		},
		async stop() {
			await container.stop({ timeout: 0 });
			containers.delete(container);
		},
	};
}

/** Requests use only the service's HTTP contract. The parent test inspects SQL separately to prove the stored result. */
async function submit(origin: string, kind: 'imports' | 'research', input: unknown): Promise<workflow.ReferenceType> {
	const response = await fetch(`${origin}/${kind}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(5000),
	});
	expect(response.status).toBe(202);
	return workflow.ReferenceSchema.parse(await response.json());
}

/** Poll the public status route until a completed snapshot is visible; failed and blocked snapshots remain diagnostic failures. */
async function completed(origin: string, kind: 'imports' | 'research', ref: workflow.ReferenceType) {
	return await until(async () => {
		const response = await fetch(`${origin}/${kind}?id=${ref.id}&scope=${ref.scope}`, {
			signal: AbortSignal.timeout(2000),
		});
		expect(response.status).toBe(200);
		const snapshot = SnapshotSchema.parse(await response.json());
		if (snapshot.state === 'blocked' || snapshot.state === 'failed') throw new Error(JSON.stringify(snapshot));
		return snapshot.state === 'completed' ? snapshot : undefined;
	});
}

describe('HTTP service and background worker containers', { timeout: 240_000, concurrency: false }, () => {
	before(async () => {
		output = await scratch('utils-workers-');
		// Bundle the real same-source consumers. Testcontainers and the test runner stay outside the application image.
		const results = await build({
			config: false,
			cwd: root,
			entry: ['host', 'provider', 'service', 'collector', 'placement'].map((name) =>
				`${root}tests/workflows/scenarios/${name}.ts`
			),
			outDir: output,
			platform: 'node',
			inputOptions: { resolve: { mainFields: ['module', 'main'] } },
			target: 'node26',
			format: ['esm'],
			dts: false,
			deps: { alwaysBundle: [/.*/] },
			publint: false,
			attw: false,
		});
		for (const chunk of results.flatMap((result) => result.chunks)) {
			if (chunk.type === 'chunk' && chunk.isEntry) {
				files.set(chunk.name, chunk.fileName);
			}
		}
		for (const result of results) await result[Symbol.asyncDispose]();
		expect([...files.keys()].sort()).toEqual(['collector', 'host', 'placement', 'provider', 'service']);
		network = await new Network().start();
		const database = await new PostgreSqlContainer(PostgresImage)
			.withNetwork(network).withNetworkAliases('database')
			.withDatabase('workflows').withUsername('fixture').withPassword('fixture').start();
		containers.add(database);
		sql = postgresjs(database.getConnectionUri(), { max: 8, onnotice() {} });
		await postgres.migrate({ database: sql });
		await sql.unsafe(await readFile(new URL('./scenarios/schema.sql', import.meta.url), 'utf8'));
		collectorOrigin = (await start('collector', 'collector')).origin;
		await start('provider', 'provider');
	});
	after(async () => {
		await sql?.end({ timeout: 2 });
		// Stop users of the network before the database and network. No unrelated containers are selected.
		for (const container of [...containers].reverse()) await container.stop({ timeout: 0 });
		await network?.stop();
		if (output) await rm(output, { recursive: true, force: true });
	});
	it('places nested work on the required registered container process', async () => {
		const namespace = crypto.randomUUID();
		const compute = (name: string): workflow.ComputeType => ({
			id: `process:${name}`,
			generation: 1,
			parent: `container:${name}`,
			kind: 'process',
			ancestors: [{ id: 'node', generation: 1 }, { id: `pod:${name}`, generation: 1, parent: 'node' }, {
				id: `container:${name}`,
				generation: 1,
				parent: `pod:${name}`,
				capacity: 2,
			}],
		});
		const wrong = await start('placement', namespace, {
			WORKER_ID: 'other',
			COMPUTE: JSON.stringify(compute('other')),
		});
		const right = await start('placement', namespace, {
			WORKER_ID: 'target',
			COMPUTE: JSON.stringify(compute('target')),
		});
		try {
			await using store = postgres.open({ database: sql, namespace });
			const client = workflow.client({ store, policy: PlacementPolicy });
			const location = workflow.placement.intersect(
				workflow.placement.within({ id: 'pod:target', generation: 1 }),
				workflow.placement.on({ id: 'process:target', generation: 1 }),
			);
			const ref = await client.trigger(PlacementParent, 'payload', { scope: 'placement', key: 'nested', location });
			expect(await client.wait(PlacementParent, ref, { signal: AbortSignal.timeout(20_000), intervalMs: 25 })).toBe(
				'target:payload',
			);
			const jobs = await sql`select host,location from utils_workflow.jobs where namespace=${namespace}`;
			expect(jobs).toHaveLength(1);
			expect(jobs[0]!.host).toBe('target');
			expect(jobs[0]!.location).toEqual(location);
		} finally {
			await right.stop();
			await wrong.stop();
		}
	});

	it('accepts an import while workers are offline, then replaces a container after its rows commit', async () => {
		const namespace = crypto.randomUUID();
		let service = await start('service', namespace);
		const input = {
			scope: crypto.randomUUID(),
			source: crypto.randomUUID(),
			revision: 1,
			key: 'import-v1',
			body: 'name\n' + Array.from({ length: 1005 }, (_, i) => `name-${i}`).join('\n'),
		};
		const ref = await submit(service.origin, 'imports', input);
		expect(await sql`select id from utils_workflow.hosts where namespace=${namespace}`).toHaveLength(0);
		expect(await sql`select id from utils_workflow.jobs where namespace=${namespace} and state='ready'`).toHaveLength(
			1,
		);
		expect(await sql`select position from source_rows where scope=${input.scope}`).toHaveLength(0);
		await service.stop();
		service = await start('service', namespace);
		expect((await submit(service.origin, 'imports', input)).id).toBe(ref.id);
		const worker = await start('host', namespace, { WORKER_ROLE: 'imports', PAUSE_AT: 'core.rows.committed' });
		await worker.event('core.rows.committed');
		await worker.stop(); // Docker sends SIGKILL. JS cleanup cannot save progress.
		await sql`update source_rows set correction='customer correction' where scope=${input.scope} and position=1`;
		const replacement = await start('host', namespace, { WORKER_ROLE: 'imports' });
		const result = await completed(service.origin, 'imports', ref);
		expect(result.value).toMatchObject({ rows: 1005 });
		await until(async () => {
			const rows = await sql`select position,value from accounts where scope=${input.scope}`;
			return rows.length === 1005 ? rows : undefined;
		});
		expect((await sql`select value from accounts where scope=${input.scope} and position=1`)[0]!.value)
			.toBe('customer correction');
		expect(await sql`select position from source_rows where scope=${input.scope}`).toHaveLength(1005);
		expect((await submit(service.origin, 'imports', input)).id).toBe(ref.id);
		const attempts = await sql`select state from utils_workflow.attempts where namespace=${namespace} and job in
      (select id from utils_workflow.jobs where namespace=${namespace} and definition->>'id'='fixture.core.parse')`;
		// The crash requires another attempt. A busy host can also miss a renewal before that crash.
		expect(attempts.length).toBeGreaterThanOrEqual(2);
		expect(attempts.filter((attempt) => attempt.state === 'success')).toHaveLength(1);
		// The first process may lose unflushed spans on SIGKILL. Durable identity still joins its replacement.
		const row = (await sql`select trace from utils_workflow.runs where namespace=${namespace} and id=${ref.id}`)[0]!;
		const [, traceId, parentSpanId] = schemaCore.object({
			version: schemaCore.literal(1),
			traceparent: schemaCore.string(),
		}).parse(row.trace)
			.traceparent.split('-');
		await until(async () => {
			const exports = schemaCore.array(schemaCore.object({
				resourceSpans: schemaCore.optional(schemaCore.array(schemaCore.object({
					scopeSpans: schemaCore.array(schemaCore.object({
						spans: schemaCore.array(
							schemaCore.object({
								name: schemaCore.string(),
								traceId: schemaCore.string(),
								parentSpanId: schemaCore.optional(schemaCore.string()),
							}, { unknownKeys: 'strip' }),
						),
					}, { unknownKeys: 'strip' })),
				}, { unknownKeys: 'strip' }))),
			}, { unknownKeys: 'strip' })).parse(await (await fetch(`${collectorOrigin}/exports`)).json());
			const spans = exports.flatMap((data) => data.resourceSpans ?? []).flatMap((data) => data.scopeSpans).flatMap((
				data,
			) => data.spans);
			return spans.some((span) =>
				span.name === 'workflow.attempt' && span.traceId === traceId && span.parentSpanId === parentSpanId
			);
		});
		await replacement.stop();
		await service.stop();
	});

	it('queues capture for another engine, recovers a lost HTTP result, and retains the expiry timer across restart', async () => {
		const namespace = crypto.randomUUID();
		let service = await start('service', namespace);
		const input = {
			scope: crypto.randomUUID(),
			research: crypto.randomUUID(),
			grant: crypto.randomUUID(),
			url: 'https://fixture.invalid/evidence',
			key: 'research-v1',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		};
		const ref = await submit(service.origin, 'research', input);
		const research = await start('host', namespace, { WORKER_ROLE: 'research' });
		await until(async () => {
			const jobs = await sql`select id from utils_workflow.jobs where namespace=${namespace}
        and definition->>'id'='fixture.intelligence.capture' and state='ready'`;
			return jobs.length === 1;
		});
		expect(await sql`select effect from captures where scope=${input.scope}`).toHaveLength(0);
		const capture = await start('host', namespace, {
			WORKER_ROLE: 'capture',
			PAUSE_AT: 'intelligence.remote.committed',
		});
		await capture.event('intelligence.remote.committed');
		await capture.stop(); // The receiver committed, but the activity has not saved its result.
		const replacement = await start('host', namespace, { WORKER_ROLE: 'capture' });
		await until(async () => {
			const runs = await sql`select id from utils_workflow.runs where namespace=${namespace}
        and definition='fixture.intelligence.knowledge' and state='ready'`;
			return runs.length === 1;
		});
		expect(await sql`select stage from contributions where scope=${input.scope}`).toHaveLength(0);
		const publication = await start('host', namespace, { WORKER_ROLE: 'publication', WORKER_ID: 'publication' });
		await completed(service.origin, 'research', ref);
		expect(await sql`select effect from captures where scope=${input.scope}`).toHaveLength(1);
		expect(await sql`select commit from contributions where scope=${input.scope} and commit is not null`).toHaveLength(
			1,
		);
		const engines = await sql`select distinct engine from utils_workflow.hosts where namespace=${namespace}`;
		expect(engines.map((row) => row.engine).sort()).toEqual(['fixture.capture', 'fixture.core']);
		expect((await sql`select body from captures where scope=${input.scope}`)[0]!.body).not.toBeNull();
		expect(
			await sql`select run from utils_workflow.instructions where namespace=${namespace}
      and due > clock_timestamp() and outcome is null`,
		).toHaveLength(1);
		await research.stop();
		await replacement.stop();
		await publication.stop();
		await service.stop();
		// No live process retains a workflow iterator or timer. Both are reconstructed from saved rows.
		service = await start('service', namespace);
		const resumed = await start('host', namespace, { WORKER_ROLE: 'research' });
		await until(async () => {
			const rows = await sql`select body from captures where scope=${input.scope}`;
			return rows[0]?.body === null;
		}, 90_000);
		expect(await sql`select commit from contributions where scope=${input.scope} and commit is not null`).toHaveLength(
			1,
		);
		expect((await submit(service.origin, 'research', input)).id).toBe(ref.id);
		await completed(service.origin, 'research', ref);
		await resumed.stop();
		await service.stop();
	});
});
