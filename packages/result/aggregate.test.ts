import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as result from './mod.ts';

describe('bounded result aggregation', () => {
	it('collects empty and heterogeneous successful values in encounter order', () => {
		expect(result.all([])).toEqual(result.ok([]));
		expect(result.all([result.ok(1), result.ok('two')])).toEqual(result.ok([1, 'two']));
	});

	it('returns the first failure by identity and closes the unconsumed tail', () => {
		const failure = result.fail({ code: 'missing' });
		let visited = 0;
		let closed = false;
		function* source(): Generator<result.Result<number, { code: string }>> {
			try {
				visited++;
				yield result.ok(1);
				visited++;
				yield failure;
				visited++;
				yield result.ok(3);
			} finally {
				closed = true;
			}
		}
		expect(result.all(source(), { maximumItems: 8 })).toBe(failure);
		expect(visited).toBe(2);
		expect(closed).toBe(true);
	});

	it('partitions in encounter order and preserves failure payload identity', () => {
		const reason = { code: 'missing' };
		const split = result.partition([result.ok(1), result.fail(reason), result.ok(2)], { maximumItems: 3 });
		expect(split.values).toEqual([1, 2]);
		expect(split.failures[0]).toBe(reason);
	});

	it('closes the partition source when the next item exceeds admission', () => {
		let closed = false;
		function* source() {
			try {
				yield result.ok(1);
				yield result.ok(2);
			} finally {
				closed = true;
			}
		}
		expect(() => result.partition(source(), { maximumItems: 1 })).toThrow(RangeError);
		expect(closed).toBe(true);
	});

	it('observes only the selected branch and preserves result identity', () => {
		const value = result.ok(1);
		const failure = result.fail('missing');
		let called = 0;
		expect(result.tap(value, () => called++)).toBe(value);
		expect(result.tap(failure, () => called++)).toBe(failure);
		expect(result.tapFailure(failure, () => called++)).toBe(failure);
		expect(called).toBe(2);
	});

	it('propagates an observer defect by identity', () => {
		const value = result.ok(1);
		const defect = new Error('observer defect');
		expect(() =>
			result.tap(value, () => {
				throw defect;
			})
		).toThrow(defect);
	});

	it('propagates a source defect after a successful item', () => {
		const defect = new Error('source defect');
		function* source() {
			yield result.ok(1);
			throw defect;
		}
		expect(() => result.all(source(), { maximumItems: 2 })).toThrow(defect);
	});
});
