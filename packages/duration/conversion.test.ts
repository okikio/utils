import './polyfill.ts';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';
import * as duration from './mod.ts';

describe('duration unit conversion', () => {
	it('totals mixed clock units as fractional seconds', () => {
		expect(duration.total({ minutes: 1, milliseconds: 500 }, 'seconds')).toBe(60.5);
	});

	it('converts fractional numeric settings directly between units', () => {
		expect(duration.convert(1.5, 'seconds', 'milliseconds')).toBe(1500);
		expect(duration.convert(2500, 'milliseconds', 'seconds')).toBe(2.5);
		expect(duration.convert(-90, 'minutes', 'hours')).toBe(-1.5);
	});

	it('supports all fixed elapsed output units', () => {
		const cases = [
			['week', 1 / 7],
			['weeks', 1 / 7],
			['day', 1],
			['days', 1],
			['hour', 24],
			['hours', 24],
			['minute', 1440],
			['minutes', 1440],
			['second', 86400],
			['seconds', 86400],
			['millisecond', 86400000],
			['milliseconds', 86400000],
			['microsecond', 86400000000],
			['microseconds', 86400000000],
			['nanosecond', 86400000000000],
			['nanoseconds', 86400000000000],
		] as const;
		for (const [unit, expected] of cases) expect(duration.elapsed({ days: 1 }, unit)).toBe(expected);
	});

	it('totals fixed weeks as seven 24-hour days', () => {
		expect(duration.elapsed({ weeks: 1, days: 1 }, 'hours')).toBe(192);
		expect(duration.elapsed({ weeks: -1 }, 'days')).toBe(-7);
	});

	it('keeps elapsed conversion independent of Temporal date limits', () => {
		// This is a valid duration but adding it to any ordinary date can overflow
		// Temporal's date range. Fixed elapsed conversion needs no such date.
		expect(duration.elapsed({ days: 1_000_000_000 }, 'hours')).toBe(24_000_000_000);
	});

	it('retains sub-millisecond output precision', () => {
		expect(duration.elapsed({ microseconds: 500 })).toBe(0.5);
		expect(duration.total({ nanoseconds: 125 }, 'microseconds')).toBe(0.125);
	});

	it('rejects calendar units in fixed elapsed input', () => {
		expect(() => duration.elapsed({ months: 1 })).toThrow(RangeError);
		expect(() => duration.elapsed({ years: 1 })).toThrow(RangeError);
	});

	it('rejects calendar output units from untyped elapsed callers', () => {
		expect(() => Reflect.apply(duration.elapsed, undefined, [{ days: 30 }, 'months'])).toThrow(RangeError);
	});

	it('retains milliseconds as the existing default elapsed output', () => {
		expect(duration.elapsed(duration.days(2))).toBe(172_800_000);
		expect(duration.elapsed({ seconds: 2, milliseconds: 250 })).toBe(2250);
	});

	it('preserves integer nanoseconds through fractional numeric milliseconds', () => {
		// The integer oracle is independent of the floating count constructor.
		// Failures catch remainder cancellation or an incorrect unit scale.
		fc.assert(
			fc.property(fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }), (nanoseconds) => {
				const value = duration.from(nanoseconds / 1_000_000, 'milliseconds');
				expect(duration.total(value, 'nanoseconds')).toBe(nanoseconds);
			}),
			{ seed: 20261101, numRuns: 1000 },
		);
	});
});
