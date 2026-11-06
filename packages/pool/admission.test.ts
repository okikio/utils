import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as pool from './mod.ts';

describe('pool waiting admission', () => {
	it('rejects maximum+1 without retaining a waiter, then releases admission after cancellation', async () => {
		await using ctx = context.create({ id: 'admission' });
		await using values = await pool.create({ ctx, maximum: 1, maximumWaiting: 1, create: () => 1, close() {} });
		await using first = await values.acquire(ctx);
		await using cancelled = context.child(ctx, { id: 'cancelled' });
		const waiting = values.acquire(cancelled);
		const rejected = expect(waiting).rejects.toBe('test cancellation');
		expect(values.stats().waiting).toBe(1);
		await expect(values.acquire(ctx)).rejects.toBeInstanceOf(pool.PoolWaitLimitError);
		context.cancel(cancelled, 'test cancellation');
		await rejected;
		expect(values.stats().waiting).toBe(0);
		const next = values.acquire(ctx);
		await first[Symbol.asyncDispose]();
		const lease = await next;
		expect(lease.value).toBe(1);
		await lease[Symbol.asyncDispose]();
		expect(values.stats().waiting).toBe(0);
	});
	it('permits creation and reuse with zero waiting slots', async () => {
		await using ctx = context.create({ id: 'no-wait' });
		await using values = await pool.create({ ctx, maximum: 1, maximumWaiting: 0, create: () => 1, close() {} });
		await using first = await values.acquire(ctx);
		await expect(values.acquire(ctx)).rejects.toBeInstanceOf(pool.PoolWaitLimitError);
		await first[Symbol.asyncDispose]();
		await using second = await values.acquire(ctx);
		expect(second.value).toBe(1);
	});
	it('rejects invalid bounds before creating resources', async () => {
		await using ctx = context.create({ id: 'bad-admission' });
		let created = 0;
		for (const maximumWaiting of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
			await expect(pool.create({ ctx, maximum: 1, maximumWaiting, create: () => ++created, close() {} })).rejects
				.toThrow(TypeError);
		}
		expect(created).toBe(0);
	});
});
