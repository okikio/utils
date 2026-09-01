import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { mapPooledOrdered, mapPooledUnordered, runBoundedQueue } from '#/bounded.ts';

describe('runBoundedQueue', () => {
	it('keeps active operations within the configured std pool size', async () => {
		let active = 0;
		let maximumActive = 0;
		await runBoundedQueue({
			items: [1, 2, 3, 4, 5, 6],
			concurrency: 2,
			async run() {
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				await new Promise((resolve) => setTimeout(resolve, 2));
				active -= 1;
			},
		});
		expect(maximumActive).toBe(2);
		expect(active).toBe(0);
	});

	it('stops scheduling new work after cooperative cancellation', async () => {
		const completed: number[] = [];
		let stopped = false;
		await runBoundedQueue({
			items: [1, 2, 3, 4],
			concurrency: 1,
			shouldStop: () => stopped,
			async run(value) {
				completed.push(value);
				stopped = true;
			},
		});
		expect(completed).toEqual([1]);
	});

	it('rejects invalid concurrency instead of silently coercing it', async () => {
		await expect(runBoundedQueue({
			items: [1],
			concurrency: Number.NaN,
			run: () => Promise.resolve(),
		})).rejects.toThrow('positive safe integer');
	});

	it('processes undefined values as data', async () => {
		const values: Array<number | undefined> = [];
		await runBoundedQueue({
			items: [undefined, 1],
			concurrency: 1,
			async run(value) {
				values.push(value);
			},
		});
		expect(values).toEqual([undefined, 1]);
	});

	it('aborts an admitted sibling before returning the mapper failure', async () => {
		const started: number[] = [];
		let siblingSettled = false;
		await expect(runBoundedQueue({
			items: [1, 2, 3, 4],
			concurrency: 2,
			async run(value, { signal }) {
				started.push(value);
				if (value === 2) throw new Error('worker failed');
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				}).finally(() => {
					siblingSettled = true;
				});
			},
		})).rejects.toThrow('worker failed');
		expect(started).toEqual([1, 2]);
		expect(siblingSettled).toBe(true);
	});
});

describe('mapPooledOrdered', () => {
	it('rethrows the concrete mapper failure after admitted siblings observe cancellation', async () => {
		let siblingAborted = false;
		const values = mapPooledOrdered({
			items: [1, 2],
			concurrency: 2,
			async map(value, { signal }) {
				if (value === 2) throw new TypeError('detector parse failed');
				try {
					await new Promise<void>((_resolve, reject) => {
						signal.addEventListener('abort', () => reject(signal.reason), { once: true });
					});
				} finally {
					siblingAborted = true;
				}
				return value;
			},
		});
		await expect((async () => {
			for await (const _ of values) { /* drain */ }
		})()).rejects.toThrow(TypeError);
		expect(siblingAborted).toBe(true);
	});
});

describe('mapPooledUnordered', () => {
	it('yields values in completion order while std pooledMap owns admission', async () => {
		const releases = new Map<number, () => void>();
		const values: number[] = [];
		const iterator = mapPooledUnordered({
			items: [1, 2, 3],
			concurrency: 3,
			async map(value) {
				await new Promise<void>((resolve) => releases.set(value, resolve));
				return value;
			},
		})[Symbol.asyncIterator]();

		const first = iterator.next();
		while (releases.size < 3) await Promise.resolve();
		releases.get(3)?.();
		values.push((await first).value as number);
		releases.get(1)?.();
		values.push((await iterator.next()).value as number);
		releases.get(2)?.();
		values.push((await iterator.next()).value as number);
		await iterator.return?.();
		expect(values).toEqual([3, 1, 2]);
	});

	it('cancels admitted transforms when the consumer stops early', async () => {
		let secondAborted = false;
		for await (
			const value of mapPooledUnordered({
				items: [1, 2],
				concurrency: 2,
				async map(item, { signal }) {
					if (item === 1) return item;
					try {
						await new Promise<void>((_resolve, reject) => {
							signal.addEventListener('abort', () => reject(signal.reason), { once: true });
						});
					} catch {
						secondAborted = true;
					}
					return item;
				},
			})
		) {
			expect(value).toBe(1);
			break;
		}
		expect(secondAborted).toBe(true);
	});
	it('does not reuse a pool slot until an acknowledged completion is consumed', async () => {
		const started: number[] = [];
		const iterator = mapPooledUnordered({
			items: [1, 2],
			concurrency: 1,
			acknowledgeCompletions: true,
			async map(value) {
				started.push(value);
				return value;
			},
		})[Symbol.asyncIterator]();

		expect((await iterator.next()).value).toBe(1);
		expect(started).toEqual([1]);
		const second = iterator.next();
		while (started.length < 2) await Promise.resolve();
		expect((await second).value).toBe(2);
		await iterator.return?.();
	});
});
