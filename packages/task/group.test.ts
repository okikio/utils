import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as groups from './group.ts';
import * as task from './mod.ts';

describe('bounded local task groups', () => {
	it('rejects waiting cap+1 and close drains accepted work without retaining a result history', async () => {
		await using ctx = context.create({ id: 'group-admission' });
		await using group = groups.create({ ctx, concurrency: 1, maximumWaiting: 1, mode: 'settled' });
		const gate = Promise.withResolvers<void>();
		const first = await group.start(async () => {
			await gate.promise;
			return 1;
		});
		const waiting = group.start(() => 2);
		await expect(group.start(() => 3)).rejects.toBeInstanceOf(groups.GroupAdmissionError);
		const closed = group.close();
		await expect(group.start(() => 4)).rejects.toBeInstanceOf(groups.GroupAdmissionError);
		gate.resolve();
		expect(await first.done).toBe(1);
		expect(await (await waiting).done).toBe(2);
		expect(await closed).toEqual({ started: 2, completed: 2, failed: 0, cancelled: false });
		expect(group.stats()).toMatchObject({ active: 0, pending: 0, state: 'closed' });
	});
	it('settled policy preserves each exact failure on Task.done', async () => {
		await using ctx = context.create({ id: 'settled' });
		await using group = groups.create({ ctx, concurrency: 1, maximumWaiting: 0, mode: 'settled' });
		const failure = new Error('child');
		const child = await group.start(() => {
			throw failure;
		});
		await expect(child.done).rejects.toBe(failure);
		expect(await group.close()).toEqual({ started: 1, completed: 0, failed: 1, cancelled: false });
	});
	it('fail-fast cancels paused siblings and joins their cleanup before rejecting with the first defect', async () => {
		await using ctx = context.create({ id: 'fail-fast' });
		const group = groups.create({ ctx, concurrency: 2, maximumWaiting: 0, mode: 'fail-fast' });
		const pauseGate = Promise.withResolvers<void>();
		const cleanup = Promise.withResolvers<void>();
		const cleaning = Promise.withResolvers<void>();
		const paused = await group.start(async (ctx) => {
			ctx.defer(async () => {
				cleaning.resolve();
				await cleanup.promise;
			});
			await pauseGate.promise;
			await ctx.checkpoint();
			return 1;
		});
		const observedPause = paused.pause();
		pauseGate.resolve();
		await observedPause;
		expect(paused.status).toBe('paused');
		const defect = new Error('first child defect');
		const rejected = expect(group.done).rejects.toBe(defect);
		const failed = await group.start(() => {
			throw defect;
		});
		await expect(failed.done).rejects.toBe(defect);
		await cleaning.promise;
		expect(group.stats().active).toBe(1);
		cleanup.resolve();
		await rejected;
		await expect(paused.done).rejects.toBeInstanceOf(context.ContextCancelledError);
		await expect(group[Symbol.asyncDispose]()).rejects.toBe(defect);
	});
	it('parent cancellation wakes an ordinary Task paused at a checkpoint', async () => {
		await using ctx = context.create({ id: 'parent-pause' });
		const gate = Promise.withResolvers<void>();
		const child = task.start(async (ctx) => {
			await gate.promise;
			await ctx.checkpoint();
		}, { ctx });
		const paused = child.pause();
		gate.resolve();
		await paused;
		context.cancel(ctx, 'parent');
		await expect(child.done).rejects.toBeInstanceOf(context.ContextCancelledError);
		expect(child.status).toBe('cancelled');
	});
});
