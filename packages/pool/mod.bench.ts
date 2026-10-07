import { run } from '../../bench/run.ts';
import { bench, do_not_optimize, group } from 'mitata';

import * as context from '@okikio/context';
import * as pool from './mod.ts';

const OPERATIONS = 100;
await using ctx = context.create({ id: 'pool-benchmark', clock: new context.TestClock() });
await using values = await pool.create({
	ctx,
	minimum: 8,
	maximum: 8,
	create: () => ({ ready: true }),
	close: () => {},
});
const direct = {};

/** Exercise the reusable path once before timing and reject a leaked lease. */
async function cycle(verify = false): Promise<pool.Stats> {
	for (let index = 0; index < OPERATIONS; index += 1) {
		const lease = await values.acquire(ctx);
		if (verify && lease.value.ready !== true) throw new Error('Pool returned an invalid resource.');
		do_not_optimize(lease.value);
		await lease[Symbol.asyncDispose]();
	}
	return values.stats();
}

const initial = await cycle(true);
if (initial.leased !== 0 || initial.idle !== 8) {
	throw new Error('Warm pool benchmark did not return every leased value.');
}

group('pool warm reuse', () => {
	bench('pool.acquire/release: 100 operations, maximum 8', async () => {
		do_not_optimize(await cycle());
	});
});

group('value-read primitive cost reference', () => {
	bench('direct reusable value read: 100 operations', () => {
		for (let index = 0; index < OPERATIONS; index += 1) do_not_optimize(direct);
	});
});

await run();
