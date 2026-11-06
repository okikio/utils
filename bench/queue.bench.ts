// @benchmark runner=queue
/**
 * Measure one finite PostgreSQL completion batch. Adaptive calibration would keep
 * creating durable work and hide per-operation contention; setup, verification
 * and cleanup therefore remain outside this explicitly bounded timed section.
 * Run through `mise run bench:queue`, which records provenance and fresh processes.
 * @module
 */
import { strictEqual } from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import type { Queue, QueueClaim, QueueRef } from '@okikio/scheduler/queue';

const [source, count, parallelism, namespace] = process.argv.slice(2);
const jobs = Number(count), concurrency = Number(parallelism);
if (
	!source || !/^utils-bench-queue-[0-9a-f-]{36}$/u.test(namespace ?? '') ||
	!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 10_000 ||
	!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > Math.min(jobs, 64)
) throw new TypeError('Queue workload requires source root, bounded jobs/concurrency, and an owned namespace.');
const databaseUrl = process.env.UTILS_TEST_DATABASE_URL;
if (!databaseUrl) {
	throw new TypeError('UTILS_TEST_DATABASE_URL must explicitly select a disposable PostgreSQL database.');
}

const report = {
	status: 'running' as 'running' | 'pass' | 'fail',
	namespace: namespace!,
	jobs,
	concurrency,
	retention: jobs,
	deadlineMilliseconds: 180_000,
	leaseMilliseconds: 300_000,
	runtime: {
		version: process.version,
		flags: process.execArgv,
		inheritedNodeOptionsPresent: Boolean(process.env.NODE_OPTIONS),
	},
	database: {} as Record<string, string>,
	preparedConnections: 0,
	wallMilliseconds: null as number | null,
	latencies: [] as { index: number; milliseconds: number }[],
	verified: 0,
	retained: null as number | null,
	cleanup: { namespaceRemoved: false, poolClosed: false },
	errors: [] as { phase: string; name: string; code?: string }[],
};
/** Raw report contract consumed by the repository benchmark controller. */
export type QueueBenchmarkReportType = typeof report;

