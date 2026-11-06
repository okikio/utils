/** Test bounded continuous writes and reconcile lost COMMIT replies against real PostgreSQL. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as workflow from '@okikio/workflow';
import { identity } from '@okikio/workflow/execution';
import * as storage from '@okikio/storage/workflow/postgres';
import { evidence, until } from './fixtures/evidence.ts';
import { cluster, PostgresImage } from './fixtures/postgres.ts';
import { proxy } from './fixtures/commit.ts';

const Local = engine.define({ id: 'test.sql' });
const Write = activity.define({
	id: 'test.write',
	version: '1',
	input: schema.string(),
	result: schema.string(),
	placement: engine.require(Local),
});
const Policy = workflow.PolicySchema.parse({
	id: 'test.sql',
	version: '1',
	limits: {
		inputBytes: 4096,
		resultBytes: 4096,
		historyBytes: 16384,
		pendingRoots: 64,
		reservedSuccessors: 0,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 180000, renewEveryMs: 10000, recoverEveryMs: 1000 },
	activities: [{
		definition: Write,
		maxAttempts: 3,
		deadlineMs: 180000,
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

/** Each producer owns one admitted activity claim. The loop stresses guarded writes, not worker dispatch throughput. */
async function claims(database: Sql, count: number) {
	await storage.migrate({ database });
	const namespace = crypto.randomUUID();
	const store = storage.open({ database, namespace, notifications: false });
	const client = workflow.client({ store, policy: Policy });
	for (let index = 0; index < count; index++) {
		await client.trigger(Write, String(index), { scope: 'test', key: String(index) });
	}
	const host = await store.register('test', [identity(Write)], Local.id, {
		activations: count,
		activities: count,
	}, 180000);
	const jobs = [];
	for (let index = 0; index < count; index++) {
		const job = await store.take(host, [identity(Write)]);
		if (job === undefined) throw new Error('An admitted test activity could not be claimed.');
		jobs.push(job);
	}
	return { store, jobs, namespace };
}

/** A duplicate is observable: the business table deliberately has no uniqueness constraint. */
async function write(store: storage.StoreType, claim: Parameters<storage.StoreType['transaction']>[0], id: string) {
	return await store.transaction(claim, { key: id, input: id, result: schema.string() }, async (tx, receipt) => {
		const prior = await receipt.get();
		if (prior !== undefined) return prior;
		await tx`insert into test_writes values (${id},${'payload:' + id})`;
		await tx`select pg_sleep(0.003)`;
		return await receipt.save(id);
	});
}

