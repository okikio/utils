import './polyfill.ts';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';
import * as units from './units.ts';
import { elapsed, elapsedNanoseconds, total } from './conversion.ts';

describe('named time settings', () => {
	it('returns Temporal durations from every full unit constructor', () => {
		const examples = [
			[units.years(2), 'P2Y'],
			[units.months(2), 'P2M'],
			[units.weeks(2), 'P2W'],
			[units.days(2), 'P2D'],
			[units.hours(2), 'PT2H'],
			[units.minutes(2), 'PT2M'],
			[units.seconds(2), 'PT2S'],
			[units.milliseconds(2), 'PT0.002S'],
			[units.microseconds(2), 'PT0.000002S'],
			[units.nanoseconds(2), 'PT0.000000002S'],
		] as const;
		for (const [value, expected] of examples) {
			expect(value.toString()).toBe(expected);
			expect(typeof value.total).toBe('function');
		}
	});

	it('makes short unit settings compose with conversions and Temporal directly', () => {
		expect(elapsed(units.sec(2.5))).toBe(2500);
		expect(total(units.min(90), 'hours')).toBe(1.5);
		expect(units.hr(1.1).toString()).toBe('PT1H6M');
		expect(elapsedNanoseconds(units.ms(0.000001))).toBe(1n);
		expect(elapsedNanoseconds(units.us(0.001))).toBe(1n);
		expect(units.s).toBe(units.seconds);
		expect(units.sec).toBe(units.seconds);
		expect(units.days(1).add(units.hr(12)).toString()).toBe('P1DT12H');
	});

	it('preserves exact bigint nanoseconds beyond Number integer precision', () => {
		for (const value of [9_007_199_254_740_991n, 9_007_199_254_740_992n, 9_007_199_254_740_993n]) {
			expect(elapsedNanoseconds(units.ns(value))).toBe(value);
			expect(elapsedNanoseconds(units.ns(-value))).toBe(-value);
		}
	});

	it('round trips exact clock magnitudes up to the Temporal duration limit', () => {
		const maximum = (1n << 53n) * 1_000_000_000n - 1n;
		fc.assert(
			fc.property(fc.bigInt({ min: -maximum, max: maximum }), (value) => {
				expect(elapsedNanoseconds(units.ns(value))).toBe(value);
			}),
			{ seed: 20261101, numRuns: 500 },
		);
		expect(() => units.ns(maximum + 1n)).toThrow(RangeError);
		expect(() => units.ns(-maximum - 1n)).toThrow(RangeError);
	});

	it('rejects unsafe numeric integers and meaningful fractional nanoseconds', () => {
		for (const value of [Number.MAX_SAFE_INTEGER + 1, 0.5, -0.5, Number.MIN_VALUE, NaN, Infinity]) {
			expect(() => units.ns(value)).toThrow(RangeError);
		}
		expect(() => units.sec(0.0000000001)).toThrow(RangeError);
		expect(() => units.ms(0.0000005)).toThrow(RangeError);
		expect(elapsedNanoseconds(units.sec(0.1 + 0.2))).toBe(300_000_000n);
	});

	it('keeps signed fixed days and exact sub-millisecond components together', () => {
		expect(elapsedNanoseconds({ weeks: 1, days: 1, nanoseconds: 1 })).toBe(691_200_000_000_001n);
		expect(elapsedNanoseconds({ days: -1, nanoseconds: -1 })).toBe(-86_400_000_000_001n);
		expect(elapsedNanoseconds(units.ns(0n))).toBe(0n);
		expect(() => elapsedNanoseconds(units.months(1))).toThrow(RangeError);
		expect(() => Reflect.apply(units.from, undefined, [1n, 'days'])).toThrow(TypeError);
	});
});
