/** Bounded load and real process replacement, plus a locked-prefix queue regression. @module */
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
import { encode, identity } from '@okikio/workflow/execution';
import { Approved, Engine } from './scenarios/events.ts';
import { Work } from './scenarios/execution.ts';
import { count, Policy, Program } from './scenarios/pressure.ts';

let container: StartedPostgreSqlContainer | undefined;
let databaseUrl: string, sql: Sql;
const children = new Set<ChildProcess>();
const states = new WeakMap<ChildProcess, ReturnType<workflow.Serving['state']>>();
const root = fileURLToPath(new URL('../../', import.meta.url));

/** Time bounds apply to the entire observation, and errors retain the unmet condition. */
async function until(read: () => Promise<boolean> | boolean, description: string): Promise<void> {
	const deadline = Date.now() + Math.max(30_000, count * 150);
	while (!await read()) {
		if (Date.now() >= deadline) throw new Error(`Pressure checks timed out: ${description}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
/** Each replacement is a fresh OS process with its own store and provider lifetimes. */
async function start(namespace: string): Promise<ChildProcess> {
	const child = spawn(process.execPath, ['tests/workflows/scenarios/pressure.ts'], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, DATABASE_URL: databaseUrl, EXECUTION_NAMESPACE: namespace },
	});
	children.add(child);
	let ready = false, output = '', diagnostic = '';
	let failure: Error | undefined;
	child.once('error', (error) => {
		failure = error;
	});
	child.stdout!.on('data', (chunk) => {
		output += String(chunk);
		for (;;) {
			const end = output.indexOf('\n');
			if (end < 0) break;
			const message = JSON.parse(output.slice(0, end)) as {
				ready?: boolean;
				state?: ReturnType<workflow.Serving['state']>;
			};
			output = output.slice(end + 1);
			if (message.ready) ready = true;
			if (message.state) states.set(child, message.state);
		}
	});
	child.stderr!.on('data', (chunk) => {
		diagnostic = (diagnostic + String(chunk)).slice(-65_536);
	});
	await until(() => {
		if (failure !== undefined) throw failure;
		if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Pressure worker exited: ${diagnostic}`);
		return ready;
	}, 'worker readiness');
	return child;
}
async function kill(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill('SIGKILL');
	await exited;
	children.delete(child);
}

