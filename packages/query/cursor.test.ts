import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as hmac from '@okikio/hash/hmac';
import { create, CursorError } from './cursor.ts';
import { asc, desc } from './mod.ts';

const secret = new Uint8Array(32).fill(7);
const order = [asc('id', { tiebreaker: true })];
const definition = {
	contract: 'people.v1',
	order,
	semantics: 'ascii;nulls-last;unique-id',
	context: 'tenant-7|active',
	values: schema.string(),
};
describe('authenticated continuation contract', () => {
	it('round trips, expires at the exact boundary, and binds contract/order/semantics/context', async () => {
		const signer = await hmac.create('sha256', secret);
		let now = 100;
		const options = {
			keys: [{ id: 'current', signer }],
			activeKey: 'current',
			maximumKeys: 1,
			maximumTokenBytes: 4096,
			expiresIn: 10,
			now: () => now,
		};
		const cursor = create(definition, options);
		const token = await cursor.encode('a,b');
		expect(await cursor.decode(token)).toBe('a,b');
		now = 109;
		expect(await cursor.decode(token)).toBe('a,b');
		now = 110;
		await expect(cursor.decode(token)).rejects.toBeInstanceOf(CursorError);
		now = 100;
		for (
			const changed of [{ contract: 'people.v2' }, { order: [desc('id', { tiebreaker: true })] }, {
				semantics: 'locale-other',
			}, { context: 'tenant-8|active' }]
		) {
			await expect(create({ ...definition, ...changed }, options).decode(token)).rejects.toBeInstanceOf(CursorError);
		}
		await expect(cursor.decode(token.replace('v1.', 'v2.'))).rejects.toBeInstanceOf(CursorError);
		const pieces = token.split('.');
		pieces[2] = pieces[2]!.slice(0, -1) + (pieces[2]!.endsWith('A') ? 'B' : 'A');
		await expect(cursor.decode(pieces.join('.'))).rejects.toBeInstanceOf(CursorError);
		await expect(cursor.decode(token + '=')).rejects.toBeInstanceOf(CursorError);
		await expect(cursor.decode('x'.repeat(4097))).rejects.toBeInstanceOf(CursorError);
	});
	it('rotates only explicitly authorized keys and authenticates before application validation', async () => {
		const old = await hmac.create('sha256', secret);
		const current = await hmac.create('sha256', new Uint8Array(32).fill(8));
		const policy = { maximumKeys: 2, maximumTokenBytes: 4096, expiresIn: null, now: () => 0 };
		const token = await create(definition, { ...policy, activeKey: 'old', keys: [{ id: 'old', signer: old }] }).encode(
			'',
		);
		const rotated = create(definition, {
			...policy,
			activeKey: 'new',
			keys: [{ id: 'old', signer: old }, { id: 'new', signer: current }],
		});
		expect(await rotated.decode(token)).toBe('');
		expect((await rotated.encode('next')).startsWith('v1.new.')).toBe(true);
		await expect(
			create(definition, { ...policy, activeKey: 'new', keys: [{ id: 'new', signer: current }] }).decode(token),
		).rejects.toBeInstanceOf(CursorError);
		let reads = 0;
		const typed = codec.define({
			decode: schema.define((value) => {
				reads++;
				return String(value);
			}),
			encode: schema.string(),
		});
		const rejecting = { sign: current.sign, verify: () => false };
		await expect(
			create({ ...definition, values: typed }, {
				...policy,
				activeKey: 'old',
				keys: [{ id: 'old', signer: rejecting }],
			}).decode(token),
		).rejects.toBeInstanceOf(CursorError);
		expect(reads).toBe(0);
	});
	it('preserves flat typed keys, including negative zero, dates, bigint, commas and empty text', async () => {
		const signer = await hmac.create('sha256', secret);
		const keys = ['', 'a,b', 23n, new Date('2026-11-04T00:00:00.000Z'), -0, null] as const;
		const values = codec.define({
			decode: schema.define((value) => value as typeof keys),
			encode: schema.define((value) => value as typeof keys),
		});
		const cursor = create({
			...definition,
			order: keys.map((_, index) => asc('key' + index, { tiebreaker: index === keys.length - 1 })),
			values,
		}, {
			keys: [{ id: 'k', signer }],
			activeKey: 'k',
			maximumKeys: 1,
			maximumTokenBytes: 4096,
			expiresIn: null,
			now: () => 0,
		});
		const decoded = await cursor.decode(await cursor.encode(keys));
		expect(decoded).toEqual(keys);
		expect(Object.is(decoded[4], -0)).toBe(true);
	});
	it('rejects invalid policy before signing and checks full token bytes, not payload alone', async () => {
		let signed = 0;
		const signer = {
			sign: () => {
				signed++;
				return new Uint8Array(32);
			},
			verify: () => true,
		};
		const policy = {
			keys: [{ id: 'k', signer }],
			activeKey: 'k',
			maximumKeys: 1,
			maximumTokenBytes: 200,
			expiresIn: 1,
			now: () => 0,
		};
		expect(() => create({ ...definition, order: [asc('id')] }, policy)).toThrow(TypeError);
		expect(() => create(definition, { ...policy, maximumKeys: 0 })).toThrow(RangeError);
		await expect(create({ ...definition, context: '' }, policy).encode('x')).rejects.toThrow(RangeError);
		expect(signed).toBe(0);
		await expect(
			create(definition, { ...policy, maximumTokenBytes: 4000, now: () => Number.MAX_SAFE_INTEGER }).encode('x'),
		).rejects.toThrow(RangeError);
	});
});
