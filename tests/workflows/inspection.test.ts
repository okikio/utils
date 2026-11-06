/** Test operator reads against committed PostgreSQL state, including restart and retained-history gaps. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import * as schemaCore from '@okikio/schema';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/capability/effect';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import { encode, identity } from '@okikio/workflow/execution';
import { Engine, Policy as Base, Progress } from './scenarios/events.ts';

/** A private input and result make accidental payload disclosure observable in public responses. */
const Work = activity.define({
	id: 'inspection.write',
	version: '1',
	input: schemaCore.object({ secret: schemaCore.string() }),
	result: schemaCore.string(),
	placement: engine.require(Engine),
	effects: [Progress],
});
/** Parent and child definitions exercise the actual saved wait and relationship contracts. */
const Flow = workflow.define({
	id: 'inspection.flow',
	version: '1',
	input: schemaCore.object({}),
	result: schemaCore.string(),
});
const Child = workflow.define({
	id: 'inspection.child',
	version: '1',
	input: schemaCore.object({}),
	result: schemaCore.string(),
});
/** Long leases keep these read tests independent of background recovery timing. */
const Policy = workflow.PolicySchema.parse({
	...Base,
	id: 'inspection.policy',
	limits: { ...Base.limits, pendingRoots: 100, pendingChildren: 100 },
	claims: { leaseMs: 60_000, renewEveryMs: 1000, recoverEveryMs: 1000 },
	activities: [{ ...Base.activities[0]!, definition: Work, maxAttempts: 3, delay: { initialMs: 1, maximumMs: 1 } }],
	workflows: [
		{
			definition: Flow,
			maxInstructions: 20,
			maximumChildren: 1,
			children: [{ definition: Child, maximum: 1 }],
			requires: ['workflow.events'],
		},
		{ definition: Child, maxInstructions: 10, requires: [] },
	],
});

let container: StartedPostgreSqlContainer | undefined;
let databaseUrl: string;
let sql: Sql;

/** Isolated namespaces avoid destructive cleanup and let failed tests retain diagnostic rows. */
function setup() {
	const namespace = crypto.randomUUID();
	const store = postgres.open({ database: sql, namespace, notifications: false });
	return {
		namespace,
		store,
		client: workflow.client({ store, policy: Policy }),
		operations: postgres.inspector({ database: sql, namespace }),
	};
}

