/** Durable event delivery and effect progress across real worker-process loss. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import * as effect from '@okikio/capability/effect';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import { identity } from '@okikio/workflow/execution';
import { Approved, Engine, Policy, Progress, Report, ReportLive, Wait } from './scenarios/events.ts';

let container: StartedPostgreSqlContainer | undefined;
let databaseUrl: string;
let sql: Sql;
const children = new Set<ChildProcess>();
const root = fileURLToPath(new URL('../../', import.meta.url));
async function until<Value>(read: () => Promise<Value | undefined | false>): Promise<Value> {
	const signal = AbortSignal.timeout(15_000);
	while (!signal.aborted) {
		const value = await read();
		if (value !== false && value !== undefined) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('Expected saved state did not appear.');
}
/** Launch a fresh event worker in its namespace and wait for readiness; the suite owns all children through its cleanup set. */
async function start(namespace: string): Promise<ChildProcess> {
	const child = spawn(process.execPath, ['tests/workflows/scenarios/events.ts'], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: databaseUrl, EVENT_NAMESPACE: namespace },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.add(child);
	let errors = '';
	child.stderr!.on('data', (chunk) => {
		errors += String(chunk);
	});
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Worker startup timed out: ${errors}`)), 15_000);
		child.stdout!.on('data', (chunk) => {
			if (String(chunk).includes('"ready":true')) {
				clearTimeout(timer);
				resolve();
			}
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('exit', () => {
			clearTimeout(timer);
			reject(new Error(`Worker exited: ${errors}`));
		});
	});
	return child;
}
async function kill(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill('SIGKILL');
	await exited;
	children.delete(child);
}

describe('saved events and progress across worker replacement', () => {
	before(async (test) => {
		const supplied = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
		if (supplied === undefined) {
			container = await new PostgreSqlContainer(
				'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db',
			).withDatabase('events').start();
			databaseUrl = container.getConnectionUri();
		} else {
			const parsed = new URL(supplied);
			const database = decodeURIComponent(parsed.pathname.slice(1)).toLowerCase();
			if (
				!['postgres:', 'postgresql:'].includes(parsed.protocol) || database.trim() === '' ||
				database === 'postgres' || database.startsWith('template') ||
				parsed.searchParams.has('database') || parsed.searchParams.has('dbname')
			) throw new Error('Event tests require a named disposable PostgreSQL database.');
			databaseUrl = supplied;
			test.diagnostic('Supplied real PostgreSQL and worker-process replacement; no container test.');
		}
		sql = postgresjs(databaseUrl, { max: 12, onnotice() {} });
		await postgres.migrate({ database: sql });
	});
	after(async () => {
		await Promise.all([...children].map(kill));
		await sql?.end({ timeout: 2 });
		await container?.stop();
	});
	it('rejects an activity with no effect recipient before worker registration', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await using ctx = context.create({ id: 'readiness' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		await expect(workflow.serve({
			store,
			resources,
			policies: [Policy],
			activities: [ReportLive],
			workflows: [],
			engine: Engine,
			hostId: 'unbound',
			shutdown: new AbortController().signal,
			capacity: { activations: 1, activities: 1, finalizers: 1, control: 1 },
		})).rejects.toMatchObject({ code: 'effect_binding' });
	});
	it('retains an early event and rejects a changed duplicate', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Wait, {}, { scope: 'core', key: 'early' });
		await Promise.all([
			client.send(ref, Approved, 'yes', { key: 'approval' }),
			client.send(ref, Approved, 'yes', { key: 'approval' }),
		]);
		await expect(client.send(ref, Approved, 'no', { key: 'approval' })).rejects.toMatchObject({
			code: 'event_conflict',
		});
		const worker = await start(namespace);
		expect(await client.wait(Wait, ref, { signal: AbortSignal.timeout(10_000) })).toEqual({
			type: 'received',
			value: 'yes',
		});
		await kill(worker);
	});
	it('saves a wait, kills its worker, and delivers through a fresh client with no live waiter', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Wait, {}, { scope: 'core', key: 'later' });
		const worker = await start(namespace);
		await until(async () => (await client.get(Wait, ref)).state === 'waiting');
		await kill(worker);
		await using fresh = postgres.open({ database: sql, namespace });
		const replacement = workflow.client({ store: fresh, policy: Policy });
		await replacement.send(ref, Approved, 'yes', { key: 'approval' });
		const next = await start(namespace);
		expect(await replacement.wait(Wait, ref, { signal: AbortSignal.timeout(10_000) })).toEqual({
			type: 'received',
			value: 'yes',
		});
		await kill(next);
	});
	it('records a timeout after process loss and rejects late delivery', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Wait, { until: new Date(Date.now() + 5000).toISOString() }, {
			scope: 'core',
			key: 'timeout',
		});
		const worker = await start(namespace);
		await until(async () => (await client.get(Wait, ref)).state === 'waiting');
		await kill(worker);
		const next = await start(namespace);
		expect(await client.wait(Wait, ref, { signal: AbortSignal.timeout(10_000) })).toEqual({ type: 'timeout' });
		await expect(client.send(ref, Approved, 'late', { key: 'approval' })).rejects.toMatchObject({
			code: 'event_closed',
		});
		await kill(next);
	});
	it('keeps accepted progress after a crash and resumes reports with the new attempt identity', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Report, {}, { scope: 'core', key: 'rows' });
		const worker = await start(namespace);
		await until(async () => (await client.get(Report, ref)).progress?.[0]);
		const stop = new AbortController();
		const stopped = Promise.withResolvers<void>();
		using _detached = client.watch(ref, { signal: stop.signal }).subscribe({ complete: () => stopped.resolve() });
		stop.abort();
		await stopped.promise;
		expect((await client.get(Report, ref)).exit).toBeUndefined();
		await kill(worker);
		await using fresh = postgres.open({ database: sql, namespace });
		const replacement = workflow.client({ store: fresh, policy: Policy });
		const saved = (await replacement.get(Report, ref)).progress![0]!;
		expect(saved.effect.value).toEqual({ rows: 200 });
		expect(saved.attempt).toBe(1);
		const observed: workflow.ProgressType[] = [];
		using _subscription = replacement.watch(ref, { intervalMs: 5 }).subscribe((report) => observed.push(report));
		await until(async () => observed.length > 0);
		const next = await start(namespace);
		expect(await replacement.wait(Report, ref, { signal: AbortSignal.timeout(10_000) })).toBe(400);
		await until(async () => observed.find((report) => report.attempt === 2));
		expect((await replacement.get(Report, ref)).progress![0]!.effect.value).toEqual({ rows: 400 });
		await kill(next);
	});
	it('bounds early event storage, isolates namespaces, and rejects delivery after cancellation', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const limited = workflow.PolicySchema.parse({ ...Policy, limits: { ...Policy.limits, historyBytes: 2048 } });
		const client = workflow.client({ store, policy: limited });
		const ref = await client.submit(Wait, {}, { scope: 'core', key: 'limits' });
		await expect(client.send(ref, Approved, 'x'.repeat(3000), { key: 'approval' })).rejects.toMatchObject({
			code: 'history_limit',
		});
		await using other = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await expect(workflow.client({ store: other, policy: limited }).send(ref, Approved, 'yes', { key: 'approval' }))
			.rejects.toMatchObject({ code: 'reference_conflict' });
		await client.cancel(ref, 'No longer needed');
		await expect(client.send(ref, Approved, 'yes', { key: 'approval' })).rejects.toMatchObject({
			code: 'event_closed',
		});
	});
	it('rejects progress from a replaced attempt even when its input and occurrence are valid', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Report, {}, { scope: 'core', key: 'stale' });
		const host = await store.register(
			'manual',
			[identity(Report)],
			'event-host',
			{ activations: 1, activities: 1 },
			600,
		);
		const job = (await store.take(host, [identity(Report)]))!;
		const occurrence = await effect.encode(await effect.create(Progress, { rows: 200 }, { key: 'batch' }));
		await store.report!(job.claim, occurrence, 2);
		await store.report!(job.claim, { ...occurrence, value: { rows: 100 } }, 1);
		expect((await client.get(Report, ref)).progress![0]!.effect.value).toEqual({ rows: 200 });
		await store.register('manual', [identity(Report)], 'event-host', { activations: 1, activities: 1 }, 600);
		await expect(store.report!(job.claim, occurrence, 3)).rejects.toMatchObject({ code: 'stale_claim' });
	});
});
