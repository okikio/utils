/** Recover utility state after a real primary crash and synchronous standby promotion. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import * as context from '@okikio/context';
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as snapshots from '@okikio/storage/state/postgres';
import * as queues from '@okikio/storage/queue/postgres';
import { StaleClaimError } from '@okikio/scheduler/queue';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as resource from '@okikio/capability/resource';
import * as workflows from '@okikio/storage/workflow/postgres';
import { evidence, until } from './fixtures/evidence.ts';

const PostgresImage = 'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db';
const command = promisify(execFile);
const Local = engine.define({ id: 'failover.local' });
const Store = resource.define<workflows.StoreType>()({
	id: 'failover.store',
	description: 'Borrow guarded SQL receipt writes.',
});
const SaveNote = activity.define({
	id: 'failover.note',
	version: '1',
	input: schema.object({ id: schema.string(), title: schema.string() }),
	result: schema.object({ id: schema.string() }),
	placement: engine.require(Local),
	resources: [Store],
});
const Policy = workflow.PolicySchema.parse({
	id: 'failover.policy',
	version: '1',
	limits: {
		inputBytes: 4096,
		resultBytes: 4096,
		historyBytes: 16384,
		pendingRoots: 4,
		reservedSuccessors: 0,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 5000, renewEveryMs: 500, recoverEveryMs: 100 },
	activities: [{
		definition: SaveNote,
		maxAttempts: 3,
		deadlineMs: 20000,
		retry: 'transient',
		delay: { initialMs: 50, maximumMs: 500 },
		recovery: 'retry',
		requires: ['postgres.transactions', 'postgres.receipts'],
	}],
	workflows: [],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60000, resultsMs: 60000, auditMs: 60000 },
});

/** Reconstruction starts a real worker; a prior receipt prevents a second business write. */
async function save(database: Sql, namespace: string, ref: workflow.ReferenceType, expected: string): Promise<void> {
	await using store = workflows.open({ database, namespace, notifications: false });
	const client = workflow.client({ store, policy: Policy });
	const implementation = activity.implement(SaveNote, {
		async run(ctx) {
			const borrowed = await ctx.get(Store);
			const saved = await borrowed.transaction(
				ctx.claim,
				{ key: 'note-v1', input: ctx.input, result: SaveNote.result },
				async (tx, receipt) => {
					const previous = await receipt.get();
					if (previous !== undefined) return previous;
					await tx`insert into failover_notes values (${ctx.input.id},${ctx.input.title})`;
					return await receipt.save({ id: ctx.input.id });
				},
			);
			return saved.value;
		},
	});
	await using owner = context.create({ id: 'failover-worker' });
	await using resources = resource.create(
		resource.implementations(resource.implement(Store, { create: () => store })),
		{ ctx: owner, host: {} },
	);
	await using worker = await workflow.serve({
		store,
		resources,
		engine: Local,
		policies: [Policy],
		activities: [implementation],
		workflows: [],
		hostId: crypto.randomUUID(),
		shutdown: new AbortController().signal,
		pollIntervalMs: 25,
		capacity: { activations: 1, activities: 1, finalizers: 1, control: 1 },
	});
	expect((await client.wait(SaveNote, ref, { signal: AbortSignal.timeout(15000) })).id).toBe(expected);
	await worker.drain();
}

