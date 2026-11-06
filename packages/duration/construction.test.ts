import './polyfill.ts';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as duration from './mod.ts';
import { Temporal as Ponyfill } from './temporal.ts';

describe('duration construction', () => {
	const units = [
		['year', 'years', 'P2Y'],
		['month', 'months', 'P2M'],
		['week', 'weeks', 'P2W'],
		['day', 'days', 'P2D'],
		['hour', 'hours', 'PT2H'],
		['minute', 'minutes', 'PT2M'],
		['second', 'seconds', 'PT2S'],
		['millisecond', 'milliseconds', 'PT0.002S'],
		['microsecond', 'microseconds', 'PT0.000002S'],
		['nanosecond', 'nanoseconds', 'PT0.000000002S'],
	] as const;

	for (const [singular, plural, expected] of units) {
		it(`accepts singular and plural ${singular} counts`, () => {
			expect(duration.from(2, singular).toString()).toBe(expected);
			expect(duration.from(2, plural).toString()).toBe(expected);
		});
	}

	it('accepts the same duration records used by other utility packages', () => {
		const value = duration.from({ seconds: 2, milliseconds: 500 });
		expect(value.toString()).toBe('PT2.5S');
	});

	it('parses ISO text without converting calendar fields into elapsed time', () => {
		const value = duration.from('P1M2DT3H');
		expect(value.months).toBe(1);
		expect(value.days).toBe(2);
		expect(value.hours).toBe(3);
	});

	it('accepts an explicit ponyfill value without constructor identity checks', () => {
		const value = duration.from(Ponyfill.Duration.from('PT2.5S'));
		expect(value.toString()).toBe('PT2.5S');
	});

	it('accepts fractional clock units', () => {
		expect(duration.from(1.5, 'hours').toString()).toBe('PT1H30M');
		expect(duration.from(1.5, 'minutes').toString()).toBe('PT1M30S');
		expect(duration.from(2.5, 'seconds').toString()).toBe('PT2.5S');
		expect(duration.from(2.5, 'milliseconds').toString()).toBe('PT0.0025S');
		expect(duration.from(2.5, 'microseconds').toString()).toBe('PT0.0000025S');
	});

	it('rejects meaningful sub-nanosecond input while accepting binary arithmetic residue', () => {
		expect(() => duration.from(0.5, 'nanoseconds')).toThrow(RangeError);
		expect(() => duration.from(-0.5, 'nanoseconds')).toThrow(RangeError);
		expect(() => duration.from(0.49, 'nanoseconds')).toThrow(RangeError);
		expect(duration.from(0.1 + 0.2, 'seconds').toString()).toBe('PT0.3S');
	});

	it('retains the whole count when converting only its fractional remainder', () => {
		const value = duration.from(1_000_000_000.5, 'seconds');
		expect(value.seconds).toBe(1_000_000_000);
		expect(duration.total(value, 'seconds')).toBe(1_000_000_000.5);
	});

	it('preserves signed zero as an empty duration', () => {
		expect(duration.from(-0, 'seconds').blank).toBe(true);
		expect(duration.from(0, 'days').sign).toBe(0);
	});

	it('rejects fractional calendar counts rather than assuming a day or month size', () => {
		for (const unit of ['year', 'month', 'week', 'day'] as const) {
			expect(() => duration.from(1.5, unit)).toThrow(RangeError);
		}
	});

	it('rejects non-finite counts', () => {
		for (const value of [NaN, Infinity, -Infinity]) {
			expect(() => duration.from(value, 'seconds')).toThrow(RangeError);
		}
	});

	it('rejects counts outside Temporal duration limits', () => {
		expect(() => duration.from(2 ** 53, 'seconds')).toThrow(RangeError);
	});

	it('rejects unknown units from JavaScript callers', () => {
		for (const unit of ['ms', 'constructor', '__proto__', '', null, 1]) {
			expect(() => Reflect.apply(duration.from, undefined, [1, unit])).toThrow(RangeError);
		}
	});

	it('requires an explicit unit for numeric input', () => {
		expect(() => Reflect.apply(duration.from, undefined, [1000])).toThrow(TypeError);
	});

	it('rejects a unit attached to a non-numeric input', () => {
		expect(() => Reflect.apply(duration.from, undefined, ['2', 'seconds'])).toThrow(TypeError);
	});

	it('retains Temporal validation for structured inputs', () => {
		expect(() => duration.from({ seconds: 2.5 })).toThrow(RangeError);
		expect(() => duration.from({ seconds: 1, milliseconds: -1 })).toThrow(RangeError);
	});
});
