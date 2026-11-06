/** Measure native cancellation round trips and joined cleanup, including replacement after a fault. @module */
import { bench, do_not_optimize } from 'mitata';
import * as context from '@okikio/context';
import { run } from '#tools/bench/run.ts';
import { cancel, open } from '../tests/fixtures/provider-cleanup-host.ts';

await using ctx = context.create({ id: 'cancellation-benchmark' });
await using thread = await open(ctx, 'worker');
await using child = await open(ctx, 'process');
for (const [kind, provider] of [['worker', thread], ['process', child]] as const) {
	// Clean cancellation reuses the host. A transport fault retires it, so fault trials include replacement startup.
	for (const mode of ['bench-cancel', 'bench-dispose']) {
		const expected = mode === 'bench-cancel' ? 'cancelled' : 'lost';
		const oracle = await cancel(ctx, provider, mode);
		if (oracle.type !== expected || provider.stats().leased !== 0) {
			throw new Error(`${kind}/${mode} did not join cleanup with the expected ${expected} receipt.`);
		}
		if (oracle.type === 'lost' && !JSON.stringify(oracle.reason).includes('owned disposer failed')) {
			throw new Error(`${kind} lost the cleanup failure diagnostics.`);
		}
		bench(
			`${kind}: cancellation + ${
				mode === 'bench-dispose' ? 'failed (includes host replacement)' : 'clean'
			} disposal receipt`,
			async () => {
				const result = await cancel(ctx, provider, mode);
				if (result.type !== expected) throw new Error(`Unexpected ${result.type} receipt.`);
				do_not_optimize(result);
			},
		);
	}
}
await run();