describe('PostgreSQL physical failover checks', { timeout: 180000, concurrency: false }, () => {
	it('retains acknowledged snapshots, queue claims and workflow receipts, rejects interrupted work, then reconnects to the promoted writer', async () => {
		const receipt = await evidence('postgres-failover');
		const driver: unknown = JSON.parse(
			await readFile(new URL('../package.json', import.meta.resolve('postgres')), 'utf8'),
		);
		if (driver === null || typeof driver !== 'object' || !('version' in driver) || typeof driver.version !== 'string') {
			throw new Error('Cannot record the installed Postgres.js version.');
		}
		const network = await new Network().start();
		const owned: StartedTestContainer[] = [];
		const pools: Sql[] = [];
		const logs: Record<string, string> = {};
		const resume = Promise.withResolvers<void>();
		const callbackDone = Promise.withResolvers<void>();
		async function capture(name: string, container: StartedTestContainer): Promise<void> {
			owned.push(container);
			logs[name] = '';
			(await container.logs()).on('data', (chunk) => {
				logs[name] += String(chunk);
			});
		}
		try {
			const primary = await new PostgreSqlContainer(PostgresImage)
				.withNetwork(network).withNetworkAliases('primary').withDatabase('test')
				.withUsername('fixture').withPassword('fixture')
				.withCommand(['postgres', '-c', 'wal_level=replica', '-c', 'max_wal_senders=5'])
				.start();
			await capture('primary', primary);
			const allow = await primary.exec([
				'sh',
				'-c',
				'echo "host replication fixture all scram-sha-256" >> "$PGDATA/pg_hba.conf"',
			]);
			expect(allow.exitCode).toBe(0);
			const direct = postgresjs(primary.getConnectionUri(), { max: 2, onnotice() {} });
			pools.push(direct);
			await direct`select pg_reload_conf()`;
			const replica = await new GenericContainer(PostgresImage).withNetwork(network)
				.withNetworkAliases('standby').withUser('postgres').withEnvironment({ PGPASSWORD: 'fixture' })
				.withCommand([
					'sh',
					'-c',
					'pg_basebackup -h primary -U fixture -D /tmp/standby -R -X stream -d "application_name=test" && exec postgres -D /tmp/standby -c listen_addresses=*',
				])
				.withExposedPorts(5432).withWaitStrategy(
					Wait.forLogMessage('database system is ready to accept read-only connections'),
				).start();
			await capture('standby', replica);
			const standby = postgresjs({
				host: replica.getHost(),
				port: replica.getMappedPort(5432),
				database: 'test',
				username: 'fixture',
				password: 'fixture',
				max: 2,
				connect_timeout: 2,
				onnotice() {},
			});
			pools.push(standby);
			await until(
				async () =>
					(await direct`select sync_state from pg_stat_replication where application_name='test'`).length ===
						1,
				'physical standby streams from this primary',
			);
			await direct.unsafe("alter system set synchronous_standby_names = 'test'");
			await direct.unsafe("alter system set synchronous_commit = 'remote_apply'");
			await direct`select pg_reload_conf()`;
			await until(
				async () => (await direct`select sync_state from pg_stat_replication`)[0]?.sync_state === 'sync',
				'standby acknowledges applied commits',
			);
			const database = postgresjs(
				`postgres://fixture:fixture@${primary.getHost()}:${primary.getMappedPort(5432)},${replica.getHost()}:${
					replica.getMappedPort(5432)
				}/test`,
				{
					max: 1,
					connect_timeout: 2,
					target_session_attrs: 'primary',
					onnotice() {},
					connection: { statement_timeout: 10000, lock_timeout: 2000 },
				},
			);
			pools.push(database);
			await snapshots.migrate({ database });
			await queues.migrate({ database });
			await workflows.migrate({ database });
			await database`create table failover_notes (id text, title text)`;
			await database`create table failover_uncommitted (id text)`;
			const namespace = crypto.randomUUID();
			await using ctx = context.create({ id: 'failover', signal: AbortSignal.timeout(60000) });
			await using cell = await state.open({
				store: snapshots.open({ database, namespace, key: 'cursor' }),
				contract: 'cursor.v1',
				value: schema.object({ cursor: schema.number() }),
				initial: () => ({ cursor: 1 }),
			});
			await cell.update(() => ({ cursor: 2 }));
			const queueOptions = {
				database,
				namespace,
				contract: 'notes.v1',
				input: schema.string(),
				output: schema.string(),
				pollMilliseconds: 25,
			};
			await using queue = queues.open(queueOptions);
			const queued = await queue.add(ctx, 'saved before failover', { key: 'same-command' });
			const oldClaim = (await queue.claim(ctx, { duration: { seconds: 1 }, owner: 'old-primary-owner' }))[0]!;
			await using admission = workflows.open({ database, namespace, notifications: false });
			const client = workflow.client({ store: admission, policy: Policy });
			const firstInput = { id: 'acknowledged', title: 'Saved before primary loss' };
			const first = await client.submit(SaveNote, firstInput, { scope: 'account', key: firstInput.id });
			await save(database, namespace, first, firstInput.id);
			const pendingInput = { id: 'pending', title: 'Accepted before primary loss' };
			const pending = await client.submit(SaveNote, pendingInput, { scope: 'account', key: pendingInput.id });
			const replication = await direct`select application_name,sync_state,replay_lsn::text from pg_stat_replication`;
			expect(replication[0]?.sync_state).toBe('sync');
			expect((await standby`select count(*)::integer as count from utils_workflow.receipts`)[0]!.count).toBe(1);
			// Keep the transaction callback alive after its connection dies. Its SQL must
			// never escape into a later transaction, even when application work resumes.
			let entered = false;
			let interruptedQueries: PromiseSettledResult<unknown>[] = [];
			let lateQuery: PromiseSettledResult<unknown> | undefined;
			const interrupted = database.begin(async (tx) => {
				try {
					await tx`insert into failover_uncommitted values ('never-committed')`;
					const queries = Promise.allSettled([tx`select pg_sleep(30)`, tx`select 42`]);
					entered = true;
					interruptedQueries = await queries;
					await resume.promise;
					[lateQuery] = await Promise.allSettled([
						tx`insert into failover_uncommitted values ('stale-callback')`,
					]);
				} finally {
					callbackDone.resolve();
				}
			}).then(
				() => ({ status: 'committed' as const, error: '' }),
				(error: unknown) => ({ status: 'rejected' as const, error: String(error) }),
			);
			await until(async () => entered, 'same-process transaction has an uncommitted write and queued queries');
			await until(
				async () =>
					(await direct`select pid from pg_stat_activity where query='select pg_sleep(30)' and state='active'`)
						.length === 1,
				'the interrupted query is running on the real primary',
			);
			const started = performance.now();
			// SIGKILL the only writer. It remains stopped throughout promotion: this is
			// explicit fencing, not an automatic election or a split-brain repair test.
			await command('docker', ['kill', '--signal=KILL', primary.getId()]);
			await expect(direct`select 1`).rejects.toThrow();
			const promoted = await replica.exec(['pg_ctl', '-D', '/tmp/standby', '-w', 'promote']);
			expect(promoted.exitCode).toBe(0);
			await until(
				async () => (await standby`select pg_is_in_recovery() as recovery`)[0]?.recovery === false,
				'standby becomes writable',
			);
			// The new single writer has no standby. Without removing the inherited
			// synchronous target, future commits would wait for a replica that does not exist.
			await standby.unsafe("alter system set synchronous_standby_names = ''");
			await standby`select pg_reload_conf()`;
			const interruption = await interrupted;
			expect(interruption.status).toBe('rejected');
			expect(interruption.error).toMatch(/CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED/);
			await until(
				async () => (await database`select pg_is_in_recovery() as recovery`)[0]?.recovery === false,
				'same multi-host pool reconnects to promoted writer',
			);
			// A fresh transaction must retain its identity when the old callback returns.
			await database.begin(async (tx) => {
				const before = (await tx`select txid_current()::text as id`)[0]!.id;
				resume.resolve();
				await callbackDone.promise;
				await new Promise((resolve) => setImmediate(resolve));
				expect((await tx`select txid_current()::text as id`)[0]!.id).toBe(before);
			});
			expect(interruptedQueries.map((query) => query.status)).toEqual(['rejected', 'rejected']);
			expect(lateQuery?.status).toBe('rejected');
			expect(await database`select * from failover_uncommitted`).toHaveLength(0);
			await using reopened = await state.open({
				store: snapshots.open({ database, namespace, key: 'cursor' }),
				contract: 'cursor.v1',
				value: schema.object({ cursor: schema.number() }),
			});
			expect(reopened.reader.get()).toEqual({ cursor: 2 });
			await reopened.update(() => ({ cursor: 3 }));
			await using replacement = queues.open(queueOptions);
			expect(await replacement.add(ctx, 'ignored duplicate', { key: 'same-command' })).toEqual(queued);
			const newClaim = (await replacement.claim(ctx, { ref: queued, owner: 'promoted-owner', wait: true }))[0]!;
			expect(newClaim.attempt).toBe(2);
			await expect(queue.complete(ctx, oldClaim, 'stale')).rejects.toBeInstanceOf(StaleClaimError);
			await replacement.complete(ctx, newClaim, 'recovered');
			expect(await queue.result(ctx, queued)).toBe('recovered');
			expect((await client.submit(SaveNote, firstInput, { scope: 'account', key: firstInput.id })).id).toBe(first.id);
			await save(database, namespace, first, firstInput.id);
			await save(database, namespace, pending, pendingInput.id);
			expect(await database`select * from failover_notes order by id`).toEqual([firstInput, pendingInput]);
			expect((await database`select count(*)::integer as count from utils_workflow.receipts`)[0]!.count).toBe(2);
			await receipt.save('result.json', {
				image: PostgresImage,
				replication,
				recoveryMs: performance.now() - started,
				interruption,
				queued: interruptedQueries.map((query) => query.status),
				driver: driver.version,
				runtime: process.versions,
				lateQuery: lateQuery?.status,
				processId: process.pid,
				notes: await database`select * from failover_notes order by id`,
				queue: await queue.result(ctx, queued),
				cursor: reopened.reader.get(),
				first,
				pending,
			});
			const dump = await replica.exec(['pg_dump', '-U', 'fixture', '-d', 'test']);
			expect(dump.exitCode).toBe(0);
			await receipt.save('promoted.sql', dump.output);
		} finally {
			resume.resolve();
			await Promise.all(pools.map((pool) => pool.end({ timeout: 2 })));
			for (const [name, log] of Object.entries(logs)) await receipt.save(`${name}.log`, log);
			for (const container of owned.reverse()) await container.stop({ timeout: 0 });
			await network.stop();
		}
	});
});
