import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { create, DurationFormatUnsupportedError, format } from './format.ts';

describe('explicit duration formatting', () => {
	it('matches pinned English locale output and applies explicit rounding', () => {
		const formatter = create({ locale: 'en-US', style: 'long', fallback: 'reject' });
		expect(formatter.mode).toBe('intl');
		expect(formatter.format('PT1H2M')).toBe('1 hour, 2 minutes');
		expect(
			format('PT1.6S', {
				locale: 'en-US',
				style: 'long',
				fallback: 'reject',
				rounding: { smallestUnit: 'second', roundingMode: 'halfExpand' },
			}),
		).toBe('2 seconds');
	});
	it('never silently chooses the ambient locale or an invalid policy', () => {
		expect(() => create({ locale: [], fallback: 'iso' })).toThrow(RangeError);
		expect(() => create({ locale: 'invalid_locale', fallback: 'iso' })).toThrow(RangeError);
	});
	it('makes missing-host fallback explicit without leaving global changes', () => {
		const descriptor = Object.getOwnPropertyDescriptor(Intl, 'DurationFormat');
		try {
			Object.defineProperty(Intl, 'DurationFormat', { value: undefined, configurable: true });
			expect(create({ locale: 'en-US', fallback: 'iso' }).format('-PT2S')).toBe('-PT2S');
			expect(() => create({ locale: 'en-US', fallback: 'reject' })).toThrow(DurationFormatUnsupportedError);
		} finally {
			if (descriptor === undefined) Reflect.deleteProperty(Intl, 'DurationFormat');
			else Object.defineProperty(Intl, 'DurationFormat', descriptor);
		}
	});
});
