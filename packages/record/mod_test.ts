import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as record from './mod.ts';

describe('record', () => {
	it('accepts plain and null-prototype data records', () => {
		expect(record.is({ a: 1 })).toBe(true);
		const nullRecord = Object.create(null) as Record<string, unknown>;
		nullRecord.__proto__ = 'value';
		expect(record.is(nullRecord)).toBe(true);
		expect(record.snapshot(nullRecord).__proto__).toBe('value');
	});

	it('rejects inherited, hidden, symbol, and accessor properties without invoking accessors', () => {
		let reads = 0;
		const accessor = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(accessor, 'value', { enumerable: true, get() { reads += 1; return 1; } });
		expect(record.is(accessor)).toBe(false);
		expect(() => record.assert(accessor, 'input')).toThrow('enumerable data property');
		expect(reads).toBe(0);

		const inherited = Object.create({ hidden: 1 }) as Record<string, unknown>;
		inherited.visible = 2;
		expect(() => record.assert(inherited, 'input')).toThrow('plain object or null-prototype record');

		const hidden = {} as Record<string, unknown>;
		Object.defineProperty(hidden, 'value', { value: 1, enumerable: false });
		expect(() => record.assert(hidden, 'input')).toThrow('enumerable data property');

		const symbol = { value: 1 } as Record<string, unknown>;
		Object.defineProperty(symbol, Symbol('hidden'), { value: 2, enumerable: true });
		expect(() => record.assert(symbol, 'input')).toThrow('string keys only');
	});

	it('returns exact ordered keys and entries and snapshots caller mutation', () => {
		const source = { a: 1, b: 2 };
		expect(record.keys(source)).toEqual(['a', 'b']);
		expect(record.entries(source)).toEqual([['a', 1], ['b', 2]]);
		const snapshot = record.snapshot(source);
		source.a = 9;
		expect(snapshot.a).toBe(1);
		expect(Object.getPrototypeOf(snapshot)).toBe(null);
		expect(Object.isFrozen(snapshot)).toBe(true);
	});
});
