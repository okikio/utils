/** Opt-in elapsed-time checks: bounded SQL writes and renewable claims across primary loss. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { it } from 'node:test';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect } from '@std/expect';
import { cluster, PostgresImage } from './fixtures/postgres.ts';
import { evidence } from './fixtures/evidence.ts';
import { admit, transient, write } from './fixtures/postgres-work.ts';

/** Short runs exercise the harness; only at least 7,200 elapsed seconds count as multi-hour evidence. */
function seconds(): number {
	const value = process.env.UTILS_POSTGRES_SOAK_SECONDS ?? '7200';
	if (!/^\d+$/u.test(value) || Number(value) < 90 || Number(value) > 14400) {
		throw new RangeError('UTILS_POSTGRES_SOAK_SECONDS must be an integer from 90 to 14400.');
	}
	return Number(value);
}

it('keeps exact SQL receipts and live leases throughout a PostgreSQL soak with midpoint promotion', {
	timeout: 15000000,
}, async () => {
	const durationMs = seconds() * 1000, producers = 8, leaseMs = 30000;
	const run = await evidence('postgres-soak');
	await using database = await cluster(run.save);
	const pool = database.pool(2);
	await pool`create table test_writes (id text, payload text)`;
	// A non-unique lookup index keeps final reconciliation bounded without suppressing duplicate inserts.
	await pool`create index test_writes_id on test_writes(id)`;
	const { store, host, jobs, namespace } = await admit(pool, producers, leaseMs, durationMs + 120000);
	await using owner = store;
	const started = performance.now(), deadline = started + durationMs;
	const stop = new AbortController();
	// Each producer advances only after a receipt is confirmed. Its counter also supplies the next write ID.
	const completed = Array<number>(producers).fill(0);
	// Fixed counters and histogram buckets replace per-write arrays; observation memory does not grow with duration.
	const buckets = [10, 25, 50, 100, 250, 500, 1000, 5000, 20000, Infinity];
	const histogram = Array<number>(buckets.length).fill(0);
	const errors: Record<string, number> = {};
	let running = true, renewals = 0, snapshots = 0, active = 0, maximum = 0;
	let promotedAt: number | undefined, lastProgress = started, lastTotal = 0, longestPauseMs = 0;
	let minimumLeaseMarginMs = Infinity;
	// Observation queries and journal writes take time too. Bound the actual gap
	// between completed samples instead of assuming a zero-cost ten-second timer.
	let lastObservation = started, longestObservationGapMs = 0;
	let lastAuthorityObservation = started, longestAuthorityGapMs = 0;
	const failures: unknown[] = [];
	await run.save('config.json', {
		image: PostgresImage,
		containers: { primary: database.primary.getId(), standby: database.replica.getId() },
		durationMs,
		producers,
		connections: 2,
		leaseMs,
		renewEveryMs: 2000,
		renewal: 'host-then-concurrent-claims',
		pauseMs: 250,
		namespace,
		host,
		pid: process.pid,
	});

	/** A failure stops admission and cancels the scheduled fault; all owned loops are still joined. */
	function launch(operation: () => Promise<void>): Promise<void> {
		return operation().catch((error: unknown) => {
			failures.push(error);
			running = false;
			stop.abort();
		});
	}
	/** Stop waiting on owned shutdown, but still report unrelated timer failures. */
	async function pause(milliseconds: number): Promise<void> {
		try {
			await delay(milliseconds, undefined, { signal: stop.signal });
		} catch (error) {
			if (!stop.signal.aborted) throw error;
		}
	}
	/**
	 * Retry a replay-safe operation for at most 20 seconds or 400 retries.
	 * The caller must retain its write ID or registration identity across retries.
	 * A lost reply can mean the operation committed; it does not prove rollback.
	 */
	async function retry(operation: () => Promise<unknown>): Promise<void> {
		const entered = performance.now();
		for (let attempt = 0;; attempt++) {
			try {
				await operation();
				return;
			} catch (error) {
				const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
				errors[code] = (errors[code] ?? 0) + 1;
				if (!transient(error) || attempt >= 400 || performance.now() - entered > 20000 || !running) throw error;
				await pause(50);
			}
		}
	}
	// Keep one write in flight per producer. Retry the same ID before admitting its successor.
	const writers = jobs.map((job, producer) =>
		launch(async () => {
			while (running && performance.now() < deadline) {
				const id = `${producer}:${completed[producer]}`, entered = performance.now();
				active++;
				maximum = Math.max(maximum, active);
				try {
					await retry(async () => expect((await write(owner, job.claim, id)).value).toBe(id));
					completed[producer]!++;
					histogram[buckets.findIndex((upper) => performance.now() - entered <= upper)]!++;
					const now = performance.now();
					longestPauseMs = Math.max(longestPauseMs, now - lastProgress);
					lastProgress = now;
				} finally {
					active--;
				}
				await pause(250);
			}
		})
	);
	// This explicit loop tests the store renewal API, not the workflow scheduler.
	const renewal = launch(async () => {
		while (running) {
			await retry(async () => {
				// Attempt renewal also checks host authority. Renew the host first; neither operation revives an expired owner.
				const entered = performance.now();
				await owner.renewHost(host, leaseMs);
				const hostMs = performance.now() - entered;
				// Independent claims enter the two-connection queue together. Serial
				// admission would make every claim wait behind another batch of writes.
				const claimMs = Array<number>(jobs.length).fill(0);
				const results = await Promise.allSettled(jobs.map(async (job, index) => {
					const claimStarted = performance.now();
					try {
						await owner.renew(job.claim);
					} finally {
						claimMs[index] = performance.now() - claimStarted;
					}
				}));
				await appendFile(
					join(run.directory, 'renewals.jsonl'),
					JSON.stringify({
						elapsedMs: performance.now() - started,
						durationMs: performance.now() - entered,
						hostMs,
						claimMs,
						outcomes: results.map((result) => result.status === 'fulfilled' ? 'renewed' : String(result.reason)),
					}) + '\n',
				);
				// Join every admitted renewal before retry or shutdown. A permanent
				// authority failure takes precedence over a concurrent connection loss.
				const rejected = results.filter((result) => result.status === 'rejected');
				const failure = rejected.find((result) => !transient(result.reason)) ?? rejected[0];
				if (failure) throw failure.reason;
			});
			renewals++;
			await pause(2000);
		}
	});
	// Sample saved authority and process memory without retaining a growing list of samples.
	const observations = launch(async () => {
		while (running) {
			await pause(10000);
			if (!running) break;
			let state: unknown;
			try {
				// Valid renewal must keep recovery from replacing any of the original claims.
				await owner.recover(64);
				const rows =
					await pool`select min(extract(epoch from (expires-clock_timestamp()))*1000)::float8 as margin, count(*)::integer as claimed, max(generation)::integer as generation from utils_workflow.jobs where namespace=${namespace} and state='claimed'`;
				const connections =
					await pool`select count(*)::integer as count from pg_stat_activity where datname=current_database()`;
				expect(rows[0]!.claimed).toBe(producers);
				expect(rows[0]!.generation).toBe(1);
				expect(rows[0]!.margin).toBeGreaterThan(0);
				minimumLeaseMarginMs = Math.min(minimumLeaseMarginMs, rows[0]!.margin);
				state = { jobs: rows[0], databaseConnections: connections[0]!.count };
			} catch (error) {
				if (!transient(error)) throw error;
				state = { unavailable: String(error) };
			}
			const total = completed.reduce((sum, value) => sum + value, 0);
			const elapsedMs = performance.now() - started;
			const observationGapMs = performance.now() - lastObservation;
			longestObservationGapMs = Math.max(longestObservationGapMs, observationGapMs);
			lastObservation = performance.now();
			// This bounds monitor liveness, not lease authority. Writers and renewal
			// still fail closed on expired claims between these SQL observations.
			const authorityGapMs = performance.now() - lastAuthorityObservation;
			expect(authorityGapMs).toBeLessThan(60000);
			if (state && typeof state === 'object' && 'jobs' in state) {
				longestAuthorityGapMs = Math.max(longestAuthorityGapMs, authorityGapMs);
				lastAuthorityObservation = performance.now();
			}
			expect(performance.now() - lastProgress).toBeLessThan(25000);
			const snapshot = {
				elapsedMs,
				completed: [...completed],
				total,
				intervalWrites: total - lastTotal,
				observationGapMs,
				authorityGapMs,
				renewals,
				active,
				rss: process.memoryUsage().rss,
				heapUsed: process.memoryUsage().heapUsed,
				state,
			};
			// The journal survives process loss. Do not retain an ever-growing samples array in memory.
			await appendFile(join(run.directory, 'progress.jsonl'), JSON.stringify(snapshot) + '\n');
			await run.save('progress.json', snapshot);
			lastTotal = total;
			snapshots++;
			console.log(`Soak ${Math.floor(elapsedMs / 1000)}s: ${total} writes, ${renewals} renewal rounds.`);
		}
	});
	// Inject one midpoint outage while the original client pools and producer loops remain alive.
	const fault = launch(async () => {
		await pause(durationMs / 2);
		if (!running) return;
		expect(completed.every((count) => count > 0)).toBe(true);
		await database.kill();
		await run.save('fault.json', { killedAtMs: performance.now() - started, outageMs: 3000 });
		await pause(3000);
		await database.promote();
		promotedAt = performance.now() - started;
		await run.save('promotion.json', { promotedAtMs: promotedAt });
	});
	try {
		await Promise.all(writers);
	} finally {
		running = false;
		stop.abort();
		await Promise.all([renewal, observations, fault]);
		longestAuthorityGapMs = Math.max(longestAuthorityGapMs, performance.now() - lastAuthorityObservation);
		// This snapshot is not a pass: exact SQL reconciliation below must still succeed.
		await run.save('result.json', {
			status: failures.length ? 'failed' : 'reconciling',
			durationMs,
			elapsedMs: performance.now() - started,
			completed,
			renewals,
			snapshots,
			maximum,
			errors,
			promotedAtMs: promotedAt,
			minimumLeaseMarginMs,
			longestPauseMs,
			longestObservationGapMs,
			longestAuthorityGapMs,
			latencyBucketsMs: buckets.map((value) => Number.isFinite(value) ? value : 'infinity'),
			histogram,
			failures: failures.map(String),
		});
	}
	if (failures.length) {
		throw new AggregateError(failures, 'PostgreSQL soak failed; inspect retained progress and SQL dump.');
	}
	expect(performance.now() - started).toBeGreaterThanOrEqual(durationMs);
	expect(promotedAt).toBeDefined();
	expect(renewals).toBeGreaterThan(durationMs / leaseMs);
	expect(snapshots).toBeGreaterThan(0);
	// Include the final unsampled tail in the monitor-liveness check.
	expect(performance.now() - lastAuthorityObservation).toBeLessThan(60000);
	expect(maximum).toBeLessThanOrEqual(producers);
	// Verify every expected ID in SQL rather than downloading all rows into Node.
	// Workflow receipt values use the explicit { kind: value, value: result } durable envelope.
	for (let producer = 0; producer < producers; producer++) {
		const job = jobs[producer]!;
		const invalid = await pool`
            select count(*)::integer as count
            from generate_series(0, ${completed[producer]! - 1}) s
            where (
                select count(*) from test_writes w
                where w.id=${String(producer)} || ':' || s::text
                and w.payload='payload:' || w.id
            ) <> 1 or not exists (
                select 1 from utils_workflow.receipts r
                where r.namespace=${namespace} and r.job=${job.claim.jobId}
                and r.key=${String(producer)} || ':' || s::text
                and r.value=jsonb_build_object('kind', 'value', 'value', r.key)
            )`;
		expect(invalid[0]!.count).toBe(0);
	}
	// Per-ID checks detect missing or changed writes; totals also detect unexpected extra rows.
	const total = completed.reduce((sum, value) => sum + value, 0);
	expect((await pool`select count(*)::integer as count from test_writes`)[0]!.count).toBe(total);
	expect(
		(await pool`select count(*)::integer as count from utils_workflow.receipts where namespace=${namespace}`)[0]!.count,
	).toBe(total);
	await run.save('reconciliation.json', {
		status: 'passed',
		total,
		exactIdsPayloadsAndReceipts: true,
		multiHour: durationMs >= 7200000,
		elapsedMs: performance.now() - started,
	});
});
