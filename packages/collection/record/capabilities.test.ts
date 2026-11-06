import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fc from 'fast-check';
import * as record from './mod.ts';
import * as json from './json.ts';
import * as change from './change.ts';

describe('safe record capabilities', () => {
	it('keeps prototype-shaped keys as own data and exact selected keys', () => {
		const input = record.fromEntries([['__proto__', 1], ['constructor', 2], ['other', 3]], {
			maximumItems: 3,
			duplicates: 'reject',
		});
		expect(Object.getPrototypeOf(input)).toBe(null);
		expect(input.__proto__).toBe(1);
		expect(record.omit(input, ['other'])).toEqual(JSON.parse('{"__proto__":1,"constructor":2}'));
		expect(Object.keys(record.map(input, (value) => Number(value) * 2))).toEqual(['__proto__', 'constructor', 'other']);
		expect(record.filter(input, (_, key) => key === 'other')).toEqual({ other: 3 });
		expect(Object.isFrozen(input)).toBe(true);
	});
	it('closes bounded sources, counts duplicates, and keeps first/last/reject policies distinct', () => {
		let closed = false;
		function* entries(): Generator<readonly [string, number]> {
			try {
				yield ['a', 1];
				yield ['a', 2];
				yield ['b', 3];
			} finally {
				closed = true;
			}
		}
		expect(() => record.fromEntries(entries(), { maximumItems: 2, duplicates: 'last' })).toThrow(RangeError);
		expect(closed).toBe(true);
		expect(record.fromEntries(entries(), { maximumItems: 3, duplicates: 'first' })).toEqual({ a: 1, b: 3 });
		expect(record.fromEntries(entries(), { maximumItems: 3, duplicates: 'last' })).toEqual({ a: 2, b: 3 });
		expect(() => record.fromEntries(entries(), { maximumItems: 3, duplicates: 'reject' })).toThrow(TypeError);
	});
	it('validates all descriptors before callbacks and propagates callback defects', () => {
		let read = false;
		let called = false;
		const input = Object.defineProperty({ good: 1 }, 'bad', {
			enumerable: true,
			get() {
				read = true;
				throw new Error();
			},
		});
		expect(() =>
			record.map(input, () => {
				called = true;
				return 1;
			})
		).toThrow(TypeError);
		expect(read || called).toBe(false);
		expect(() => record.filter({ [Symbol()]: 1 }, () => true)).toThrow(TypeError);
		const defect = new Error('callback');
		expect(() =>
			record.map({ a: 1 }, () => {
				throw defect;
			})
		).toThrow(defect);
	});
});

describe('deterministic finite JSON and reversible changes', () => {
	it('sorts keys including numeric names and enforces actual escaped UTF-8 bytes', () => {
		expect(json.stringify({ '2': -0, '10': 'é', a: '\n' }, { maximumBytes: 100 })).toBe('{"10":"é","2":0,"a":"\\n"}');
		expect(json.stringify('é', { maximumBytes: 4 })).toBe('"é"');
		expect(() => json.stringify('é', { maximumBytes: 3 })).toThrow(RangeError);
		expect(() => json.stringify({ a: undefined }, { maximumBytes: 100 })).toThrow(TypeError);
	});
	it('inverts and composes generated JSON edits against their exact base', () => {
		fc.assert(
			fc.property(fc.jsonValue(), fc.jsonValue(), fc.jsonValue(), (base, middle, end) => {
				const first = change.diff(base, middle);
				const second = change.diff(middle, end);
				expect(change.equal(change.patch(middle, change.invert(base, first)), base)).toBe(true);
				expect(change.equal(change.patch(base, change.compose(base, first, second)), end)).toBe(true);
			}),
			{ seed: 20261104, numRuns: 100 },
		);
		expect(() => change.compose({}, [{ type: 'remove', path: ['absent'] }], [])).toThrow(TypeError);
	});
});
