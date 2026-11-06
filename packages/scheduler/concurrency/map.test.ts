import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { fail, ok } from '@okikio/result';
import { map } from './map.ts';

describe('bounded public mapping', () => {
	it('bounds admitted tail results behind a slow first item', async () => {
		const first = Promise.withResolvers<void>();
		const admitted = Promise.withResolvers<void>();
		let started = 0;
		let closed = 0;
		async function* source() {
			try {
				for (let value = 0; value < 100; value++) yield value;
			} finally {
				closed++;
			}
		}
		const iterator = map(source(), async (value) => {
			if (++started === 3) admitted.resolve();
			if (value === 0) await first.promise;
			return value;
		}, { concurrency: 3, maximumBuffered: 3, ordering: 'input' })[Symbol.asyncIterator]();
		const pending = iterator.next();
		await admitted.promise;
		expect(started).toBe(3);
		first.resolve();
		expect((await pending).value).toBe(0);
		await iterator.return?.();
		expect(started).toBe(3);
		expect(closed).toBe(1);
	});
	it('requires an explicit sufficient result budget before pulling source', () => {
		expect(() =>
			map([1], (value) => value, {
				concurrency: 2,
				maximumBuffered: 1,
				ordering: 'input',
			})
		).toThrow(RangeError);
	});
	it('retains expected failures in settled mode and preserves thrown defects', async () => {
		const values = await Array.fromAsync(map([1, 2, 3], (value) => value === 2 ? fail('missing') : ok(value), {
			concurrency: 2,
			maximumBuffered: 2,
			ordering: 'input',
			mode: 'settled',
		}));
		expect(values).toEqual([ok(1), fail('missing'), ok(3)]);
		const defect = new Error('mapper defect');
		await expect(Array.fromAsync(map([1, 2], () => {
			throw defect;
		}, {
			concurrency: 1,
			maximumBuffered: 1,
			ordering: 'input',
			mode: 'settled',
		}))).rejects.toBe(defect);
	});
	it('acknowledges unordered results only when the consumer resumes and cancels siblings on return', async () => {
		let started = 0;
		let stopped = 0;
		const iterator = map([0, 1, 2, 3, 4], async (value, { signal }) => {
			started++;
			if (value === 0) return value;
			await new Promise<void>((resolve) =>
				signal.addEventListener('abort', () => {
					stopped++;
					resolve();
				}, { once: true })
			);
			return value;
		}, { concurrency: 2, maximumBuffered: 2, ordering: 'completion' })[Symbol.asyncIterator]();
		expect((await iterator.next()).value).toBe(0);
		expect(started).toBeLessThanOrEqual(2);
		await iterator.return?.();
		expect(stopped).toBe(started - 1);
	});
});
