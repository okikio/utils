/** Compare public mapping with its existing owner under identical order and acknowledgement rules. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual } from 'node:assert';
import { map, mapPooledOrdered, mapPooledUnordered } from '@okikio/scheduler/concurrency';
import { run } from './fixtures/bench.ts';
for (const count of [1000, 10_000]) {
	const values = Array.from({ length: count }, (_, index) => index);
	for (const concurrency of [1, 8, 64]) {
		for (const ordering of ['input', 'completion'] as const) {
			const transform = async (value: number): Promise<number> => value * 2;
			const candidate = () => map(values, transform, { concurrency, maximumBuffered: concurrency, ordering });
			const baseline = () =>
				ordering === 'input'
					? mapPooledOrdered({ items: values, map: transform, concurrency })
					: mapPooledUnordered({ items: values, map: transform, concurrency, acknowledgeCompletions: true });
			/** Preflight checks exact multiplicity and input order; timing consumes without retaining every result. */
			const consume = async function (stream: AsyncIterable<number>, verify = false): Promise<number> {
				let sum = 0;
				let seen = 0;
				const collected: number[] | undefined = verify ? [] : undefined;
				for await (const value of stream) {
					sum += value;
					seen++;
					collected?.push(value);
				}
				if (collected) {
					if (ordering === 'completion') collected.sort((left, right) => left - right);
					deepStrictEqual(collected, values.map((value) => value * 2));
				}
				if (seen !== count || sum !== count * (count - 1)) throw new Error('Map output oracle failed.');
				return sum;
			};
			await consume(candidate(), true);
			await consume(baseline(), true);
			group(`${ordering} ${count} items, ${concurrency} admitted`, () => {
				bench('public map', async () => do_not_optimize(await consume(candidate())));
				bench('existing owner', async () => do_not_optimize(await consume(baseline())));
			});
		}
	}
}
await run();
