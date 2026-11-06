import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
/** Measure reverse cleanup with an equivalent successful finally-loop reference; errors are a separate workload. */
import { DisposableStack, SuppressedError } from './mod.ts';
for (const count of [1, 32, 1024]) {
	/** Timed calls retain traversal costs; complete order and error checks run only in preflight. */
	const cycle = function (stack: boolean, fail = false, verify = false): number {
		const order: number[] = [];
		let failure: unknown;
		const defect = fail ? new Error('cleanup') : undefined;
		const callbacks = Array.from({ length: count }, (_, index) => () => {
			order.push(index);
			if (fail && index === 0) throw defect;
		});
		if (stack) {
			const owned = new DisposableStack();
			for (const callback of callbacks) owned.defer(callback);
			try {
				owned.dispose();
			} catch (error) {
				if (!fail || !(error instanceof Error)) throw error;
				failure = error;
			}
		} else {
			try {
				/* Work finishes before the finally-owned cleanup. */
			} finally {
				for (const callback of callbacks.toReversed()) {
					try {
						callback();
					} catch (error) {
						failure = error;
					}
				}
			}
		}
		if (!fail && failure !== undefined) throw failure;
		if (verify) {
			deepStrictEqual(order, Array.from({ length: count }, (_, index) => count - index - 1));
			strictEqual(failure, defect);
		}
		return order.length;
	};
	strictEqual(cycle(true, false, true), count);
	strictEqual(cycle(false, false, true), count);
	strictEqual(cycle(true, true, true), count);
	group(`dispose ${count} callbacks including registration`, () => {
		bench('stack successful cleanup', () => do_not_optimize(cycle(true)));
		bench('explicit finally-loop successful cleanup', () => do_not_optimize(cycle(false)));
		bench('stack cleanup with one error', () => do_not_optimize(cycle(true, true)));
	});
}
// Ensure the error path cannot accidentally become a successful no-op.
const failed = new DisposableStack();
failed.defer(() => {
	throw new Error('first');
});
failed.defer(() => {
	throw new Error('second');
});
let suppressed = false;
try {
	failed.dispose();
} catch (error) {
	suppressed = error instanceof SuppressedError;
}
strictEqual(suppressed, true);
await run();
