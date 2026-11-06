import './polyfill.ts';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as duration from './mod.ts';

describe('explicit UTC instants', () => {
	it('interprets date-only text at UTC midnight', () => {
		expect(duration.parseInstant('2026-11-01')).toBe(1_793_491_200_000);
	});

	it('applies the supplied offset without using the host time zone', () => {
		expect(duration.parseInstant('2026-11-01T01:30:00-04:00')).toBe(1_793_511_000_000);
	});

	it('writes canonical UTC text with millisecond precision', () => {
		expect(duration.formatInstant(1_793_491_200_000)).toBe('2026-11-01T00:00:00.000Z');
		expect(duration.formatInstant(-1)).toBe('1969-12-31T23:59:59.999Z');
	});

	it('reduces sub-millisecond input fractions to epoch-millisecond precision', () => {
		expect(duration.parseInstant('1970-01-01T00:00:00.000999999Z')).toBe(0);
	});

	it('keeps offset ranges and the seconds profile consistent across native and fallback Temporal', () => {
		for (
			const value of [
				'2026-01-01T12:00:00+00:60',
				'2026-01-01T12:00:00-00:60',
				'2026-01-01T12:00:00+24:00',
				'2026-01-01T12:00:60Z',
				'2026-01-01T24:00:00Z',
				'2026-01-01T12:00:00Z[UTC]',
			]
		) expect(() => duration.parseInstant(value)).toThrow(RangeError);
		expect(duration.parseInstant('1970-01-01T23:59:00+23:59')).toBe(0);
	});

	for (const value of ['2025-02-29', '2026-04-31', '2026-11-01T01:30:00', '2026-02-30T00:00:00Z', 'not-a-date']) {
		it(`rejects invalid or ambiguous instant ${value}`, () => {
			expect(() => duration.parseInstant(value)).toThrow(RangeError);
		});
	}

	it('rejects epoch values that cannot be serialized exactly as milliseconds', () => {
		for (const value of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) {
			expect(() => duration.formatInstant(value)).toThrow(RangeError);
		}
	});
});
