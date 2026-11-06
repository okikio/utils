/** Real PostgreSQL and fresh-process evidence for the supported root-chain continuation contract. @module */
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
import type { Sql } from 'postgres';
import { ownSchema } from './fixtures/database.ts';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import * as execution from '@okikio/workflow/execution';
import {
	DeferredChild,
	Engine,
	Finalizer,
	Immediate,
	Parent,
	Policy,
	Program,
	Write,
} from './scenarios/continuation.ts';

const cleanup = new AsyncDisposableStack();
let container: StartedPostgreSqlContainer | undefined;
let databaseUrl: string;
let sql: Sql;
const root = fileURLToPath(new URL('../../', import.meta.url));
const input = { cursor: 0, until: 2, mode: 'basic' as const };

/** Bound every external gate; a child notification alone is never the durable crash-boundary proof. */
async function bounded<Value>(pending: Promise<Value>): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Continuation fixture timed out.')), 15_000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
async function until<Value>(read: () => Promise<Value | undefined | false>): Promise<Value> {
	const expires = Date.now() + 15_000;
	while (Date.now() < expires) {
		const value = await read();
		if (value !== undefined && value !== false) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('The required durable continuation state did not appear.');
}
async function kill(child: ChildProcess): Promise<void> {
	if (child.exitCode === null && child.signalCode === null) {
		const exited = once(child, 'exit');
		child.kill('SIGKILL');
		await bounded(exited);
	}
}
/**
 * Launch a fresh continuation worker and expose a separate, bounded crash gate.
 * Process IDs reject another child's notification. A gate only synchronizes the
 * test; the surrounding database assertions establish the durable boundary.
 */
async function start(namespace: string, hold?: 'rollover' | 'cleanup') {
	const child = spawn(process.execPath, ['tests/workflows/scenarios/continuation.ts'], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			DATABASE_URL: databaseUrl,
			CONTINUATION_NAMESPACE: namespace,
			HOLD_ROLLOVER: String(hold === 'rollover'),
			HOLD_CLEANUP: String(hold === 'cleanup'),
		},
	});
	cleanup.defer(() => kill(child));
	const ready = Promise.withResolvers<void>();
	const gate = Promise.withResolvers<void>();
	// A test may need only startup; retain handlers for an early child failure in either observation.
	void ready.promise.catch(() => {});
	void gate.promise.catch(() => {});
	let pending = '';
	let stderr = '';
	child.stderr!.on('data', (chunk) => stderr += String(chunk));
	child.stdout!.on('data', (chunk) => {
		pending += String(chunk);
		while (pending.includes('\n')) {
			const end = pending.indexOf('\n');
			const line = pending.slice(0, end);
			pending = pending.slice(end + 1);
			try {
				const message = JSON.parse(line) as { ready?: boolean; gate?: string; pid?: number };
				if (message.pid !== child.pid) throw new Error('Unexpected fixture process identity.');
				if (message.ready) ready.resolve();
				if (message.gate === hold) gate.resolve();
			} catch (error) {
				ready.reject(error);
				gate.reject(error);
			}
		}
	});
	child.once('error', (error) => {
		ready.reject(error);
		gate.reject(error);
	});
	child.once('exit', (code, signal) => {
		const error = new Error(`Continuation worker exited (${code ?? signal}): ${stderr}`);
		ready.reject(error);
		gate.reject(error);
	});
	await bounded(ready.promise);
	return { child, gate: () => bounded(gate.promise) };
}