describe('read-only durable execution inspection', () => {
	before(async () => {
		const supplied = process.env.UTILS_INSPECTION_TEST_DATABASE_URL;
		if (supplied !== undefined) databaseUrl = supplied;
		else {
			container = await new PostgreSqlContainer(
				'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db',
			).start();
			databaseUrl = container.getConnectionUri();
		}
		sql = postgresjs(databaseUrl, { max: 8, onnotice() {} });
		await postgres.migrate({ database: sql });
	});

	after(async () => {
		await sql?.end({ timeout: 2 });
		await container?.stop();
	});

	it('reports actual claims, attempts, progress freshness, completion, and capacity without private payloads', async () => {
		const { namespace, store, client, operations } = setup();
		await using _owned = store;
		const secret = `private-input-${crypto.randomUUID()}`;
		const ref = await client.submit(Work, { secret }, { scope: 'tenant-a', key: secret });
		const queued = await operations.queue({ scope: 'tenant-a' });
		expect(queued.totals).toMatchObject({ runs: 1, paused: 0, dueJobs: 1 });
		expect(Date.parse(queued.observedAt) - Date.parse(queued.totals.oldestDueAt!)).toBeGreaterThanOrEqual(0);
		const host = await store.register(
			'operator-worker',
			[identity(Work)],
			Engine.id,
			{ activations: 2, activities: 2 },
			60_000,
		);
		const job = (await store.take(host, [identity(Work)]))!;
		expect(job).toBeDefined();
		const occurrence = await effect.encode(await effect.create(Progress, { rows: 200 }, { key: secret }));
		await store.report!(job.claim, occurrence, 2);
		const progress = await operations.progress(ref);
		expect(progress.items[0]).toMatchObject({
			job: job.claim.jobId,
			effect: Progress.id,
			generation: 1,
			attempt: 1,
			sequence: 2,
		});
		expect(progress.items[0]!.reportedAt).toMatch(/Z$/);
		await store.report!(job.claim, { ...occurrence, value: { rows: 100 } }, 1);
		expect((await operations.progress(ref)).items).toEqual(progress.items);
		const claimed = await operations.inspect(ref);
		expect(claimed.jobs[0]).toMatchObject({ state: 'claimed', host: host.id, hostGeneration: host.generation });
		expect(claimed.totals).toMatchObject({ jobs: 1, readyJobs: 0, claimedJobs: 1, attempts: 1, progress: 1 });
		expect((await operations.hosts()).items[0]!.activities).toEqual({ limit: 2, active: 1, free: 1, expired: 0 });
		const pending = await operations.attempts(ref, { job: job.claim.jobId });
		expect(pending.items[0]).toMatchObject({ state: 'started', endedAt: null, outcomeType: null });
		expect(pending.items[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
		await store.complete(job, { type: 'fault', code: 'private_fault', message: secret }, 'permanent');
		const finished = await operations.inspect(ref);
		expect(finished.run).toMatchObject({
			state: 'failed',
			outcomeType: 'fault',
			chain: { root: ref.id, index: 0, continuedTo: null },
		});
		expect(finished.run.finishedAt).toMatch(/Z$/);
		const attempts = await operations.attempts(ref);
		expect(attempts.items[0]).toMatchObject({ state: 'fault', outcomeType: 'fault' });
		expect(attempts.items[0]!.endedAt).toMatch(/Z$/);
		const history = await operations.history(ref);
		expect(history.coverage).toBe('created');
		expect(history.items.filter((item) => item.kind === 'job').map((item) => item.state)).toEqual([
			'ready',
			'claimed',
			'failed',
		]);
		expect(history.events).toBe(finished.totals.historyEvents);
		expect(history.bytes).toBe(finished.totals.historyBytes);
		expect(history.bytes).toBeGreaterThan(0);
		expect((await operations.hosts()).items[0]!.activities).toEqual({ limit: 2, active: 0, free: 2, expired: 0 });
		const response = JSON.stringify([queued, claimed, finished, progress, attempts, history]);
		expect(response).not.toContain(secret);
		expect(response).not.toContain('private_fault');
		expect(response).not.toContain('"occurrence"');
		expect(response).not.toContain('"input"');
		expect(postgres.InspectionSchema.parse(JSON.parse(JSON.stringify(finished)))).toEqual(finished);
		await store.leave(host);
		expect((await operations.hosts()).items[0]).toMatchObject({ draining: true, activities: { free: 0 } });
		expect(namespace).toBe(ref.namespace);
	});

	it('pages persisted timer, event, and child waits and observes parking release activation capacity', async () => {
		const { store, client, operations } = setup();
		await using _owned = store;
		const ref = await client.trigger(Flow, {}, { scope: 'tenant-a', key: 'waits' });
		const host = await store.register('wait-worker', [identity(Flow), identity(Child)], Engine.id, {
			activations: 1,
			activities: 1,
		}, 60_000);
		const activation = (await store.activate(host, [identity(Flow)]))!;
		const until = new Date(Date.now() + 60_000).toISOString();
		await store.instruction(activation, { type: 'sleep', path: '0:sleep', fingerprint: 'sleep', delay: 60_000 }, {
			park: false,
		});
		await store.instruction(activation, { type: 'sleep-until', path: '1:until', fingerprint: 'until', due: until }, {
			park: false,
		});
		await store.instruction(activation, {
			type: 'wait-event',
			path: '2:event',
			fingerprint: 'event',
			event: 'approved',
			eventKey: 'private-correlation',
			due: until,
		}, { park: false });
		await store.instruction(activation, {
			type: 'child-workflow',
			path: '3:child',
			fingerprint: 'child',
			definition: identity(Child),
			input: encode({}, 1024),
			cancellation: 'follow-parent',
		}, { park: false });
		expect((await operations.hosts()).items[0]!.activations.active).toBe(1);
		await store.park!(activation, ['0:sleep', '1:until', '2:event', '3:child']);
		expect((await operations.hosts()).items[0]!.activations).toEqual({ limit: 1, active: 0, free: 1, expired: 0 });
		const first = await operations.waits(ref, { limit: 2 });
		const second = await operations.waits(ref, { limit: 2, after: first.next! });
		expect([...first.items, ...second.items].map((item) => item.type)).toEqual([
			'sleep',
			'sleep-until',
			'wait-event',
			'child-workflow',
		]);
		expect(second.next).toBeNull();
		expect(second.items[1]!.child).not.toBeNull();
		expect((await operations.inspect(ref)).totals.waitingInstructions).toBe(4);
		await store.send!(ref, 'approved', 'private-correlation', encode('private-event-value', 1024));
		const resolved = await operations.waits(ref);
		expect(resolved.items.find((item) => item.type === 'wait-event')).toMatchObject({
			resolved: true,
			outcomeType: 'success',
		});
		expect(JSON.stringify(resolved)).not.toContain('private-');
	});

	it('validates exact namespace, scope, kind, and definition version on every run view', async () => {
		const { namespace, store, client, operations } = setup();
		await using _owned = store;
		const ref = await client.submit(Work, { secret: 'tenant-a-secret' }, { scope: 'tenant-a', key: 'identity' });
		await client.submit(Work, { secret: 'tenant-b-secret' }, { scope: 'tenant-b', key: 'identity' });
		const variants = [
			{ ...ref, namespace: crypto.randomUUID() },
			{ ...ref, scope: 'tenant-b' },
			{ ...ref, definition: { ...ref.definition, version: 'other' } },
			{ ...ref, definition: { ...ref.definition, id: 'other' } },
			{ ...ref, definition: { ...ref.definition, kind: 'workflow' as const } },
			{ ...ref, id: crypto.randomUUID() },
		];
		for (const candidate of variants) {
			for (const method of ['inspect', 'attempts', 'waits', 'progress', 'history'] as const) {
				await expect(operations[method](candidate)).rejects.toMatchObject({ code: 'inspection_reference' });
			}
		}
		expect((await operations.queue({ scope: 'tenant-a' })).items.map((item) => item.ref.id)).toEqual([ref.id]);
		expect((await operations.queue({ scope: 'missing' })).totals.runs).toBe(0);
		const other = postgres.inspector({ database: sql, namespace: `${namespace}-other` });
		expect((await other.queue({ scope: 'tenant-a' })).items).toEqual([]);
	});

	it('uses timestamp microseconds plus UUID for queue pagination and binds cursors to filters and views', async () => {
		const { namespace, store, client, operations } = setup();
		await using _owned = store;
		const refs = [];
		for (let index = 0; index < 3; index++) {
			refs.push(await client.submit(Work, { secret: String(index) }, { scope: 'tenant-a', key: String(index) }));
		}
		refs.sort((a, b) => a.id.localeCompare(b.id));
		const expected = [refs[2]!, refs[0]!, refs[1]!];
		// Fixture acceptance times share a JS millisecond; dropping SQL microseconds would repeat or omit rows.
		for (let index = 0; index < expected.length; index++) {
			await sql`update utils_workflow.runs set created=${
				index === 0 ? '2026-10-31T00:00:00.000001Z' : '2026-10-31T00:00:00.000002Z'
			}::text::timestamptz where namespace=${namespace} and id=${expected[index]!.id}`;
		}
		const first = await operations.queue({ scope: 'tenant-a', limit: 1 });
		const second = await operations.queue({ scope: 'tenant-a', limit: 1, after: first.next! });
		const third = await operations.queue({ scope: 'tenant-a', limit: 1, after: second.next! });
		expect([...first.items, ...second.items, ...third.items].map((item) => item.ref.id)).toEqual(
			expected.map((ref) => ref.id),
		);
		expect(third.next).toBeNull();
		await expect(operations.queue({ scope: 'tenant-b', after: first.next! })).rejects.toMatchObject({
			code: 'inspection_cursor',
		});
		await expect(operations.queue({ scope: 'tenant-a', states: ['waiting'], after: first.next! })).rejects
			.toMatchObject({ code: 'inspection_cursor' });
		await expect(operations.hosts({ after: first.next! })).rejects.toMatchObject({ code: 'inspection_cursor' });
		await expect(operations.inspect(refs[0]!, { after: 'not-json' })).rejects.toMatchObject({
			code: 'inspection_cursor',
		});
		await expect(operations.queue({ scope: 'tenant-a', limit: 0 })).rejects.toThrow();
		await expect(operations.queue({ scope: 'tenant-a', limit: 101 })).rejects.toThrow();
		await expect(operations.inspect(refs[0]!, { limit: 1.5 })).rejects.toThrow();
		expect(() => postgres.InspectionOptionsSchema.parse({ limit: 1, input: 'unexpected' })).toThrow();
		expect(() => postgres.QueueOptionsSchema.parse({})).toThrow();
	});

	it('resumes committed lifecycle transitions with a saved tail cursor after replacing the pool', async () => {
		const { namespace, store, client, operations } = setup();
		await using _owned = store;
		const ref = await client.trigger(Flow, {}, { scope: 'tenant-a', key: 'history' });
		const initial = await operations.history(ref, { limit: 1 });
		expect(initial.items.map((item) => item.sequence)).toEqual(['1']);
		expect(initial.hasMore).toBe(false);
		expect(initial.next).not.toBeNull();
		await client.pause(ref, { actor: 'operator@example.test', reason: 'private-operation-reason', revision: 0 });
		await client.resume(ref, { actor: 'operator@example.test', reason: 'private-operation-reason', revision: 1 });
		const replacement = postgresjs(databaseUrl, { max: 1, onnotice() {} });
		try {
			const restarted = postgres.inspector({ database: replacement, namespace });
			let page = await restarted.history(ref, { after: initial.next!, limit: 2 });
			const changes = [...page.items];
			while (page.hasMore) {
				page = await restarted.history(ref, { after: page.next!, limit: 2 });
				changes.push(...page.items);
			}
			expect(changes.map((item) => item.sequence)).toEqual(['2', '3', '4', '5']);
			expect(changes.filter((item) => item.kind === 'operator').map((item) => item.action)).toEqual([
				'pause',
				'resume',
			]);
			expect(
				changes.filter((item) => item.kind === 'operator').every((item) =>
					item.actor === 'operator@example.test' && item.hasReason
				),
			).toBe(true);
			expect(JSON.stringify(changes)).not.toContain('private-operation-reason');
			const empty = await restarted.history(ref, { after: page.next! });
			expect(empty.items).toEqual([]);
			expect(empty.next).toBe(page.next);
			expect(empty.hasMore).toBe(false);
			expect((await restarted.inspect(ref)).run.control).toEqual({ paused: false, revision: 2 });
			const other = await client.trigger(Flow, {}, { scope: 'tenant-a', key: 'other' });
			await expect(restarted.history(other, { after: initial.next! })).rejects.toMatchObject({
				code: 'inspection_cursor',
			});
		} finally {
			await replacement.end();
		}
	});

	it('preserves long accepted operation paths and legacy host identifiers in pages and cursors', async () => {
		const { namespace, store, client, operations } = setup();
		await using _owned = store;
		const firstHost = await store.register('legacy-one', [], Engine.id, { activations: 1, activities: 1 }, 60_000);
		const secondHost = await store.register('legacy-two', [], Engine.id, { activations: 1, activities: 1 }, 60_000);
		const longHost = 'a'.repeat(9000), longEngine = 'engine.'.repeat(50);
		// Older registration accepted these identifiers. A newer admission bound must not hide their saved metadata.
		await sql`update utils_workflow.hosts set id=${
			longHost + ':1'
		},engine=${longEngine} where namespace=${namespace} and id=${firstHost.id}`;
		await sql`update utils_workflow.hosts set id=${
			longHost + ':2'
		},engine=${longEngine} where namespace=${namespace} and id=${secondHost.id}`;
		const hosts = await operations.hosts({ limit: 1 });
		expect(hosts.items[0]).toMatchObject({ id: longHost + ':1', engine: longEngine });
		expect(hosts.next!.length).toBeGreaterThan(8192);
		expect((await operations.hosts({ limit: 1, after: hosts.next! })).items[0]!.id).toBe(longHost + ':2');
		const ref = await client.trigger(Flow, {}, { scope: 'tenant-a', key: 'long-path' });
		const host = await store.register('worker', [identity(Flow)], Engine.id, { activations: 1, activities: 1 }, 60_000);
		const activation = (await store.activate(host, [identity(Flow)]))!;
		const path = 'operation'.repeat(1000);
		for (const suffix of ['1', '2']) {
			await store.instruction(activation, { type: 'sleep', path: path + suffix, fingerprint: suffix, delay: 60_000 }, {
				park: false,
			});
		}
		const first = await operations.waits(ref, { limit: 1 });
		expect(first.items[0]!.operation).toBe(path + '1');
		expect(first.next!.length).toBeGreaterThan(8192);
		const second = await operations.waits(ref, { limit: 1, after: first.next! });
		expect(second.items[0]!.operation).toBe(path + '2');
		expect(second.next).toBeNull();
	});

	it('does not expose uncommitted transitions or invent history for rolled-back changes', async () => {
		const { namespace, store, client, operations } = setup();
		await using _owned = store;
		const ref = await client.trigger(Flow, {}, { scope: 'tenant-a', key: 'commit-order' });
		const original = await operations.history(ref);
		const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		const pending = sql.begin(async (tx) => {
			await tx`update utils_workflow.runs set paused=true,control_revision=control_revision+1 where namespace=${namespace} and id=${ref.id}`;
			ready.resolve();
			await release.promise;
		});
		await ready.promise;
		try {
			const beforeCommit = await operations.history(ref, { after: original.next! });
			expect(beforeCommit.items).toEqual([]);
			expect(beforeCommit.through).toBe(original.through);
			expect((await operations.inspect(ref)).run.control.paused).toBe(false);
		} finally {
			release.resolve();
			await pending;
		}
		const committed = await operations.history(ref, { after: original.next! });
		expect(committed.items.map((item) => item.sequence)).toEqual(['2']);
		expect(committed.items[0]!.control).toEqual({ paused: true, revision: 1 });
		await expect(sql.begin(async (tx) => {
			await tx`update utils_workflow.runs set paused=false,control_revision=control_revision+1 where namespace=${namespace} and id=${ref.id}`;
			throw new Error('Rollback fixture.');
		})).rejects.toThrow('Rollback fixture.');
		expect((await operations.history(ref, { after: committed.next! })).items).toEqual([]);
		await client.resume(ref, { actor: 'operator', reason: 'Resume after rollback.', revision: 1 });
		expect((await operations.history(ref, { after: committed.next! })).items.map((item) => item.sequence)).toEqual([
			'3',
			'4',
		]);
	});

	it('makes retained prefixes, interior gaps, and migration baselines explicit', async () => {
		const { namespace, store, client, operations } = setup();
		await using _owned = store;
		const ref = await client.trigger(Flow, {}, { scope: 'tenant-a', key: 'retention' });
		const initial = await operations.history(ref);
		await client.pause(ref, { actor: 'operator', reason: 'Pause fixture.', revision: 0 });
		await client.resume(ref, { actor: 'operator', reason: 'Resume fixture.', revision: 1 });
		// Explicitly simulate partial retention; normal application code never edits adapter history tables.
		await sql`delete from utils_workflow.run_events where namespace=${namespace} and run=${ref.id} and sequence<=3`;
		await expect(operations.history(ref, { after: initial.next! })).rejects.toMatchObject({
			code: 'inspection_history_gap',
		});
		const retained = await operations.history(ref);
		expect(retained).toMatchObject({ coverage: 'retained', availableFrom: '4', through: '5', hasGaps: false });
		await client.pause(ref, { actor: 'operator', reason: 'Another pause.', revision: 2 });
		await sql`delete from utils_workflow.run_events where namespace=${namespace} and run=${ref.id} and sequence=6`;
		await expect(operations.history(ref, { after: retained.next! })).rejects.toMatchObject({
			code: 'inspection_history_gap',
		});
		const baseline = await client.trigger(Flow, {}, { scope: 'tenant-a', key: 'migration-baseline' });
		await sql`update utils_workflow.run_events set kind='baseline' where namespace=${namespace} and run=${baseline.id} and sequence=1`;
		expect((await operations.history(baseline)).coverage).toBe('migration');
	});

	it('performs reads in a read-only SQL session and leaves the borrowed pool and saved leases unchanged', async () => {
		const { namespace, store, client } = setup();
		await using _owned = store;
		const ref = await client.submit(Work, { secret: 'private' }, { scope: 'tenant-a', key: 'readonly' });
		const host = await store.register(
			'read-only-host',
			[identity(Work)],
			Engine.id,
			{ activations: 1, activities: 1 },
			60_000,
		);
		await store.take(host, [identity(Work)]);
		const before =
			await sql`select r.xmin::text as revision,r.expires,h.expires as host_expires,j.expires as job_expires from utils_workflow.runs r
 join utils_workflow.hosts h on h.namespace=r.namespace and h.id=${host.id}
 join utils_workflow.jobs j on j.namespace=r.namespace and j.run=r.id where r.namespace=${namespace} and r.id=${ref.id}`;
		const readonly = postgresjs(databaseUrl, {
			max: 1,
			onnotice() {},
			connection: { default_transaction_read_only: true },
		});
		try {
			const operations = postgres.inspector({ database: readonly, namespace });
			await operations.inspect(ref);
			await operations.attempts(ref);
			await operations.waits(ref);
			await operations.progress(ref);
			await operations.history(ref);
			await operations.queue({ scope: 'tenant-a' });
			await operations.hosts();
			expect((await readonly`select 1 as usable`)[0]!.usable).toBe(1);
		} finally {
			await readonly.end();
		}
		const after =
			await sql`select r.xmin::text as revision,r.expires,h.expires as host_expires,j.expires as job_expires from utils_workflow.runs r
 join utils_workflow.hosts h on h.namespace=r.namespace and h.id=${host.id}
 join utils_workflow.jobs j on j.namespace=r.namespace and j.run=r.id where r.namespace=${namespace} and r.id=${ref.id}`;
		expect([...after]).toEqual([...before]);
	});
});
