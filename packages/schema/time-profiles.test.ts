import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { Temporal } from '@okikio/duration/temporal';
import * as codec from './codec/mod.ts';
import { DateSchema, DurationSchema, ElapsedSchema, InstantSchema } from './time.ts';
import * as schema from './mod.ts';

describe('explicit Temporal wire profiles', () => {
	it('preserves nanoseconds before and after epoch and accepts explicit ponyfill values', async () => {
		for (const text of ['1969-12-31T23:59:59.999999999Z', '2024-02-29T12:00:00.123456789Z']) {
			const instant = await codec.decode(InstantSchema, text);
			expect(await codec.encode(InstantSchema, instant)).toBe(text);
			expect(await codec.encode(InstantSchema, Temporal.Instant.from(text))).toBe(text);
		}
		expect(await codec.encode(InstantSchema, await codec.decode(InstantSchema, '1970-01-01T00:00:00Z'))).toBe(
			'1970-01-01T00:00:00.000000000Z',
		);
		expect(await codec.encode(DateSchema, await codec.decode(DateSchema, '1970-01-01T00:00:00.123456789Z'))).toBe(
			'1970-01-01T00:00:00.123Z',
		);
	});
	it('rejects excess precision, offsets, leap seconds and calendar-invalid timestamps', async () => {
		for (
			const value of [
				'2024-02-30T00:00:00Z',
				'2024-01-01T00:00:60Z',
				'2024-01-01T00:00:00.1234567890Z',
				'2024-01-01T00:00:00+00:00',
				'+010000-01-01T00:00:00Z',
			]
		) {
			await expect(codec.decode(InstantSchema, value)).rejects.toBeInstanceOf(schema.SchemaValidationError);
		}
		await expect(codec.encode(InstantSchema, Temporal.Instant.from('+010000-01-01T00:00:00Z'))).rejects.toThrow();
	});
	it('retains calendar durations while the elapsed profile rejects months and normalizes fixed days', async () => {
		expect((await codec.decode(DurationSchema, 'P1M')).months).toBe(1);
		expect(await codec.encode(DurationSchema, Temporal.Duration.from('P1M'))).toBe('P1M');
		await expect(codec.decode(ElapsedSchema, 'P1M')).rejects.toThrow();
		await expect(codec.encode(ElapsedSchema, Temporal.Duration.from('P1Y'))).rejects.toThrow();
		expect(await codec.encode(ElapsedSchema, await codec.decode(ElapsedSchema, 'P1DT0.000000001S'))).toBe(
			'PT86400.000000001S',
		);
		for (const value of ['P', 'PT', 'P1D1M', 'P1X', 'P'.repeat(129)]) {
			await expect(codec.decode(DurationSchema, value)).rejects.toThrow();
		}
	});
	it('reports transformed application projections as unsupported rather than claiming JSON Temporal objects', () => {
		expect(schema.inspect(InstantSchema.decode).input.supported).toBe(true);
		expect(schema.inspect(InstantSchema.decode).output.supported).toBe(false);
		expect(schema.inspect(DurationSchema.encode).input.supported).toBe(false);
	});
});
