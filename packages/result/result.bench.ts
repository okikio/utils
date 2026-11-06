/** Cost of ordered aggregation and stopping at the first expected failure, with an explicit-loop baseline. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import * as result from '@okikio/result';
for (const count of [1, 100, 10_000]) {
	for (const position of [-1, 0, Math.floor(count / 2), count - 1]) {
		const failure = result.fail('missing');
		const values = Array.from({ length: count }, (_, index) => index === position ? failure : result.ok(index));
		/** Same output allocation, ordering, freeze and failure identity; input is a finite array. */
		const reference = function (): result.Result<readonly number[], string> {
			const output: number[] = [];
			for (const value of values) {
				if (!value.ok) return value;
				output.push(value.value);
			}
			return result.ok(Object.freeze(output));
		};
		const actual = result.all(values);
		const expected = reference();
		// Counts alone cannot detect dropped, reordered or substituted payloads.
		deepStrictEqual(actual, expected);
		if (!actual.ok) strictEqual(actual, failure);
		else strictEqual(Object.isFrozen(actual.value), true);
		group(`result ${count} items: failure index ${position}`, () => {
			bench('all', () => {
				do_not_optimize(result.all(values));
			});
			bench('equivalent explicit loop', () => {
				do_not_optimize(reference());
			});
		});
	}
}
await run();
