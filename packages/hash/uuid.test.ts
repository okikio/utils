import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as uuid from './uuid.ts';

describe('UUID policies', () => {
	it('creates a native v4 and normalizes uppercase input on round-trip', () => {
		const value = uuid.v4();
		expect(uuid.version(value)).toBe(4);
		expect(uuid.format(uuid.parse(value.toUpperCase()))).toBe(value);
	});

	for (const timestamp of [1, 1645557742000]) {
		it(`retains v7 timestamp ${timestamp} without requiring random IDs to sort`, () => {
			const value = uuid.v7(timestamp);
			expect(uuid.version(value)).toBe(7);
			expect(uuid.timestamp(value)).toBe(timestamp);
		});
	}

	it('rejects a negative v7 timestamp', () => {
		expect(() => uuid.v7(-1)).toThrow();
	});

	it('refuses timestamp extraction from v4', () => {
		expect(() => uuid.timestamp(uuid.v4())).toThrow();
	});

	it('round-trips nil with version zero', () => {
		expect(uuid.version(uuid.NIL)).toBe(0);
		expect(uuid.format(uuid.parse(uuid.NIL))).toBe(uuid.NIL);
	});

	it('rejects malformed text', () => {
		expect(uuid.is('bad')).toBe(false);
		expect(() => uuid.parse('bad')).toThrow();
	});

	it('rejects a byte view of the wrong length', () => {
		expect(() => uuid.format(new Uint8Array(15))).toThrow(RangeError);
	});

	it('rejects unsupported version and variant bits', () => {
		expect(() => uuid.format(new Uint8Array(16).fill(255))).toThrow(TypeError);
	});
});
