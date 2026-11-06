/** Synchronous all-or-nothing leases versus the existing awaited FIFO admission path. @module */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as capacity from './capacity/mod.ts';

for (const dimensions of [2, 8, 64]) {
	const limits = Object.fromEntries(Array.from({ length: dimensions }, (_, i) => [`r${i}`, 2]));
	const request = Object.fromEntries(Object.keys(limits).map((key) => [key, 1]));
	const host = capacity.create(limits, { maximumPending: 0 });
	const lease = capacity.tryAcquire(host, request)!;
	strictEqual(capacity.inspect(host, limits, { maximumReasons: 1 }).truncated, dimensions > 1);
	strictEqual(capacity.tryAcquire(host, limits), undefined);
	lease.release();
	deepStrictEqual(capacity.available(host), limits);
	group(`immediate capacity ${dimensions} dimensions including release`, () => {
		bench('tryAcquire', () => {
			const lease = capacity.tryAcquire(host, request)!;
			lease.release();
			do_not_optimize(lease);
		});
		bench('await acquire without contention', async () => {
			const lease = await capacity.acquire(host, request);
			lease.release();
			do_not_optimize(lease);
		});
	});
}
await run();
