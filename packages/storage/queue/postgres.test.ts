import { after, before, describe, it } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import postgresjs from 'postgres';
import type { Sql, TransactionSql } from 'postgres';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { QueueCapacityError, QueueClosedError, QueueItemNotFoundError, StaleClaimError } from '@okikio/scheduler/queue';
import * as adapter from './postgres.ts';

const url = process.env.UTILS_QUEUE_DATABASE_URL;
let database: Sql;
const namespaces: string[] = [];

/** Each test owns an isolated namespace; the suite borrows one disposable database. */
function fixture(
	options: Partial<
		Pick<
			adapter.Options<ReturnType<typeof schema.string>, ReturnType<typeof schema.string>>,
			'capacity' | 'retention' | 'maximumBytes'
		>
	> = {},
) {
	const namespace = 'queue-test-' + crypto.randomUUID();
	namespaces.push(namespace);
	const configuration = {
		database,
		namespace,
		contract: 'text-v1',
		input: schema.string(),
		output: schema.string(),
		pollMilliseconds: 5,
		...options,
	};
	return { namespace, configuration, first: adapter.open(configuration), second: adapter.open(configuration) };
}

/** Explicit gates let tests hold a database lock or decoder without guessing when work has started. */
function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

/**
 * Observe or pause the real driver's transaction body without changing its SQL,
 * BEGIN options, COMMIT/ROLLBACK behavior, or borrowed connection ownership.
 */
function transactions(
	database: Sql,
	visit: (tx: TransactionSql, body: (tx: TransactionSql) => Promise<unknown>) => Promise<unknown>,
): Sql {
	return new Proxy(database, {
		get(target, key, receiver) {
			if (key !== 'begin') return Reflect.get(target, key, receiver);
			return (
				options: string | ((tx: TransactionSql) => Promise<unknown>),
				body?: (tx: TransactionSql) => Promise<unknown>,
			) =>
				target.begin(typeof options === 'string' ? options : '', async (tx) => {
					return await visit(tx, typeof options === 'function' ? options : body!);
				});
		},
	});
}

/** Wait only for a database-observable condition; a missing condition fails this regression promptly. */
async function until(read: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 2500;
	while (!await read()) {
		if (Date.now() >= deadline) throw new Error('Expected database condition did not appear.');
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
}

/** Keep a failed cancellation assertion from retaining the test's deliberately held lock forever. */
async function within<Value>(pending: Promise<Value>): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error('Owned cancellation did not settle.')), 2000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

