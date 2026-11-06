/** Final transport receipts retain work and cleanup failures and join the complete owned lifetime. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import { settle } from './protocol.ts';

describe('shared worker cleanup receipts', () => {
	it('retains an unrelated operation error after abort instead of calling it cancellation', async () => {
		const ctx = context.create({ id: 'abort-fault' });
		const receipt = await settle(ctx, () => {
			context.cancel(ctx, 'stop');
			throw new Error('operation failed while stopping');
		}, () => {});
		expect(receipt).toMatchObject({ type: 'fault', fault: { message: 'operation failed while stopping' } });
	});

	it('rejects a late successful return after abort', async () => {
		const ctx = context.create({ id: 'abort-success' });
		expect(
			await settle(ctx, () => {
				context.cancel(ctx, 'stop');
				return 'late';
			}, () => {}),
		).toEqual({ type: 'cancelled' });
	});

	it('joins context cleanup after a failed release and preserves every failure as fault data', async () => {
		const ctx = context.create({ id: 'failed-receipt' });
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const order: string[] = [];
		ctx.defer(async () => {
			order.push('context');
			started.resolve();
			await finish.promise;
			throw new Error('context cleanup failed');
		});
		let completed = false;
		const receipt = settle(ctx, () => {
			throw undefined;
		}, () => {
			order.push('release');
			throw new Error('correlation release failed');
		}).then((value) => {
			completed = true;
			return value;
		});
		await started.promise;
		expect(order).toEqual(['release', 'context']);
		expect(completed).toBe(false);
		finish.resolve();
		expect(await receipt).toMatchObject({
			type: 'fault',
			fault: {
				name: 'SuppressedError',
				suppressed: '[undefined]',
				error: {
					name: 'SuppressedError',
					error: { name: 'Error', message: 'context cleanup failed' },
					suppressed: { name: 'Error', message: 'correlation release failed' },
				},
			},
		});
	});

	it('publishes cancellation only after context cleanup and leaves the parent usable', async () => {
		await using parent = context.create({ id: 'receipt-parent' });
		const ctx = context.child(parent);
		let released = 0;
		ctx.defer(() => {
			released++;
		});
		context.cancel(ctx, null);
		const receipt = await settle(ctx, () => {
			throw new Error('cancelled work must not start');
		}, () => {});
		expect(receipt).toEqual({ type: 'cancelled' });
		expect(released).toBe(1);
		expect(parent.signal.aborted).toBe(false);
	});
});
