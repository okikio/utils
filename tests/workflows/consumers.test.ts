/** Real durable consumers using existing process and thread utilities. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Sql } from 'postgres';
import { ownSchema } from './fixtures/database.ts';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import * as context from '@okikio/context';
import { Approved, Import, InputSchema, Policy, Research, ResultSchema } from './scenarios/consumers/contracts.ts';

const cleanup = new AsyncDisposableStack();
let container: StartedPostgreSqlContainer | undefined;
/** Local checks may borrow an isolated database; the default suite owns its PostgreSQL container. */
let databaseUrl: string;
let sql: Sql;
const ports = new WeakMap<ChildProcess, number>();
async function until<Value>(read: () => Promise<Value | undefined | false>): Promise<Value> {
	const end = Date.now() + 30_000;
	while (Date.now() < end) {
		const value = await read();
		if (value !== undefined && value !== false) return value;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error('Consumer state did not reach the expected boundary.');
}
/**
 * Start an isolated consumer host and register its shutdown before waiting for
 * the ready message. That message supplies its HTTP port; later SQL assertions,
 * not the child output, establish that work was durably committed.
 */
async function start(namespace: string): Promise<ChildProcess> {
	const child = spawn(process.env.DENO_BIN ?? 'deno', [
		'run',
		'-A',
		'tests/workflows/scenarios/consumers/main.ts',
		'host',
	], {
		cwd: new URL('../../', import.meta.url),
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, DATABASE_URL: databaseUrl, CONSUMER_NAMESPACE: namespace },
	});
	cleanup.defer(() => stop(child));
	let diagnostics = '';
	child.stderr!.on('data', (value) => {
		diagnostics += String(value);
	});
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Consumer startup failed: ${diagnostics}`)), 30_000);
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('exit', () => {
			clearTimeout(timer);
			reject(new Error(`Consumer exited: ${diagnostics}`));
		});
		let output = '';
		child.stdout!.on('data', (value) => {
			output += String(value);
			for (const line of output.split('\n').slice(0, -1)) {
				const ready = JSON.parse(line) as { ready: boolean; port: number };
				if (ready.ready) {
					ports.set(child, ready.port);
					clearTimeout(timer);
					resolve();
				}
			}
			output = output.slice(output.lastIndexOf('\n') + 1);
		});
	});
	return child;
}
/** Kill the detached process group for crash tests, or ask its host to stop, then bound the wait for child exit. */
async function stop(child: ChildProcess, force = true): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	if (force) process.kill(-child.pid!, 'SIGKILL');
	else child.kill('SIGTERM');
	await Promise.race([
		exited,
		new Promise<never>((_resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Worker did not close within 10 seconds.')), 10_000);
			timer.unref();
		}),
	]);
}

/** HTTP is only the test boundary. Authentication and workspace authorization belong to the app. */
async function post(host: ChildProcess, path: string, body: unknown): Promise<Response> {
	return await fetch(`http://127.0.0.1:${ports.get(host)}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(5000),
	});
}

