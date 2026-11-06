import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
/** Join a local request receipt before releasing its correlation; transport startup belongs to root host workflows. */
import { settle } from './protocol.ts';
import * as context from '@okikio/context';
for (const count of [1, 32, 256]) {
	const cycle = async function (owned: boolean, fail = false, verify = false): Promise<number> {
		let released = 0;
		for (let index = 0; index < count; index++) {
			const ctx = context.create({ id: 'receipt', clock: new context.TestClock() });
			if (owned) {
				const output = await settle(ctx, () => {
					if (fail) throw new Error('work');
					return index;
				}, () => {
					released++;
				});
				strictEqual(output.type, fail ? 'fault' : 'result');
				if (verify && output.type === 'result') strictEqual(output.value, index);
			} else {
				try {
					do_not_optimize(await Promise.resolve(index));
				} finally {
					released++;
					await ctx[Symbol.asyncDispose]();
				}
			}
		}
		return released;
	};
	strictEqual(await cycle(true, false, true), count);
	strictEqual(await cycle(false), count);
	strictEqual(await cycle(true, true), count);
	group(`worker ${count} joined local receipts`, () => {
		bench('settle result and release', async () => do_not_optimize(await cycle(true)));
		bench(
			'explicit successful finally cleanup: no fault/cancellation encoding',
			async () => do_not_optimize(await cycle(false)),
		);
		bench('settle unexpected fault and release', async () => do_not_optimize(await cycle(true, true)));
	});
}
await run();
