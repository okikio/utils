import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as codec from './codec/mod.ts';
import { DateSchema } from './time.ts';

describe('DateSchema', () => {
	it('round trips UTC instants at Date precision', async () => {
		const value = await codec.decode(DateSchema, '2026-10-26T12:00:00.123Z');
		expect(value).toBeInstanceOf(Date);
		expect(await codec.encode(DateSchema, value)).toBe('2026-10-26T12:00:00.123Z');
	});
	it('rejects ambiguous local times, offsets and invalid dates', async () => {
		for (const text of ['2026-10-26T12:00:00', '2026-10-26T12:00:00+01:00', '2026-02-30T12:00:00Z']) {
			await expect(codec.decode(DateSchema, text)).rejects.toThrow();
		}
		await expect(codec.encode(DateSchema, new Date(NaN))).rejects.toThrow();
	});

	it('retains Gregorian year rules and the exact UTC wire grammar', async () => {
		for (const source of ['0000-02-29T00:00:00Z', '2000-02-29T23:59:59Z', '9999-12-31T23:59:59Z']) {
			const value = await codec.decode(DateSchema, source);
			expect(await codec.encode(DateSchema, value)).toBe(source.replace('Z', '.000Z'));
		}
		for (
			const source of [
				'1900-02-29T00:00:00Z',
				'2024-13-01T00:00:00Z',
				'2024-01-01T24:00:00Z',
				'2024-01-01T00:60:00Z',
				'2024-01-01T00:00:60Z',
				'2024-01-01t00:00:00z',
				'2024-01-01T00:00:00Z[UTC]',
				'+010000-01-01T00:00:00Z',
			]
		) await expect(codec.decode(DateSchema, source)).rejects.toThrow();
		await expect(codec.encode(DateSchema, new Date('+010000-01-01T00:00:00Z'))).rejects.toThrow();
		await expect(codec.encode(DateSchema, new Date('-000001-01-01T00:00:00Z'))).rejects.toThrow();
	});

	it('truncates arbitrary fractional precision before and after the Unix epoch', async () => {
		for (const prefix of ['1969-12-31T23:59:59', '2024-02-29T12:00:00']) {
			const source = `${prefix}.12345678901234567890Z`;
			const value = await codec.decode(DateSchema, source);
			expect(await codec.encode(DateSchema, value)).toBe(`${prefix}.123Z`);
			expect(await codec.decode(DateSchema, source)).not.toBe(value);
		}
		expect(await codec.encode(DateSchema, await codec.decode(DateSchema, '1970-01-01T00:00:00.1Z')))
			.toBe('1970-01-01T00:00:00.100Z');
	});
});
