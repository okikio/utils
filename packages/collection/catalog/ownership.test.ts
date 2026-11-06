/** Shared record rules protect catalog composition without reading accessors. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as catalog from './mod.ts';

describe('catalog input ownership', () => {
	it('rejects a getter-bearing catalog record without executing the getter', () => {
		let calls = 0;
		const entries = {
			get one() {
				calls++;
				return { id: 'one', kind: 'test' };
			},
		};
		expect(() => catalog.create('test', entries)).toThrow(TypeError);
		expect(calls).toBe(0);
	});
	it('rejects accessor identity and cyclic composition', () => {
		let calls = 0;
		const entry = {
			get id() {
				calls++;
				return 'one';
			},
			kind: 'test',
		};
		expect(catalog.validate(entry).valid).toBe(false);
		expect(calls).toBe(0);
		const cycle: unknown[] = [];
		cycle.push(cycle);
		expect(catalog.validate(cycle).valid).toBe(false);
	});
	it('retains repeated noncyclic arrays and rejects inherited list entries', () => {
		const entry = { id: 'one', kind: 'test' };
		const part = [entry];
		expect(catalog.values([part, part])).toEqual([entry]);
		expect(catalog.validate(new Array(1)).valid).toBe(false);
	});
});
