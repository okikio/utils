import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { batch, collect, iterable, lines } from './mod.ts';
import type { CleanupOutcome } from './reader.ts';

describe('stream cancellation admission', () => {
	it('does not acquire or pull an iterator after cancellation', async () => {
		let factories = 0, pulls = 0;
		const source: AsyncIterable<number> = {
			[Symbol.asyncIterator]() {
				factories++;
				return {
					async next() {
						pulls++;
						return { done: false, value: 1 };
					},
				};
			},
		};
		const signal = AbortSignal.abort(new Error('cancelled'));
		await expect(collect(source, { signal })).rejects.toThrow('cancelled');
		await expect(batch(source, { maximumItems: 1, signal }).next()).rejects.toThrow('cancelled');
		expect(factories).toBe(0);
		expect(pulls).toBe(0);
	});

	it('stops observing a stalled producer while preserving return cleanup failures', async () => {
		const controller = new AbortController();
		let cleanup!: Promise<CleanupOutcome>, pulls = 0, returns = 0;
		const failure = new Error('producer cleanup failed');
		const source: AsyncIterable<number> = {
			[Symbol.asyncIterator]() {
				return {
					next() {
						pulls++;
						return new Promise<IteratorResult<number>>(() => {});
					},
					async return() {
						returns++;
						throw failure;
					},
				};
			},
		};
		const collection = collect(source, {
			signal: controller.signal,
			onCleanup(value) {
				cleanup = value;
			},
		});
		controller.abort('stop');
		await expect(collection).rejects.toBe('stop');
		expect(pulls).toBe(1);
		expect(returns).toBe(1);
		expect(await cleanup).toEqual({ status: 'failed', error: failure });
	});

	it('releases the Web Stream lock even if early-return cancellation never settles', async () => {
		const source = new ReadableStream<number>({
			start(controller) {
				controller.enqueue(1);
			},
			cancel() {
				return new Promise<void>(() => {});
			},
		});
		const values = iterable(source);
		expect((await values.next()).value).toBe(1);
		await values.return!();
		expect(source.locked).toBe(false);
	});

	it('does not emit buffered lines after the consumer aborts between records', async () => {
		const controller = new AbortController();
		const source = new Response('first\nsecond\n').body!;
		const records = lines(source, { signal: controller.signal });
		expect((await records.next()).value).toBe('first');
		controller.abort('stop between lines');
		await expect(records.next()).rejects.toBe('stop between lines');
		expect(source.locked).toBe(false);
	});
});
