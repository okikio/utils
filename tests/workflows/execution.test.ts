/** The same consumer program runs in a service and in a replaceable background process. */
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
import * as context from '@okikio/context';
import * as local from '@okikio/activity/local';
import * as resource from '@okikio/capability/resource';
import { encode, fingerprint, identity } from '@okikio/workflow/execution';
import { Approved, Engine } from './scenarios/events.ts';
import { Policy, Program, ProgramLive, Work, WorkLive } from './scenarios/execution.ts';

let container: StartedPostgreSqlContainer | undefined;
/** Explicit local checks can borrow an isolated PostgreSQL instance; ordinary runs own a container. */
let databaseUrl: string;
let sql: Sql;
const children = new Set<ChildProcess>();
const queries = new WeakMap<ChildProcess, string[]>();
const root = fileURLToPath(new URL('../../', import.meta.url));
async function until<Value>(read: () => Promise<Value | undefined | false>): Promise<Value> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== undefined && value !== false) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('The expected saved state did not appear.');
}
/** Start an independently owned worker with selected polling and tracing settings, retaining its emitted SQL separately from readiness. */
async function start(
	namespace: string,
	options: { notifications?: boolean; poll?: number; trace?: boolean; short?: boolean } = {},
): Promise<ChildProcess> {
	const child = spawn(process.execPath, ['tests/workflows/scenarios/execution.ts'], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			DATABASE_URL: databaseUrl,
			EXECUTION_NAMESPACE: namespace,
			SHORT_BRANCH: String(options.short ?? false),
			TRACE_QUERIES: options.trace ? 'true' : '',
			NOTIFICATIONS: String(options.notifications ?? true),
			POLL_INTERVAL: String(options.poll ?? 60_000),
		},
	});
	children.add(child);
	const statements: string[] = [];
	queries.set(child, statements);
	let pending = '';
	child.stdout!.on('data', (chunk) => {
		pending += String(chunk);
		for (;;) {
			const end = pending.indexOf('\n');
			if (end < 0) break;
			const line = pending.slice(0, end);
			pending = pending.slice(end + 1);
			const item = JSON.parse(line) as { query?: string };
			if (item.query) statements.push(item.query);
		}
	});
	let stderr = '';
	child.stderr!.on('data', (chunk) => {
		stderr += String(chunk);
	});
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Worker startup timed out: ${stderr}`)), 15_000);
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
			reject(new Error(`Worker exited: ${stderr}`));
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
/** Use the standard local provider with the exact activity implementation registered by the background worker. */
async function runLocal(
	mode: 'parallel' | 'map' | 'settle' | 'retry' | 'race' | 'timer' | 'until',
): Promise<readonly number[]> {
	await using parent = context.create({ id: `local:${mode}` });
	await using resources = resource.create(resource.implementations(), { ctx: parent, host: {} });
	await using ctx = await workflow.context({
		definition: Program,
		input: { mode },
		runId: `local:${mode}`,
		ctx: parent,
	});
	await using scheduler = workflow.scheduler({
		async command(ctx, command) {
			if (command.type === 'sleep') {
				await ctx.clock.sleep(command.duration.total({ unit: 'milliseconds' }), ctx.signal);
				return workflow.success(ctx.clock.now());
			}
			if (command.type === 'sleep-until') {
				await ctx.clock.sleep(
					Math.max(0, Temporal.Instant.from(command.until).epochMilliseconds - ctx.clock.now().epochMilliseconds),
					ctx.signal,
				);
				return workflow.success(command.until);
			}
			throw new Error(`Unexpected local command: ${command.type}`);
		},
	});
	await using registration = await scheduler.register({
		engine: Engine,
		hostId: `local:${mode}`,
		capacity: 2,
		provider: local.create({ engine: Engine, implementations: [WorkLive], resources }),
	});
	void registration;
	return await workflow.run({ ctx, implementation: ProgramLive, scheduler });
}

describe('consistent execution and saved wake-ups', () => {
	before(async () => {
		const supplied = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
		if (supplied !== undefined) databaseUrl = supplied;
		else {
			container = await new PostgreSqlContainer(
				'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db',
			).start();
			databaseUrl = container.getConnectionUri();
		}
		sql = postgresjs(databaseUrl, { max: 12, onnotice() {} });
		await postgres.migrate({ database: sql });
	});
	after(async () => {
		await Promise.all([...children].map(kill));
		await sql?.end({ timeout: 2 });
		await container?.stop();
	});
	for (const inactive of ['cancelled', 'blocked'] as const) {
		it(`keeps ${inactive} timers from consuming the bounded recovery scan`, async () => {
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace, notifications: false });
			const policy = workflow.PolicySchema.parse({
				...Policy,
				limits: { ...Policy.limits, pendingRoots: 70 },
				claims: { ...Policy.claims, leaseMs: 10_000 },
			});
			const client = workflow.client({ store, policy });
			const host = await store.register('timer-recovery', [identity(Program)], Engine.id, {
				activations: 70,
				activities: 1,
			}, 60_000);
			const accepted: workflow.ActivationType[] = [];
			// Keep 64 retained waits ahead of a live timer in the scan's actual UUID order.
			// The normal worker uses this batch size. All requests use the public store contract.
			for (let index = 0; index < 65; index++) {
				await client.trigger(Program, { mode: 'timer' }, { scope: 'recovery', key: `timer:${index}` });
				const activation = (await store.activate(host, [identity(Program)]))!;
				accepted.push(activation);
				await store.instruction(activation, {
					type: 'sleep',
					path: '0:',
					fingerprint: 'recovery-timer',
					delay: 500,
				}, { park: false });
			}
			accepted.sort((left, right) => left.ref.id.localeCompare(right.ref.id));
			for (const activation of accepted.slice(0, 64)) {
				if (inactive === 'cancelled') await client.cancel(activation.ref, 'Fixture cancellation.');
				else await store.block(activation, 'fixture_blocked');
			}
			const live = accepted[64]!;
			await store.park!(live, ['0:']);
			await until(async () => {
				const rows =
					await sql`select path from utils_workflow.instructions where namespace=${namespace} and due<=clock_timestamp()`;
				return rows.length === 65;
			});
			await store.recover(64);
			expect((await client.get(Program, live.ref)).state).toBe('ready');
			// Inactive history remains inspectable; recovery must filter it rather than delete it.
			expect(await sql`select path from utils_workflow.instructions where namespace=${namespace} and outcome is null`)
				.toHaveLength(64);
			expect((await client.get(Program, accepted[0]!.ref)).state).toBe(inactive);
			await store.leave(host);
		});
	}
	it('keeps blocked jobs from consuming the bounded recovery scan', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const policy = workflow.PolicySchema.parse({
			...Policy,
			limits: { ...Policy.limits, pendingRoots: 70 },
			claims: { ...Policy.claims, leaseMs: 1000 },
		});
		const client = workflow.client({ store, policy });
		const host = await store.register('job-recovery', [identity(Program), identity(Work)], Engine.id, {
			activations: 1,
			activities: 70,
		}, 60_000);
		let live: workflow.JobType | undefined;
		for (let index = 0; index < 65; index++) {
			await client.trigger(Program, { mode: 'parallel' }, { scope: 'recovery', key: `job:${index}` });
			const activation = (await store.activate(host, [identity(Program)]))!;
			await store.instruction(activation, {
				type: 'activity',
				path: '0:',
				fingerprint: 'recovery-job',
				definition: identity(Work),
				input: encode({ value: 1 }, policy.limits.inputBytes),
			}, { park: false });
			const job = (await store.take(host, [identity(Work)]))!;
			if (index < 64) await store.block(activation, 'fixture_blocked');
			else {
				live = job;
				await store.park!(activation, ['0:']);
			}
		}
		await until(async () => {
			const rows =
				await sql`select id from utils_workflow.jobs where namespace=${namespace} and expires<=clock_timestamp()`;
			return rows.length === 65;
		});
		await store.recover(64);
		expect(
			(await sql`select state from utils_workflow.jobs where namespace=${namespace} and id=${live!.claim.jobId}`)[0]!
				.state,
		).toBe('ready');
		expect(await sql`select id from utils_workflow.jobs where namespace=${namespace} and state='claimed'`).toHaveLength(
			64,
		);
		await store.leave(host);
	});
	it('keeps cancelled child waits from consuming the bounded recovery scan', async () => {
		const Child = workflow.define({
			id: 'recovery.child',
			version: '1',
			input: Work.input,
			result: Work.result,
		});
		const Parent = workflow.define({
			id: 'recovery.parent',
			version: '1',
			input: Work.input,
			result: Work.result,
			workflows: [Child],
		});
		const policy = workflow.PolicySchema.parse({
			...Policy,
			limits: { ...Policy.limits, pendingRoots: 70, pendingChildren: 70 },
			claims: { ...Policy.claims, leaseMs: 10_000 },
			activities: [],
			workflows: [{
				definition: Parent,
				maxInstructions: 10,
				maximumChildren: 1,
				children: [{ definition: Child, maximum: 1 }],
				requires: ['workflow.children'],
			}, { definition: Child, maxInstructions: 1, requires: [] }],
		});
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy });
		const host = await store.register('child-recovery', [identity(Parent), identity(Child)], Engine.id, {
			activations: 70,
			activities: 1,
		}, 60_000);
		const accepted: workflow.ActivationType[] = [];
		for (let index = 0; index < 65; index++) {
			await client.trigger(Parent, { value: 1 }, { scope: 'recovery', key: `parent:${index}` });
			const parent = (await store.activate(host, [identity(Parent)]))!;
			accepted.push(parent);
			await store.instruction(parent, {
				type: 'child-workflow',
				path: '0:',
				fingerprint: 'recovery-child',
				definition: identity(Child),
				input: encode({ value: 1 }, policy.limits.inputBytes),
			}, { park: false });
			const child = (await store.activate(host, [identity(Child)]))!;
			await store.finish(child, { type: 'success', value: encode(7, policy.limits.resultBytes) }, 0);
		}
		accepted.sort((left, right) => left.ref.id.localeCompare(right.ref.id));
		for (const parent of accepted.slice(0, 64)) await client.cancel(parent.ref, 'Fixture cancellation.');
		const live = accepted[64]!;
		await store.park!(live, ['0:']);
		await store.recover(64);
		expect((await client.get(Parent, live.ref)).state).toBe('ready');
		const outcomes =
			await sql`select outcome from utils_workflow.instructions where namespace=${namespace} and run=${live.ref.id}`;
		expect(outcomes[0]!.outcome).toEqual({ type: 'success', value: { kind: 'value', value: 7 } });
		await store.leave(host);
	});
	for (
		const [mode, expected] of [
			['parallel', [1, 2]],
			['map', [1, 2, 3, 4]],
			['settle', [1, 2]],
			['retry', [3]],
			['race', [2]],
			['timer', [1]],
			['until', [1]],
		] as const
	) {
		it(`runs the same ${mode} program locally and in a separate process`, async () => {
			expect(await runLocal(mode)).toEqual(expected);
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace });
			const client = workflow.client({ store, policy: Policy });
			const child = await start(namespace);
			const ref = await client.submit(Program, { mode }, { scope: 'imports', key: mode });
			expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual(expected);
			if (mode === 'retry') {
				expect(await sql`select id from utils_workflow.jobs where namespace=${namespace}`).toHaveLength(3);
			}
			if (mode === 'race') {
				const rows =
					await sql`select state from utils_workflow.jobs where namespace=${namespace} and input->'value'->>'hold'='true'`;
				expect(rows[0]?.state).toBe('failed');
			}
			await kill(child);
		});
	}
	it('saves both parallel waits, survives a hard kill, and wakes a fresh worker without live waiters', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Program, { mode: 'events' }, { scope: 'intelligence', key: 'approval' });
		const first = await start(namespace);
		await until(async () => {
			const rows =
				await sql`select path from utils_workflow.instructions where namespace=${namespace} and type='wait-event'`;
			return rows.length === 2 && (await client.get(Program, ref)).state === 'waiting';
		});
		await kill(first);
		await client.send(ref, Approved, '1', { key: 'first' });
		const next = await start(namespace);
		await client.send(ref, Approved, '2', { key: 'second' });
		expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1, 2]);
		await kill(next);
	});
	it('blocks a replacement that removes a saved step inside a parallel branch', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Program, { mode: 'nested' }, { scope: 'imports', key: 'changed' });
		const first = await start(namespace);
		await until(async () => {
			const steps =
				await sql`select path from utils_workflow.instructions where namespace=${namespace} and type='wait-event'`;
			return steps.length === 1 && (await client.get(Program, ref)).state === 'waiting';
		});
		await kill(first);
		// Restarting a worker does not resume dormant work. Its saved event makes this run ready.
		await client.send(ref, Approved, '1', { key: 'nested' });
		const next = await start(namespace, { short: true });
		const snapshot = await until(async () => {
			const saved = await client.get(Program, ref);
			return saved.state === 'blocked' ? saved : false;
		});
		expect(snapshot.reason).toBe('replay_conflict');
		await kill(next);
	});
	it('admits only two unfinished mapped branches and fills a released branch position', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Program, { mode: 'capacity' }, { scope: 'intelligence', key: 'capacity' });
		const child = await start(namespace);
		await until(async () => (await client.get(Program, ref)).state === 'waiting');
		const initial =
			await sql`select event_key from utils_workflow.instructions where namespace=${namespace} and type='wait-event'`;
		expect(initial).toHaveLength(2);
		const key = initial[0]!.event_key as string;
		await client.send(ref, Approved, key.split(':')[1]!, { key });
		const all = await until(async () => {
			const rows =
				await sql`select event_key from utils_workflow.instructions where namespace=${namespace} and type='wait-event'`;
			return rows.length === 3 ? rows : false;
		});
		for (const row of all) {
			const key = row.event_key as string;
			await client.send(ref, Approved, key.split(':')[1]!, { key });
		}
		try {
			expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1, 2, 3]);
		} catch (cause) {
			const run = await client.get(Program, ref);
			const steps =
				await sql`select path,parent,type,outcome from utils_workflow.instructions where namespace=${namespace}`;
			throw new Error(`Mapped waits did not finish: ${JSON.stringify({ run, steps })}`, { cause });
		}
		await kill(child);
	});

	for (const mode of ['timer', 'until'] as const) {
		it(`keeps the original ${mode} deadline when its worker is killed and replaced`, async () => {
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace });
			const client = workflow.client({ store, policy: Policy });
			const ref = await client.submit(Program, {
				mode,
				milliseconds: 2500,
				until: Temporal.Now.instant().add({ milliseconds: 2500 }).toString(),
			}, { scope: 'imports', key: mode });
			const type = mode === 'timer' ? 'sleep' : 'sleep-until';
			const first = await start(namespace);
			const due = await until(async () =>
				(await sql`select due from utils_workflow.instructions where namespace=${namespace} and type=${type}`)[0]
					?.due as
						| Date
						| undefined
			);
			await kill(first);
			const next = await start(namespace);
			expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1]);
			const rows = await sql`select due from utils_workflow.instructions where namespace=${namespace} and type=${type}`;
			expect(rows).toHaveLength(1);
			expect((rows[0]!.due as Date).toISOString()).toBe(due.toISOString());
			await kill(next);
		});
	}
	it('scans saved work when notifications are disabled', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const child = await start(namespace, { notifications: false, poll: 100 });
		const ref = await client.submit(Program, { mode: 'parallel' }, { scope: 'imports', key: 'poll' });
		expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1, 2]);
		await kill(child);
	});
	it('recovers an interrupted branch without repeating a completed sibling', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Program, { mode: 'recover' }, { scope: 'imports', key: 'batches' });
		const first = await start(namespace);
		await until(async () => {
			const rows = await sql`select state from utils_workflow.jobs where namespace=${namespace}`;
			return rows.some((row) => row.state === 'claimed') && rows.some((row) => row.state === 'completed');
		});
		await kill(first);
		const next = await start(namespace);
		expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1, 2]);
		const attempts =
			await sql`select j.input,a.sequence,a.state from utils_workflow.jobs j join utils_workflow.attempts a on a.namespace=j.namespace and a.job=j.id where j.namespace=${namespace}`;
		expect(attempts.filter((row) => row.input.value.value === 2)).toHaveLength(1);
		expect(attempts.filter((row) => row.input.value.value === 1).map((row) => row.state).sort()).toEqual([
			'abandoned',
			'success',
		]);
		await kill(next);
	});
	it('retains a completion that commits after the scan and before parking', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Program, { mode: 'parallel' }, { scope: 'imports', key: 'park' });
		const host = await store.register('manual', [identity(Program), identity(Work)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 15_000);
		const activation = (await store.activate(host, [identity(Program)]))!;
		const intent = {
			type: 'activity' as const,
			path: '0:',
			definition: identity(Work),
			input: encode({ value: 1 }, 1024),
			fingerprint: await fingerprint('one'),
		};
		expect(await store.instruction(activation, intent, { park: false })).toBeUndefined();
		const job = (await store.take(host, [identity(Work)]))!;
		await store.complete(job, { type: 'success', value: encode(1, 1024) }, 'permanent');
		await store.park!(activation, [intent.path]);
		expect((await store.get(ref)).state).toBe('ready');
		await store.leave(host);
	});
	it('fails fast and revokes unfinished siblings without leaving expired jobs to scan forever', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const child = await start(namespace);
		const ref = await client.submit(Program, { mode: 'fail-fast' }, { scope: 'imports', key: 'failure' });
		await until(async () => (await client.get(Program, ref)).state === 'failed');
		expect(await sql`select id from utils_workflow.jobs where namespace=${namespace} and state in ('ready','claimed')`)
			.toHaveLength(0);
		expect(await store.next!()).toBeUndefined();
		await kill(child);
	});
	it('rescans saved work after the notification connection is lost', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const child = await start(namespace);
		const listener = await until(async () =>
			(await sql`select pid from pg_stat_activity where application_name=${namespace} and lower(query) like 'listen %'`)[
				0
			]
		);
		await sql`select pg_terminate_backend(${listener.pid})`;
		const ref = await client.submit(Program, { mode: 'parallel' }, { scope: 'imports', key: 'reconnect' });
		expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1, 2]);
		await until(async () =>
			(await sql`select pid from pg_stat_activity where application_name=${namespace} and lower(query) like 'listen %' and pid<>${listener.pid}`)[
				0
			]
		);
		await kill(child);
	});

	it('keeps idle queue scans asleep and wakes them when new work commits', async () => {
		const namespace = crypto.randomUUID();
		const child = await start(namespace, { trace: true });
		const statements = queries.get(child)!;
		await until(async () => statements.some((query) => query.includes('deadlines')));
		const before = statements.filter((query) => query.includes('skip locked')).length;
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(statements.filter((query) => query.includes('skip locked')).length).toBe(before);
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Program, { mode: 'parallel' }, { scope: 'imports', key: 'wake' });
		expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(10_000) })).toEqual([1, 2]);
		await kill(child);
	});
	it('closes its notification session after reconnecting and leaves the application pool usable', async () => {
		const name = crypto.randomUUID();
		const database = postgresjs(databaseUrl, {
			max: 1,
			connection: { application_name: name },
			onnotice() {},
		});
		try {
			await using store = postgres.open({ database, namespace: name });
			let connections = 0;
			const close = await store.subscribe!(() => {
				connections++;
			});
			const first = await until(async () =>
				(await sql`select pid from pg_stat_activity where application_name=${name} and lower(query) like 'listen %'`)[0]
			);
			await sql`select pg_terminate_backend(${first.pid})`;
			await until(async () => connections >= 2);
			await close();
			expect(
				await sql`select pid from pg_stat_activity where application_name=${name} and lower(query) like 'listen %'`,
			).toHaveLength(0);
			expect((await database`select 1 as value`)[0]!.value).toBe(1);
		} finally {
			await database.end({ timeout: 1 });
		}
	});

	it('finds a queued retry that became due after dispatch checked, without polling full or unrelated workers', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		await client.submit(Work, { value: 1 }, { scope: 'imports', key: 'retry-boundary' });
		await sql`update utils_workflow.jobs set available=clock_timestamp()+interval '1 hour' where namespace=${namespace}`;
		const host = await store.register('retry', [identity(Work)], Engine.id, { activations: 1, activities: 1 }, 15_000);
		expect(await store.take(host, [identity(Work)])).toBeUndefined();
		// Move the saved deadline across the dispatch/next-deadline boundary without relying on wall-clock sleeps.
		await sql`update utils_workflow.jobs set available=clock_timestamp()-interval '1 millisecond' where namespace=${namespace}`;
		expect(await store.next!({ activities: [identity(Work)], finalizers: [] })).toBe(0);
		expect(await store.next!({ activities: [], finalizers: [] })).toBeUndefined();
		expect(await store.next!({ activities: [identity(Program)], finalizers: [] })).toBeUndefined();
		await store.leave(host);
	});

	it('retries a ready workflow skipped while its row is locked, without waking a full worker', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.submit(Program, { mode: 'parallel' }, { scope: 'imports', key: 'locked' });
		const host = await store.register(
			'locked',
			[identity(Program)],
			Engine.id,
			{ activations: 1, activities: 1 },
			15_000,
		);
		await sql.begin(async (tx) => {
			await tx`select id from utils_workflow.runs where namespace=${namespace} and id=${ref.id} for update`;
			expect(await store.activate(host, [identity(Program)])).toBeUndefined();
			expect(await store.next!({ workflows: [identity(Program)], activities: [], finalizers: [] })).toBe(0);
			expect(await store.next!({ workflows: [], activities: [], finalizers: [] })).toBeUndefined();
		});
		expect(await store.activate(host, [identity(Program)])).toBeDefined();
		await store.leave(host);
	});

	it('keeps the first attempt expiry within its deadline even when the lease is longer', async () => {
		const namespace = crypto.randomUUID();
		const policy = workflow.PolicySchema.parse({
			...Policy,
			activities: Policy.activities.map((entry) => ({ ...entry, deadlineMs: 100 })),
		});
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy });
		await client.submit(Work, { value: 1 }, { scope: 'imports', key: 'deadline' });
		const host = await store.register(
			'deadline',
			[identity(Work)],
			Engine.id,
			{ activations: 1, activities: 1 },
			15_000,
		);
		expect(await store.take(host, [identity(Work)])).toBeDefined();
		const rows = await sql`select expires<=deadline as bounded from utils_workflow.jobs where namespace=${namespace}`;
		expect(rows[0]!.bounded).toBe(true);
		await store.leave(host);
	});

	it('does not publish a transaction that rolls back and does not wake a different namespace', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		let calls = 0;
		const close = await store.subscribe!(() => {
			calls++;
		});
		try {
			const initial = calls;
			await expect(sql.begin(async (tx) => {
				await tx`select pg_notify('utils_workflow',${namespace})`;
				throw new Error('rollback');
			})).rejects.toThrow('rollback');
			await sql`select pg_notify('utils_workflow',${crypto.randomUUID()})`;
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(calls).toBe(initial);
			await sql`select pg_notify('utils_workflow',${namespace})`;
			await until(async () => calls > initial);
		} finally {
			await close();
		}
	});
});
