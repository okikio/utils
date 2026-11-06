import './polyfill.ts';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as duration from './mod.ts';

describe('calendar and elapsed durations', () => {
	it('uses an explicit reference for month conversion', () => {
		expect(duration.convert(1, 'month', 'days', { relativeTo: '2026-02-01' })).toBe(28);
		expect(duration.convert(1, 'month', 'days', { relativeTo: '2024-02-01' })).toBe(29);
	});

	it('accepts standard Temporal date records as references', () => {
		expect(duration.total({ years: 1 }, 'days', { relativeTo: { year: 2024, month: 1, day: 1 } })).toBe(366);
	});

	it('requires a reference when converting to calendar units', () => {
		expect(() => duration.total({ days: 31 }, 'months')).toThrow(RangeError);
		expect(() => duration.total({ days: 365 }, 'years')).toThrow(RangeError);
		expect(() => duration.total({ days: 7 }, 'weeks')).toThrow(RangeError);
	});

	it('requires a reference when the input contains calendar units', () => {
		expect(() => duration.total({ months: 1 }, 'days')).toThrow(RangeError);
		expect(() => duration.total({ years: 1 }, 'days')).toThrow(RangeError);
		expect(() => duration.total({ weeks: 1 }, 'days')).toThrow(RangeError);
	});

	it('distinguishes a spring clock-change day from a fixed elapsed day', () => {
		const relativeTo = '2026-03-08T00:00:00-05:00[America/New_York]';
		expect(duration.convert(1, 'day', 'hours', { relativeTo })).toBe(23);
		expect(duration.elapsed(duration.days(1), 'hours')).toBe(24);
		expect(duration.compare({ days: 1 }, { hours: 23 }, { relativeTo })).toBe(0);
	});

	it('measures a fall clock-change day as 25 hours', () => {
		const relativeTo = '2026-11-01T00:00:00-04:00[America/New_York]';
		expect(duration.convert(1, 'day', 'hours', { relativeTo })).toBe(25);
	});

	it('requires a real reference instead of choosing an arbitrary calendar date', () => {
		expect(() => duration.compare({ months: 1 }, { days: 31 })).toThrow(RangeError);
		expect(duration.compare({ months: 1 }, { days: 28 }, { relativeTo: '2026-02-01' })).toBe(0);
	});

	it('orders signed durations consistently', () => {
		expect(duration.compare({ milliseconds: -1 }, { milliseconds: 0 })).toBeLessThan(0);
		expect(duration.compare({ seconds: 1 }, { milliseconds: 999 })).toBeGreaterThan(0);
	});

	it('authors whole fixed days without application-specific limits', () => {
		expect(duration.days(4000).toString()).toBe('P4000D');
		expect(duration.elapsed(duration.days(-1))).toBe(-86_400_000);
		expect(duration.elapsed(duration.days(0))).toBe(0);
	});

	it('rejects fractional, non-finite and out-of-range calendar counts', () => {
		for (const value of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
			expect(() => duration.days(value)).toThrow(RangeError);
		}
	});
});
