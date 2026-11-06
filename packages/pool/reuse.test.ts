import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as pool from './mod.ts';

describe('pool reset and rotation', () => {
	it('resets before publishing idle and rotates only after the final allowed lease returns', async () => {
		await using ctx = context.create({ id: 'reuse' });
		let created = 0;
		const closed: number[] = [];
		let resets = 0;
		await using values = await pool.create({
			ctx,
			maximum: 1,
			maximumWaiting: 2,
			maximumUses: 2,
			create: () => ({ id: ++created, dirty: false }),
			reset(value) {
				resets++;
				value.dirty = false;
			},
			close(value) {
				closed.push(value.id);
			},
		});
		await pool.withLease(values, ctx, (value) => {
			value.dirty = true;
		});
		expect(resets).toBe(1);
		const second = await values.acquire(ctx);
		expect(second.value).toEqual({ id: 1, dirty: false });
		expect(closed).toEqual([]);
		await second[Symbol.asyncDispose]();
		expect(closed).toEqual([1]);
		expect(resets).toBe(1);
		await pool.withLease(values, ctx, (value) => expect(value.id).toBe(2));
	});
	it('keeps reset ownership through drain and closes once after reset settles', async () => {
		await using ctx = context.create({ id: 'drain-reset' });
		const resetting = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		let closed = 0;
		await using values = await pool.create({
			ctx,
			maximum: 1,
			maximumWaiting: 1,
			create: () => 1,
			reset() {
				started.resolve();
				return resetting.promise;
			},
			close() {
				closed++;
			},
		});
		const lease = await values.acquire(ctx);
		const returned = lease[Symbol.asyncDispose]();
		await started.promise;
		const drained = values.drain();
		expect(closed).toBe(0);
		resetting.resolve();
		await Promise.all([returned, drained, lease[Symbol.asyncDispose]()]);
		expect(closed).toBe(1);
		expect(values.stats().idle).toBe(0);
	});
	it('preserves reset and close failures and joins repeated lease release', async () => {
		await using ctx = context.create({ id: 'reset-failure' });
		const reset = new Error('reset');
		const close = new Error('close');
		let closed = 0;
		const values = await pool.create({
			ctx,
			maximum: 1,
			maximumWaiting: 0,
			create: () => 1,
			reset() {
				throw reset;
			},
			close() {
				closed++;
				throw close;
			},
		});
		const lease = await values.acquire(ctx);
		let failure: unknown;
		try {
			await lease[Symbol.asyncDispose]();
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(SuppressedError);
		expect((failure as SuppressedError).error).toBe(close);
		expect((failure as SuppressedError).suppressed).toBe(reset);
		await expect(lease[Symbol.asyncDispose]()).rejects.toBe(failure);
		expect(closed).toBe(1);
		await expect(values[Symbol.asyncDispose]()).rejects.toBeInstanceOf(AggregateError);
	});
	it('checks creation age independently of idle time and preserves a borrowed value at the boundary', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'age', clock });
		let created = 0;
		let closed = 0;
		await using values = await pool.create({
			ctx,
			minimum: 1,
			maximum: 1,
			maximumWaiting: 0,
			maximumAge: 'PT10S',
			maximumIdleAge: 'PT1H',
			create: () => ++created,
			close() {
				closed++;
			},
		});
		const lease = await values.acquire(ctx);
		clock.advance('PT10S');
		await values.maintain();
		expect(closed).toBe(0);
		await lease[Symbol.asyncDispose]();
		expect(closed).toBe(1);
		await pool.withLease(values, ctx, (value) => expect(value).toBe(2));
		const failure = new Error('consumer');
		await expect(pool.withLease(values, ctx, () => {
			throw failure;
		})).rejects.toBe(failure);
		expect(values.stats().idle).toBe(1);
	});
});

it('selects one exact idle value and retains retirement capacity until borrower and close join', async () => {
	await using ctx = context.create({ id: 'selected-pool' });
	const finish = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	let count = 0;
	await using values = await pool.create({
		ctx,
		maximum: 2,
		maximumWaiting: 2,
		minimum: 2,
		create: () => ({ id: ++count }),
		async close() {
			started.resolve();
			await finish.promise;
		},
	});
	const first = await values.acquire(ctx);
	const value = first.value;
	expect(values.values()).toContain(value);
	await first[Symbol.asyncDispose]();
	const selected = await values.select(ctx, value);
	expect(selected.value).toBe(value);
	await expect(values.select(ctx, value)).rejects.toMatchObject({ code: 'busy' });
	const retirement = values.retire(value);
	await expect(values.select(ctx, value)).rejects.toMatchObject({ code: 'missing' });
	const returning = selected[Symbol.asyncDispose]();
	await started.promise;
	expect(values.stats().idle).toBe(1);
	finish.resolve();
	await returning;
	await retirement;
	await expect(values.select(ctx, value)).rejects.toMatchObject({ code: 'missing' });
});

it('rejects ambiguous value identity and retirement racing a health check cannot publish a lease', async () => {
	await using ctx = context.create({ id: 'selected-health' });
	const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
	let checking = false, closes = 0;
	await using values = await pool.create({
		ctx,
		maximum: 1,
		minimum: 1,
		maximumWaiting: 1,
		create: () => ({}),
		async check() {
			if (checking) {
				entered.resolve();
				await release.promise;
			}
			return true;
		},
		close() {
			closes++;
		},
	});
	const initial = await values.acquire(ctx);
	const target = initial.value;
	await initial[Symbol.asyncDispose]();
	checking = true;
	const selecting = values.select(ctx, target);
	const rejected = expect(selecting).rejects.toMatchObject({ code: 'missing' });
	await entered.promise;
	const retiring = values.retire(target);
	expect(values.retire(target)).toBe(retiring);
	release.resolve();
	await rejected;
	await retiring;
	expect(closes).toBe(1);
	await using duplicates = await pool.create({
		ctx,
		maximum: 2,
		minimum: 2,
		maximumWaiting: 0,
		create: () => 1,
		close() {},
	});
	await expect(duplicates.select(ctx, 1)).rejects.toBeInstanceOf(TypeError);
	expect(() => duplicates.retire(1)).toThrow(TypeError);
});

it('does not publish a value before its factory transfers ownership to the pool', async () => {
	await using ctx = context.create({ id: 'pool-discovery' });
	const factory = Promise.withResolvers<{ id: string }>();
	await using values = await pool.create({
		ctx,
		maximum: 1,
		maximumWaiting: 0,
		create: () => factory.promise,
		close() {},
	});
	const acquiring = values.acquire(ctx);
	expect(values.values()).toEqual([]);
	const value = { id: 'new' };
	factory.resolve(value);
	await using lease = await acquiring;
	expect(lease.value).toBe(value);
	expect(values.values()).toEqual([value]);
	expect(Object.isFrozen(values.values())).toBe(true);
});
