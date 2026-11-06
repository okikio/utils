/** Queue timing and local waiting capacity preserve ownership on invalid operations. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as queue from './mod.ts';

describe('queue policy and observation isolation', () => {
	it('uses fixed elapsed days and validates retry inputs before surrendering a claim', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'elapsed', clock });
		await using jobs = queue.memory<string, string>({ clock });
		const ref = await jobs.add(ctx, 'work');
		const [claim] = await jobs.claim(ctx, { duration: { days: 1 } });
		expect(claim!.expiresAt.epochMilliseconds - claim!.claimedAt.epochMilliseconds).toBe(86_400_000);
		await expect(jobs.retry(ctx, claim!, { priority: NaN })).rejects.toThrow();
		expect((await jobs.stats()).claimed).toBe(1);
		await jobs.complete(ctx, claim!, 'kept');
		expect(await jobs.result(ctx, ref)).toBe('kept');
	});

	it('bounds waiters and releases admission when a waiting caller aborts', async () => {
		const signal = new AbortController();
		await using ctx = context.create({ id: 'waiting', signal: signal.signal });
		await using other = context.create({ id: 'other' });
		await using jobs = queue.memory<string, string>({ maximumWaiters: 1 });
		const pending = jobs.claim(ctx, { wait: true });
		const rejected = expect(pending).rejects.toBe('stopped');
		await expect(jobs.claim(other, { wait: true })).rejects.toBeInstanceOf(queue.QueueWaitCapacityError);
		signal.abort('stopped');
		await rejected;
		expect((await jobs.stats()).waitingClaims).toBe(0);
		const next = jobs.claim(other, { wait: true });
		await jobs.add(other, 'available');
		expect((await next)[0]?.value).toBe('available');
	});

	it('keeps committed state and releases result waiters when an observer throws', async () => {
		await using ctx = context.create({ id: 'observation' });
		await using jobs = queue.memory<string, string>();
		const listener = jobs.events.subscribe({
			next() {
				throw new Error('observer');
			},
		});
		try {
			const ref = await jobs.add(ctx, 'work');
			const pending = jobs.result(ctx, ref);
			const [claim] = await jobs.claim(ctx);
			await jobs.complete(ctx, claim!, 'saved');
			expect(await pending).toBe('saved');
			expect((await jobs.stats()).completed).toBe(1);
		} finally {
			listener.unsubscribe();
		}
	});
});
