import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import * as catalog from './mod.ts';

const First = Object.freeze({ id: 'test:first', kind: 'test', description: 'First entry.' });
const Second = Object.freeze({ id: 'test:second', kind: 'test' });

describe('catalog', () => {
	it('preserves prototype-shaped keys as ordinary entries', () => {
		const entries = Object.create(null) as Record<string, typeof First>;
		Object.defineProperty(entries, '__proto__', { value: First, enumerable: true });
		Object.defineProperty(entries, 'constructor', { value: Second, enumerable: true });
		const definitions = catalog.create('test', entries);

		expect(definitions.__proto__).toBe(First);
		expect(definitions.constructor).toBe(Second);
		expect(catalog.values(definitions)).toEqual([First, Second]);
		const ids = catalog.ids(definitions);
		expect(Object.getOwnPropertyDescriptor(ids, '__proto__')?.value).toBe('test:first');
		expect(Object.getOwnPropertyDescriptor(ids, 'constructor')?.value).toBe('test:second');
	});

	it('projects key-preserving identifiers and checks exact membership', () => {
		const definitions = catalog.create('test', { First, Second });
		const selected = catalog.select(definitions, ['Second'] as const);

		expect(catalog.ids(definitions)).toEqual({ First: 'test:first', Second: 'test:second' });
		expect(catalog.ids(selected)).toEqual({ Second: 'test:second' });
		expect(catalog.has(definitions, First)).toBe(true);
		expect(catalog.has(selected, First)).toBe(false);
		expect(catalog.has(definitions, { ...First })).toBe(false);
		expect(catalog.get(definitions, First.id)).toBe(First);
		expect(catalog.get(selected, Second.id)).toBe(Second);
		expect(catalog.get(selected, First.id)).toBeUndefined();
		expect(catalog.get(definitions, 'test:missing')).toBeUndefined();
	});
});
