/** Memory and saved execution run the same stateful work in actual container threads and children. */
import '@okikio/dispose/polyfill';
import { after, before, it } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, getContainerRuntimeClient, Network, Wait } from 'testcontainers';
import type { StartedNetwork, StartedTestContainer } from 'testcontainers';
import { build } from 'tsdown';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as sessions from '@okikio/capability/resource/session';
import * as sessionStore from '@okikio/storage/session/postgres';
import { call, checkHosts, checkSession, prepare, until } from '../fixtures/session-scenario.ts';

const NodeImage = 'node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3';
const PostgresImage = 'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db';
const owned = new Set<StartedTestContainer>();
const files = new Map<string, string>();
let output: string;
let network: StartedNetwork;
let database: Sql;
before(async () => {
	await mkdir(new URL('../../.tmp/', import.meta.url), { recursive: true });
	output = await mkdtemp(fileURLToPath(new URL('../../.tmp/session-', import.meta.url)));
	const results = await build({
		config: false,
		cwd: fileURLToPath(new URL('../../', import.meta.url)),
		entry: ['session-coordinator', 'session-thread', 'session-process'].map((name) => `tests/fixtures/${name}.ts`),
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
		.withDatabase('sessions').withUsername('fixture').withPassword('fixture').start();
	owned.add(sql);
	database = postgresjs(sql.getConnectionUri(), { max: 12, onnotice() {} });
	await postgres.migrate({ database });
	await sessionStore.migrate({ database });
	await prepare(database);
});
after(async () => {
	await database?.end({ timeout: 2 });
	for (const container of [...owned].reverse()) await container.stop({ timeout: 0 });
	await network?.stop();
	if (output) await rm(output, { recursive: true, force: true });
});
/** A prestarted executor owns its native provider; deployment, not workflow, creates the container. */
async function start(namespace: string, kind: string, selection = false, delayed = false) {
	let diagnostic = '';
	const container = await new GenericContainer(NodeImage).withNetwork(network).withWorkingDir('/app')
		.withCopyDirectoriesToContainer([{ source: output, target: '/app' }])
		.withEnvironment({
			DATABASE_URL: 'postgres://fixture:fixture@database:5432/sessions',
			SESSION_NAMESPACE: namespace,
			POOL_SELECTION: selection ? '1' : '0',
			SESSION_DELAY_PUBLICATION: delayed ? '1' : '0',
			SESSION_KIND: kind,
			PORT: '8080',
			SESSION_THREAD_MODULE: `./${files.get('session-thread')!}`,
			SESSION_PROCESS_MODULE: `./${files.get('session-process')!}`,
		})
		.withCommand(['node', files.get('session-coordinator')!]).withExposedPorts(8080)
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
		await container.stop({ timeout: 10000 });
		owned.delete(container);
	};
	return {
		container,
		origin: `http://${container.getHost()}:${container.getMappedPort(8080)}`,
		stop,
		[Symbol.asyncDispose]: stop,
	};
}
for (const kind of ['thread', 'process']) {
	it(`recovers a real container ${kind} when initial session publication crosses renewal ticks`, {
		timeout: 120000,
	}, async () => {
		const namespace = crypto.randomUUID();
		await using host = await start(namespace, kind, false, true);
		await checkSession({
			...host,
			namespace,
			kind,
			database,
			registry: sessions.registry(sessionStore.open({ database, namespace })),
		});
	});
	it(`tests distributed sessions on actual container ${kind} hosts`, { timeout: 120000 }, async () => {
		const namespace = crypto.randomUUID();
		await using host = await start(namespace, kind);
		await checkSession({
			...host,
			namespace,
			kind,
			database,
			registry: sessions.registry(sessionStore.open({ database, namespace })),
		});
	});
}

for (const kind of ['thread', 'process']) {
	it(`rejects saved sessions after forced whole-container loss and creates a distinct ${kind} owner`, {
		timeout: 120000,
	}, async () => {
		const namespace = crypto.randomUUID();
		const registry = sessions.registry(sessionStore.open({ database, namespace }));
		await using first = await start(namespace, kind, true);
		const initialHost = (await (await fetch(`${first.origin}/hosts`)).json())[0];
		const reference = (await call(first.origin, 'durable', { op: 'create', host: initialHost })).reference!;
		const before = await call(first.origin, 'memory', { op: 'use', reference, host: initialHost });
		const runtime = await getContainerRuntimeClient();
		await runtime.container.getById(first.container.getId()).kill({ signal: 'SIGKILL' });
		await first.container.stop({ timeout: 0 });
		owned.delete(first.container);
		await until(async () => (await registry.inspect(reference.id))?.state === 'lost');
		await using replacement = await start(namespace, kind, true);
		// A saved reference names the dead physical host. Routing must reject it rather than borrow from its replacement.
		await expect(call(replacement.origin, 'durable', { op: 'use', reference }))
			.rejects.toThrow('Session operation failed:');
		const stale = await fetch(`${replacement.origin}/memory`, {
			method: 'POST',
			body: JSON.stringify({ op: 'create', host: initialHost }),
		});
		expect(stale.status).toBe(500);
		await stale.text();
		const created = await call(replacement.origin, 'durable', { op: 'create' });
		expect(created.host!.pool).not.toBe(initialHost.pool);
		const next = created.reference!;
		const after = await call(replacement.origin, 'memory', { op: 'use', reference: next, host: created.host });
		expect(next.id).not.toBe(reference.id);
		expect(next.incarnation).not.toBe(reference.incarnation);
		expect(after.instance).not.toBe(before.instance);
		await replacement.stop();
		expect((await registry.inspect(next.id))!.state).toBe('closed');
		expect(
			await database`select * from utils_session_fixture.closes where namespace=${namespace} and session=${next.id}`,
		).toHaveLength(1);
	});
}

for (const kind of ['thread', 'process']) {
	it(`selects and retires exact ${kind} pool entries inside a real container`, async () => {
		const namespace = crypto.randomUUID();
		await using host = await start(namespace, kind, true);
		await checkHosts({
			...host,
			kind,
			database,
			namespace,
			registry: sessions.registry(sessionStore.open({ database, namespace })),
		});
	});
}
