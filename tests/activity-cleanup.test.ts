import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import { attempt } from './fixtures/provider-cleanup.ts';
import { open } from './fixtures/provider-cleanup-host.ts';

describe('real Worker and process cancellation receipts', () => {
	for (const kind of ['worker', 'process'] as const) {
		for (
			const [mode, behavior] of [
				['cancel', 'clean cancellation'],
				['success', 'late success suppression'],
				['dispose', 'owned disposer failure'],
				['throw', 'unrelated stop failure'],
				['undefined', 'thrown undefined'],
			] as const
		) {
			it(
				`${kind}: preserves ${behavior} and joins cleanup before releasing its host`,
				{ timeout: 15_000 },
				async () => {
					await using owner = context.create({ id: 'cleanup-native' });
					await using provider = await open(owner, kind);
					await using ctx = context.child(owner);
					const ready = Promise.withResolvers<void>();
					let settled = false;
					const result = provider.run(ctx, attempt(ctx, mode), {
						async heartbeat() {
							ready.resolve();
						},
					})
						.finally(() => {
							settled = true;
						});
					await ready.promise;
					context.cancel(ctx, 'caller stopped');
					await new Promise<void>((resolve) => setTimeout(resolve, 10));
					expect(settled).toBe(false);
					expect(provider.stats().leased).toBe(1);
					const outcome = await result;
					expect(outcome.type).toBe(mode === 'cancel' || mode === 'success' ? 'cancelled' : 'lost');
					expect(provider.stats().leased).toBe(0);
					// A fault must retire the physical host rather than return it to the idle pool.
					if (outcome.type === 'lost') expect(provider.stats().idle).toBe(0);
					if (outcome.type === 'lost' && mode !== 'undefined') {
						expect(JSON.stringify(outcome.reason)).toContain(
							mode === 'dispose' ? 'owned disposer failed' : 'unrelated stop failure',
						);
					}
				},
			);
		}
	}
});
