import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as hosts from './hosts.ts';
import { AsyncDisposableStack } from '@okikio/dispose';

describe('shared activity hosts', () => {
	it('reports acquisition timeout through the local time provider after ambient replacement', async () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
		Object.defineProperty(globalThis, 'Temporal', {
			configurable: true,
			get() {
				throw new Error('Host timeout must use its imported time provider.');
			},
		});
		try {
			const clock = new context.TestClock();
			await using ctx = context.create({ id: 'host-local-time', clock });
			await using values = await hosts.create({
				ctx,
				maximum: 1,
				maximumWaiting: 1,
				acquireTimeout: 'PT0.001S',
				create: () => ({}),
				close() {},
			}, 1);
			// Keep the only host leased so the next acquisition must wait for its deadline.
			await using _held = await values.acquire(ctx);
			const waiting = expect(values.acquire(ctx)).rejects.toMatchObject({ name: 'PoolAcquireTimeoutError' });
			clock.advance({ milliseconds: 1 });
			await waiting;
		} finally {
			if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'Temporal');
			else Object.defineProperty(globalThis, 'Temporal', descriptor);
		}
	});
	it('bounds sharing and host count, cancels FIFO waits and joins drain', async () => {
		await using ctx = context.create({ id: 'shared-hosts' });
		let created = 0;
		let closed = 0;
		await using values = await hosts.create({
			ctx,
			maximum: 1,
			maximumWaiting: 3,
			create: () => ({ id: ++created }),
			close: () => {
				closed++;
			},
		}, 2);
		// Join a queued borrow after the active leases return, even if an assertion fails.
		await using pending = new AsyncDisposableStack();
		await using first = await values.acquire(ctx);
		await using second = await values.acquire(ctx);
		expect(first.value).toBe(second.value);
		await using cancelled = context.child(ctx);
		const waiting = values.acquire(cancelled);
		const rejection = expect(waiting).rejects.toBeDefined();
		context.cancel(cancelled, 'cancel queue');
		await rejection;
		const third = values.acquire(ctx);
		pending.defer(async () => await (await third)[Symbol.asyncDispose]());
		await first[Symbol.asyncDispose]();
		await using next = await third;
		expect(next.value).toBe(second.value);
		expect(created).toBe(1);
		let drained = false;
		const drain = values.drain().then(() => {
			drained = true;
		});
		await second[Symbol.asyncDispose]();
		expect(drained).toBe(false);
		await next[Symbol.asyncDispose]();
		await drain;
		expect(closed).toBe(1);
	});

	it('retires an invalid host only after every borrower returns, then replaces it', async () => {
		await using ctx = context.create({ id: 'shared-hosts' });
		let created = 0;
		const closed: number[] = [];
		await using values = await hosts.create({
			ctx,
			maximum: 1,
			maximumWaiting: 3,
			create: () => ++created,
			close: (value) => {
				closed.push(value);
			},
		}, 2);
		// Returning active leases first lets retirement finish and the queued borrow settle.
		await using pending = new AsyncDisposableStack();
		await using a = await values.acquire(ctx);
		await using b = await values.acquire(ctx);
		a.invalidate('host lost');
		expect(b.invalid).toBe(true);
		const queued = values.acquire(ctx);
		pending.defer(async () => await (await queued)[Symbol.asyncDispose]());
		await a[Symbol.asyncDispose]();
		expect(closed).toEqual([]);
		await b[Symbol.asyncDispose]();
		await using replacement = await queued;
		expect(replacement.value).toBe(2);
		expect(closed).toEqual([1]);
	});

	it('allows available slots with no waiting budget and rejects a saturated host', async () => {
		await using ctx = context.create({ id: 'no-shared-wait' });
		await using values = await hosts.create({ ctx, maximum: 1, maximumWaiting: 0, create: () => 1, close() {} }, 2);
		await using a = await values.acquire(ctx);
		await using b = await values.acquire(ctx);
		await expect(values.acquire(ctx)).rejects.toBeDefined();
		await a[Symbol.asyncDispose]();
		await using _c = await values.acquire(ctx);
		await b[Symbol.asyncDispose]();
	});

	it('rejects invalid concurrency before host creation', () => {
		for (const value of [0, -1, NaN, Infinity, 1.5]) expect(() => hosts.concurrency(value)).toThrow();
	});
});

it('selects an exact shared host and retires only after its final attempt returns', async () => {
	await using ctx = context.create({ id: 'selected-hosts' });
	let created = 0, closed = 0;
	await using values = await hosts.create({
		ctx,
		maximum: 2,
		maximumWaiting: 2,
		create: () => ({ id: ++created }),
		close() {
			closed++;
		},
	}, 2);
	await using a = await values.acquire(ctx);
	await using b = await values.acquire(ctx, { value: a.value });
	await expect(values.acquire(ctx, { value: a.value })).rejects.toMatchObject({ code: 'busy' });
	await using c = await values.acquire(ctx);
	expect(c.value).not.toBe(a.value);
	const retiring = values.retire(a.value);
	await expect(values.acquire(ctx, { value: a.value })).rejects.toMatchObject({ code: 'missing' });
	await a[Symbol.asyncDispose]();
	expect(closed).toBe(0);
	await b[Symbol.asyncDispose]();
	await retiring;
	expect(closed).toBe(1);
	await c[Symbol.asyncDispose]();
});
