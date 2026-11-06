import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { MeterReadingSchema } from './schema.ts';

describe('meter timestamp semantics', () => {
	it('preserves valid offset text and fractional precision', () => {
		for (
			const at of [
				'2024-02-29T12:34:56Z',
				'2024-02-29T12:34:56.123456789123+05:30',
				'0000-01-01T00:00:00.000Z',
				'9999-12-31T23:59:59-00:00',
			]
		) {
			expect(MeterReadingSchema.parse({ value: 1, at }).at).toBe(at);
		}
	});
	it('rejects impossible calendar and clock values', () => {
		for (
			const at of [
				'2026-02-31T12:00:00Z',
				'2026-02-29T12:00:00Z',
				'2026-04-31T12:00:00Z',
				'2026-01-01T24:00:00Z',
				'2026-01-01T12:60:00Z',
				'2026-01-01T12:00:60Z',
				'2026-01-01T12:00:00+24:00',
				'2026-01-01T12:00:00+00:60',
			]
		) {
			expect(() => MeterReadingSchema.parse({ value: 1, at })).toThrow();
		}
	});
	it('keeps the explicit wire profile narrower than Temporal ISO parsing', () => {
		for (
			const at of [
				'2026-01-01',
				'2026-01-01T12:00Z',
				'2026-01-01T12:00:00',
				'2026-01-01 12:00:00Z',
				'2026-01-01T12:00:00Z[UTC]',
			]
		) {
			expect(() => MeterReadingSchema.parse({ value: 1, at })).toThrow();
		}
	});
});
