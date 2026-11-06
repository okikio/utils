/** Cancellation must prevent late source values from starting new side effects. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { mapPooledOrdered } from './bounded.ts';

describe('ordered mapper admission', () => {
	it('closes a source value arriving after caller cancellation without invoking its mapper', async () => {
		const reading = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const controller = new AbortController();
		const reason = new Error('request cancelled');
		const mapped: number[] = [];
		let closed = false;
		async function* source(): AsyncIterable<number> {
			try {
				reading.resolve();
				await release.promise;
				yield 1;
			} finally {
				closed = true;
			}
		}
		const values = Array.fromAsync(mapPooledOrdered({
			items: source(),
			concurrency: 1,
			signal: controller.signal,
			map(value) {
				mapped.push(value);
				return Promise.resolve(value);
			},
		}));
		const rejected = expect(values).rejects.toBe(reason);
		await reading.promise;
		controller.abort(reason);
		release.resolve();
		await rejected;
		expect(mapped).toEqual([]);
		expect(closed).toBe(true);
	});

	it('retains an undefined sibling failure and refuses a late second source value', async () => {
		const readingSecond = Promise.withResolvers<void>();
		const cancelled = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const mapped: number[] = [];
		let closed = false;
		async function* source(): AsyncIterable<number> {
			try {
				yield 1;
				readingSecond.resolve();
				await release.promise;
				yield 2;
			} finally {
				closed = true;
			}
		}
		const values = Array.fromAsync(mapPooledOrdered({
			items: source(),
			concurrency: 2,
			async map(value, { signal }) {
				mapped.push(value);
				if (value === 1) {
					signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
					await readingSecond.promise;
					throw undefined;
				}
				return value;
			},
		}));
		const rejected = expect(values).rejects.toBeUndefined();
		await cancelled.promise;
		release.resolve();
		await rejected;
		expect(mapped).toEqual([1]);
		expect(closed).toBe(true);
	});
});