describe('durable queue pressure', () => {
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

	it('claims available work after 32 locked owners without waiting for those owners', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const refs: workflow.ReferenceType[] = [];
		for (let index = 0; index < 33; index++) {
			refs.push(await client.submit(Work, { value: index }, { scope: 'pressure', key: String(index) }));
		}
		const host = await store.register('prefix', [identity(Work)], Engine.id, { activations: 1, activities: 1 }, 60_000);
		const locked = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		const lock = sql.begin(async (tx) => {
			await tx`select id from utils_workflow.runs where namespace=${namespace} and id in ${
				tx(refs.slice(0, 32).map((ref) => ref.id))
			} for update`;
			locked.resolve();
			await release.promise;
		});
		try {
			await Promise.race([locked.promise, lock]);
			const job = await store.take(host, [identity(Work)], false);
			expect(job?.ref.id).toBe(refs[32]!.id);
		} finally {
			release.resolve();
			await lock;
			await store.leave(host);
		}
	});

	it('does not let diagnosed blocked cleanup children hide a later completed cleanup', async () => {
		const namespace = crypto.randomUUID();
		const Child = workflow.define({
			id: 'pressure.cleanup-child',
			version: '1',
			input: Program.input,
			result: Program.result,
		});
		const Owner = workflow.define({
			id: 'pressure.cleanup-owner',
			version: '1',
			input: Program.input,
			result: Program.result,
			workflows: [Child],
		});
		const policy = workflow.PolicySchema.parse({
			...Policy,
			limits: { ...Policy.limits, pendingChildren: 70, pendingFinalizers: 70 },
			workflows: [
				{
					definition: Owner,
					maxInstructions: 2,
					maximumChildren: 1,
					children: [{ definition: Child, maximum: 1 }],
					requires: ['workflow.cleanup'],
				},
				{ definition: Child, maxInstructions: 1, requires: [] },
			],
		});
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy });
		const host = await store.register('cleanup-prefix', [identity(Owner), identity(Child)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 60_000);
		const families: { owner: workflow.ReferenceType; child: workflow.ReferenceType }[] = [];
		try {
			for (let index = 0; index < 65; index++) {
				const owner = await client.submit(Owner, index, { scope: 'pressure', key: String(index) });
				const activation = (await store.activate(host, [identity(Owner)]))!;
				await store.instruction(activation, {
					type: 'defer',
					path: '0:',
					fingerprint: `defer:${index}`,
					cleanup: {
						type: 'child-workflow',
						path: '0:/cleanup',
						fingerprint: `child:${index}`,
						definition: identity(Child),
						input: encode(index, 1024),
					},
				}, { park: false });
				await store.finish(activation, { type: 'success', value: encode(index, 1024) }, 1);
				const child = (await store.activate(host, [identity(Child)]))!;
				families.push({ owner, child: child.ref });
				await store.block(child, 'fixture_child_blocked');
			}
			// Match the retained prefix the current scan actually chooses; UUID/storage order must not make the fixture flaky.
			await store.recover(64);
			const diagnosed =
				await sql`select id from utils_workflow.runs where namespace=${namespace} and reason='cleanup_child_blocked'`;
			expect(diagnosed).toHaveLength(64);
			const seen = new Set(diagnosed.map((row) => row.id as string));
			const live = families.find((family) => !seen.has(family.owner.id))!;
			await client.repair(live.child, {
				actor: 'test',
				reason: 'Resolve the child outside the retained prefix',
				epoch: 1,
				attempts: 1,
			});
			const child = (await store.activate(host, [identity(Child)]))!;
			expect(child.ref.id).toBe(live.child.id);
			await store.finish(child, { type: 'success', value: encode(1, 1024) }, 0);
			await store.recover(64);
			expect((await client.get(Owner, live.owner)).state).toBe('completed');
		} finally {
			await store.leave(host);
		}
	});

	it('parks many runs on one activation slot, accepts events offline, and completes after SIGKILL replacement', async (test) => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const refs: workflow.ReferenceType[] = [];
		for (let index = 0; index < count; index++) {
			refs.push(await client.submit(Program, index, { scope: 'pressure', key: String(index) }));
		}
		const first = await start(namespace);
		await until(async () => {
			const rows =
				await sql`select count(*)::integer as count from utils_workflow.runs where namespace=${namespace} and state='waiting'`;
			return rows[0]!.count === count && states.get(first)?.slots.activations.active === 0;
		}, 'all workflows durably parked with zero occupied activation slots');
		expect(states.get(first)!.slots.activations.capacity).toBe(1);
		await kill(first);
		for (const ref of refs) await client.send(ref, Approved, 'approved', { key: 'approval' });
		const second = await start(namespace);
		expect(second.pid).not.toBe(first.pid);
		await until(
			async () =>
				(await sql`select count(*)::integer as count from utils_workflow.runs where namespace=${namespace} and state='completed'`)[
					0
				]!.count === count,
			'all accepted results after replacement',
		);
		const results = await Promise.all(refs.map(async (ref) => (await client.get(Program, ref)).value));
		expect(results).toEqual(Array.from({ length: count }, (_, index) => index));
		const attempts =
			await sql`select count(*)::integer as count from utils_workflow.attempts a join utils_workflow.jobs j on j.namespace=a.namespace and j.id=a.job where j.namespace=${namespace}`;
		expect(attempts[0]!.count).toBe(count);
		test.diagnostic(
			JSON.stringify({
				runs: count,
				activationCapacity: 1,
				firstPid: first.pid,
				replacementPid: second.pid,
				completed: results.length,
				attempts: attempts[0]!.count,
			}),
		);
		await kill(second);
	});
});
