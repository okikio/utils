/** Renew through a bounded outage, then prove that an expired owner cannot regain write permission. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { expect } from '@std/expect';
import { identity } from '@okikio/workflow/execution';
import { cluster, watch } from './fixtures/postgres.ts';
import { evidence, until } from './fixtures/evidence.ts';
import { admit, Local, transient, Work, write } from './fixtures/postgres-work.ts';

describe('PostgreSQL lease renewal through failover', { concurrency: false, timeout: 180000 }, () => {
	it('joins queued work after the owned server stops responding to client requests', async () => {
		const run = await evidence('postgres-client-silence');
		await using database = await cluster(run.save);
		const pool = database.pool(1);
		await pool`select 1`;
		// A paused server cannot execute statement_timeout or send a protocol reply.
		// Resume its physical owner before the outer fixture captures the SQL dump.
		await using _paused = await database.pause();
		const stop = new AbortController();
		const lastProgress = performance.now();
		const pending = pool.begin(async (tx) => await tx`select 2`);
		const watchdog = watch(pool, stop.signal, () => lastProgress, 500);
		const results = await Promise.allSettled([pending, watchdog]);
		stop.abort();
		expect(results[0]).toMatchObject({ status: 'rejected' });
		expect(results[1]).toMatchObject({
			status: 'rejected',
			reason: { message: 'No acknowledged write for 500 ms; closed the fixture-owned pool.' },
		});
		expect(pool.stats).toMatchObject({ connections: 0, waiting: 0 });
		// Fatal loop shutdown also joins the fixture's separate administration pools.
		await database.close();
		expect(database.direct.stats).toMatchObject({ connections: 0, waiting: 0 });
		expect(database.standby.stats).toMatchObject({ connections: 0, waiting: 0 });
		await run.save('result.json', {
			physicallyPaused: true,
			joined: true,
			pool: pool.stats,
			administrationClosed: true,
		});
	});

	it('bounds queued transactions without closing connections already owned by callers', async () => {
		const run = await evidence('postgres-pool-admission');
		await using database = await cluster(run.save);
		const pool = database.pool(2, 0.2);
		await using first = await pool.reserve();
		await using second = await pool.reserve();
		let entered = false;
		// Both connections remain borrowed. No server-side SQL timeout can bound
		// the third transaction because it has not acquired a connection yet.
		await expect(pool.begin(async () => {
			entered = true;
		})).rejects.toMatchObject({ code: 'QUEUE_TIMEOUT' });
		expect(entered).toBe(false);
		expect((await first`select 1 as value`)[0]!.value).toBe(1);
		expect((await second`select 2 as value`)[0]!.value).toBe(2);
		first.release();
		second.release();
		expect((await pool.begin(async (tx) => await tx`select 3 as value`))[0]!.value).toBe(3);
		await run.save('result.json', { rejectedBeforeAdmission: true, admittedConnectionsPreserved: true, reused: true });
	});

	it('serializes concurrent host renewals without converting shared locks into a deadlock', async () => {
		const run = await evidence('postgres-concurrent-renewal');
		await using database = await cluster(run.save);
		const pool = database.pool(2);
		await pool`create table test_writes (id text, payload text)`;
		const { store, host, jobs, namespace } = await admit(pool, 1, 30000, 180000);
		await using owner = store;
		// Four callers share two connections. Repeated overlap exercises renewal's initial lock mode.
		const failures: unknown[] = [];
		for (let round = 0; round < 8; round++) {
			const results = await Promise.allSettled(Array.from({ length: 4 }, () => owner.renewHost(host, 30000)));
			for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
		}
		await run.save('result.json', { attempts: 32, failures: failures.map(String) });
		expect(failures).toEqual([]);
		const live = await pool`select generation from utils_workflow.hosts where namespace=${namespace}
            and id=${host.id} and generation=${host.generation} and expires>clock_timestamp()`;
		expect(live).toEqual([{ generation: host.generation }]);
		expect((await write(owner, jobs[0]!.claim, 'after-renewal')).value).toBe('after-renewal');
	});

	it('renews host and attempt before expiry on the promoted writer', async () => {
		const run = await evidence('postgres-lease-renew');
		await using database = await cluster(run.save);
		const pool = database.pool(2);
		await pool`create table test_writes (id text, payload text)`;
		const { store, host, jobs, namespace } = await admit(pool, 1, 30000, 180000);
		await using owner = store;
		const claim = jobs[0]!.claim;
		await write(owner, claim, 'before');
		await owner.renewHost(host, 30000);
		await owner.renew(claim);
		const before = await pool`select expires from utils_workflow.jobs where namespace=${namespace}`;
		await database.kill();
		// Require an actual failed renewal while no primary exists, rather than inferring it from a timer.
		const rejected = await owner.renew(claim).then(() => undefined, (error: unknown) => error);
		expect(transient(rejected)).toBe(true);
		await delay(3000);
		await database.promote();
		await until(async () => {
			await owner.renewHost(host, 30000);
			await owner.renew(claim);
			return true;
		}, 'same host and attempt renew before their original expiry');
		const after = await pool`select expires from utils_workflow.jobs where namespace=${namespace}`;
		expect(after[0]!.expires.getTime()).toBeGreaterThan(before[0]!.expires.getTime());
		await write(owner, claim, 'after');
		expect(await pool`select id from test_writes order by id`).toEqual([{ id: 'after' }, { id: 'before' }]);
		await run.save('result.json', { before, after, host, claimSequence: claim.sequence, renewed: true });
	});

	it('rejects expired renewal and stale writes before and after a replacement claims the work', async () => {
		const run = await evidence('postgres-lease-expired');
		await using database = await cluster(run.save);
		const pool = database.pool(2);
		await pool`create table test_writes (id text, payload text)`;
		const { store, host, jobs, namespace } = await admit(pool, 1, 3000, 180000);
		await using owner = store;
		const old = jobs[0]!;
		await write(owner, old.claim, 'accepted');
		await database.kill();
		await delay(5000);
		await database.promote();
		await until(async () => {
			await pool`select 1`;
			return true;
		}, 'promoted writer is reachable');
		await expect(owner.renewHost(host, 3000)).rejects.toMatchObject({ code: 'stale_claim' });
		await expect(owner.renew(old.claim)).rejects.toMatchObject({ code: 'stale_claim' });
		await expect(write(owner, old.claim, 'forbidden-before')).rejects.toMatchObject({ code: 'stale_claim' });
		const replacement = await owner.register('replacement', [identity(Work)], Local.id, {
			activations: 1,
			activities: 1,
		}, 30000);
		await owner.recover(64);
		let current: Awaited<ReturnType<typeof owner.take>>;
		await until(async () => {
			current = await owner.take(replacement, [identity(Work)]);
			return current !== undefined;
		}, 'replacement obtains a new current claim');
		expect(current!.claim.sequence).toBe(old.claim.sequence + 1);
		await expect(write(owner, old.claim, 'forbidden-after')).rejects.toMatchObject({ code: 'stale_claim' });
		await write(owner, current!.claim, 'accepted');
		await write(owner, current!.claim, 'replacement');
		expect(await pool`select id from test_writes order by id`).toEqual([{ id: 'accepted' }, {
			id: 'replacement',
		}]);
		expect(
			(await pool`select count(*)::integer as count from utils_workflow.receipts where namespace=${namespace}`)[0]!
				.count,
		).toBe(2);
		await run.save('result.json', {
			oldSequence: old.claim.sequence,
			replacementSequence: current!.claim.sequence,
			staleWritesRejected: 2,
			originalReceiptReused: true,
		});
	});

	it('rejects an expired attempt after promotion even while its host registration remains live', async () => {
		const run = await evidence('postgres-attempt-expired');
		await using database = await cluster(run.save);
		const pool = database.pool(2);
		await pool`create table test_writes (id text, payload text)`;
		const { store, host, jobs, namespace } = await admit(pool, 1, 3000, 180000);
		await using owner = store;
		// Isolate attempt expiry: host authority remains valid throughout the five-second outage.
		await owner.renewHost(host, 30000);
		await database.kill();
		await delay(5000);
		await database.promote();
		await until(async () => {
			await pool`select 1`;
			return true;
		}, 'promoted writer is reachable');
		await owner.renewHost(host, 30000);
		await expect(owner.renew(jobs[0]!.claim)).rejects.toMatchObject({ code: 'stale_claim' });
		await expect(write(owner, jobs[0]!.claim, 'forbidden')).rejects.toMatchObject({ code: 'stale_claim' });
		expect((await pool`select count(*)::integer as count from test_writes`)[0]!.count).toBe(0);
		const state = await pool`
            select extract(epoch from (j.expires-clock_timestamp()))*1000 as attempt_margin,
                   extract(epoch from (h.expires-clock_timestamp()))*1000 as host_margin
            from utils_workflow.jobs j join utils_workflow.hosts h
            on h.namespace=j.namespace and h.id=j.host and h.generation=j.host_generation
            where j.namespace=${namespace}`;
		expect(Number(state[0]!.attempt_margin)).toBeLessThan(0);
		expect(Number(state[0]!.host_margin)).toBeGreaterThan(0);
		await run.save('result.json', { state, liveHostRenewed: true, expiredAttemptRejected: true });
	});
});
