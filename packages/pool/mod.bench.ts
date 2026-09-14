import { bench, do_not_optimize, group, run } from 'mitata';

import * as context from '@okikio/context';
import * as pool from './mod.ts';

const OPERATIONS = 100;
await using ctx = context.create({ id: 'pool-benchmark', clock: new context.TestClock() });
await using values = await pool.create({
	ctx,
	minimum: 8,
	maximum: 8,
	create: () => ({}),
	close: () => {},
});
const direct = {};

/** Exercise the reusable path once before timing and reject a leaked lease. */
async function cycle(): Promise<pool.Stats> {
	for (let index = 0; index < OPERATIONS; index += 1) {
		const lease = await values.acquire(ctx);
		do_not_optimize(lease.value);
		await lease[Symbol.asyncDispose]();
	}
	return values.stats();
}

const initial = await cycle();
if (initial.leased !== 0 || initial.idle !== 8) throw new Error('Warm pool benchmark did not return every leased value.');

group('pool warm reuse', () => {
	bench('pool.acquire/release: 100 operations, maximum 8', async () => {
		do_not_optimize(await cycle());
	});

	bench('direct reusable value read: 100 operations', () => {
		for (let index = 0; index < OPERATIONS; index += 1) do_not_optimize(direct);
	});
});

await run();
