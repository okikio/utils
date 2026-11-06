import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
/** Forwarded functions must preserve behavior and identity; cold imports and bundles are separate root measurements. */
import * as focused from '@okikio/duration';
import * as facade from './duration.ts';
import * as result from './result.ts';
import * as focusedResult from '@okikio/result';
strictEqual(facade.elapsed, focused.elapsed);
strictEqual(result.all, focusedResult.all);
for (const count of [1, 1000]) {
	const values = Array.from({ length: count }, (_, index) => focused.ms(index));
	const expected = count * (count - 1) / 2;
	const total = function (forwarded: boolean): number {
		let sum = 0;
		for (const value of values) sum += (forwarded ? facade : focused).elapsed(value);
		return sum;
	};
	strictEqual(total(true), expected);
	strictEqual(total(false), expected);
	group(`facade ${count} fixed-unit conversions, same function identity`, () => {
		bench('focused public entry', () => do_not_optimize(total(false)));
		bench('forwarded public entry', () => do_not_optimize(total(true)));
	});
}
await run();
