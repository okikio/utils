import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { digest, sign, verify } from '@okikio/http/signature';

describe('byte signatures', () => {
	it('matches RFC 4231 case 2 and rejects altered bytes or noncanonical signatures', async () => {
		const bytes = new TextEncoder().encode('what do ya want for nothing?');
		const signature = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
		expect(await sign('Jefe', bytes)).toBe(signature);
		expect(await verify('Jefe', bytes, signature)).toBe(true);
		bytes[0] = 0;
		expect(await verify('Jefe', bytes, signature)).toBe(false);
		expect(await verify('Jefe', bytes, signature.toUpperCase())).toBe(false);
		expect(await verify('Jefe', bytes, 'abc')).toBe(false);
		await expect(sign(' ', bytes)).rejects.toThrow(TypeError);
	});
	it('signs just the selected UTF-8 bytes and preserves spaces in a nonblank key', async () => {
		const frame = new TextEncoder().encode('X{"message":"café"}Y');
		const payload = frame.subarray(1, -1);
		const secret = ' example key ';
		const signature = '4cf4fd3d605d36e452895af131bc1f9b534b13d698579bca3d7332c0561a8564';
		expect(await sign(secret, payload)).toBe(signature);
		expect(await verify(secret, payload, signature)).toBe(true);
		expect(await verify(secret, frame, signature)).toBe(false);
		expect(await verify(secret.trim(), payload, signature)).toBe(false);
	});
	it('snapshots borrowed input before yielding and hashes exact bytes', async () => {
		const bytes = new TextEncoder().encode('abc');
		const expected = await sign('key', bytes);
		const pending = sign('key', bytes);
		bytes.fill(0);
		expect(await pending).toBe(expected);
		expect(await digest(new TextEncoder().encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});
});
