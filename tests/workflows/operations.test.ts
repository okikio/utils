/** Operator controls, shared-schema maintenance, and bounded retention against real PostgreSQL. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Sql } from 'postgres';
import { ownSchema } from './fixtures/database.ts';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import { encode, identity } from '@okikio/workflow/execution';
import { Engine } from './scenarios/events.ts';
import { Policy, Program, Work } from './scenarios/execution.ts';

const cleanup = new AsyncDisposableStack();
let container: StartedPostgreSqlContainer | undefined;
let databaseUrl: string;
let sql: Sql;
const root = fileURLToPath(new URL('../../', import.meta.url));
const tables = [
	'runs',
	'jobs',
	'attempts',
	'instructions',
	'cleanups',
	'receipts',
	'events',
	'progress',
	'audit',
	'run_events',
] as const;
const policy = workflow.PolicySchema.parse({ ...Policy, claims: { ...Policy.claims, leaseMs: 10_000 } });
const control = (revision: number) => ({ actor: 'operations-test', reason: 'Planned maintenance.', revision });
const success = (value: unknown): workflow.OutcomeType => ({
	type: 'success',
	value: encode(value, policy.limits.resultBytes),
});

/** Register a namespace-local executor and client; the test releases the host before closing its store and borrows the suite database. */
async function fixture(t: TestContext, selected = policy) {
	const namespace = crypto.randomUUID();
	const store = postgres.open({ database: sql, namespace, notifications: false });
	const client = workflow.client({ store, policy: selected });
	const host = await store.register('operations', [identity(Work), identity(Program)], Engine.id, {
		activations: 4,
		activities: 4,
	}, 60_000);
	t.after(async () => {
		await store.leave(host);
		await store[Symbol.asyncDispose]();
	});
	return { namespace, store, client, host };
}
async function until<Value>(read: () => Promise<Value | undefined | false>): Promise<Value> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== undefined && value !== false) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('Expected durable state did not appear.');
}
async function stop(child: ChildProcess): Promise<void> {
	if (child.exitCode === null && child.signalCode === null) {
		const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) });
		child.kill('SIGKILL');
		await exited;
	}
}
/** Start the execution worker for operational controls and register shutdown before polling its visible ready state. */
async function start(namespace: string): Promise<ChildProcess> {
	const child = spawn(process.execPath, ['tests/workflows/scenarios/execution.ts'], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			DATABASE_URL: databaseUrl,
			EXECUTION_NAMESPACE: namespace,
			POLL_INTERVAL: '25',
			NOTIFICATIONS: 'false',
		},
	});
	cleanup.defer(() => stop(child));
	let stderr = '', ready = false;
	child.stderr!.on('data', (chunk) => {
		stderr += String(chunk);
	});
	child.stdout!.on('data', (chunk) => {
		if (String(chunk).includes('"ready":true')) ready = true;
	});
	await until(async () => {
		if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Worker exited: ${stderr}`);
		return ready;
	});
	return child;
}
/** Count rows across the tracked workflow tables in one namespace so deletion assertions cannot pass after clearing only the primary run row. */
async function count(namespace: string): Promise<number> {
	let total = 0;
	for (const table of tables) {
		const rows = await sql`select count(*)::integer as count from ${
			sql(`utils_workflow.${table}`)
		} where namespace=${namespace}`;
		total += rows[0]!.count;
	}
	return total;
}
async function age(ref: workflow.ReferenceType, milliseconds = 120_000): Promise<void> {
	// Only retained timestamps are adjusted; completion/cleanup/claims still use the real public adapter.
	await sql`update utils_workflow.runs set finished_at=clock_timestamp()-${milliseconds}*interval '1 millisecond'
 where namespace=${ref.namespace} and family=${ref.id} and state in ('completed','failed','cancelled','continued')`;
}

describe('durable operations and maintenance', { concurrency: false }, () => {
	before(async () => {
		const supplied = process.env.UTILS_WORKFLOW_OPERATIONS_DATABASE_URL;
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
		// These migration tests own and replace the entire execution schema. Never borrow the ordinary suite's URL.
		if (supplied !== undefined && new URL(supplied).pathname === '/postgres') {
			throw new Error('Operations tests require a dedicated disposable database, not the postgres database.');
		}
		const owned = cleanup.use(await ownSchema(databaseUrl, 12));
		databaseUrl = owned.url;
		sql = owned.database;
	});
	after(async () => {
		await cleanup.disposeAsync();
	});
	it('serializes fresh migrations and rejects a future revision before issuing schema DDL', async () => {
		await sql`drop schema if exists utils_workflow cascade`;
		expect(await postgres.planMigrations({ database: sql })).toMatchObject({
			ready: true,
			status: { state: 'uninstalled', target: 3 },
			steps: [{ to: 3, action: 'install' }],
		});
		expect((await sql`select to_regclass('utils_workflow.version') as value`)[0]!.value).toBe(null);
		await Promise.all([postgres.migrate({ database: sql }), postgres.migrate({ database: sql })]);
		expect((await sql`select version from utils_workflow.version where id`)[0]!.version).toBe(3);
		expect(await postgres.planMigrations({ database: sql })).toMatchObject({
			ready: true,
			status: { state: 'current', current: 3 },
			steps: [],
		});
		await sql`update utils_workflow.version set version=999 where id`;
		expect(await postgres.planMigrations({ database: sql })).toMatchObject({
			ready: false,
			status: { state: 'incompatible', current: 999 },
			steps: [],
		});
		await sql`drop trigger runs_change on utils_workflow.runs`;
		try {
			await expect(postgres.migrate({ database: sql })).rejects.toMatchObject({ code: 'schema_version' });
			expect((await sql`select version from utils_workflow.version where id`)[0]!.version).toBe(999);
			expect((await sql`select count(*)::integer as count from pg_trigger where tgname='runs_change'`)[0]!.count).toBe(
				0,
			);
		} finally {
			await sql`drop schema utils_workflow cascade`;
			await postgres.migrate({ database: sql });
		}
	});
	it('requires drained hosts for an upgrade and conservatively backfills legacy completion and history', async () => {
		await sql`drop schema utils_workflow cascade`;
		await sql.unsafe(await readFile(new URL('./fixtures/version-one.sql', import.meta.url), 'utf8'));
		const namespace = crypto.randomUUID(), id = crypto.randomUUID();
		await sql`insert into utils_workflow.hosts(namespace,id,generation,definitions,engine,activations,activities,expires)
 values(${namespace},'legacy',1,'[]'::jsonb,'legacy',1,1,clock_timestamp()+interval '1 minute')`;
		await sql`insert into utils_workflow.runs(namespace,id,scope,key,kind,definition,version,input,fingerprint,policy,policyhash,state,outcome,family,reservation,created)
 values(${namespace},${id},'legacy','legacy','activity',${Work.id},${Work.version},${
			sql.json(encode({ value: 7 }, 1024))
		},'fixture',${sql.json(policy)},'fixture','completed',${
			sql.json(success(7))
		},${id},'{}'::jsonb,clock_timestamp()-interval '1 year')`;
		expect(await postgres.planMigrations({ database: sql })).toMatchObject({
			ready: false,
			status: { state: 'upgrade', current: 1, activeWorkers: true },
			steps: [{ from: 1, to: 3, action: 'upgrade' }],
		});
		await expect(postgres.migrate({ database: sql })).rejects.toMatchObject({ code: 'migration_workers_active' });
		expect((await sql`select version from utils_workflow.version where id`)[0]!.version).toBe(1);
		expect(
			(await sql`select count(*)::integer as count from information_schema.columns where table_schema='utils_workflow' and table_name='runs' and column_name='finished_at'`)[
				0
			]!.count,
		).toBe(0);
		await sql`update utils_workflow.hosts set draining=true where namespace=${namespace}`;
		const before = (await sql`select clock_timestamp() as time`)[0]!.time as Date;
		await postgres.migrate({ database: sql });
		const row =
			(await sql`select created,finished_at,chain_root,chain_index from utils_workflow.runs where namespace=${namespace} and id=${id}`)[
				0
			]!;
		expect((row.finished_at as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect((row.finished_at as Date).getTime()).toBeGreaterThan((row.created as Date).getTime());
		expect(row.chain_root).toBe(id);
		expect(row.chain_index).toBe(0);
		expect(
			await sql`select sequence,kind,state from utils_workflow.run_events where namespace=${namespace} and run=${id}`,
		).toMatchObject([{ sequence: '1', kind: 'baseline', state: 'completed' }]);
		await using store = postgres.open({ database: sql, namespace });
		expect(await store.prune({ limit: 1000 })).toMatchObject({ deleted: 0 });
	});
	it('rolls back version-two DDL when an incompatible existing relation aborts the upgrade', async () => {
		await sql`drop schema utils_workflow cascade`;
		await sql.unsafe(await readFile(new URL('./fixtures/version-one.sql', import.meta.url), 'utf8'));
		// A real DDL conflict after the column changes exercises rollback of the complete migration transaction.
		await sql`create table utils_workflow.run_events(obstruction text)`;
		try {
			await expect(postgres.migrate({ database: sql })).rejects.toMatchObject({ code: '42703' });
			expect((await sql`select version from utils_workflow.version where id`)[0]!.version).toBe(1);
			expect(
				(await sql`select count(*)::integer as count from information_schema.columns where table_schema='utils_workflow' and table_name='runs' and column_name in ('paused','finished_at','chain_root')`)[
					0
				]!.count,
			).toBe(0);
		} finally {
			await sql`drop table utils_workflow.run_events`;
			await postgres.migrate({ database: sql });
		}
	});
	it('performs no DDL for the current revision while active work holds table and row locks', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Work, { value: 1 }, { scope: 'ops', key: 'active-migration' });
		const job = (await store.take(host, [identity(Work)]))!;
		const acquired = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		const holding = sql.begin(async (tx) => {
			await tx`select id from utils_workflow.runs where namespace=${namespace} and id=${ref.id} for update`;
			await tx`select id from utils_workflow.jobs where namespace=${namespace} and id=${job.claim.jobId} for update`;
			acquired.resolve();
			await release.promise;
		});
		await acquired.promise;
		try {
			const migrated = postgres.migrate({ database: sql });
			await Promise.race([
				migrated,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Current migration waited for live relation locks.')), 1000).unref()
				),
			]);
		} finally {
			release.resolve();
			await holding;
		}
		await store.complete(job, success(1), 'permanent');
		expect((await store.get(ref)).state).toBe('completed');
	});
	it('makes new registration wait for migration ownership and validates the resulting revision', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const locked = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		const holding = sql.begin(async (tx) => {
			await tx`select pg_advisory_xact_lock(776161003)`;
			locked.resolve();
			await release.promise;
			await tx`update utils_workflow.version set version=999 where id`;
		});
		await locked.promise;
		let settled = false;
		const registering = store.register('new-host', [], Engine.id, { activations: 1, activities: 1 }, 60_000);
		const observed = registering.then(() => {
			settled = true;
		}, () => {
			settled = true;
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 75));
			expect(settled).toBe(false);
			release.resolve();
			await holding;
			await expect(registering).rejects.toMatchObject({ code: 'schema_version' });
			await observed;
		} finally {
			release.resolve();
			await holding;
			await sql`update utils_workflow.version set version=3 where id`;
		}
	});
	it('upgrades a drained revision-two schema with legacy unconstrained jobs to revision three', async () => {
		await sql`update utils_workflow.hosts set draining=true`;
		await sql`alter table utils_workflow.runs drop column location`;
		await sql`alter table utils_workflow.jobs drop column location, drop column affinity`;
		await sql`alter table utils_workflow.hosts drop column compute, drop column affinity`;
		await sql`drop table utils_workflow.compute`;
		await sql`update utils_workflow.version set version=2 where id`;
		expect(await postgres.planMigrations({ database: sql })).toMatchObject({
			status: { target: 3, current: 2, state: 'upgrade' },
			ready: true,
		});
		await postgres.migrate({ database: sql });
		expect(await postgres.migrationStatus({ database: sql })).toMatchObject({ state: 'current', current: 3 });
		const hosts = await sql`select compute,affinity from utils_workflow.hosts`;
		for (const host of hosts) {
			expect(host.compute).toEqual([]);
			expect(host.affinity).toEqual({});
		}
		const jobs = await sql`select location,affinity from utils_workflow.jobs`;
		for (const job of jobs) {
			expect(job.location).toBeNull();
			expect(job.affinity).toBeNull();
		}
	});

	it('pauses queued admissions with CAS before idempotence and records attributed control events', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Work, { value: 1 }, { scope: 'ops', key: 'pause' });
		expect(await client.pause(ref, control(0))).toEqual({ paused: true, revision: 1 });
		await expect(client.pause(ref, control(0))).rejects.toMatchObject({ code: 'control_conflict' });
		expect(await client.pause(ref, control(1))).toEqual({ paused: true, revision: 1 });
		expect(await store.take(host, [identity(Work)])).toBeUndefined();
		expect(await store.next!()).toBeUndefined();
		expect(await client.resume(ref, control(1))).toEqual({ paused: false, revision: 2 });
		const job = (await store.take(host, [identity(Work)]))!;
		await store.complete(job, success(1), 'permanent');
		await expect(client.pause(ref, control(2))).rejects.toMatchObject({ code: 'control_closed' });
		expect(
			await sql`select action,actor,reason from utils_workflow.run_events where namespace=${namespace} and run=${ref.id} and kind='operator' order by sequence`,
		).toMatchObject([
			{ action: 'pause', actor: 'operations-test', reason: 'Planned maintenance.' },
			{ action: 'resume', actor: 'operations-test', reason: 'Planned maintenance.' },
		]);
	});
	it('allows an already claimed attempt to renew and commit one receipt while paused', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Work, { value: 7 }, { scope: 'ops', key: 'active-pause' });
		const job = (await store.take(host, [identity(Work)]))!;
		await client.pause(ref, control(0));
		expect((await store.get(ref)).epoch).toBe(job.claim.epoch);
		const before =
			(await sql`select updated_at from utils_workflow.runs where namespace=${namespace} and id=${ref.id}`)[0]!
				.updated_at;
		const events =
			(await sql`select count(*)::integer as count from utils_workflow.run_events where namespace=${namespace} and run=${ref.id}`)[
				0
			]!.count;
		await store.renew(job.claim);
		expect(
			(await sql`select updated_at from utils_workflow.runs where namespace=${namespace} and id=${ref.id}`)[0]!
				.updated_at,
		).toEqual(before);
		expect(
			(await sql`select count(*)::integer as count from utils_workflow.run_events where namespace=${namespace} and run=${ref.id}`)[
				0
			]!.count,
		).toBe(events);
		await sql`create table if not exists operations_business(namespace text primary key, value integer not null)`;
		const result = await store.transaction(
			job.claim,
			{ key: 'commit', input: 7, result: Work.result },
			async (tx, receipt) => {
				await tx`insert into operations_business values(${namespace},7)`;
				return await receipt.save(7);
			},
		);
		expect(result.value).toBe(7);
		await store.complete(job, success(7), 'permanent');
		expect((await store.get(ref)).state).toBe('completed');
		expect(
			(await sql`select count(*)::integer as count from utils_workflow.receipts where namespace=${namespace}`)[0]!
				.count,
		).toBe(1);
	});
	it('recovers an abandoned claim while paused but grants no replacement until resumed', async (t) => {
		const { store, client, host } = await fixture(t);
		const ref = await client.trigger(Work, { value: 1 }, { scope: 'ops', key: 'abandoned' });
		const abandoned = (await store.take(host, [identity(Work)]))!;
		await client.pause(ref, control(0));
		await store.leave(host);
		await store.recover(64);
		const replacement = await store.register('replacement', [identity(Work)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 60_000);
		t.after(() => store.leave(replacement));
		await expect(store.complete(abandoned, success(1), 'permanent')).rejects.toMatchObject({ code: 'stale_claim' });
		expect(await store.take(replacement, [identity(Work)])).toBeUndefined();
		await client.resume(ref, control(1));
		const resumed = await until(() => store.take(replacement, [identity(Work)]));
		expect(resumed.claim.sequence).toBe(2);
		await store.complete(resumed, success(1), 'permanent');
	});
	it('keeps due timers and event delivery durable while paused without immediate scheduling hints', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Program, { mode: 'timer' }, { scope: 'ops', key: 'timer' });
		const active = (await store.activate(host, [identity(Program)]))!;
		await store.instruction(active, { type: 'sleep', path: '0:', fingerprint: 'timer', delay: 1000 });
		await client.pause(ref, control(0));
		expect(await store.next!()).toBeUndefined();
		await store.send!(ref, 'extra-event', 'before-resume', encode('saved', 1024));
		await until(async () =>
			(await sql`select due<=clock_timestamp() as due from utils_workflow.instructions where namespace=${namespace} and run=${ref.id}`)[
				0
			]!.due as boolean
		);
		await store.recover(64);
		expect((await store.get(ref)).state).toBe('ready');
		expect(await store.activate(host, [identity(Program)])).toBeUndefined();
		expect(await store.next!()).toBeUndefined();
		await client.resume(ref, control(1));
		const resumed = (await store.activate(host, [identity(Program)]))!;
		expect(await store.instruction(resumed, { type: 'sleep', path: '0:', fingerprint: 'timer', delay: 1000 }))
			.toMatchObject({ type: 'success' });
		await store.finish(resumed, success([1]), 1);
	});
	it('runs cleanup and accepts cancellation even when ordinary admissions are paused', async (t) => {
		const selected = workflow.PolicySchema.parse({
			...policy,
			limits: { ...policy.limits, pendingFinalizers: 1 },
			workflows: [{ ...policy.workflows[0]!, requires: ['workflow.cleanup'] }],
		});
		const { store, client, host } = await fixture(t, selected);
		const ref = await client.trigger(Program, { mode: 'timer' }, { scope: 'ops', key: 'cleanup' });
		const active = (await store.activate(host, [identity(Program)]))!;
		await store.instruction(active, {
			type: 'defer',
			path: '0:',
			fingerprint: 'cleanup',
			cleanup: {
				type: 'activity',
				path: 'unused',
				fingerprint: 'cleanup-work',
				definition: identity(Work),
				input: encode({ value: 9 }, 1024),
			},
		}, { park: false });
		await client.pause(ref, control(0));
		await store.finish(active, success([1]), 1);
		expect((await store.get(ref)).state).toBe('settling');
		const cleanup = (await store.take(host, [identity(Work)], true))!;
		expect(cleanup.path).toBe('cleanup:0:');
		await store.complete(
			cleanup,
			{ type: 'fault', code: 'cleanup-test', message: 'Cleanup needs operator repair.' },
			'permanent',
		);
		expect((await store.get(ref)).state).toBe('blocked');
		expect(
			(await sql`select finished_at from utils_workflow.runs where namespace=${ref.namespace} and id=${ref.id}`)[0]!
				.finished_at,
		).toBeNull();
		expect(await store.prune({ limit: 1000 })).toMatchObject({ deleted: 0 });
		await store.repair(ref, { ...control(1), epoch: cleanup.claim.epoch, attempts: 1 });
		const repaired = (await store.take(host, [identity(Work)], true))!;
		await store.complete(repaired, success(9), 'permanent');
		expect((await store.get(ref)).state).toBe('completed');
		const cancelled = await client.trigger(Work, { value: 2 }, { scope: 'ops', key: 'cancel' });
		await client.pause(cancelled, control(0));
		expect(await client.cancel(cancelled, 'Operator cancelled.')).toBe('requested');
		expect((await store.get(cancelled)).state).toBe('cancelled');
	});
	it('keeps failed continuation cleanup blocked after cancellation and rolls over only after repair succeeds', async (t) => {
		const selected = workflow.PolicySchema.parse({
			...policy,
			limits: { ...policy.limits, reservedSuccessors: 1, pendingFinalizers: 2 },
			workflows: [{
				...policy.workflows[0]!,
				maxContinuations: 1,
				requires: ['workflow.cleanup', 'workflow.continue'],
			}],
		});
		const { store, client, host, namespace } = await fixture(t, selected);
		const ref = await client.trigger(Program, { mode: 'timer' }, { scope: 'ops', key: 'continue-cleanup' });
		const active = (await store.activate(host, [identity(Program)]))!;
		await store.instruction(active, {
			type: 'defer',
			path: '0:',
			fingerprint: 'cleanup',
			cleanup: {
				type: 'activity',
				path: 'unused',
				fingerprint: 'cleanup-work',
				definition: identity(Work),
				input: encode({ value: 9 }, 1024),
			},
		}, { park: false });
		await client.pause(ref, control(0));
		await store.continue!(
			active,
			{ path: '1:', fingerprint: 'next-segment', input: encode({ mode: 'timer' }, 1024) },
			2,
		);
		const cleanup = (await store.take(host, [identity(Work)], true))!;
		await store.complete(
			cleanup,
			{ type: 'fault', code: 'cleanup-test', message: 'Cleanup needs repair.' },
			'permanent',
		);
		const blocked = await store.get(ref);
		expect(blocked.state).toBe('blocked');
		expect(await client.cancel(ref, 'Cancellation cannot replace the committed continuation.')).toBe('too_late');
		expect(await store.get(ref)).toEqual(blocked);
		expect(
			(await sql`select continuation,continued_to from utils_workflow.runs where namespace=${namespace} and id=${ref.id}`)[
				0
			],
		).toMatchObject({ continuation: { path: '1:' }, continued_to: null });
		await store.repair(ref, {
			actor: 'operations-test',
			reason: 'Cleanup can retry.',
			epoch: blocked.epoch,
			attempts: 1,
		});
		const retried = (await store.take(host, [identity(Work)], true))!;
		await store.complete(retried, success(9), 'permanent');
		const continued = await store.get(ref);
		expect(continued.state).toBe('continued');
		expect(continued.continuedTo).toBeDefined();
		const next = continued.continuedTo!;
		expect((await store.get(next)).control).toEqual({ paused: true, revision: 1 });
		expect(await store.activate(host, [identity(Program)])).toBeUndefined();
		await client.resume(next, control(1));
		await store.finish((await store.activate(host, [identity(Program)]))!, success([1]), 0);
		expect((await store.get(next)).state).toBe('completed');
	});
	it('preserves a paused timer across SIGKILL and lets unrelated work finish before resume', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		let child = await start(namespace);
		try {
			const ref = await client.trigger(Program, { mode: 'timer', milliseconds: 400 }, { scope: 'ops', key: 'crash' });
			await until(async () => (await store.get(ref)).state === 'waiting');
			await client.pause(ref, control(0));
			await stop(child);
			child = await start(namespace);
			const other = await client.trigger(Work, { value: 42 }, { scope: 'ops', key: 'unrelated' });
			expect(await client.wait(Work, other, { signal: AbortSignal.timeout(10_000) })).toBe(42);
			await until(async () => (await store.get(ref)).state === 'ready');
			expect((await store.get(ref)).control).toEqual({ paused: true, revision: 1 });
			await client.resume(ref, control(1));
			expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1]);
		} finally {
			await stop(child);
		}
	});
	it('orders concurrent job and operator events under one run lock and rolls back all history with admission', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Program, { mode: 'parallel' }, { scope: 'ops', key: 'events' });
		const active = (await store.activate(host, [identity(Program)]))!;
		for (let index = 0; index < 2; index++) {
			await store.instruction(active, {
				type: 'activity',
				path: `${index}:`,
				fingerprint: `job:${index}`,
				definition: identity(Work),
				input: encode({ value: index }, 1024),
			}, { park: false });
		}
		await store.park!(active, ['0:', '1:']);
		const [first, second] = await Promise.all([store.take(host, [identity(Work)]), store.take(host, [identity(Work)])]);
		await Promise.all([
			store.complete(first!, success(0), 'permanent'),
			store.complete(second!, success(1), 'permanent'),
			client.pause(ref, control(0)),
		]);
		const events =
			await sql`select sequence,kind,job_id,state from utils_workflow.run_events where namespace=${namespace} and run=${ref.id} order by sequence`;
		expect(events.map((entry) => Number(entry.sequence))).toEqual(events.map((_, index) => index + 1));
		expect(
			events.filter((entry) => entry.kind === 'job' && entry.state === 'completed').map((entry) => entry.job_id).sort(),
		).toEqual([first!.claim.jobId, second!.claim.jobId].sort());
		expect(events.filter((entry) => entry.kind === 'operator')).toHaveLength(1);
		const before = await count(namespace);
		await expect(postgres.begin(sql, async (tx) => {
			await client.in(tx).trigger(Work, { value: 1 }, { scope: 'ops', key: 'rollback' });
			throw new Error('Intentional rollback.');
		})).rejects.toThrow('Intentional rollback.');
		expect(await count(namespace)).toBe(before);
	});
	it('rejects oversized repair attribution before changing the epoch or audit history', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Work, { value: 1 }, { scope: 'ops', key: 'repair-input' });
		const job = (await store.take(host, [identity(Work)]))!;
		await store.complete(job, { type: 'fault', code: 'unknown', message: 'Inspect before repair.' }, 'unknown');
		const before = await store.get(ref), rows = await count(namespace);
		for (
			const attribution of [
				{ actor: 'a'.repeat(257), reason: 'Reviewed.' },
				{ actor: 'operator', reason: 'r'.repeat(2049) },
				{ actor: ' ', reason: 'Reviewed.' },
			]
		) {
			await expect(client.repair(ref, { ...attribution, epoch: before.epoch, attempts: 1 })).rejects.toMatchObject({
				code: 'repair_input',
			});
		}
		expect(await store.get(ref)).toEqual(before);
		expect(await count(namespace)).toBe(rows);
		await client.repair(ref, { actor: 'a'.repeat(256), reason: 'r'.repeat(2048), epoch: before.epoch, attempts: 1 });
		await store.complete((await store.take(host, [identity(Work)]))!, success(1), 'permanent');
		expect((await store.get(ref)).state).toBe('completed');
	});
	it('timestamps accepted progress without letting an old sequence refresh its staleness', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Work, { value: 1 }, { scope: 'ops', key: 'progress' });
		const job = (await store.take(host, [identity(Work)]))!;
		await store.report!(job.claim, { id: 'operations.progress', key: 'first', value: { count: 1 } }, 1);
		const first =
			(await sql`select reported_at,revision from utils_workflow.progress where namespace=${namespace} and run=${ref.id}`)[
				0
			]!;
		await store.report!(job.claim, { id: 'operations.progress', key: 'old', value: { count: 0 } }, 1);
		expect(
			(await sql`select reported_at,revision from utils_workflow.progress where namespace=${namespace} and run=${ref.id}`)[
				0
			],
		).toEqual(first);
		await store.report!(job.claim, { id: 'operations.progress', key: 'second', value: { count: 2 } }, 2);
		const second =
			(await sql`select reported_at,revision from utils_workflow.progress where namespace=${namespace} and run=${ref.id}`)[
				0
			]!;
		expect((second.reported_at as Date).getTime()).toBeGreaterThanOrEqual((first.reported_at as Date).getTime());
		expect(second.revision).not.toBe(first.revision);
	});
	it('deletes at most the requested total rows, preserves domain writes, and releases deduplication only after pruning', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Work, { value: 7 }, { scope: 'ops', key: 'retained' });
		const job = (await store.take(host, [identity(Work)]))!;
		await store.transaction(job.claim, { key: 'domain', input: 7, result: Work.result }, async (tx, receipt) => {
			await tx`insert into operations_business values(${namespace},7)`;
			return await receipt.save(7);
		});
		await client.pause(ref, control(0));
		await store.report!(job.claim, { id: 'operations.progress', key: 'last', value: 7 }, 1);
		await store.complete(job, success(7), 'permanent');
		expect(await client.trigger(Work, { value: 7 }, { scope: 'ops', key: 'retained' })).toEqual(ref);
		expect(await store.prune({ limit: 1000 })).toMatchObject({ deleted: 0 });
		await age(ref);
		let remaining = await count(namespace), passes = 0;
		while (remaining > 0) {
			const pruned = await store.prune({ limit: 3 });
			const after = await count(namespace);
			expect(pruned.deleted).toBe(remaining - after);
			expect(pruned.deleted).toBeGreaterThan(0);
			expect(pruned.deleted).toBeLessThanOrEqual(3);
			expect(pruned.more).toBe(after > 0);
			remaining = after;
			if (++passes > 20) throw new Error('Retention did not make bounded progress.');
		}
		expect((await sql`select value from operations_business where namespace=${namespace}`)[0]!.value).toBe(7);
		await expect(store.get(ref)).rejects.toMatchObject({ code: 'not_found' });
		const repeated = await client.trigger(Work, { value: 7 }, { scope: 'ops', key: 'retained' });
		expect(repeated.id).not.toBe(ref.id);
	});
	it('rolls back a retention pass if an application foreign key still requires the run', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		const ref = await client.trigger(Work, { value: 1 }, { scope: 'ops', key: 'domain-reference' });
		await store.complete((await store.take(host, [identity(Work)]))!, success(1), 'permanent');
		await age(ref);
		t.after(() => sql`drop table if exists operations_reference`);
		await sql`create table operations_reference(namespace text,run uuid,foreign key(namespace,run) references utils_workflow.runs(namespace,id))`;
		await sql`insert into operations_reference values(${namespace},${ref.id})`;
		const before = await count(namespace);
		await expect(store.prune({ limit: 1000 })).rejects.toMatchObject({ code: '23503' });
		expect(await count(namespace)).toBe(before);
		expect((await store.get(ref)).state).toBe('completed');
		await sql`delete from operations_reference where namespace=${namespace}`;
		expect(await store.prune({ limit: 1000 })).toMatchObject({ runs: 1, families: 1, more: false });
	});
	for (const longest of ['dedupeMs', 'resultsMs', 'auditMs'] as const) {
		it(`preserves a terminal family for its full ${longest} window measured from completion`, async (t) => {
			const selected = workflow.PolicySchema.parse({
				...policy,
				retention: { dedupeMs: 1, resultsMs: 1, auditMs: 1, [longest]: 60_000 },
			});
			const { store, client, host, namespace } = await fixture(t, selected);
			const ref = await client.trigger(Work, { value: 1 }, { scope: 'ops', key: longest });
			await sql`update utils_workflow.runs set created=clock_timestamp()-interval '1 year' where namespace=${namespace} and id=${ref.id}`;
			await store.complete((await store.take(host, [identity(Work)]))!, success(1), 'permanent');
			await age(ref, 1000);
			expect(await store.prune({ limit: 1000 })).toMatchObject({ deleted: 0, more: false });
			await age(ref);
			expect((await store.prune({ limit: 1000 })).families).toBe(1);
		});
	}
	it('isolates admission quotas by namespace and policy version while serializing concurrent acceptance', async (t) => {
		const selected = workflow.PolicySchema.parse({ ...policy, limits: { ...policy.limits, pendingRoots: 1 } });
		const { store, client, host } = await fixture(t, selected);
		const ref = await client.trigger(Work, { value: 1 }, { scope: 'one', key: 'active' });
		expect(await client.trigger(Work, { value: 1 }, { scope: 'one', key: 'active' })).toEqual(ref);
		await expect(client.trigger(Work, { value: 2 }, { scope: 'one', key: 'active' }))
			.rejects.toMatchObject({ code: 'admission_conflict' });
		await expect(client.trigger(Work, { value: 2 }, { scope: 'another-scope', key: 'full' }))
			.rejects.toMatchObject({ code: 'admission_capacity' });
		const otherPolicy = workflow.client({
			store,
			policy: workflow.PolicySchema.parse({ ...selected, id: 'operations.other-policy' }),
		});
		const otherVersion = workflow.client({
			store,
			policy: workflow.PolicySchema.parse({ ...selected, version: 'other-version' }),
		});
		await otherPolicy.trigger(Work, { value: 3 }, { scope: 'one', key: 'other-policy' });
		await otherVersion.trigger(Work, { value: 4 }, { scope: 'one', key: 'other-version' });
		const elsewhere = await fixture(t, selected);
		await elsewhere.client.trigger(Work, { value: 5 }, { scope: 'one', key: 'active' });
		const active = (await store.take(host, [identity(Work)]))!;
		expect(active.ref.id).toBe(ref.id);
		await store.complete(active, success(1), 'permanent');
		const competing = await Promise.allSettled([
			client.trigger(Work, { value: 6 }, { scope: 'one', key: 'next-a' }),
			client.trigger(Work, { value: 7 }, { scope: 'one', key: 'next-b' }),
		]);
		expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		const rejected = competing.find((result) => result.status === 'rejected');
		expect(rejected?.status).toBe('rejected');
		if (rejected?.status === 'rejected') expect(rejected.reason).toMatchObject({ code: 'admission_capacity' });
	});
	it('protects a family reservation and retention until every child finishes, charging each family once', async (t) => {
		const Child = workflow.define({ id: 'operations.child', version: '1', input: Work.input, result: Work.result });
		const Parent = workflow.define({
			id: 'operations.parent',
			version: '1',
			input: Work.input,
			result: Work.result,
			workflows: [Child],
		});
		const selected = workflow.PolicySchema.parse({
			...policy,
			limits: { ...policy.limits, pendingRoots: 2, pendingChildren: 1 },
			workflows: [{
				definition: Parent,
				maxInstructions: 2,
				maximumChildren: 1,
				children: [{ definition: Child, maximum: 1 }],
				requires: ['workflow.children'],
			}, { definition: Child, maxInstructions: 1, requires: [] }],
		});
		const { store, client, host: activityHost } = await fixture(t, selected);
		const host = await store.register('family', [identity(Parent), identity(Child)], Engine.id, {
			activations: 2,
			activities: 1,
		}, 60_000);
		t.after(() => store.leave(host));
		const ref = await client.trigger(Parent, { value: 1 }, { scope: 'ops', key: 'parent' });
		const parent = (await store.activate(host, [identity(Parent)]))!;
		await store.instruction(parent, {
			type: 'child-workflow',
			path: '0:',
			fingerprint: 'child',
			definition: identity(Child),
			input: encode({ value: 1 }, 1024),
			discard: true,
			cancellation: 'independent',
		}, { park: false });
		// The advancing root and its live child consume one root slot, not two.
		const independent = await client.trigger(Work, { value: 2 }, { scope: 'ops', key: 'independent' });
		const activity = (await store.take(activityHost, [identity(Work)]))!;
		expect(activity.ref.id).toBe(independent.id);
		await store.complete(activity, success(2), 'permanent');
		await store.finish(parent, success(1), 1);
		await expect(client.trigger(Parent, { value: 3 }, { scope: 'ops', key: 'next-parent' }))
			.rejects.toMatchObject({ code: 'admission_capacity' });
		await age(ref);
		expect(await store.prune({ limit: 1000 })).toMatchObject({ deleted: 0 });
		const child = (await store.activate(host, [identity(Child)]))!;
		await store.block(child, 'intentional test repair');
		expect(await store.prune({ limit: 1000 })).toMatchObject({ deleted: 0 });
		await store.repair(child.ref, {
			actor: 'operations-test',
			reason: 'Ready to finish.',
			epoch: child.claim.epoch,
			attempts: 1,
		});
		const resumed = (await store.activate(host, [identity(Child)]))!;
		await store.finish(resumed, success(1), 0);
		// Terminal evidence still exists, but it no longer holds the family's child reservation.
		expect((await client.trigger(Parent, { value: 3 }, { scope: 'ops', key: 'next-parent' })).id).not.toBe(ref.id);
		expect(await store.prune({ limit: 1000 })).toMatchObject({ deleted: 0 });
		await age(ref);
		expect(await store.prune({ limit: 1000 })).toMatchObject({ runs: 2, families: 1, more: false });
	});
	it('serializes competing pruners, enforces budgets, and leaves other namespaces untouched', async (t) => {
		const { store, client, host, namespace } = await fixture(t);
		for (let index = 0; index < 4; index++) {
			const ref = await client.trigger(Work, { value: index }, { scope: 'ops', key: `prune:${index}` });
			await store.complete((await store.take(host, [identity(Work)]))!, success(index), 'permanent');
			await age(ref);
		}
		const other = await fixture(t);
		const ref = await other.client.trigger(Work, { value: 9 }, { scope: 'ops', key: 'keep' });
		await other.store.complete((await other.store.take(other.host, [identity(Work)]))!, success(9), 'permanent');
		await age(ref);
		const beforeOther = await count(other.namespace), before = await count(namespace);
		const results = await Promise.all([store.prune({ limit: 17 }), store.prune({ limit: 17 })]);
		for (const result of results) expect(result.deleted).toBeLessThanOrEqual(17);
		expect(results.reduce((sum, value) => sum + value.deleted, 0)).toBe(before - await count(namespace));
		expect(await count(other.namespace)).toBe(beforeOther);
		for (const invalid of [0, -1, 1001, 1.5, NaN]) {
			await expect(store.prune({ limit: invalid })).rejects.toBeInstanceOf(RangeError);
		}
	});
});
