import { bench, do_not_optimize, group, run } from 'mitata';

import * as context from '@okikio/context';
import * as queue from './mod.ts';

const ITEMS = 1_000;

/** Create deterministic queue identities so the benchmark measures queue coordination rather than UUID generation. */
function ids(): () => string {
	let next = 0;
	return () => `benchmark-${++next}`;
}

group('memory queue lifecycle', () => {
	bench('queue.memory: add + claim + complete 1k items', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'queue-benchmark', clock });
		await using jobs = queue.memory<number, number>({ clock, id: ids() });

		for (let index = 0; index < ITEMS; index += 1) await jobs.add(ctx, index);
		const claims = await jobs.claim(ctx, { limit: ITEMS, owner: 'benchmark' });
		for (const claim of claims) await jobs.complete(ctx, claim, claim.value);
		do_not_optimize(jobs.stats());
	});

	bench('array push + shift baseline: 1k items', () => {
		const values: number[] = [];
		for (let index = 0; index < ITEMS; index += 1) values.push(index);
		while (values.length > 0) do_not_optimize(values.shift());
	});
});

await run();
