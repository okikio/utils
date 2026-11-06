import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as random from './random.ts';

describe('secure random policies', () => {
	it('fills only a visible range and crosses native quota boundaries', () => {
		const storage = new Uint8Array(70002);
		storage[0] = 123;
		storage[70001] = 124;
		expect(random.fill(storage.subarray(1, 70001)).length).toBe(70000);
		expect(storage[0]).toBe(123);
		expect(storage[70001]).toBe(124);
	});
	it('fills shared views through ordinary temporary storage', () => {
		const storage = new Uint8Array(new SharedArrayBuffer(70002));
		storage[0] = 123;
		storage[70001] = 124;
		expect(random.fill(storage.subarray(1, 70001)).length).toBe(70000);
		expect(storage[0]).toBe(123);
		expect(storage[70001]).toBe(124);
	});
	it('permits an empty allocation', () => {
		expect(random.bytes(0)).toEqual(new Uint8Array());
	});

	for (const size of [-1, 0.1, NaN, Infinity, random.MAX_BYTES + 1]) {
		it(`rejects invalid byte count ${size}`, () => {
			expect(() => random.bytes(size)).toThrow(RangeError);
		});
	}

	for (
		const [min, max] of [[0, 0], [2, 1], [0, Infinity], [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]] as const
	) {
		it(`rejects unsafe or nonincreasing integer bounds [${min}, ${max})`, () => {
			expect(() => random.integer(min, max)).toThrow(RangeError);
		});
	}

	it('returns the only admitted integer in a one-value range', () => {
		expect(random.integer(-7, -6)).toBe(-7);
	});

	it('keeps sampled integers within the inclusive lower and exclusive upper bounds', () => {
		// This verifies range membership, not randomness quality or distribution.
		for (let index = 0; index < 100; index++) {
			const value = random.integer(-10, 17);
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(-10);
			expect(value).toBeLessThan(17);
		}
	});
});