describe('PostgreSQL load and ambiguous commit checks', { concurrency: false, timeout: 240000 }, () => {
	for (const producers of [2, 8]) {
		it(`reconciles every guarded write with ${producers} producers sharing two connections through primary loss`, async () => {
			const run = await evidence(`postgres-load-${producers}`);
			await using database = await cluster(run.save);
			const pool = database.pool(2);
			await pool`create table test_writes (id text, payload text)`;
			const { store, jobs, namespace } = await claims(pool, producers);
			await using _owner = store;
			const started = performance.now(), deadline = started + 60000;
			const ids: string[] = [], latencies: number[] = [];
			const samples: Array<{ second: number; completed: number; errors: number; active: number; rss: number }> = [];
			const errors: Record<string, number> = {};
			let active = 0, maximum = 0, running = true;
			const sample = setInterval(
				() =>
					samples.push({
						second: Math.floor((performance.now() - started) / 1000),
						completed: ids.length,
						errors: Object.values(errors).reduce((sum, count) => sum + count, 0),
						active,
						rss: process.memoryUsage().rss,
					}),
				1000,
			);
			const writers = Promise.allSettled(jobs.map(async (job, producer) => {
				let sequence = 0;
				while (running && sequence < 10000 && performance.now() < deadline) {
					const id = `${producer}:${sequence++}`, entered = performance.now();
					for (let attempt = 0;; attempt++) {
						active++;
						maximum = Math.max(maximum, active);
						try {
							expect((await write(store, job.claim, id)).value).toBe(id);
							ids.push(id);
							latencies.push(performance.now() - entered);
							break;
						} catch (error) {
							const code = error !== null && typeof error === 'object' && 'code' in error
								? String(error.code)
								: 'unknown';
							errors[code] = (errors[code] ?? 0) + 1;
							if (
								!/^(?:CONNECTION_(?:CLOSED|DESTROYED|ENDED)|CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|57P01|57P02|57P03)$/u
									.test(code) ||
								attempt >= 400 || performance.now() - entered > 20000
							) throw error;
						} finally {
							active--;
						}
						// Retry the same receipt identity, with a finite budget and no second in-flight operation per producer.
						await delay(50);
					}
					await delay(4);
				}
			}));
			// Attach a rejection observer before waiting on the fault schedule; no failed producer is hidden.
			const outcome = writers.then((results) => {
				const failed = results.filter((result) => result.status === 'rejected');
				return failed.length === 0
					? undefined
					: new AggregateError(failed.map((result) => result.reason), 'A load producer failed.');
			});
			try {
				await delay(8000);
				// Establish committed work from every producer before the fault. A fixed
				// throughput target tests machine speed, not recovery correctness.
				await until(
					async () => jobs.every((_, producer) => ids.some((id) => id.startsWith(`${producer}:`))),
					'every producer has committed a guarded write before primary loss',
				);
				await until(async () => active > 0, 'writes are in flight at primary loss');
				await database.kill();
				await delay(3000);
				await database.promote();
				const failure = await outcome;
				if (failure !== undefined) throw failure;
				const rows = await pool`select id,payload from test_writes order by id`;
				expect(rows).toEqual(ids.toSorted().map((id) => ({ id, payload: 'payload:' + id })));
				expect(
					(await pool`select count(*)::integer as count from utils_workflow.receipts where namespace=${namespace}`)[0]!
						.count,
				).toBe(ids.length);
				expect(new Set(ids).size).toBe(ids.length);
				expect(Object.values(errors).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
				expect(
					samples.filter((value, index) => value.second >= 15 && value.completed > (samples[index - 1]?.completed ?? 0))
						.length,
				).toBeGreaterThanOrEqual(30);
				expect(maximum).toBeLessThanOrEqual(producers);
			} finally {
				running = false;
				await outcome;
				clearInterval(sample);
				latencies.sort((left, right) => left - right);
				await run.save('result.json', {
					image: PostgresImage,
					durationMs: performance.now() - started,
					producers,
					connections: 2,
					maximum,
					completed: ids.length,
					errors,
					samples,
					latencyMs: {
						p50: latencies[Math.floor(latencies.length * .5)],
						p95: latencies[Math.floor(latencies.length * .95)],
						p99: latencies[Math.floor(latencies.length * .99)],
					},
					ids,
				});
			}
		});
	}

	it('distinguishes rollback from a lost successful COMMIT reply and reconciles on the promoted writer', async () => {
		const run = await evidence('postgres-commit');
		await using database = await cluster(run.save);
		const pool = database.pool(2);
		await pool`create table test_writes (id text, payload text)`;
		await using fault = await proxy(database.primary.getHost(), database.primary.getMappedPort(5432));
		const borrowed = postgres(fault.url, { max: 1, ssl: false, connect_timeout: 2, onnotice() {} });
		await using _connection = { [Symbol.asyncDispose]: () => borrowed.end({ timeout: 2 }) };
		const { store, jobs } = await claims(borrowed, 1);
		await using writer = store;
		const attempts: Array<{ id: string; error: string }> = [];
		const trials: Array<{ id: string; mode: 'before' | 'after'; visibleBeforePromotion: boolean }> = [];
		try {
			for (const mode of ['before', 'after'] as const) {
				for (let index = 0; index < 3; index++) {
					const id = `${mode}:${index}`;
					fault.arm(mode);
					const result = await write(writer, jobs[0]!.claim, id).then(
						() => 'unexpected success',
						(error: unknown) => String(error),
					);
					attempts.push({ id, error: result });
					expect(result).not.toBe('unexpected success');
					expect(fault.events.at(-1)?.mode).toBe(mode);
					const observed = await store.getReceipt(jobs[0]!.claim, { key: id, input: id, result: schema.string() });
					expect(observed?.value).toBe(mode === 'after' ? id : undefined);
					expect(await pool`select id,payload from test_writes where id=${id}`).toEqual(
						mode === 'after' ? [{ id, payload: 'payload:' + id }] : [],
					);
					trials.push({ id, mode, visibleBeforePromotion: observed !== undefined });
				}
			}
			await database.kill();
			await database.promote();
			fault.target(database.replica.getHost(), database.replica.getMappedPort(5432));
			await until(async () => {
				await borrowed`select 1`;
				return true;
			}, 'same receipt owner reconnects through redirected proxy');
			await until(
				async () => (await pool`select pg_is_in_recovery() as recovery`)[0]?.recovery === false,
				'existing reconciliation pool reaches new writer',
			);
			for (const trial of trials) {
				const options = { key: trial.id, input: trial.id, result: schema.string() };
				expect((await store.getReceipt(jobs[0]!.claim, options))?.value).toBe(
					trial.mode === 'after' ? trial.id : undefined,
				);
				// Concurrent reconciliation uses the same identity and current claim. Its receipt lock serializes the two writes.
				const values = await Promise.all([
					write(store, jobs[0]!.claim, trial.id),
					write(store, jobs[0]!.claim, trial.id),
				]);
				expect(values.map((value) => value.value)).toEqual([trial.id, trial.id]);
				await expect(store.getReceipt(jobs[0]!.claim, { ...options, input: 'changed' })).rejects.toMatchObject({
					code: 'receipt_conflict',
				});
			}
			expect(await pool`select id,payload from test_writes order by id`).toEqual(
				trials.map(({ id }) => id).toSorted().map((id) => ({ id, payload: 'payload:' + id })),
			);
			expect(
				(await pool`select count(*)::integer as count from utils_workflow.receipts where namespace=${store.namespace}`)[
					0
				]!.count,
			).toBe(trials.length);
		} finally {
			await run.save('result.json', {
				image: PostgresImage,
				trials,
				attempts,
				faults: fault.events,
				diagnostics: fault.diagnostics,
			});
		}
	});
});
