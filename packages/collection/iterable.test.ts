import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as iterable from './iterable.ts';

describe('bounded synchronous iterables', () => {
	it('yields a full first chunk before reading another value and closes on break', () => {
		let read = 0;
		let closed = 0;
		const source = function* () {
			try {
				while (true) yield read++;
			} finally {
				closed++;
			}
		};
		for (const values of iterable.chunk(source(), 2)) {
			expect(values).toEqual([0, 1]);
			expect(Object.isFrozen(values)).toBe(true);
			break;
		}
		expect(read).toBe(2);
		expect(closed).toBe(1);
	});
	it('preserves remainder and validates size without opening the source', () => {
		expect([...iterable.chunk([1, 2, 3], 2)]).toEqual([[1, 2], [3]]);
		for (const size of [0, -1, 1.5, Infinity, NaN]) expect(() => [...iterable.chunk([], size)]).toThrow(RangeError);
	});
	it('keeps first SameValueZero identities including NaN and closes after early unique output', () => {
		const options = { maximumItems: 5, maximumKeys: 3 };
		expect([...iterable.unique([NaN, NaN, 0, -0, 1], (v) => v, options)]).toEqual([NaN, 0, 1]);
		let closed = 0;
		const source = function* () {
			try {
				yield 1;
				yield 2;
			} finally {
				closed++;
			}
		};
		for (const _ of iterable.unique(source(), (v) => v, options)) break;
		expect(closed).toBe(1);
	});
	it('bounds scans even for all-duplicate input and closes on key overflow or callback defect', () => {
		for (const mode of ['items', 'keys', 'callback']) {
			let closed = 0;
			const source = function* () {
				try {
					yield 1;
					yield 2;
					yield 3;
				} finally {
					closed++;
				}
			};
			const defect = new Error('key');
			expect(() => [...iterable.unique(source(), (v) => {
				if (mode === 'callback') throw defect;
				return mode === 'items' ? 0 : v;
			}, { maximumItems: mode === 'items' ? 1 : 3, maximumKeys: mode === 'keys' ? 1 : 3 })]).toThrow();
			expect(closed).toBe(1);
		}
	});
	it('materializes ordered groups and makes duplicate index behavior explicit', () => {
		const source = [{ key: 'b', n: 1 }, { key: 'a', n: 2 }, { key: 'b', n: 3 }];
		const options = { maximumItems: 3, maximumKeys: 2 };
		const groups = iterable.group(source, (v) => v.key, options);
		expect([...groups.keys()]).toEqual(['b', 'a']);
		expect(groups.get('b')).toEqual([source[0], source[2]]);
		expect(Object.isFrozen(groups.get('b'))).toBe(true);
		expect(iterable.index(source, (v) => v.key, { ...options, duplicates: 'first' }).get('b')).toBe(source[0]);
		const last = iterable.index(source, (v) => v.key, { ...options, duplicates: 'last' });
		expect(last.get('b')).toBe(source[2]);
		expect([...last.keys()]).toEqual(['b', 'a']);
		expect(() => iterable.index(source, (v) => v.key, { ...options, duplicates: 'reject' })).toThrow(TypeError);
	});
	it('supports zero bounds for empty input and rejects nonempty input', () => {
		const options = { maximumItems: 0, maximumKeys: 0 };
		expect(iterable.group([], (v) => v, options).size).toBe(0);
		expect(() => iterable.group([1], (v) => v, options)).toThrow(RangeError);
	});
});
