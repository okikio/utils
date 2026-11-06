import './polyfill.ts';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as duration from './mod.ts';

describe('duration rounding', () => {
	it('defaults to nearest-unit rounding with ties away from zero', () => {
		expect(duration.round('PT1.5S', 'seconds').toString()).toBe('PT2S');
		expect(duration.round('-PT1.5S', 'second').toString()).toBe('-PT2S');
	});

	it('supports a caller-selected increment', () => {
		const value = duration.round('PT6M', { smallestUnit: 'minute', roundingIncrement: 5, roundingMode: 'ceil' });
		expect(value.toString()).toBe('PT10M');
	});

	it('balances smaller fields into a requested largest unit', () => {
		const value = duration.round({ seconds: 3661 }, { largestUnit: 'hours' });
		expect(value.hours).toBe(1);
		expect(value.minutes).toBe(1);
		expect(value.seconds).toBe(1);
	});

	it('uses Temporal rounding modes for negative values', () => {
		expect(duration.round('-PT1.9S', { smallestUnit: 'second', roundingMode: 'trunc' }).toString()).toBe('-PT1S');
		expect(duration.round('-PT1.1S', { smallestUnit: 'second', roundingMode: 'floor' }).toString()).toBe('-PT2S');
	});

	it('requires a real calendar reference when balancing months', () => {
		expect(() => duration.round({ months: 1 }, { largestUnit: 'day' })).toThrow(RangeError);
		const value = duration.round({ months: 1 }, { largestUnit: 'day', relativeTo: '2026-02-01' });
		expect(value.days).toBe(28);
	});

	it('rejects increments that do not divide the next unit', () => {
		expect(() => duration.round('PT6M', { smallestUnit: 'minute', roundingIncrement: 7 })).toThrow(RangeError);
	});

	it('requires a rounding or balancing unit', () => {
		expect(() => duration.round('PT1S', {})).toThrow(RangeError);
	});
});
