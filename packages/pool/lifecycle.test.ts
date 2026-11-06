import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as pool from './mod.ts';

describe('pool cleanup ownership', () => {
	it('joins one lease close through repeated disposal and concurrent pool shutdown', async () => {
		await using owner = context.create({ id: 'repeated-lease-close' });
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		let closes = 0;
		const values = await pool.create({
			ctx: owner,
			maximum: 1,
			maximumWaiting: 32,
			maximumIdle: 0,
			create: () => 1,
			async close() {
				closes++;
				started.resolve();
				await finish.promise;
			},
		});
		const lease = await values.acquire(owner);
		const first = lease[Symbol.asyncDispose]();
		await started.promise;
		const second = lease[Symbol.asyncDispose]();
		expect(second).toBe(first);
		let finished = false;
		void second.then(() => {
			finished = true;
		});
		const disposal = values[Symbol.asyncDispose]();
		expect(values[Symbol.asyncDispose]()).toBe(disposal);
		await expect(values.acquire(owner)).rejects.toBeInstanceOf(pool.PoolUnavailableError);
		expect(finished).toBe(false);
		finish.resolve();
		await Promise.all([first, second, disposal]);
		expect(closes).toBe(1);
		expect(values.stats().state).toBe('disposed');
	});

	it('shares complete disposal with synchronous lifecycle observers', async () => {
		await using owner = context.create({ id: 'reentrant-disposal' });
		const values = await pool.create({ ctx: owner, maximum: 1, maximumWaiting: 32, create: () => 1, close: () => {} });
		const nested: PromiseLike<void>[] = [];
		const events: string[] = [];
		using _subscription = values.events.subscribe((event) => {
			if (event.type !== 'draining' && event.type !== 'disposed') return;
			events.push(event.type);
			nested.push(values[Symbol.asyncDispose]());
		});
		const disposal = values[Symbol.asyncDispose]();
		await disposal;
		expect(events).toEqual(['draining', 'disposed']);
		expect(nested).toHaveLength(2);
		for (const pending of nested) expect(pending).toBe(disposal);
		expect(owner.signal.aborted).toBe(false);
	});

	it('retires a prepared lease if its acquisition cleanup fails before delivery', async () => {
		await using owner = context.create({ id: 'undelivered-lease' });
		const closed: number[] = [];
		const values = await pool.create({
			ctx: owner,
			maximum: 1,
			maximumWaiting: 32,
			create(acquisition) {
				// Inject a fallible resource into the runtime-owned child. The
				// public result must never lose the value prepared before it fails.
				(acquisition as context.Owned).defer(() => {
					throw undefined;
				});
				return 42;
			},
			close(value) {
				closed.push(value);
			},
		});
		expect(await Promise.allSettled([values.acquire(owner)])).toEqual([{ status: 'rejected', reason: undefined }]);
		expect(closed).toEqual([42]);
		expect(values.stats()).toMatchObject({ idle: 0, leased: 0, creating: 0 });
		await values.drain();
		await values[Symbol.asyncDispose]();
		expect(owner.signal.aborted).toBe(false);
	});

	it('unlinks an acquired child if reading the timeout clock fails', async () => {
		await using owner = context.create({ id: 'partial-acquisition' });
		await using values = await pool.create({
			ctx: owner,
			maximum: 1,
			maximumWaiting: 32,
			acquireTimeout: { seconds: 1 },
			create: () => 1,
			close: () => {},
		});
		const failure = new Error('clock unavailable');
		const add = AbortSignal.prototype.addEventListener;
		const remove = AbortSignal.prototype.removeEventListener;
		const retained = new Set<unknown>();
		AbortSignal.prototype.addEventListener = function (...args: Parameters<typeof add>) {
			if (args[0] === 'abort') retained.add(args[1]);
			add.apply(this, args);
		};
		AbortSignal.prototype.removeEventListener = function (...args: Parameters<typeof remove>) {
			if (args[0] === 'abort') retained.delete(args[1]);
			remove.apply(this, args);
		};
		try {
			await expect(values.acquire({
				...owner,
				clock: {
					now() {
						throw failure;
					},
					sleep: async () => {},
				},
			})).rejects.toBe(failure);
			expect(retained.size).toBe(0);
		} finally {
			AbortSignal.prototype.addEventListener = add;
			AbortSignal.prototype.removeEventListener = remove;
		}
	});
	it('reports every expired-value cleanup failure and retains it for drain', async () => {
		const clock = new context.TestClock();
		await using owner = context.create({ id: 'expired-close-errors', clock });
		const firstFailure = new Error('first expired connection could not close');
		const closed: number[] = [];
		let created = 0;
		const values = await pool.create({
			ctx: owner,
			maximum: 2,
			maximumWaiting: 32,
			maximumIdleAge: { seconds: 1 },
			create: () => ++created,
			close(value) {
				closed.push(value);
				throw value === 1 ? firstFailure : undefined;
			},
		});
		try {
			const first = await values.acquire(owner);
			const second = await values.acquire(owner);
			await first[Symbol.asyncDispose]();
			await second[Symbol.asyncDispose]();
			clock.advance({ seconds: 1 });
			const [maintained] = await Promise.allSettled([values.maintain()]);
			expect(maintained.status).toBe('rejected');
			if (maintained.status !== 'rejected') return;
			expect(maintained.reason).toBeInstanceOf(AggregateError);
			expect(maintained.reason.errors).toEqual([firstFailure, undefined]);
			expect(closed).toEqual([1, 2]);
			expect(values.stats()).toMatchObject({ idle: 0, leased: 0, creating: 0 });
			const [drained] = await Promise.allSettled([values.drain()]);
			expect(drained.status).toBe('rejected');
			if (drained.status === 'rejected') expect(drained.reason.errors).toEqual([firstFailure, undefined]);
		} finally {
			await Promise.allSettled([values[Symbol.asyncDispose]()]);
		}
	});

	it('keeps every drain caller pending until idle closure and active lease release finish', async () => {
		await using owner = context.create({ id: 'overlapping-drains' });
		const closing = Promise.withResolvers<void>();
		const allowClose = Promise.withResolvers<void>();
		let created = 0;
		const values = await pool.create({
			ctx: owner,
			maximum: 2,
			maximumWaiting: 32,
			create: () => ++created,
			async close(value) {
				if (value !== 1) return;
				closing.resolve();
				await allowClose.promise;
			},
		});
		const first = await values.acquire(owner);
		const second = await values.acquire(owner);
		await first[Symbol.asyncDispose]();
		const draining = values.drain();
		await closing.promise;
		let finished = false;
		const joined = values.drain().then(() => {
			finished = true;
		});
		try {
			await second[Symbol.asyncDispose]();
			// Awaiting an admission rejection gives both drain continuations a turn,
			// while the provider's explicit close barrier remains unresolved.
			await expect(values.acquire(owner)).rejects.toBeInstanceOf(pool.PoolUnavailableError);
			expect(finished).toBe(false);
		} finally {
			allowClose.resolve();
			await Promise.all([draining, joined]);
			await values[Symbol.asyncDispose]();
		}
		expect(finished).toBe(true);
	});

	it('publishes one drain transition when an observer requests drain again', async () => {
		await using owner = context.create({ id: 'reentrant-drain' });
		const values = await pool.create({ ctx: owner, maximum: 1, maximumWaiting: 32, create: () => 1, close: () => {} });
		let notifications = 0;
		let nested: Promise<void> | undefined;
		using _subscription = values.events.subscribe((event) => {
			if (event.type !== 'draining') return;
			notifications++;
			if (notifications === 1) nested = values.drain();
		});
		try {
			await values.drain();
			await nested;
			expect(notifications).toBe(1);
		} finally {
			await values[Symbol.asyncDispose]();
		}
	});

	it('retains failed health-check retirement for shutdown', async () => {
		await using owner = context.create({ id: 'unhealthy-close-error' });
		const failure = new Error('unhealthy resource could not close');
		const values = await pool.create({
			ctx: owner,
			minimum: 1,
			maximum: 1,
			maximumWaiting: 32,
			create: () => 1,
			check: () => false,
			close() {
				throw failure;
			},
		});
		try {
			await expect(values.acquire(owner)).rejects.toBe(failure);
			const [drained] = await Promise.allSettled([values.drain()]);
			expect(drained.status).toBe('rejected');
			if (drained.status === 'rejected') expect(drained.reason.errors).toEqual([failure]);
			const [disposed] = await Promise.allSettled([values[Symbol.asyncDispose]()]);
			expect(disposed.status).toBe('rejected');
			expect(values.stats().state).toBe('disposed');
			const [lateDrain] = await Promise.allSettled([values.drain()]);
			expect(lateDrain.status).toBe('rejected');
			if (lateDrain.status === 'rejected') expect(lateDrain.reason.errors).toEqual([failure]);
		} finally {
			await Promise.allSettled([values[Symbol.asyncDispose]()]);
		}
	});
});
