import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as codec from './mod.ts';

/** Build a synchronous test codec direction; undefined marks failure, so these fixtures cannot represent an accepted undefined output. */
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
	decode: transform<string, Date>(
		'date-decode',
		(value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined,
	),
	encode: transform<Date, string>(
		'date-encode',
		(value) => value instanceof Date && !Number.isNaN(value.valueOf()) ? value.toISOString() : undefined,
	),
});

const StringCodec = codec.define({
	decode: transform<string, string>('string', (value) => typeof value === 'string' ? value : undefined),
	encode: transform<string, string>('string', (value) => typeof value === 'string' ? value : undefined),
});

describe('codec object records', () => {
	it('rejects hidden codec shape properties instead of dropping them from composition', () => {
		const shape = { identity: StringCodec };
		Object.defineProperty(shape, 'hidden', { value: StringCodec, enumerable: false });
		expect(() => codec.object(shape)).toThrow(TypeError);
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
		await expect(codec.decode(Definition, input)).rejects.toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('preserves evolving external input while independently rejecting authored output extras', async () => {
		const Definition = codec.object({ identity: StringCodec }, {
			decode: { unknownKeys: 'preserve' },
			encode: { unknownKeys: 'reject' },
		});
		expect(await codec.decode(Definition, { identity: 'a', future: true })).toEqual({ identity: 'a', future: true });
		await expect(codec.encode(Definition, { identity: 'a', typo: true })).rejects.toMatchObject({
			issues: [{ message: 'Unknown object property.', path: ['typo'] }],
		});
		await expect(codec.decode(Definition, { identity: 1, future: true })).rejects.toMatchObject({
			issues: [{ path: ['identity'] }],
		});
	});

	it('retains stripping defaults when only one codec direction selects preservation', async () => {
		const Definition = codec.object({ identity: StringCodec }, { encode: { unknownKeys: 'preserve' } });
		const input = { identity: 'a', future: true };
		expect(await codec.decode(Definition, input)).toEqual({ identity: 'a' });
		expect(await codec.encode(Definition, input)).toEqual(input);
	});

	it('keeps independent strip defaults when typed optional direction settings are absent', async () => {
		const options: codec.ObjectOptions<'preserve', 'preserve'> = {};
		const Definition = codec.object({ identity: StringCodec }, options);
		const input = { identity: 'a', future: true };
		expect(await codec.decode(Definition, input)).toEqual({ identity: 'a' });
		expect(await codec.encode(Definition, input)).toEqual({ identity: 'a' });
		const inner: codec.ObjectOptions<'preserve', 'preserve'> = { decode: {}, encode: {} };
		const Nested = codec.object({ identity: StringCodec }, inner);
		expect(await codec.decode(Nested, input)).toEqual({ identity: 'a' });
		expect(await codec.encode(Nested, input)).toEqual({ identity: 'a' });
	});

	it('retains absent optional fields separately from explicit undefined in either direction', async () => {
		const Definition = codec.object({ identity: StringCodec, label: codec.optional(StringCodec) });
		for (const transform of [codec.decode, codec.encode]) {
			const absent = await transform(Definition, { identity: 'a' });
			const explicit = await transform(Definition, { identity: 'a', label: undefined });
			expect(Object.hasOwn(absent, 'label')).toBe(false);
			expect(Object.hasOwn(explicit, 'label')).toBe(true);
		}
	});

	it('keeps nested unknown-key issues attached to their object path', async () => {
		const Definition = codec.object({
			profile: codec.object({ identity: StringCodec }, { decode: { unknownKeys: 'reject' } }),
		}, { decode: { unknownKeys: 'preserve' } });
		await expect(codec.decode(Definition, { profile: { identity: 'a', typo: true }, future: true })).rejects
			.toMatchObject({
				issues: [{ path: ['profile', 'typo'] }],
			});
	});

	it('preserves unsafe-looking keys as own data without changing output prototypes', async () => {
		const Definition = codec.object({ identity: StringCodec }, { decode: { unknownKeys: 'preserve' } });
		const input = JSON.parse('{"identity":"a","__proto__":{"polluted":true},"constructor":5}');
		const decoded = await codec.decode(Definition, input);
		expect(Object.getPrototypeOf(decoded)).toBe(null);
		expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
		expect(decoded['constructor']).toBe(5);
		expect('polluted' in decoded).toBe(false);
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
