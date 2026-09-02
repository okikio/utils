import { bench, do_not_optimize, group, run } from 'mitata';

import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
import * as queue from '@okikio/queue';

const JOBS = 100;

group('bounded coordination', () => {
	bench('100 queue jobs through a four-resource pool', async () => {
		const clock = new context.TestClock();
		await using owner = context.create({ id: 'coordination-bench', clock });
		let next = 0;
		await using providers = await pool.create({
			ctx: owner,
			minimum: 4,
			maximum: 4,
			create: () => ({ id: ++next }),
			close: () => {},
		});
		await using jobs = queue.memory<number, number>({ clock });
		for (let index = 0; index < JOBS; index += 1) await jobs.add(owner, index);
		const claims = await jobs.claim(owner, { limit: JOBS, owner: 'bench' });
		await Promise.all(claims.map(async (claim) => {
			await using lease = await providers.acquire(owner);
			await jobs.complete(owner, claim, claim.value + lease.value.id);
		}));
		do_not_optimize([await jobs.stats(), providers.stats()]);
	}).gc('once');
});

await run();
