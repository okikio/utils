import { bench, do_not_optimize, group } from 'mitata';

import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
import * as queue from '@okikio/queue';

const JOBS = 100;

/** Execute one bounded queue and pool lifecycle with counters retained as the benchmark oracle. */
async function cycle(): Promise<Readonly<{ readonly completed: number; readonly leased: number; readonly waiting: number }>> {
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
	const jobsStats = await jobs.stats();
	const poolStats = providers.stats();
	return Object.freeze({ completed: jobsStats.completed, leased: poolStats.leased, waiting: poolStats.waiting });
}

const initial = await cycle();
if (initial.completed !== JOBS || initial.leased !== 0 || initial.waiting !== 0) {
	throw new Error('Coordination benchmark did not settle its bounded work set.');
}

group('bounded coordination', () => {
	bench('100 queue jobs through a four-resource pool', async () => {
		do_not_optimize(await cycle());
	}).gc('once');
});
