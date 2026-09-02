import { bench, do_not_optimize, group, run } from 'mitata';

import * as context from '@okikio/context';
import * as pool from './mod.ts';

const OPERATIONS = 100;

group('pool warm reuse', () => {
	bench('pool.acquire/release: 100 operations, maximum 8', async () => {
		await using ctx = context.create({ id: 'pool-benchmark', clock: new context.TestClock() });
		await using values = await pool.create({
			ctx,
			minimum: 8,
			maximum: 8,
			create: () => ({}),
			close: () => {},
		});

		for (let index = 0; index < OPERATIONS; index += 1) {
			const lease = await values.acquire(ctx);
			do_not_optimize(lease.value);
			await lease[Symbol.asyncDispose]();
		}
	});

	bench('direct reusable value read: 100 operations', () => {
		const value = {};
		for (let index = 0; index < OPERATIONS; index += 1) do_not_optimize(value);
	});
});

await run();
