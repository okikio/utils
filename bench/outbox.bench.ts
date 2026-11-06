// @benchmark optional
/**
 * Measure SQL acceptance, claiming, acknowledgement and retention for sixteen messages.
 * Compare claim batches of one and sixteen with the same payload and total work.
 * Pool construction and migration are outside timing; each sample removes its rows.
 * This excludes sink execution, transport, process recovery and memory test.
 * @module
 */
import '@okikio/dispose/polyfill';
import process from 'node:process';
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import postgres from 'postgres';
import * as outbox from '@okikio/storage/outbox/postgres';
import { run } from '#tools/bench/run.ts';

const url = process.env.UTILS_BENCH_DATABASE_URL;
if (!url) throw new Error('Set UTILS_BENCH_DATABASE_URL to an explicitly disposable PostgreSQL database.');
const database = postgres(url, { max: 4, onnotice() {} });
/** Dispose SQL fixture rows before the pool, preserving operation and cleanup failures. */
await using owners = new AsyncDisposableStack();
owners.defer(() => database.end({ timeout: 2 }));
/** Reuse the same finite JSON payload: allocation and corpus creation are not the SQL question. */
const messages = Array.from({ length: 16 }, (_, index) => ({
	id: 'bench.saved.v1',
	key: String(index),
	value: { index, text: 'x'.repeat(4096) },
}));

await outbox.migrate({ database });
for (const limit of [1, 16]) {
	const namespace = `outbox-bench-${crypto.randomUUID()}`;
	// Register each namespace separately so one failed cleanup cannot skip the
	// other namespaces or the pool. Async disposal retains both failures.
	owners.defer(async () => {
		await database.begin(async (tx) => {
			await tx`delete from utils_outbox.messages where namespace=${namespace}`;
			await tx`delete from utils_outbox.policies where namespace=${namespace}`;
		});
	});
	const box = outbox.open({ database, namespace, maximum: 16 });
	/** Include the complete stored lifetime; retention cannot accumulate between samples. */
	const cycle = async (verify = false): Promise<number> => {
		await database.begin(async (tx) => {
			for (const message of messages) await box.append(tx, message);
		});
		let completed = 0;
		const observed = verify ? new Set<string>() : undefined;
		while (completed < messages.length) {
			const claims = await box.claim({ limit });
			if (claims.length !== Math.min(limit, messages.length - completed)) {
				throw new Error('Outbox benchmark lost a message or retained an earlier claim.');
			}
			for (const claim of claims) {
				if (observed) {
					// Counts alone cannot detect a duplicated key or payload attached to
					// the wrong occurrence. Compare each consumer-visible message once.
					if (observed.has(claim.key)) throw new Error('Outbox benchmark redelivered a completed key.');
					observed.add(claim.key);
					deepStrictEqual({ id: claim.id, key: claim.key, value: claim.value }, messages[Number(claim.key)]);
				}
				await box.complete(claim);
			}
			completed += claims.length;
		}
		// Every row is terminal. A future cutoff removes this sample's dedupe
		// history so the next sample may reuse its fixed occurrence keys.
		const removed = await box.prune(Number.MAX_SAFE_INTEGER, messages.length);
		if (removed !== messages.length) throw new Error('Outbox benchmark retained sample history.');
		do_not_optimize(completed);
		return completed;
	};

	if (await cycle(true) !== 16) throw new Error('Outbox benchmark work oracle failed.');
	// Inspect exact retention outside timing, including in --check mode.
	const rows = await database`select count(*)::int as count from utils_outbox.messages where namespace=${namespace}`;
	if (rows[0]!.count !== 0) throw new Error('Outbox benchmark cleanup oracle failed.');
	group(`sixteen 4 KiB SQL messages, claim batch ${limit}`, () => {
		bench('accept + claim + acknowledge + prune', cycle);
	});
}
await run();
