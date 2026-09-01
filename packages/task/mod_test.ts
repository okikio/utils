import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as task from './mod.ts';

describe('@okikio/task', () => {
	it('completes and cleans one local operation', async () => {
		let cleaned = false;
		await using work = task.start(async (ctx) => {
			ctx.defer(() => { cleaned = true; });
			return 42;
		}, { id: 'task-complete' });
		expect(await work.done).toBe(42);
		expect(work.status).toBe('completed');
		expect(cleaned).toBe(true);
	});

	it('pauses at a checkpoint and cancellation releases the pause', async () => {
		let entered = false;
		await using work = task.start(async (ctx) => {
			entered = true;
			while (true) await ctx.checkpoint();
		}, { id: 'task-pause' });
		while (!entered) await Promise.resolve();
		const paused = work.pause();
		await paused;
		expect(work.status).toBe('paused');
		await work.cancel('stop');
		expect(work.status).toBe('cancelled');
	});
});
