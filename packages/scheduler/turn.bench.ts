/** Whole-chunk throughput and host progress are separate from raw microtask cost. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as scheduler from './mod.ts';

/** Fixed arithmetic work and result oracle, with optional host turns between chunks. */
async function work(cooperative: boolean): Promise<number> {
	let total = 0;
	for (let chunk = 0; chunk < 4; chunk++) {
		for (let index = 0; index < 10_000; index++) total += index;
		if (cooperative) await scheduler.yield();
	}
	return total;
}
for (const cooperative of [false, true]) {
	if (await work(cooperative) !== 199_980_000) throw new Error('CPU chunk oracle failed.');
}
group('four fixed CPU chunks; cooperative latency includes timer turns', () => {
	bench('uninterrupted', async () => do_not_optimize(await work(false)));
	bench('cooperative', async () => do_not_optimize(await work(true)));
});
await run();
