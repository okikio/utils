import { bench, do_not_optimize, group } from 'mitata';

import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
import * as queue from '@okikio/queue';

const JOBS = 100;

/** Execute one bounded queue and pool lifecycle with counters retained as the benchmark oracle. */
async function cycle(
	verify = false,
): Promise<
	Readonly<{ readonly completed: number; readonly leased: number; readonly waiting: number; readonly closed: number }>
> {
	const clock = new context.TestClock();
	await using owner = context.create({ id: 'coordination-bench', clock });
	let next = 0;
	let closed = 0;
	await using providers = await pool.create({
		ctx: owner,
		minimum: 4,
		maximum: 4,
		create: () => ({ id: ++next }),
		close: () => {
			closed++;
		},
	});
	await using jobs = queue.memory<number, number>({ clock });
	const refs: queue.QueueRef[] = [];
	for (let index = 0; index < JOBS; index += 1) refs.push(await jobs.add(owner, index));
	const claims = await jobs.claim(owner, { limit: JOBS, owner: 'bench' });
	await Promise.all(claims.map(async (claim) => {
		await using lease = await providers.acquire(owner);
		await jobs.complete(owner, claim, claim.value + lease.value.id);
	}));
	if (verify) {
		for (let index = 0; index < refs.length; index += 1) {
			const value = await jobs.result(owner, refs[index]!);
			if (!Number.isInteger(value) || value < index + 1 || value > index + 4) {
				throw new Error('Coordination lost input/resource result correlation.');
			}
		}
	}
	const jobsStats = await jobs.stats();
	const poolStats = providers.stats();
	await providers[Symbol.asyncDispose]();
	return Object.freeze({
		closed,
		completed: jobsStats.completed,
		leased: poolStats.leased,
		waiting: poolStats.waiting,
	});
}

const initial = await cycle(true);
if (initial.completed !== JOBS || initial.leased !== 0 || initial.waiting !== 0 || initial.closed !== 4) {
	throw new Error('Coordination benchmark did not settle its bounded work set.');
}

group('bounded coordination', () => {
	bench('100 queue jobs through a four-resource pool', async () => {
		do_not_optimize(await cycle());
	}).gc('once');
});
