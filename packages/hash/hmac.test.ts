import { describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { expect } from '@std/expect';
import * as encoding from './encoding.ts';
import * as hmac from './hmac/mod.ts';
import * as hmacSync from './hmac/sync.ts';

/** Encode literal vectors without obscuring their published text. */
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('HMAC admission and verification', () => {
	for (const name of ['sha256', 'sha384', 'sha512'] as const) {
		it(`${name} agrees with an independent provider and rejects altered tags`, async () => {
			const key = new Uint8Array(131).fill(0xaa);
			const input = text('Test Using Larger Than Block-Size Key - Hash Key First');
			const expected = createHmac(name, key).update(input).digest('hex');
			const tag = await hmac.sign(name, key, input);
			expect(encoding.hex(tag)).toBe(expected);
			expect(encoding.hex(hmacSync.sign(name, key, input))).toBe(expected);
			expect(await hmac.verify(name, key, input, tag)).toBe(true);
			expect(hmacSync.verify(name, key, input, tag)).toBe(true);
			tag[0] = tag[0]! ^ 1;
			expect(await hmac.verify(name, key, input, tag)).toBe(false);
			expect(hmacSync.verify(name, key, input, tag)).toBe(false);
			expect(await hmac.verify(name, key, input, new Uint8Array(1))).toBe(false);
			expect(hmacSync.verify(name, key, input, new Uint8Array(1))).toBe(false);
		});
	}
	it('keeps reusable verification bound to the imported secret', async () => {
		const key = text('secret');
		const native = await hmac.create('sha256', key);
		const portable = hmacSync.create('sha256', key);
		key.fill(0);
		const tag = portable.sign('message');
		expect(await native.sign('message')).toEqual(tag);
		portable.sign = () => new Uint8Array(32);
		const verify = portable.verify;
		expect(verify('message', tag)).toBe(true);
		expect(verify('message', new Uint8Array(32))).toBe(false);
		portable.destroy();
	});
	it('matches the RFC 4231 case 1 SHA-256 vector', async () => {
		expect(encoding.hex(await hmac.sign('sha256', new Uint8Array(20).fill(0x0b), 'Hi There'))).toBe(
			'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
		);
	});
	it('copies keys, messages and verification tags at admission', async () => {
		const key = text('secret');
		const message = text('message');
		const tag = hmacSync.sign('sha256', key, message);
		const pending = hmac.sign('sha256', key, message);
		key.fill(0);
		message.fill(0);
		expect(await pending).toEqual(tag);
		const input = text('message');
		const signature = tag.slice();
		const checking = hmac.verify('sha256', text('secret'), input, signature);
		input.fill(0);
		signature.fill(0);
		expect(await checking).toBe(true);
		const reusable = hmacSync.create('sha256', text('secret'));
		expect(reusable.sign('message')).toEqual(tag);
		reusable.destroy();
		expect(() => reusable.sign('message')).toThrow();
		await expect(hmac.create('sha256', new Uint8Array())).rejects.toThrow();
		expect(() => hmacSync.create('sha256', new Uint8Array())).toThrow();
	});
});
