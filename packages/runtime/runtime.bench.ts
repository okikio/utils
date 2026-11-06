import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
/** Portable inspection acquires nothing; primitive feature checks omit the complete diagnostic snapshot. */
import { inspect } from './inspect.ts';
const expected = inspect();
strictEqual(expected.permissions, 'unqueried');
strictEqual(Object.isFrozen(expected), true);
strictEqual(expected.features.streams, typeof ReadableStream === 'function' && typeof WritableStream === 'function');
for (const count of [1, 1000]) {
	group(`runtime inspection ${count} snapshots`, () => {
		bench('complete frozen evidence', () => {
			for (let index = 0; index < count; index++) do_not_optimize(inspect());
		});
		bench('primitive stream feature checks only', () => {
			for (let index = 0; index < count; index++) {
				do_not_optimize(typeof ReadableStream === 'function' && typeof WritableStream === 'function');
			}
		});
	});
}
await run();
