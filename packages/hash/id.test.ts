import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as id from './id.ts';

describe('random identifiers', () => {
	it('uses the default URL-safe alphabet and length', () => {
		expect(id.random()).toMatch(/^[A-Za-z0-9_-]{21}$/);
	});

	it('uses the configured alphabet and exact length', () => {
		expect(id.create({ alphabet: 'abc', length: 100 })()).toMatch(/^[abc]{100}$/);
	});

	for (const alphabet of ['', 'a', 'aa', 'a b', 'aé']) {
		it(`rejects inadmissible alphabet ${JSON.stringify(alphabet)} before use`, () => {
			expect(() => id.create({ alphabet })).toThrow();
		});
	}

	for (const length of [0, -1, 1.5, Infinity, 1048577]) {
		it(`rejects inadmissible length ${length}`, () => {
			expect(() => id.random(length)).toThrow(RangeError);
		});
	}
});

describe('deterministic identifiers', () => {
	it('preserves the original namespaced tuple digest', async () => {
		expect(await id.derive('row', ['a', 'b'])).toBe('row-0473ef2dc0d324ab659d3580c1134e9d');
	});
});
