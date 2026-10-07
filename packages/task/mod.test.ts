import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as task from './mod.ts';

describe('@okikio/task', () => {
	it('completes and cleans one local operation', async () => {
		let cleaned = false;
		await using work = task.start(async (ctx) => {
			ctx.defer(() => {
				cleaned = true;
			});
			return 42;
		}, { id: 'task-complete' });
		expect(await work.done).toBe(42);
		expect(work.status).toBe('completed');
		expect(cleaned).toBe(true);
	});

	it('pauses at a checkpoint and cancellation releases the pause', async () => {
		const entered = Promise.withResolvers<void>();
		await using work = task.start(async (ctx) => {
			entered.resolve();
			while (true) await ctx.checkpoint();
		}, { id: 'task-pause' });
		await entered.promise;
		const paused = work.pause();
		await paused;
		expect(work.status).toBe('paused');
		await work.cancel('stop');
		expect(work.status).toBe('cancelled');
	});

	it('reports cleanup failure after successful work', async () => {
		const cleanup = new Error('cleanup failed');
		const work = task.start((ctx) => {
			ctx.defer(() => {
				throw cleanup;
			});
			return 42;
		});
		await expect(work.done).rejects.toBe(cleanup);
		expect(work.status).toBe('failed');
	});

	it('preserves a thrown undefined value when cleanup also fails', async () => {
		const cleanup = new Error('cleanup failed');
		const work = task.start((ctx) => {
			ctx.defer(() => {
				throw cleanup;
			});
			throw undefined;
		});
		const result = await Promise.allSettled([work.done]);
		expect(result[0]?.status).toBe('rejected');
		const reason = result[0]?.status === 'rejected' ? result[0].reason : undefined;
		expect(reason).toBeInstanceOf(SuppressedError);
		expect(reason.error).toBe(cleanup);
		expect(reason.suppressed).toBe(undefined);
		expect(work.status).toBe('failed');
	});
});

it('joins asynchronous cleanup when a returned task is disposed', async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const work = task.start((ctx) => {
		ctx.defer(async () => {
			entered.resolve();
			await release.promise;
		});
		return 42;
	});
	await entered.promise;
	let disposed = false;
	const closing = work[Symbol.asyncDispose]().then(() => {
		disposed = true;
	});
	// This checkpoint observes settlement without making completion depend on a
	// fixed number of event-loop turns or a short wall-clock delay.
	await Promise.resolve();
	expect(disposed).toBe(false);
	expect(work.status).not.toBe('completed');
	release.resolve();
	await closing;
	expect(disposed).toBe(true);
	expect(await work.done).toBe(42);
	expect(work.status).toBe('completed');
});
