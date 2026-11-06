/** Public native Worker requests with identical validation/transfer/cleanup and optional logical admission budgets. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from '#tools/bench/run.ts';
import * as context from '@okikio/context';
import * as thread from '@okikio/worker/thread';
import { Protocol } from '#fixtures/worker-budget-protocol.ts';
await using ctx = context.create({ id: 'worker-budget-bench' });
await using owners = new AsyncDisposableStack();
const module = new URL('../tests/fixtures/worker-budget-thread.ts', import.meta.url);
for (const bytes of [1024, 1048576]) {
	const policy = { maximumMessageBytes: bytes + 4096, maximumInFlightBytes: bytes * 2 + 8192, maximumNodes: 1000 };
	const bounded = owners.use(thread.open(ctx, { module, protocol: Protocol, budget: policy }));
	const baseline = owners.use(thread.open(ctx, { module, protocol: Protocol }));
	/** Identical fresh allocations keep detached-buffer replacement outside the comparison's ownership difference. */
	const call = async function (owner: typeof bounded): Promise<void> {
		const value = new Uint8Array(bytes);
		const buffer = value.buffer;
		const result = await owner.request(ctx, value, { transfer: [buffer] });
		if (result !== bytes || buffer.byteLength !== 0) throw new Error('Native transfer/cleanup oracle failed.');
		do_not_optimize(result);
	};
	await call(bounded);
	await call(baseline);
	let rejected = false;
	try {
		await bounded.request(ctx, new Uint8Array(bytes + 8192));
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		rejected = true;
	}
	if (!rejected) throw new Error('Raw admission limit oracle failed.');
	group(`native transferred request ${bytes} bytes`, () => {
		bench('negotiated transport with logical admission budgets', async () => await call(bounded));
		bench('same negotiated transport without byte accounting', async () => await call(baseline));
	});
}
await run();
