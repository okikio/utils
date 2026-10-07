import { run } from '../../bench/run.ts';
import { bench, do_not_optimize, group } from 'mitata';

import * as context from '@okikio/context';
import * as queue from './mod.ts';

const ITEMS = 1_000;

/** Create deterministic queue identities so the benchmark measures queue coordination rather than UUID generation. */
function ids(): () => string {
	let next = 0;
	return () => `benchmark-${++next}`;
}

/** Run the full owned queue lifecycle and expose its terminal counters to the oracle and timer. */
async function cycle(verify = false): Promise<queue.QueueStats> {
	const clock = new context.TestClock();
	await using ctx = context.create({ id: 'queue-benchmark', clock });
	await using jobs = queue.memory<number, number>({ clock, id: ids() });

	const refs: queue.QueueRef[] = [];
	for (let index = 0; index < ITEMS; index += 1) refs.push(await jobs.add(ctx, index));
	const claims = await jobs.claim(ctx, { limit: ITEMS, owner: 'benchmark' });
	if (verify && (claims.length !== ITEMS || !claims.every((claim, index) => claim.value === index))) {
		throw new Error('Queue benchmark lost FIFO values.');
	}
	for (const claim of claims) await jobs.complete(ctx, claim, claim.value);
	if (verify) {
		for (let index = 0; index < refs.length; index += 1) {
			if (await jobs.result(ctx, refs[index]!) !== index) throw new Error('Queue result belongs to the wrong item.');
		}
	}
	return await jobs.stats();
}

const initial = await cycle(true);
if (initial.completed !== ITEMS || initial.queued !== 0 || initial.claimed !== 0) {
	throw new Error('Queue lifecycle benchmark did not complete its fixed work set.');
}

group('memory queue lifecycle', () => {
	bench('queue.memory: add + claim + complete 1k items', async () => {
		do_not_optimize(await cycle());
	});
});

// This primitive omits claims, expiry, fencing, cancellation and completion storage.
// Keep it outside the lifecycle group so the report cannot imply equivalent work.
group('FIFO primitive cost reference', () => {
	bench('array FIFO primitive: enqueue + dequeue 1k values', () => {
		const values: number[] = [];
		for (let index = 0; index < ITEMS; index += 1) values.push(index);
		while (values.length > 0) do_not_optimize(values.shift());
	});
});

await run();
