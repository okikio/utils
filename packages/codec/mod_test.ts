import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as codec from './mod.ts';

function transform<Input, Output>(
	vendor: string,
	validate: (value: unknown) => Output | undefined,
): StandardSchemaV1<Input, Output> {
	return {
		'~standard': {
			version: 1,
			vendor,
			validate(value: unknown) {
				const output = validate(value);
				return output === undefined ? { issues: [{ message: `Invalid ${vendor}.` }] } : { value: output };
			},
		},
	};
}

const DateCodec = codec.define({
	decode: transform<string, Date>('date-decode', (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined),
	encode: transform<Date, string>('date-encode', (value) => value instanceof Date && !Number.isNaN(value.valueOf()) ? value.toISOString() : undefined),
});

const StringCodec = codec.define({
	decode: transform<string, string>('string', (value) => typeof value === 'string' ? value : undefined),
	encode: transform<string, string>('string', (value) => typeof value === 'string' ? value : undefined),
});

describe('codec object records', () => {
	it('rejects hidden codec shape properties instead of dropping them from composition', () => {
		const shape = { identity: StringCodec };
		Object.defineProperty(shape, 'hidden', { value: StringCodec, enumerable: false });
		expect(() => codec.object(shape)).toThrow('plain object or null-prototype record');
	});

	it('rejects accessor-backed object input instead of executing getters during validation', async () => {
		const Definition = codec.object({ identity: StringCodec });
		let reads = 0;
		const input = {} as { identity: string };
		Object.defineProperty(input, 'identity', {
			enumerable: true,
			get() {
				reads += 1;
				return 'workspace-1';
			},
		});
		await expect(codec.decode(Definition, input)).rejects.toThrow('ordinary data object');
		expect(reads).toBe(0);
	});
});

describe('codec', () => {
	it('uses independent schemas for each direction', async () => {
		const decoded = await codec.decode(DateCodec, '2026-08-05T00:00:00.000Z');
		expect(decoded).toBeInstanceOf(Date);
		expect(await codec.encode(DateCodec, decoded)).toBe('2026-08-05T00:00:00.000Z');
	});

	it('composes nested optional object properties', async () => {
		const Admission = codec.object({
			identity: StringCodec,
			billing: codec.optional(codec.object({ reservedAt: DateCodec })),
		});
		const decoded = await codec.decode(Admission, {
			identity: 'workspace-1',
			billing: { reservedAt: '2026-08-05T00:00:00.000Z' },
		});
		expect(decoded.billing?.reservedAt).toBeInstanceOf(Date);
		expect(await codec.encode(Admission, decoded)).toEqual({
			identity: 'workspace-1',
			billing: { reservedAt: '2026-08-05T00:00:00.000Z' },
		});
	});

	it('reports the complete path for nested invalid data', async () => {
		const Definition = codec.object({ dates: codec.array(DateCodec) });
		await expect(codec.decode(Definition, { dates: ['not-a-date'] })).rejects.toMatchObject({
			issues: [{ path: ['dates', 0] }],
		});
	});
});
