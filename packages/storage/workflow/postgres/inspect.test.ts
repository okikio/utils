import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { AttemptsSchema } from './inspect.ts';

describe('inspection timestamp contracts', () => {
	it('preserves exact database milliseconds and cursor microseconds', () => {
		for (
			const observedAt of [
				'2024-02-29T12:34:56.123Z',
				'2024-02-29T12:34:56.123456Z',
				'0000-01-01T00:00:00.000Z',
				'9999-12-31T23:59:59.999999Z',
			]
		) {
			expect(AttemptsSchema.parse({ observedAt, items: [], next: null }).observedAt).toBe(observedAt);
		}
	});
	it('rejects calendar rollover and invalid time values', () => {
		for (
			const observedAt of [
				'2026-02-31T12:00:00.000Z',
				'2026-02-29T12:00:00.000Z',
				'2026-01-01T24:00:00.000Z',
				'2026-01-01T23:60:00.000Z',
				'2026-01-01T23:59:60.000Z',
			]
		) {
			expect(() => AttemptsSchema.parse({ observedAt, items: [], next: null })).toThrow();
		}
	});
	it('does not admit alternate offsets, annotations, or fractional widths', () => {
		for (
			const observedAt of [
				'2026-01-01T12:00:00.000+00:00',
				'2026-01-01T12:00:00.000Z[UTC]',
				'2026-01-01T12:00:00Z',
				'2026-01-01T12:00:00.12Z',
				'2026-01-01T12:00:00.1234Z',
				'2026-01-01T12:00:00.123456789Z',
			]
		) {
			expect(() => AttemptsSchema.parse({ observedAt, items: [], next: null })).toThrow();
		}
	});
});
