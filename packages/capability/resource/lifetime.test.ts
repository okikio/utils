/** Collection disposal must report every owned cleanup failure after joining acquisitions. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as resource from './mod.ts';

describe('resource disposal during acquisition', () => {
	it('reports failed partial cleanup to both the borrower and the disposing owner', async () => {
		await using owner = context.create({ id: 'cleanup-owner', clock: new context.TestClock() });
		const started = Promise.withResolvers<void>();
		const cleanup = new Error('partial resource cleanup failed');
		let cleaned = 0;
		const Pending = resource.define<never>()({ id: 'pending', description: 'A cancellable acquisition.' });
		const implementation = resource.implement(Pending, {
			create({ ctx }) {
				ctx.defer(() => {
					cleaned++;
					throw cleanup;
				});
				return new Promise<never>((_resolve, reject) => {
					ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
					started.resolve();
				});
			},
		});
		const collection = resource.create(resource.implementations(implementation), { host: {}, ctx: owner });
		const acquisition = collection.get(owner, Pending).catch((error: unknown) => error);
		await started.promise;
		const disposal = collection[Symbol.asyncDispose]();
		const rejected = expect(disposal).rejects.toBeInstanceOf(SuppressedError);
		const failure = await acquisition;
		await rejected;
		expect(failure).toBeInstanceOf(SuppressedError);
		if (!(failure instanceof SuppressedError)) throw new Error('Expected acquisition cleanup failure.');
		expect(failure.error).toBe(cleanup);
		expect(failure.suppressed).toBeInstanceOf(resource.CollectionDisposedError);
		await expect(disposal).rejects.toBe(failure);
		expect(collection[Symbol.asyncDispose]()).toBe(disposal);
		expect(cleaned).toBe(1);
	});

	it('retains cancellation when cleanup of a late created value also fails', async () => {
		await using owner = context.create({ id: 'late-owner', clock: new context.TestClock() });
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const cleanup = new Error('late resource cleanup failed');
		let cleaned = 0;
		const Late = resource.define<Disposable>()({ id: 'late', description: 'A late acquisition.' });
		const implementation = resource.implement(Late, {
			async create() {
				started.resolve();
				await release.promise;
				return {
					[Symbol.dispose]() {
						cleaned++;
						throw cleanup;
					},
				};
			},
		});
		const collection = resource.create(resource.implementations(implementation), { host: {}, ctx: owner });
		const acquisition = collection.get(owner, Late).catch((error: unknown) => error);
		await started.promise;
		const disposal = collection[Symbol.asyncDispose]();
		const rejected = expect(disposal).rejects.toBeInstanceOf(SuppressedError);
		release.resolve();
		const failure = await acquisition;
		await rejected;
		expect(failure).toBeInstanceOf(SuppressedError);
		if (!(failure instanceof SuppressedError)) throw new Error('Expected late cleanup failure.');
		expect(failure.error).toBe(cleanup);
		expect(failure.suppressed).toBeInstanceOf(resource.CollectionDisposedError);
		await expect(disposal).rejects.toBe(failure);
		expect(cleaned).toBe(1);
	});

	it('closes acquired resources even when an in-flight cleanup fails and retains both failures', async () => {
		await using owner = context.create({ id: 'combined-owner', clock: new context.TestClock() });
		const started = Promise.withResolvers<void>();
		const residentFailure = new Error('resident cleanup failed');
		const cleaned: string[] = [];
		const Resident = resource.define<Disposable>()({ id: 'resident', description: 'An acquired resource.' });
		const Pending = resource.define<never>()({ id: 'pending', description: 'An in-flight resource.' });
		const resident = resource.implement(Resident, {
			create() {
				return {
					[Symbol.dispose]() {
						cleaned.push('resident');
						throw residentFailure;
					},
				};
			},
		});
		const pending = resource.implement(Pending, {
			create({ ctx }) {
				ctx.defer(() => {
					cleaned.push('pending');
					throw undefined;
				});
				return new Promise<never>((_resolve, reject) => {
					ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
					started.resolve();
				});
			},
		});
		const collection = resource.create(resource.implementations(resident, pending), { host: {}, ctx: owner });
		await collection.get(owner, Resident);
		const acquisition = collection.get(owner, Pending).catch((error: unknown) => error);
		await started.promise;
		const disposal = Promise.resolve(collection[Symbol.asyncDispose]()).catch((error: unknown) => error);
		const pendingFailure = await acquisition;
		const failure = await disposal;
		expect(pendingFailure).toBeInstanceOf(SuppressedError);
		if (!(pendingFailure instanceof SuppressedError)) throw new Error('Expected partial cleanup failure.');
		expect(pendingFailure.error).toBeUndefined();
		expect(failure).toBeInstanceOf(AggregateError);
		if (!(failure instanceof AggregateError)) throw new Error('Expected both cleanup failures.');
		expect(failure.errors).toEqual([pendingFailure, residentFailure]);
		expect(cleaned).toEqual(['pending', 'resident']);
	});
});

it('publishes one disposal completion before synchronous abort observers reenter', async () => {
	await using owner = context.create({ id: 'reentrant-disposal' });
	const cleanupStarted = Promise.withResolvers<void>();
	const releaseCleanup = Promise.withResolvers<void>();
	let reentered: PromiseLike<void> | undefined;
	const Value = resource.define<null>()({ id: 'reentrant', description: 'One owned cleanup lifetime.' });
	const implementation = resource.implement(Value, {
		create({ ctx }) {
			ctx.signal.addEventListener('abort', () => {
				reentered = collection[Symbol.asyncDispose]();
			}, { once: true });
			ctx.defer(async () => {
				cleanupStarted.resolve();
				await releaseCleanup.promise;
			});
			return null;
		},
	});
	const collection = resource.create(resource.implementations(implementation), { ctx: owner, host: {} });
	await collection.get(owner, Value);
	const first = collection[Symbol.asyncDispose]();
	try {
		expect(reentered).toBe(first);
		await cleanupStarted.promise;
		let settled = false;
		void first.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
	} finally {
		releaseCleanup.resolve();
		await first;
		await reentered;
	}
});
