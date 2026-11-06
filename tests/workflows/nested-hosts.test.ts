/** Durable placement reaches actual physical providers, including recovery after whole-owner loss. */
import { after, before, it } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { expect } from '@std/expect';
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import { ChildLive, compute, Engine, Parent, ParentLive, Policy } from '../fixtures/nested-contract.ts';
import { open } from '../fixtures/nested-host.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Requires an explicitly disposable PostgreSQL database.');
const database = postgresjs(url, { max: 12, onnotice() {} });
before(async () => {
	await postgres.migrate({ database });
});
after(async () => {
	await database.end({ timeout: 2 });
});

/** Poll committed state under a deadline; a fixed sleep cannot establish that an instruction committed. */
async function until(read: () => Promise<boolean>): Promise<void> {
	const deadline = AbortSignal.timeout(20000);
	while (!await read()) {
		deadline.throwIfAborted();
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
for (const kind of ['thread', 'process'] as const) {
	it(`runs durable nested work on a selected actual ${kind}`, { timeout: 30000 }, async () => {
		await using owner = context.create({ id: 'durable-native' });
		await using resources = resource.create(resource.implementations(), { ctx: owner, host: {} });
		await using wrong = await open(owner, kind, 'wrong');
		await using right = await open(owner, kind, 'right');
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database, namespace });
		await using _wrongHost = await workflow.serve({
			store,
			resources,
			shutdown: owner.signal,
			engine: Engine,
			workflows: [ParentLive, ChildLive],
			activities: [],
			policies: [Policy],
			engines: [{ engine: Engine, provider: wrong, capacity: 2 }],
			hostId: 'wrong',
			compute: compute('wrong', kind),
			pollIntervalMs: 25,
			capacity: { activations: 1, activities: 2, finalizers: 1, control: 1 },
		});
		await using _rightHost = await workflow.serve({
			store,
			resources,
			shutdown: owner.signal,
			engine: Engine,
			workflows: [ParentLive, ChildLive],
			activities: [],
			policies: [Policy],
			engines: [{ engine: Engine, provider: right, capacity: 2 }],
			hostId: 'right',
			compute: compute('right', kind),
			pollIntervalMs: 25,
			capacity: { activations: 1, activities: 2, finalizers: 1, control: 1 },
		});
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Parent, 'value', {
			scope: 'native',
			key: 'nested',
			location: workflow.placement.on({ id: `${kind}:right`, generation: 1 }),
		});
		const [a, b] = await client.wait(Parent, ref, { signal: AbortSignal.timeout(20000), intervalMs: 10 });
		expect(a!.owner).toBe('right');
		expect(b!.owner).toBe('right');
		expect(a!.instance).toBe(b!.instance);
		expect(b!.count).toBe(2);
		expect(b!.finished).toBe(1);
		if (kind === 'thread') {
			expect(a!.thread).toBeGreaterThan(0);
			expect(a!.pid).toBe(process.pid);
		} else {
			expect(a!.thread).toBe(0);
			expect(a!.pid).not.toBe(process.pid);
		}
		expect(wrong.stats().idle + wrong.stats().leased).toBe(0);
		const jobs = await database`select host,location from utils_workflow.jobs where namespace=${namespace}`;
		expect(jobs).toHaveLength(2);
		for (const job of jobs) {
			expect(job.host).toBe('right');
		}
	});
}

/** Own an entire POSIX process group so a killed coordinator cannot leave a child provider behind. */
async function start(namespace: string, kind: string) {
	const child = spawn(process.execPath, [new URL('../fixtures/nested-coordinator.ts', import.meta.url).pathname], {
		cwd: new URL('../../', import.meta.url),
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			DATABASE_URL: url,
			WORKFLOW_NAMESPACE: namespace,
			PLACEMENT_OWNER: 'recovered',
			PLACEMENT_KIND: kind,
		},
	});
	let output = '', diagnostic = '';
	child.stdout!.on('data', (value) => {
		output = (output + String(value)).slice(-32768);
	});
	child.stderr!.on('data', (value) => {
		diagnostic = (diagnostic + String(value)).slice(-32768);
	});
	// Explicit stop and async disposal share one receipt, so a released process group is never killed twice.
	let stopping: Promise<void> | undefined;
	const stop = () =>
		stopping ??= (async () => {
			const exited = child.exitCode === null && child.signalCode === null ? once(child, 'exit') : undefined;
			try {
				process.kill(-child.pid!, 'SIGKILL');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
			}
			await exited;
		})();
	try {
		await until(async () => {
			if (child.exitCode !== null) throw new Error(`Coordinator exited: ${diagnostic}`);
			return output.includes('nested-ready');
		});
	} catch (error) {
		await stop();
		throw error;
	}
	return { stop, [Symbol.asyncDispose]: stop };
}
for (const kind of ['thread', 'process'] as const) {
	it(`replays saved child progress after killing its actual ${kind} owner`, {
		timeout: 30000,
		skip: process.platform === 'win32',
	}, async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database, namespace });
		const client = workflow.client({ store, policy: Policy });
		await using first = await start(namespace, kind);
		const ref = await client.trigger(Parent, 'slow', {
			scope: 'native',
			key: 'restart',
			location: workflow.placement.on({ id: `${kind}:recovered`, generation: 1 }),
		});
		await until(async () => {
			const rows = await database`select state from utils_workflow.jobs where namespace=${namespace} order by path`;
			return rows.length === 2 && rows[0]!.state === 'completed' && rows[1]!.state === 'claimed';
		});
		await first.stop();
		await using _replacement = await start(namespace, kind);
		const [a, b] = await client.wait(Parent, ref, { signal: AbortSignal.timeout(20000), intervalMs: 10 });
		expect(a!.owner).toBe('recovered');
		expect(b!.owner).toBe('recovered');
		expect(b!.instance).not.toBe(a!.instance);
		expect(a!.count).toBe(1);
		expect(b!.count).toBe(1);
		const jobs = await database`select state from utils_workflow.jobs where namespace=${namespace}`;
		expect(jobs).toHaveLength(2);
		for (const job of jobs) {
			expect(job.state).toBe('completed');
		}
	});
}