describe('Core and Intelligence consumer recovery', () => {
	before(async () => {
		const supplied = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
		if (supplied !== undefined) databaseUrl = supplied;
		else {
			container = await new PostgreSqlContainer(
				'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db',
			).start();
			cleanup.defer(async () => {
				await container!.stop();
			});
			databaseUrl = container.getConnectionUri();
		}
		const owned = cleanup.use(await ownSchema(databaseUrl, 8));
		databaseUrl = owned.url;
		sql = owned.database;
		await postgres.migrate({ database: sql });
		await sql`create table consumer_writes (ordinal bigserial,namespace text,job uuid,source text,label text,batch integer,pid integer,primary key(namespace,job))`;
		await sql`create table consumer_gates (namespace text,name text,opened boolean,primary key(namespace,name))`;
	});
	after(async () => {
		await cleanup.disposeAsync();
	});
	it('restarts a Core import at saved batches, accepts background work, and runs cleanup in reverse order', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Import, { source: 'core' }, { scope: 'workspace', key: 'import' });
		let host = await start(namespace);
		await until(async () =>
			(await sql`select path from utils_workflow.instructions where namespace=${namespace} and run=${ref.id} and type='wait-event'`)
				.length > 0
		);
		expect(
			(await sql`select * from consumer_writes where namespace=${namespace} and label in ('outer','inner')`).length,
		).toBe(0);
		await stop(host);
		await client.send(ref, Approved, true);
		host = await start(namespace);
		expect(await client.wait(Import, ref, { signal: AbortSignal.timeout(30_000) })).toEqual({ value: 6 });
		const rows = await sql`select label,batch,pid from consumer_writes where namespace=${namespace} order by ordinal`;
		expect(rows.filter((row) => row.label === 'rows').map((row) => row.batch)).toEqual([1, 2, 3]);
		expect(rows.filter((row) => ['inner', 'outer'].includes(row.label)).map((row) => row.label)).toEqual([
			'inner',
			'outer',
		]);
		await until(async () =>
			(await sql`select job from consumer_writes where namespace=${namespace} and label='notification'`).length === 1
		);
		const snapshot = await client.get(Import, ref, { children: true });
		expect(snapshot.progress?.some((report) => report.progress !== undefined)).toBe(true);
		expect(rows.find((row) => row.label === 'rows')!.pid).not.toBe(host.pid);
		await stop(host, false);
	});
	it('runs Intelligence branches on real threads, closes branch cleanup, and observes a publication child', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const host = await start(namespace);
		expect((await fetch(`http://127.0.0.1:${ports.get(host)}/ready`)).status).toBe(200);
		const accepted = await post(host, '/research', { source: 'intelligence' });
		expect(accepted.status).toBe(202);
		const ref = workflow.ReferenceSchema.parse(await accepted.json());
		expect(await client.wait(Research, ref, { signal: AbortSignal.timeout(30_000) })).toEqual({ value: 3 });
		const rows = await sql`select label,pid from consumer_writes where namespace=${namespace} order by ordinal`;
		expect(rows.filter((row) => ['first', 'second'].includes(row.label)).every((row) => row.pid === host.pid)).toBe(
			true,
		);
		expect(rows.findIndex((row) => row.label === 'branch')).toBeLessThan(
			rows.findIndex((row) => row.label === 'publication'),
		);
		const status = await post(host, '/status', { ref });
		expect(status.status).toBe(200);
		const snapshot = workflow.SnapshotSchema.parse(await status.json());
		expect(snapshot.progress?.some((report) => report.run?.id !== ref.id)).toBe(true);
		expect(rows.findIndex((row) => row.label === 'publication')).toBeLessThan(
			rows.findIndex((row) => row.label === 'child.cleanup'),
		);
		expect(snapshot.value).toEqual({ value: 3 });
		await stop(host, false);
	});
	it('recovers a cleanup whose process dies after its write but before acknowledgement', async () => {
		const namespace = crypto.randomUUID();
		await sql`insert into consumer_gates values (${namespace},'cleanup',false)`;
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Import, { source: 'cleanup', gate: 'cleanup' }, {
			scope: 'workspace',
			key: 'cleanup',
		});
		const host = await start(namespace);
		await client.send(ref, Approved, true);
		const child = await until(async () =>
			(await sql`select pid from consumer_writes where namespace=${namespace} and label='inner'`)[0]?.pid as
				| number
				| undefined
		);
		expect((await client.get(Import, ref)).state).toBe('settling');
		process.kill(child, 'SIGKILL');
		await sql`update consumer_gates set opened=true where namespace=${namespace}`;
		expect(await client.wait(Import, ref, { signal: AbortSignal.timeout(30_000) })).toEqual({ value: 6 });
		expect((await sql`select job from consumer_writes where namespace=${namespace} and label='inner'`).length).toBe(1);
		const attempts =
			await sql`select j.sequence from utils_workflow.jobs j join utils_workflow.cleanups c on c.namespace=j.namespace and c.job=j.id where j.namespace=${namespace} and c.path='1:'`;
		expect(attempts[0]!.sequence).toBeGreaterThanOrEqual(2);
		await stop(host, false);
	});
	it('recovers pending cleanup after the whole worker stops', async () => {
		const namespace = crypto.randomUUID();
		await sql`insert into consumer_gates values (${namespace},'restart',false)`;
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		let host = await start(namespace);
		const accepted = await post(host, '/imports', { source: 'restart', gate: 'restart' });
		expect(accepted.status).toBe(202);
		const ref = workflow.ReferenceSchema.parse(await accepted.json());
		expect((await post(host, '/events', { ref, value: true })).status).toBe(200);
		await until(async () =>
			(await sql`select job from consumer_writes where namespace=${namespace} and label='inner'`).length === 1
		);
		await stop(host);
		await sql`update consumer_gates set opened=true where namespace=${namespace}`;
		host = await start(namespace);
		expect(await client.wait(Import, ref, { signal: AbortSignal.timeout(30_000) })).toEqual({ value: 6 });
		expect(
			(await sql`select label from consumer_writes where namespace=${namespace} and label in ('inner','outer') order by ordinal`)
				.map((row) => row.label),
		).toEqual(['inner', 'outer']);
		await stop(host, false);
	});
	it('runs saved cleanup after cancellation and a rejected import', async () => {
		for (const cancelled of [true, false]) {
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace });
			const client = workflow.client({ store, policy: Policy });
			const ref = await client.trigger(Import, { source: 'exit' }, { scope: 'workspace', key: 'exit' });
			const host = await start(namespace);
			await until(async () =>
				(await sql`select path from utils_workflow.instructions where namespace=${namespace} and run=${ref.id} and type='wait-event'`)
					.length > 0
			);
			if (cancelled) expect(await client.cancel(ref, 'User stopped the import.')).toBe('requested');
			else await client.send(ref, Approved, false);
			const snapshot = await until(async () => {
				const value = await client.get(Import, ref);
				return ['cancelled', 'failed'].includes(value.state) ? value : undefined;
			});
			expect(snapshot.state).toBe(cancelled ? 'cancelled' : 'failed');
			expect(
				(await sql`select label from consumer_writes where namespace=${namespace} and label in ('inner','outer') order by ordinal`)
					.map((row) => row.label),
			).toEqual(['inner', 'outer']);
			await stop(host, false);
		}
	});

	it('accepts local background trigger effects durably before any worker starts', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const Launch = workflow.define({
			id: 'consumer.launch',
			version: '1',
			input: InputSchema,
			result: ResultSchema,
			workflows: [Import],
		});
		const launch = workflow.implement(Launch, function* (ctx) {
			yield* ctx.trigger(Import, ctx.input, { background: true });
			return { value: 0 };
		});
		await using owner = context.create({ id: 'request' });
		await using scheduler = workflow.scheduler({ effect: client.effects({ scope: 'workspace' }) });
		for (let replay = 0; replay < 2; replay++) {
			await using ctx = await workflow.context({
				ctx: owner,
				definition: Launch,
				input: { source: 'background' },
				runId: 'request',
			});
			expect(await workflow.run({ ctx, implementation: launch, scheduler })).toEqual({ value: 0 });
		}
		const rows = await sql`select id from utils_workflow.runs where namespace=${namespace}`;
		expect(rows.length).toBe(1);
		expect((await sql`select * from consumer_writes where namespace=${namespace}`).length).toBe(0);
		const ref = workflow.ReferenceSchema.parse({
			namespace,
			scope: 'workspace',
			id: rows[0]!.id,
			definition: { kind: 'workflow', id: Import.id, version: Import.version },
		});
		await client.send(ref, Approved, true);
		const host = await start(namespace);
		expect(await client.wait(Import, ref, { signal: AbortSignal.timeout(30_000) })).toEqual({ value: 6 });
		await stop(host, false);
	});
	it('retains the business result when cleanup fails and resumes after audited repair', async () => {
		const namespace = crypto.randomUUID();
		await sql`insert into consumer_gates values (${namespace},'repair',false)`;
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Import, { source: 'repair' }, { scope: 'workspace', key: 'repair' });
		await client.send(ref, Approved, true);
		const host = await start(namespace);
		const blocked = await until(async () => {
			const value = await client.get(Import, ref);
			return value.state === 'blocked' ? value : undefined;
		});
		expect(blocked.reason).toBe('cleanup_exhausted');
		expect(blocked.exit?.type).toBe('success');
		expect((await sql`select * from consumer_writes where namespace=${namespace} and label='outer'`).length).toBe(0);
		await sql`update consumer_gates set opened=true where namespace=${namespace}`;
		await client.repair(ref, {
			actor: 'operator',
			reason: 'Destination available.',
			epoch: blocked.epoch,
			attempts: 1,
		});
		expect(await client.wait(Import, ref, { signal: AbortSignal.timeout(30_000) })).toEqual({ value: 6 });
		expect((await sql`select action from utils_workflow.audit where namespace=${namespace}`).map((row) => row.action))
			.toContain('repair');
		await stop(host, false);
	});
});