describe('bounded durable root continuation', () => {
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
		const owned = cleanup.use(await ownSchema(databaseUrl, 12));
		databaseUrl = owned.url;
		sql = owned.database;
		await postgres.migrate({ database: sql });
		await sql`create table utils_continuation_writes(
 namespace text not null, run uuid not null, job uuid not null, label text not null, cursor integer not null, pid integer not null)`;
	});
	after(async () => {
		await cleanup.disposeAsync();
	});

	it('recovers a committed rollover in a fresh process and follows the original handle', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Program, input, { scope: 'test', key: 'chain' });
		const oneRoot = workflow.client({
			store,
			policy: workflow.PolicySchema.parse({ ...Policy, limits: { ...Policy.limits, pendingRoots: 1 } }),
		});
		const first = await start(namespace, 'rollover');
		await first.gate();
		const beforeKill = await sql`select r.state,r.outcome,r.continued_to,r.chain_index,n.state as next_state,
 n.chain_root,n.chain_index as next_index,
 (select count(*)::integer from utils_workflow.runs where namespace=${namespace}) as runs,
 (select count(*)::integer from utils_continuation_writes where namespace=${namespace}) as writes
 from utils_workflow.runs r join utils_workflow.runs n on n.namespace=r.namespace and n.id=r.continued_to
 where r.namespace=${namespace} and r.id=${ref.id}`;
		expect(beforeKill).toHaveLength(1);
		expect(beforeKill[0]).toMatchObject({
			state: 'continued',
			outcome: null,
			chain_index: 0,
			next_state: 'ready',
			chain_root: ref.id,
			next_index: 1,
			runs: 2,
			writes: 1,
		});
		await expect(oneRoot.trigger(Immediate, input, { scope: 'test', key: 'while-chain' }))
			.rejects.toMatchObject({ code: 'admission_capacity' });
		await kill(first.child);
		const replacement = await start(namespace);
		expect(replacement.child.pid).not.toBe(first.child.pid);
		expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(15_000), intervalMs: 10 })).toBe(2);
		const physical = await client.get(Program, ref);
		expect(physical.state).toBe('continued');
		expect(physical.exit).toBeUndefined();
		expect(physical.continuedTo!.id).toBe(beforeKill[0]!.continued_to);
		expect((await client.get(Program, ref, { follow: true })).value).toBe(2);
		expect(await client.trigger(Program, input, { scope: 'test', key: 'chain' })).toEqual(ref);
		const segments = await sql`select r.id,r.state,r.chain_index,count(i.path)::integer as instructions
 from utils_workflow.runs r left join utils_workflow.instructions i on i.namespace=r.namespace and i.run=r.id
 where r.namespace=${namespace} group by r.id,r.state,r.chain_index order by r.chain_index`;
		expect(segments.map((row) => row.state)).toEqual(['continued', 'continued', 'completed']);
		expect(segments.map((row) => row.instructions)).toEqual([2, 2, 1]);
		expect(new Set(segments.map((row) => row.id)).size).toBe(3);
		expect((await sql`select cursor from utils_continuation_writes where namespace=${namespace} order by cursor`)
			.map((row) => row.cursor)).toEqual([0, 1, 2]);
		await kill(replacement.child);
		// Retained continued segments cannot hold the family's finished reservation forever.
		expect((await oneRoot.trigger(Immediate, input, { scope: 'test', key: 'after-chain' })).id).not.toBe(ref.id);
	});

	it('finishes receipt-backed deferred cleanup after process loss before publishing a successor', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Program, { ...input, until: 1, mode: 'cleanup' }, {
			scope: 'test',
			key: 'cleanup',
		});
		const first = await start(namespace, 'cleanup');
		await first.gate();
		const beforeKill =
			await sql`select r.state,r.outcome,r.continuation,r.continued_to,j.id as job,j.sequence,j.state as job_state,
 a.state as attempt_state,a.ended,p.contract,p.value,p.fingerprint,
 (select w.pid from utils_continuation_writes w where w.namespace=r.namespace and w.job=j.id limit 1) as writer_pid,
 (select count(*)::integer from utils_continuation_writes w where w.namespace=r.namespace and w.job=j.id) as writes,
 (select count(*)::integer from utils_workflow.runs where namespace=${namespace}) as runs
 from utils_workflow.runs r join utils_workflow.jobs j on j.namespace=r.namespace and j.run=r.id and j.finalizer
 join utils_workflow.attempts a on a.namespace=j.namespace and a.job=j.id and a.generation=j.generation
 join utils_workflow.receipts p on p.namespace=j.namespace and p.job=j.id and p.key='write/v1'
 where r.namespace=${namespace} and r.id=${ref.id}`;
		expect(beforeKill).toHaveLength(1);
		expect(beforeKill[0]).toMatchObject({
			state: 'settling',
			outcome: null,
			continued_to: null,
			sequence: 1,
			job_state: 'claimed',
			attempt_state: 'started',
			ended: null,
			contract: 'write/v1',
			value: { kind: 'value', value: 0 },
			fingerprint: await execution.fingerprint({ cursor: 0, label: 'cleanup', fail: false }),
			writer_pid: first.child.pid,
			writes: 1,
			runs: 1,
		});
		expect(beforeKill[0]!.continuation).not.toBeNull();
		await expect(store.send!(ref, 'late', 'new-slot', execution.encode('too late', 4096)))
			.rejects.toMatchObject({ code: 'event_closed' });
		await kill(first.child);
		const replacement = await start(namespace);
		expect(await client.wait(Program, ref, { signal: AbortSignal.timeout(15_000), intervalMs: 10 })).toBe(1);
		expect(
			(await sql`select count(*)::integer as count from utils_continuation_writes
 where namespace=${namespace} and job=${beforeKill[0]!.job}`)[0]!.count,
		).toBe(1);
		expect(
			(await sql`select state from utils_workflow.attempts where namespace=${namespace} and job=${beforeKill[0]!.job}
 order by sequence`).map((row) => row.state),
		).toEqual(['abandoned', 'success']);
		expect((await sql`select cursor,label from utils_continuation_writes where namespace=${namespace}
 order by cursor,label`).map((row) => [row.cursor, row.label])).toEqual([[0, 'cleanup'], [0, 'work'], [1, 'cleanup'], [
			1,
			'work',
		]]);
		await kill(replacement.child);
	});

	it('rolls back successor creation, saved request, and old-segment transition together', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Immediate, input, { scope: 'test', key: 'atomic' });
		const host = await store.register(`atomic:${namespace}`, [execution.identity(Immediate)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 30_000);
		const activation = (await store.activate(host, [execution.identity(Immediate)]))!;
		const name = `continuation_fail_${namespace.replaceAll('-', '')}`;
		// Fail after successor insertion, when the same transaction changes the old segment.
		await sql.unsafe(`create function utils_workflow.${name}() returns trigger language plpgsql as $$
 begin if new.namespace='${namespace}' and new.state='continued' then raise exception 'fixture rollover rollback'; end if; return new; end $$`);
		await sql.unsafe(
			`create trigger ${name} before update of state on utils_workflow.runs for each row execute function utils_workflow.${name}()`,
		);
		const intent = {
			path: '0:',
			fingerprint: 'atomic-continuation',
			input: execution.encode({ ...input, cursor: 1 }, 4096),
		};
		try {
			await expect(store.continue!(activation, intent, 1)).rejects.toThrow('fixture rollover rollback');
			expect((await client.get(Immediate, ref)).state).toBe('advancing');
			expect(
				(await sql`select count(*)::integer as count from utils_workflow.runs where namespace=${namespace}`)[0]!.count,
			).toBe(1);
			expect(
				(await sql`select count(*)::integer as count from utils_workflow.instructions where namespace=${namespace}`)[0]!
					.count,
			).toBe(0);
			expect(
				(await sql`select continuation,continued_to from utils_workflow.runs where namespace=${namespace} and id=${ref.id}`)[
					0
				],
			)
				.toMatchObject({ continuation: null, continued_to: null });
		} finally {
			await sql.unsafe(`drop trigger ${name} on utils_workflow.runs`);
			await sql.unsafe(`drop function utils_workflow.${name}()`);
		}
		await store.continue!(activation, intent, 1);
		await expect(store.continue!(activation, intent, 1)).rejects.toMatchObject({ code: 'stale_claim' });
		expect(
			(await sql`select count(*)::integer as count from utils_workflow.runs where namespace=${namespace}`)[0]!.count,
		).toBe(2);
		await store.leave(host);
	});

	it('carries an accepted pause through rollover and resumes the new physical segment explicitly', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Immediate, input, { scope: 'test', key: 'paused' });
		const host = await store.register(`paused:${namespace}`, [execution.identity(Immediate)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 30_000);
		const activation = (await store.activate(host, [execution.identity(Immediate)]))!;
		await client.pause(ref, { actor: 'test', reason: 'Pause an already admitted activation.', revision: 0 });
		await store.continue!(activation, {
			path: '0:',
			fingerprint: 'paused-continuation',
			input: execution.encode({ ...input, cursor: 1 }, 4096),
		}, 1);
		const next = await client.get(Immediate, ref, { follow: true });
		expect(next.ref.id).not.toBe(ref.id);
		expect(next.control).toEqual({ paused: true, revision: 1 });
		expect(await store.activate(host, [execution.identity(Immediate)])).toBeUndefined();
		await expect(client.resume(ref, { actor: 'test', reason: 'Old physical handle.', revision: 1 }))
			.rejects.toMatchObject({ code: 'control_closed' });
		await client.resume(next.ref, { actor: 'test', reason: 'Resume this segment.', revision: 1 });
		expect((await store.activate(host, [execution.identity(Immediate)]))!.ref).toEqual(next.ref);
		await store.leave(host);
	});

	it('refuses to leave live family work behind and admits continuation after that obligation settles', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const policy = workflow.PolicySchema.parse({
			...Policy,
			workflows: Policy.workflows.map((rule) =>
				rule.definition.id === Immediate.id
					? {
						...rule,
						maximumChildren: 1,
						children: [{ definition: Program, maximum: 1 }],
					}
					: rule
			),
		});
		const client = workflow.client({ store, policy });
		const ref = await client.trigger(Immediate, input, { scope: 'test', key: 'family' });
		const host = await store.register(`family:${namespace}`, [execution.identity(Immediate)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 30_000);
		const activation = (await store.activate(host, [execution.identity(Immediate)]))!;
		await store.instruction(activation, {
			type: 'child-workflow',
			path: '0:',
			fingerprint: 'child-request',
			definition: execution.identity(Program),
			input: execution.encode(input, 4096),
			discard: true,
			cancellation: 'independent',
		}, { park: false });
		const intent = {
			path: '1:',
			fingerprint: 'family-continuation',
			input: execution.encode({ ...input, cursor: 1 }, 4096),
		};
		await expect(store.continue!(activation, intent, 2)).rejects.toMatchObject({ code: 'continuation_pending' });
		expect(
			(await sql`select continued_to,continuation from utils_workflow.runs where namespace=${namespace} and id=${ref.id}`)[
				0
			],
		)
			.toMatchObject({ continued_to: null, continuation: null });
		const row = (await sql`select id from utils_workflow.runs where namespace=${namespace} and parent=${ref.id}`)[0]!;
		await client.cancel({ ...ref, id: row.id, definition: execution.identity(Program) }, 'Settle the fixture child.');
		await store.continue!(activation, intent, 2);
		expect((await client.get(Immediate, ref)).state).toBe('continued');
		await store.leave(host);
	});

	it('rejects continuation from an admitted successor instead of resetting its family budget', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const policy = workflow.PolicySchema.parse({
			...Policy,
			successors: [{ from: Write, maximum: 1, choices: [Immediate] }],
		});
		const client = workflow.client({ store, policy });
		await client.trigger(Write, { cursor: 0, label: 'work', fail: false }, { scope: 'test', key: 'predecessor' });
		const host = await store.register(
			`successor:${namespace}`,
			[execution.identity(Immediate), execution.identity(Write)],
			Engine.id,
			{
				activations: 1,
				activities: 1,
			},
			30_000,
		);
		const job = (await store.take(host, [execution.identity(Write)]))!;
		const ref = await postgres.begin(sql, (tx) =>
			client.in(tx, { claim: job.claim }).trigger(Immediate, input, {
				scope: 'test',
				key: 'successor',
			}));
		const activation = (await store.activate(host, [execution.identity(Immediate)]))!;
		await expect(store.continue!(activation, {
			path: '0:',
			fingerprint: 'successor-continuation',
			input: execution.encode({ ...input, cursor: 1 }, 4096),
		}, 1)).rejects.toMatchObject({ code: 'continuation_scope' });
		expect((await client.get(Immediate, ref)).state).toBe('advancing');
		await store.leave(host);
	});

	for (const mode of ['nested', 'cleanup-fail', 'budget'] as const) {
		it(`retains explicit inspection state for unsupported or incomplete ${mode} continuation`, async () => {
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace, notifications: false });
			const client = workflow.client({ store, policy: Policy });
			const ref = await client.trigger(Program, {
				...input,
				until: mode === 'budget' ? 3 : 1,
				mode: mode === 'budget' ? 'basic' : mode,
			}, { scope: 'test', key: mode });
			const worker = await start(namespace);
			await expect(client.wait(Program, ref, { signal: AbortSignal.timeout(15_000), intervalMs: 10 })).rejects
				.toMatchObject({
					snapshot: {
						state: 'blocked',
						reason: mode === 'nested'
							? 'continuation_scope'
							: mode === 'budget'
							? 'continuation_limit'
							: 'cleanup_exhausted',
					},
				});
			const runs =
				await sql`select state,continuation,continued_to from utils_workflow.runs where namespace=${namespace} order by chain_index`;
			expect(runs).toHaveLength(mode === 'budget' ? 3 : 1);
			if (mode === 'cleanup-fail') {
				expect(runs[0]!.continuation).not.toBeNull();
				expect(runs[0]!.continued_to).toBeNull();
			}
			await kill(worker.child);
		});
	}

	it('preserves a failed cleanup child for inspection instead of mutating its frozen continuation intent', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(DeferredChild, { ...input, until: 1 }, {
			scope: 'test',
			key: 'failed-cleanup-child',
		});
		const worker = await start(namespace);
		await expect(client.wait(DeferredChild, ref, { signal: AbortSignal.timeout(15_000), intervalMs: 10 }))
			.rejects.toMatchObject({ snapshot: { state: 'blocked', reason: 'cleanup_exhausted' } });
		const before = (await sql`select state,epoch,outcome,continuation,continued_to from utils_workflow.runs
 where namespace=${namespace} and id=${ref.id}`)[0]!;
		expect(before).toMatchObject({ state: 'blocked', epoch: 1, outcome: null, continued_to: null });
		expect(before.continuation).not.toBeNull();
		const cleanup = (await sql`select c.state,c.job,c.child,r.state as child_state from utils_workflow.cleanups c
 join utils_workflow.runs r on r.namespace=c.namespace and r.id=c.child
 where c.namespace=${namespace} and c.run=${ref.id}`)[0]!;
		expect(cleanup).toMatchObject({ state: 'failed', job: null, child_state: 'failed' });
		expect(await client.cancel(ref, 'Do not replace the accepted continuation.')).toBe('too_late');
		await expect(
			client.repair(ref, { actor: 'test', reason: 'A child retry needs an explicit contract.', epoch: 1, attempts: 1 }),
		)
			.rejects.toMatchObject({ code: 'repair_policy' });
		expect(
			(await sql`select state,epoch,outcome,continuation,continued_to from utils_workflow.runs
 where namespace=${namespace} and id=${ref.id}`)[0],
		).toEqual(before);
		expect(
			(await sql`select count(*)::integer as count from utils_workflow.audit where namespace=${namespace} and run=${ref.id}`)[
				0
			]!.count,
		)
			.toBe(0);
		expect(
			(await sql`select count(*)::integer as count from utils_workflow.runs where namespace=${namespace}`)[0]!.count,
		).toBe(2);
		await kill(worker.child);
	});

	it('rejects child continuation without changing its parent result identity', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const ref = await client.trigger(Parent, { ...input, until: 1 }, { scope: 'test', key: 'child' });
		const worker = await start(namespace);
		await until(async () => {
			const rows =
				await sql`select state,reason,continued_to from utils_workflow.runs where namespace=${namespace} and parent=${ref.id}`;
			return rows[0]?.state === 'blocked' ? rows[0] : undefined;
		});
		const child =
			(await sql`select id,state,reason,continued_to from utils_workflow.runs where namespace=${namespace} and parent=${ref.id}`)[
				0
			]!;
		expect(child).toMatchObject({ state: 'blocked', reason: 'continuation_scope', continued_to: null });
		expect((await client.get(Parent, ref)).state).toBe('waiting');
		expect(
			(await sql`select child from utils_workflow.instructions where namespace=${namespace} and run=${ref.id}`)[0]!
				.child,
		).toBe(child.id);
		await kill(worker.child);
	});

	it('reserves the full finite chain and rejects configured finalizers before rollover', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const constrained = workflow.PolicySchema.parse({ ...Policy, limits: { ...Policy.limits, reservedSuccessors: 1 } });
		await expect(
			workflow.client({ store, policy: constrained }).trigger(Immediate, input, { scope: 'test', key: 'capacity' }),
		)
			.rejects.toMatchObject({ code: 'admission_capacity' });
		const policy = workflow.PolicySchema.parse({
			...Policy,
			finalizers: [{
				roots: [Immediate],
				activity: Finalizer,
				maxAttempts: 1,
				deadlineMs: 1000,
				retry: 'never',
				delay: { initialMs: 10, maximumMs: 10 },
			}],
		});
		const ref = await workflow.client({ store, policy }).trigger(Immediate, input, { scope: 'test', key: 'finalizer' });
		const host = await store.register(`finalizer:${namespace}`, [execution.identity(Immediate)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 30_000);
		const activation = (await store.activate(host, [execution.identity(Immediate)]))!;
		await expect(store.continue!(activation, {
			path: '0:',
			fingerprint: 'finalizer-rejection',
			input: execution.encode({ ...input, cursor: 1 }, 4096),
		}, 1)).rejects.toMatchObject({ code: 'continuation_finalizer' });
		expect(
			(await sql`select state,continuation,continued_to from utils_workflow.runs where namespace=${namespace} and id=${ref.id}`)[
				0
			],
		)
			.toMatchObject({ state: 'advancing', continuation: null, continued_to: null });
		await store.leave(host);
	});
});
