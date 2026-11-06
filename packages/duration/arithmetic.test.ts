import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as arithmetic from './arithmetic.ts';
import { elapsedNanoseconds } from './conversion.ts';
import { ns } from './units.ts';

describe('duration arithmetic policies', () => {
	it('preserves bigint precision across sum, subtraction and ordering', () => {
		const large = ns(9_007_199_254_740_993n);
		const options = { mode: 'elapsed' as const, maximumItems: 2 };
		const value = arithmetic.sum([large, ns(1n)], options);
		expect(elapsedNanoseconds(value)).toBe(9_007_199_254_740_994n);
		expect(elapsedNanoseconds(arithmetic.subtract(value, large, options))).toBe(1n);
		expect(elapsedNanoseconds(arithmetic.minimum(value, large, options))).toBe(9_007_199_254_740_993n);
		expect(elapsedNanoseconds(arithmetic.maximum(value, large, options))).toBe(9_007_199_254_740_994n);
	});
	it('handles mixed signs and inclusive clamp with reversed-bound rejection', () => {
		const options = { mode: 'elapsed' as const, maximumItems: 2 };
		expect(arithmetic.sum(['PT2S', '-PT3S'], options).toString()).toBe('-PT1S');
		expect(arithmetic.sum([], options).toString()).toBe('PT0S');
		expect(arithmetic.clamp('PT8S', 'PT1S', 'PT4S', options).toString()).toBe('PT4S');
		expect(() => arithmetic.clamp('PT2S', 'PT4S', 'PT1S', options)).toThrow(RangeError);
		expect(() => arithmetic.subtract('P1M', 'PT1S', options)).toThrow(RangeError);
	});
	it('uses the explicit zoned reference for spring and autumn comparisons', () => {
		for (
			const [relativeTo, expected] of [
				['2026-03-08T00:00-05:00[America/New_York]', 'P1D'],
				['2026-11-01T00:00-04:00[America/New_York]', 'PT24H'],
			] as const
		) {
			expect(arithmetic.minimum('P1D', 'PT24H', { mode: 'calendar', relativeTo }).toString()).toBe(expected);
		}
		expect(arithmetic.sum(['P1M', 'P1D'], { mode: 'calendar', relativeTo: '2024-01-31', maximumItems: 2 }).toString())
			.toBe('P1M1D');
	});
	it('closes the source on count overflow and invalid calendar input', () => {
		let closed = 0;
		function* values() {
			try {
				yield 'PT1S';
				yield 'PT2S';
			} finally {
				closed++;
			}
		}
		expect(() => arithmetic.sum(values(), { mode: 'elapsed', maximumItems: 1 })).toThrow(RangeError);
		expect(closed).toBe(1);
	});
});