describe('PostgreSQL queue authority', { skip: url === undefined, concurrency: false }, () => {
	before(async () => {
		database = postgresjs(url!, { max: 12, onnotice() {} });
		await adapter.migrate({ database });
	});

	after(async () => {
		if (database === undefined) return;
		try {
			for (const namespace of namespaces) {
				await database.unsafe('delete from utils_queue.items where namespace=$1', [namespace]);
				await database.unsafe('delete from utils_queue.policies where namespace=$1', [namespace]);
			}
		} finally {
			await database.end({ timeout: 2 });
		}
	});
	describe('schema migrations', () => {
		it('migrates idempotently and rejects future schema revisions', async () => {
			await Promise.all([adapter.migrate({ database }), adapter.migrate({ database })]);
			await database.unsafe('update utils_queue.version set revision=999 where id');
			try {
				await rejects(adapter.migrate({ database }), /Unsupported/);
			} finally {
				await database.unsafe('update utils_queue.version set revision=2 where id');
			}
		});

		it('upgrades an actual revision-one schema under the migration lock', async () => {
			await database.unsafe('alter table utils_queue.items drop column redriven_from');
			await database.unsafe('drop index utils_queue.queue_inspection');
			await database.unsafe('update utils_queue.version set revision=1 where id');
			await Promise.all([adapter.migrate({ database }), adapter.migrate({ database })]);
			strictEqual((await database.unsafe('select revision from utils_queue.version where id'))[0]!.revision, 2);
			await database.unsafe('select redriven_from from utils_queue.items limit 0');
		});
	});

	describe('admission and host fencing', () => {
		it('deduplicates concurrent admission and enforces a shared active limit', async () => {
			const { first, second } = fixture({ capacity: 1 });
			await using a = first;
			await using b = second;
			await using ctx = context.create({ id: 'queue-test' });
			const refs = await Promise.all([a.add(ctx, 'one', { key: 'same' }), b.add(ctx, 'ignored', { key: 'same' })]);
			deepStrictEqual(refs[0], refs[1]);
			await rejects(b.add(ctx, 'full'), QueueCapacityError);
			const [claim] = await b.claim(ctx);
			await a.complete(ctx, claim!, 'done');
			strictEqual(await b.result(ctx, refs[0]!), 'done');
			await a.add(ctx, 'next');
		});

		it('emits added only for a new item, including when independent hosts reuse a key', async () => {
			const { first, second } = fixture();
			await using a = first;
			await using b = second;
			await using ctx = context.create({ id: 'queue-admission-events' });
			const added: string[] = [];
			using _first = a.events.subscribe((event) => {
				if (event.type === 'added') added.push(event.itemId);
			});
			using _second = b.events.subscribe((event) => {
				if (event.type === 'added') added.push(event.itemId);
			});
			const ref = await a.add(ctx, 'first', { key: 'same-work' });
			const duplicates = await Promise.all([
				a.add(ctx, 'ignored', { key: 'same-work' }),
				b.add(ctx, 'also ignored', { key: 'same-work' }),
			]);
			deepStrictEqual(duplicates, [ref, ref]);
			deepStrictEqual(added, [ref.id]);
		});

		it('claims each row once across independent hosts and fences expired owners', async () => {
			const { first, second, namespace } = fixture();
			await using a = first;
			await using b = second;
			await using ctx = context.create({ id: 'parent' });
			await Promise.all(Array.from({ length: 40 }, (_, index) => a.add(ctx, String(index))));
			const [left, right] = await Promise.all([
				a.claim(ctx, { owner: 'left', limit: 25 }),
				b.claim(ctx, { owner: 'right', limit: 25 }),
			]);
			const all = [...left, ...right];
			strictEqual(all.length, 40);
			strictEqual(new Set(all.map((x) => x.itemId)).size, 40);
			const stale = all[0]!;
			await database.unsafe(
				"update utils_queue.items set expires=clock_timestamp()-interval '1 second' where namespace=$1 and id=$2",
				[namespace, stale.itemId],
			);
			const [recovered] = await b.claim(ctx, { ref: { id: stale.itemId }, owner: 'replacement' });
			strictEqual(recovered!.attempt, 2);
			await rejects(a.complete(ctx, stale, 'stale'), StaleClaimError);
			await rejects(a.cancel(ctx, stale, 'stale'), StaleClaimError);
			await rejects(a.renew(ctx, stale, { seconds: 1 }), StaleClaimError);
			await b.complete(ctx, recovered!, 'recovered');
			strictEqual(await a.result(ctx, { id: stale.itemId }), 'recovered');
		});

		it('preserves priority, FIFO ties, delayed retry and renewal', async () => {
			const { first } = fixture();
			await using jobs = first;
			await using ctx = context.create({ id: 'queue-test' });
			const one = await jobs.add(ctx, 'one', { priority: 1 });
			await jobs.add(ctx, 'two', { priority: 2 });
			await jobs.add(ctx, 'three', { priority: 2 });
			const claims = await jobs.claim(ctx, { limit: 3 });
			deepStrictEqual(claims.map((x) => x.value), ['two', 'three', 'one']);
			const renewed = await jobs.renew(ctx, claims[2]!, { seconds: 40 });
			ok(renewed.expiresAt.epochMilliseconds > claims[2]!.expiresAt.epochMilliseconds);
			await jobs.retry(ctx, renewed, { delay: { milliseconds: 20 } });
			deepStrictEqual(await jobs.claim(ctx, { ref: one }), []);
			const [retry] = await jobs.claim(ctx, { ref: one, wait: true });
			strictEqual(retry!.attempt, 2);
		});
	});

	describe('codecs, retention and pool ownership', () => {
		it('uses explicit codecs once per direction and restores decoded output after reopen', async () => {
			const namespace = 'queue-date-' + crypto.randomUUID();
			namespaces.push(namespace);
			let encodes = 0;
			let decodes = 0;
			const DateCodec = codec.define({
				decode: schema.define((value) => {
					if (typeof value !== 'string') schema.reject('Expected text.');
					decodes += 1;
					return new Date(value);
				}),
				encode: schema.define((value) => {
					if (!(value instanceof Date)) schema.reject('Expected a Date.');
					encodes += 1;
					return value.toISOString();
				}),
			});
			const options = { database, namespace, contract: 'date-v1', input: DateCodec, output: DateCodec };
			await using ctx = context.create({ id: 'queue-test' });
			const date = new Date('2026-11-01T00:00:00.000Z');
			const first = adapter.open(options);
			const ref = await first.add(ctx, date);
			await first.close();
			await using reopened = adapter.open(options);
			const [claim] = await reopened.claim(ctx);
			strictEqual(claim!.value.getTime(), date.getTime());
			await reopened.complete(ctx, claim!, date);
			strictEqual((await reopened.result(ctx, ref)).toISOString(), date.toISOString());
			strictEqual(encodes, 2);
			strictEqual(decodes, 2);
		});

		it('rejects policy conflicts and unsupported encoders before accepting work', async () => {
			const { configuration, first } = fixture();
			await using a = first;
			await a.stats();
			await using conflict = adapter.open({ ...configuration, capacity: 2 });
			await rejects(conflict.stats(), adapter.PolicyConflictError);
			const transform = schema.transform(schema.string(), (value) => Number(value));
			strictEqual((await first.stats()).queued, 0);
			await rejects(async () => adapter.open({ ...configuration, input: transform }), TypeError);
		});

		it('bounds encoded bytes and terminal retention without deleting active work', async () => {
			const { first, second, namespace } = fixture({
				maximumBytes: 32,
				retention: { limit: 1, duration: { seconds: 1 } },
			});
			await using a = first;
			await using b = second;
			await using ctx = context.create({ id: 'queue-test' });
			await rejects(a.add(ctx, 'x'.repeat(64)), RangeError);
			const firstRef = await a.add(ctx, 'first', { key: 'old' });
			await a.complete(ctx, (await a.claim(ctx))[0]!, 'done');
			const secondRef = await a.add(ctx, 'second');
			await b.complete(ctx, (await b.claim(ctx))[0]!, 'done2');
			await rejects(a.result(ctx, firstRef), QueueItemNotFoundError);
			const current = await a.add(ctx, 'active', { key: 'old' });
			ok(current.id !== firstRef.id);
			await database.unsafe(
				"update utils_queue.items set finished=clock_timestamp()-interval '2 seconds' where namespace=$1 and id=$2",
				[namespace, secondRef.id],
			);
			deepStrictEqual(await a.prune(), { deleted: 1, more: false });
			strictEqual((await a.stats()).queued, 1);
		});

		it('enforces terminal retention when independent completions overlap before commit', async () => {
			const { first, second, configuration } = fixture({ retention: { limit: 1 } });
			await using producer = first;
			await using reader = second;
			await using ctx = context.create({ id: 'concurrent-retention' });
			const old = await producer.add(ctx, 'old');
			const latest = await producer.add(ctx, 'latest');
			const independent = await producer.add(ctx, 'independent');
			const [oldClaim, latestClaim] = await producer.claim(ctx, { limit: 2 });
			await reader.stats();
			const beforeCommit = gate(), releaseCommit = gate(), peerStarted = gate();
			let peerPid = 0;
			// Both handles still execute the real SQL and transaction protocol. Only the first
			// COMMIT is paused, making its terminal row invisible to the peer's snapshot.
			const firstPool = transactions(database, async (tx, action) => {
				const value = await action(tx);
				beforeCommit.release();
				await releaseCommit.promise;
				return value;
			});
			const peerPool = transactions(database, async (tx, action) => {
				peerPid = (await tx.unsafe('select pg_backend_pid() as pid'))[0]!.pid;
				peerStarted.release();
				return await action(tx);
			});
			await using a = adapter.open({ ...configuration, database: firstPool });
			await using b = adapter.open({ ...configuration, database: peerPool });
			await Promise.all([a.stats(), b.stats()]);
			const firstResult = Promise.allSettled([a.complete(ctx, oldClaim!, 'old result')]);
			let peerResult: Promise<PromiseSettledResult<void>[]> | undefined;
			try {
				await within(beforeCommit.promise);
				const [independentClaim] = await within(reader.claim(ctx, { ref: independent }));
				strictEqual(independentClaim!.value, 'independent');
				let peerSettled = false;
				peerResult = Promise.allSettled([b.complete(ctx, latestClaim!, 'latest result')]).then((value) => {
					peerSettled = true;
					return value;
				});
				await within(peerStarted.promise);
				// A correct implementation may serialize terminal transitions. Observe that real
				// database wait rather than requiring both transactions to reach COMMIT together.
				await until(async () =>
					peerSettled || (await database.unsafe(
							"select pid from pg_stat_activity where pid=$1 and wait_event_type='Lock'",
							[peerPid],
						)).length === 1
				);
			} finally {
				releaseCommit.release();
			}
			deepStrictEqual((await firstResult).map((result) => result.status), ['fulfilled']);
			deepStrictEqual((await peerResult!).map((result) => result.status), ['fulfilled']);
			strictEqual((await reader.stats()).completed, 1);
			await rejects(reader.result(ctx, old), QueueItemNotFoundError);
			strictEqual(await reader.result(ctx, latest), 'latest result');
		});

		it('reports skipped terminal rows and finishes retention after external locks are released', async () => {
			const { first, second, namespace } = fixture({ retention: { limit: 1 } });
			await using a = first;
			await using b = second;
			await using ctx = context.create({ id: 'locked-retention' });
			const old = await a.add(ctx, 'old');
			await a.complete(ctx, (await a.claim(ctx))[0]!, 'old result');
			const latest = await a.add(ctx, 'latest');
			const [claim] = await a.claim(ctx);
			const entered = gate(), release = gate();
			const blocker = database.begin(async (tx) => {
				await tx.unsafe('select id from utils_queue.items where namespace=$1 and id=$2 for update', [
					namespace,
					old.id,
				]);
				entered.release();
				await release.promise;
			});
			try {
				await within(entered.promise);
				await within(a.complete(ctx, claim!, 'latest result'));
				deepStrictEqual(await within(b.prune()), { deleted: 0, more: true });
				strictEqual((await b.stats()).completed, 2);
			} finally {
				release.release();
				await blocker;
			}
			deepStrictEqual(await b.prune(), { deleted: 1, more: false });
			await rejects(b.result(ctx, old), QueueItemNotFoundError);
			strictEqual(await b.result(ctx, latest), 'latest result');
		});

		it('owns transaction isolation without changing a borrowed pool default', async () => {
			const pool = postgresjs(url!, {
				max: 4,
				connection: { default_transaction_isolation: 'repeatable read' },
				onnotice() {},
			});
			try {
				const levels: string[] = [];
				const inspected = transactions(pool, async (tx, action) => {
					levels.push((await tx.unsafe('show transaction_isolation'))[0]!.transaction_isolation);
					return await action(tx);
				});
				await adapter.migrate({ database: inspected });
				const { first, second, configuration } = fixture();
				await first.close();
				await second.close();
				await using jobs = adapter.open({ ...configuration, database: inspected });
				await using ctx = context.create({ id: 'queue-isolation' });
				const ref = await jobs.add(ctx, 'work');
				const [claim] = await jobs.claim(ctx);
				await jobs.complete(ctx, claim!, 'done');
				await jobs.prune();
				strictEqual(await jobs.result(ctx, ref), 'done');
				deepStrictEqual(levels, Array(5).fill('read committed'));
				strictEqual(
					(await pool.unsafe('show default_transaction_isolation'))[0]!.default_transaction_isolation,
					'repeatable read',
				);
			} finally {
				await pool.end({ timeout: 2 });
			}
		});
	});

	describe('cancellation and transaction rollback', () => {
		it('cancels local waits and closes only the view, preserving the borrowed pool and persisted work', async () => {
			const { first, second } = fixture();
			const controller = new AbortController();
			await using a = first;
			await using b = second;
			await using ctx = context.create({ id: 'queue-wait', signal: controller.signal });
			const waiting = a.claim(ctx, { wait: true });
			controller.abort(new Error('stop waiting'));
			await rejects(waiting, /stop waiting/);
			await using next = context.create({ id: 'queue-test' });
			const ref = await a.add(next, 'saved');
			const blocked = a.result(next, ref);
			await a.close('view closed');
			await rejects(blocked, QueueClosedError);
			const [claim] = await b.claim(next);
			await b.complete(next, claim!, 'saved-done');
			strictEqual(await b.result(next, ref), 'saved-done');
			strictEqual((await database.unsafe('select 1 as alive'))[0]!.alive, 1);
		});

		it('cancels independent namespace initialization requests and joins close while registration is blocked', async () => {
			const { first, second, namespace, configuration } = fixture();
			await using a = first;
			await using b = second;
			const entered = gate(), release = gate();
			let blockerPid = 0;
			const blocker = database.begin(async (tx) => {
				blockerPid = (await tx.unsafe('select pg_backend_pid() as pid'))[0]!.pid;
				await tx.unsafe(
					'insert into utils_queue.policies(namespace,contract,capacity,retained,ttl) values($1,$2,10000,10000,86400000)',
					[namespace, configuration.contract],
				);
				entered.release();
				await release.promise;
			});
			await entered.promise;
			const controller = new AbortController(), reason = new Error('cancel only this initializer');
			await using cancelled = context.create({ id: 'cancelled-initializer', signal: controller.signal });
			await using remaining = context.create({ id: 'remaining-initializer' });
			const firstResult = Promise.allSettled([a.add(cancelled, 'first')]);
			const secondResult = Promise.allSettled([a.add(remaining, 'second')]);
			try {
				await until(async () =>
					(await database.unsafe('select pid from pg_stat_activity where $1::integer = any(pg_blocking_pids(pid))', [
						blockerPid,
					])).length === 2
				);
				controller.abort(reason);
				const [failed] = await within(firstResult);
				strictEqual(failed!.status, 'rejected');
				if (failed!.status === 'rejected') strictEqual(failed.reason, reason);
				// The other caller still owns its independent initialization query.
				strictEqual(
					(await database.unsafe('select pid from pg_stat_activity where $1::integer = any(pg_blocking_pids(pid))', [
						blockerPid,
					])).length,
					1,
				);
				await within(a.close());
				const [closed] = await within(secondResult);
				strictEqual(closed!.status, 'rejected');
				if (closed!.status === 'rejected') ok(closed.reason instanceof QueueClosedError);
			} finally {
				release.release();
				await blocker;
			}
			await b.add(remaining, 'still usable');
			strictEqual((await b.stats()).queued, 1);
		});

		it('rolls back claims when cancellation or close occurs during an awaited decoder', async () => {
			for (const cancellation of ['signal', 'close'] as const) {
				const { configuration, first, second } = fixture();
				await first.close();
				await second.close();
				const entered = gate(), release = gate();
				const input = codec.define({
					encode: schema.string(),
					decode: schema.defineAsync(async (value) => {
						entered.release();
						await release.promise;
						return schema.string().parse(value);
					}),
				});
				await using jobs = adapter.open({ ...configuration, input });
				await using producer = context.create({ id: 'decode-producer' });
				const controller = new AbortController(), reason = new Error('decode cancelled');
				await using consumer = context.create({ id: 'decode-consumer', signal: controller.signal });
				const ref = await jobs.add(producer, 'saved');
				const pending = Promise.allSettled([jobs.claim(consumer)]);
				await entered.promise;
				let closing: Promise<void> | undefined;
				try {
					if (cancellation === 'signal') controller.abort(reason);
					else {
						let settled = false;
						closing = jobs.close().then(() => {
							settled = true;
						});
						await Promise.resolve();
						strictEqual(settled, false);
					}
				} finally {
					release.release();
				}
				const [failed] = await pending;
				strictEqual(failed!.status, 'rejected');
				if (failed!.status === 'rejected') {
					if (cancellation === 'signal') strictEqual(failed.reason, reason);
					else ok(failed.reason instanceof QueueClosedError);
				}
				await closing;
				const [row] = await database.unsafe(
					'select state,attempt from utils_queue.items where namespace=$1 and id=$2',
					[
						configuration.namespace,
						ref.id,
					],
				);
				deepStrictEqual(row, { state: 'queued', attempt: 0 });
			}
		});

		it('rolls back a complete claim batch when a later payload decoder rejects', async () => {
			const { configuration, first, second } = fixture();
			await first.close();
			await second.close();
			let decodes = 0;
			const input = codec.define({
				encode: schema.string(),
				decode: schema.define((value) => {
					if (++decodes === 2) schema.reject('Second payload rejected.');
					return schema.string().parse(value);
				}),
			});
			await using jobs = adapter.open({ ...configuration, input });
			await using ctx = context.create({ id: 'batch-decode' });
			await jobs.add(ctx, 'first');
			await jobs.add(ctx, 'second');
			await rejects(jobs.claim(ctx, { limit: 2 }), schema.SchemaValidationError);
			const rows = await database.unsafe(
				'select state,attempt from utils_queue.items where namespace=$1 order by sequence',
				[configuration.namespace],
			);
			deepStrictEqual([...rows], [{ state: 'queued', attempt: 0 }, { state: 'queued', attempt: 0 }]);
		});

		it('rolls renewal back when the returned payload cannot be decoded', async () => {
			const { configuration, first, second } = fixture();
			await first.close();
			await second.close();
			let decodes = 0;
			const input = codec.define({
				encode: schema.string(),
				decode: schema.define((value) => {
					if (++decodes === 2) schema.reject('Renewal payload rejected.');
					return schema.string().parse(value);
				}),
			});
			await using jobs = adapter.open({ ...configuration, input });
			await using ctx = context.create({ id: 'renew-decode' });
			const ref = await jobs.add(ctx, 'saved');
			const [claim] = await jobs.claim(ctx, { duration: { seconds: 10 } });
			await rejects(jobs.renew(ctx, claim!, { seconds: 30 }), schema.SchemaValidationError);
			const [row] = await database.unsafe('select expires from utils_queue.items where namespace=$1 and id=$2', [
				configuration.namespace,
				ref.id,
			]);
			strictEqual((row!.expires as Date).getTime(), claim!.expiresAt.epochMilliseconds);
			const renewed = await jobs.renew(ctx, claim!, { seconds: 30 });
			await jobs.complete(ctx, renewed, 'done');
			strictEqual(await jobs.result(ctx, ref), 'done');
		});
	});

	describe('expiry, process recovery and inspection', () => {
		it('checks lease expiry after a competing row lock is released for every claim mutation', async () => {
			for (const mutation of ['complete', 'retry', 'renew', 'cancel'] as const) {
				const { first, second, namespace } = fixture();
				await using jobs = first;
				await using peer = second;
				await using ctx = context.create({ id: 'expiry-after-lock' });
				const ref = await jobs.add(ctx, 'saved');
				const [claim] = await jobs.claim(ctx, { duration: { milliseconds: 350 } });
				const entered = gate(), release = gate();
				let blockerPid = 0;
				const blocker = database.begin(async (tx) => {
					blockerPid = (await tx.unsafe('select pg_backend_pid() as pid'))[0]!.pid;
					await tx.unsafe('select id from utils_queue.items where namespace=$1 and id=$2 for update', [
						namespace,
						ref.id,
					]);
					entered.release();
					await release.promise;
				});
				await entered.promise;
				const pending = Promise.allSettled([
					mutation === 'complete'
						? jobs.complete(ctx, claim!, 'late')
						: mutation === 'retry'
						? jobs.retry(ctx, claim!)
						: mutation === 'renew'
						? jobs.renew(ctx, claim!, { seconds: 30 })
						: jobs.cancel(ctx, claim!, 'late'),
				]);
				try {
					await until(async () =>
						(await database.unsafe('select pid from pg_stat_activity where $1::integer = any(pg_blocking_pids(pid))', [
							blockerPid,
						])).length > 0
					);
					await until(async () =>
						(await database.unsafe(
							'select expires<=clock_timestamp() as expired from utils_queue.items where namespace=$1 and id=$2',
							[namespace, ref.id],
						))[0]!.expired === true
					);
				} finally {
					release.release();
					await blocker;
				}
				const [failed] = await pending;
				strictEqual(failed!.status, 'rejected', mutation);
				if (failed!.status === 'rejected') ok(failed.reason instanceof StaleClaimError, mutation);
				const [replacement] = await peer.claim(ctx, { ref });
				strictEqual(replacement!.attempt, 2);
			}
		});

		it('recovers a claim after the claiming process is killed', async () => {
			const { first, configuration } = fixture();
			await using jobs = first;
			await using ctx = context.create({ id: 'queue-test' });
			const ref = await jobs.add(ctx, 'crash-survivor');
			const child = spawn(process.env.UTILS_TEST_NODE ?? 'node', [
				'--import',
				fileURLToPath(import.meta.resolve('@okikio/duration/polyfill')),
				'--import',
				fileURLToPath(import.meta.resolve('@okikio/dispose/polyfill')),
				fileURLToPath(new URL('./fixtures/claim.ts', import.meta.url)),
				url!,
				configuration.namespace,
			], { stdio: ['ignore', 'pipe', 'pipe'] });
			let stderr = '';
			child.stderr.on('data', (chunk) => {
				stderr += String(chunk);
			});
			const announced = new Promise<void>((resolve, reject) => {
				child.stdout.on('data', (chunk) => {
					if (String(chunk).includes('claimed')) resolve();
				});
				child.once('error', reject);
				child.once('exit', () => reject(new Error('Claiming child exited early: ' + stderr)));
			});
			try {
				await announced;
			} finally {
				child.kill('SIGKILL');
				await once(child, 'exit');
			}
			const [replacement] = await jobs.claim(ctx, { ref, wait: true, duration: { seconds: 30 } });
			strictEqual(replacement!.attempt, 2);
			await jobs.complete(ctx, replacement!, 'recovered');
			strictEqual(await jobs.result(ctx, ref), 'recovered');
		});

		it('inspects bounded metadata pages and deduplicates concurrent redrive across real clients', async () => {
			const { first, second } = fixture();
			await using ctx = context.create({ id: 'queue-redrive-inspection' });
			await using a = first;
			await using b = second;
			const source = await a.add(ctx, 'private-source', { priority: 7 });
			await a.cancel(ctx, source);
			const copies = await Promise.all([
				a.redrive(ctx, source, { key: 'copy' }),
				b.redrive(ctx, source, { key: 'copy' }),
			]);
			strictEqual(copies[0]!.id, copies[1]!.id);
			ok(copies[0]!.id !== source.id);
			const options = { limit: 1, maximumScanned: 1 };
			const page = await a.inspect(options);
			strictEqual(page.entries[0]!.id, source.id);
			ok(page.cursor);
			const continuation = await b.inspect({ ...options, cursor: page.cursor! });
			strictEqual(continuation.entries[0]!.id, copies[0]!.id);
			strictEqual(continuation.entries[0]!.redrivenFrom, source.id);
			strictEqual(continuation.entries[0]!.attempt, 0);
			strictEqual(JSON.stringify(page).includes('private-source'), false);
			const [claim] = await b.claim(ctx);
			strictEqual(claim!.attempt, 1);
			await rejects(a.redrive(ctx, copies[0]!, { key: 'next' }), TypeError);
		});
	});
});