const cancellation = new AbortController();
const deadline = setTimeout(
	() => cancellation.abort(new Error('Queue benchmark deadline exceeded.')),
	report.deadlineMilliseconds,
);
const terminate = () => cancellation.abort(new Error('Queue benchmark was terminated.'));
process.once('SIGTERM', terminate);
let database: Sql | undefined;
let queue: Queue<string, string> | undefined;
let migrated = false;
let phase = 'load-source';
try {
	// Node resolves each selected module's bare imports from that checkout's own
	// package links. The old source tree is neither rewritten nor remapped to ours.
	const root = pathToFileURL(resolve(source) + sep);
	await import(new URL('packages/duration/polyfill.ts', root).href);
	await import(new URL('packages/dispose/polyfill.ts', root).href);
	const context: typeof import('@okikio/context') = await import(new URL('packages/context/mod.ts', root).href);
	const schema: typeof import('@okikio/schema') = await import(new URL('packages/schema/mod.ts', root).href);
	const storage: typeof import('@okikio/storage/queue/postgres') = await import(
		new URL('packages/storage/queue/postgres.ts', root).href
	);
	database = postgresjs(databaseUrl, {
		max: Math.max(2, concurrency),
		connect_timeout: 5,
		connection: { statement_timeout: 30_000 },
		onnotice() {},
	});
	phase = 'database-settings';
	const settings = await database.unsafe(
		"select current_setting('server_version') as version,current_setting('fsync') as fsync,current_setting('synchronous_commit') as synchronous_commit,current_setting('full_page_writes') as full_page_writes,current_setting('default_transaction_isolation') as default_isolation",
	);
	for (const [key, value] of Object.entries(settings[0]!)) report.database[key] = String(value);
	phase = 'migrate';
	await storage.migrate({ database });
	migrated = true;
	phase = 'warm-connections';
	// Reserve every connection together so concurrent complete() calls cannot pay
	// for opening extra sockets in the timed batch. Always return acquired leases.
	const connections = await Promise.allSettled(Array.from({ length: concurrency }, () => database!.reserve()));
	try {
		for (const connection of connections) {
			if (connection.status === 'rejected') throw connection.reason;
			await connection.value.unsafe('select 1');
			report.preparedConnections += 1;
		}
	} finally {
		for (const connection of connections) {
			if (connection.status === 'fulfilled') connection.value.release();
		}
	}
	queue = storage.open({
		database,
		namespace: namespace!,
		contract: 'queue-completion-benchmark-v1',
		input: schema.string(),
		output: schema.string(),
		capacity: jobs,
		retention: { limit: jobs, duration: { hours: 1 } },
	});
	await using ctx = context.create({ id: namespace!, signal: cancellation.signal });
	phase = 'prepare';
	const refs: QueueRef[] = [];
	for (let index = 0; index < jobs; index += 1) refs.push(await queue.add(ctx, `job-${index}`));
	const claims: QueueClaim<string>[] = [];
	phase = 'claim';
	while (claims.length < jobs) {
		const batch = await queue.claim(ctx, {
			owner: namespace!,
			limit: Math.min(jobs - claims.length, 1000),
			duration: { milliseconds: report.leaseMilliseconds },
		});
		if (batch.length === 0) throw new Error('Prepared work was not claimable.');
		claims.push(...batch);
	}
	strictEqual(claims.length, jobs);
	let cursor = 0;
	const active = queue;
	phase = 'complete';
	const started = performance.now();
	const completions = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
		while (cursor < jobs) {
			const index = cursor++;
			const claim = claims[index]!;
			const before = performance.now();
			await active.complete(ctx, claim, `completed:${claim.value}`);
			report.latencies.push({ index, milliseconds: performance.now() - before });
		}
	}));
	report.wallMilliseconds = performance.now() - started;
	for (const completion of completions) {
		if (completion.status === 'rejected') throw completion.reason;
	}
	strictEqual(report.latencies.length, jobs);
	phase = 'verify-results';
	for (const [index, ref] of refs.entries()) {
		strictEqual(await queue.result(ctx, ref), `completed:job-${index}`);
		report.verified += 1;
	}
	phase = 'verify-counts';
	const stats = await queue.stats();
	strictEqual(stats.completed, jobs);
	strictEqual(
		stats.queued + stats.claimed + stats.failed + stats.cancelled + stats.waitingClaims + stats.waitingResults,
		0,
	);
	report.retained = Number(
		(await database.unsafe(
			'select count(*) as count from utils_queue.items where namespace=$1',
			[namespace!],
		))[0]!.count,
	);
	strictEqual(report.retained, jobs);
	report.status = 'pass';
} catch (error) {
	report.status = 'fail';
	report.errors.push(failure(phase, error));
} finally {
	clearTimeout(deadline);
	try {
		await queue?.close();
	} catch (error) {
		report.errors.push(failure('queue-close', error));
	}
	if (database !== undefined) {
		if (migrated) {
			try {
				await database.unsafe('delete from utils_queue.items where namespace=$1', [namespace!]);
				await database.unsafe('delete from utils_queue.policies where namespace=$1', [namespace!]);
				const rows = await database.unsafe(
					'select (select count(*) from utils_queue.items where namespace=$1) as items,(select count(*) from utils_queue.policies where namespace=$1) as policies',
					[namespace!],
				);
				strictEqual(Number(rows[0]!.items), 0);
				strictEqual(Number(rows[0]!.policies), 0);
				report.cleanup.namespaceRemoved = true;
			} catch (error) {
				report.errors.push(failure('namespace-cleanup', error));
			}
		}
		try {
			await database.end({ timeout: 5 });
			report.cleanup.poolClosed = true;
		} catch (error) {
			report.errors.push(failure('pool-close', error));
		}
	}
	process.removeListener('SIGTERM', terminate);
	if (report.errors.length > 0) report.status = 'fail';
}
report.latencies.sort((a, b) => a.index - b.index);
console.log(JSON.stringify(report));
if (report.status !== 'pass') process.exitCode = 1;

/** Keep driver credentials, connection strings and SQL parameters out of reports. */
function failure(phase: string, error: unknown): { phase: string; name: string; code?: string } {
	const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(error.name) ? error.name : 'Error';
	const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
	return { phase, name, ...(typeof code === 'string' && /^[0-9A-Z_]{1,32}$/u.test(code) ? { code } : {}) };
}
