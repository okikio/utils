/** Scan and retention costs for bounded lazy de-duplication, including an early-exit workload. @module */
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as iterable from './iterable.ts';

for (const count of [1000, 100_000]) {
	for (const keys of [10, count]) {
		const values = Array.from({ length: count }, (_, i) => i % keys);
		const options = { maximumItems: count, maximumKeys: keys };
		const expected = [...new Set(values)];
		deepStrictEqual([...iterable.unique(values, (v) => v, options)], expected);
		group(`unique ${count} values ${keys} keys`, () => {
			bench('bounded iterator collected', () => do_not_optimize([...iterable.unique(values, (v) => v, options)]));
			bench('native Set collected without bounds', () => do_not_optimize([...new Set(values)]));
		});
	}
	const values = Array.from({ length: count }, (_, i) => i);
	deepStrictEqual(iterable.chunk(values, 64).next().value, values.slice(0, 64));
	group(`first chunk of ${count} values`, () => {
		bench('lazy chunk plus early close', () => {
			for (const chunk of iterable.chunk(values, 64)) {
				do_not_optimize(chunk);
				break;
			}
		});
		bench('native slice and freeze', () => do_not_optimize(Object.freeze(values.slice(0, 64))));
	});
}
await run();
