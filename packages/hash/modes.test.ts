import { describe, it } from 'node:test';
import { createHash, createHmac, getHashes } from 'node:crypto';
import { expect } from '@std/expect';
import * as packed from './_entry/packed/sha3.ts';
import * as packedMac from './_entry/packed/mac.ts';
import * as native from './_entry/native/sha2.ts';
import * as nativeNational from './_entry/native/national.ts';
import * as portable from './_entry/portable/blake.ts';
import * as portableChecksum from './_entry/portable/checksum.ts';
import * as portableSha3 from './_entry/portable/sha3.ts';
import * as web from './_entry/web/sha2.ts';
import * as webLegacy from './_entry/web/legacy.ts';
import * as sha3 from './sha3.ts';
import { NotReadyError, UnsupportedError } from './_family.ts';

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const input = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 0xff);
const key = input(32);

describe('forced backend entry points', () => {
	it('packed: throws NotReadyError before ready(), then runs the embedded module', async () => {
		expect(() => packed.hash('sha3-256', 'abc')).toThrow(NotReadyError);
		await packed.ready();
		expect(hex(packed.hash('sha3-256', 'abc'))).toBe(createHash('sha3-256').update('abc').digest('hex'));
		await packedMac.ready();
		const sip = Uint8Array.from({ length: 16 }, (_, index) => index);
		expect(hex(packedMac.hash('siphash-2-4', '', { key: sip }))).toBe('310e0edd47db6f72');
	});

	it('packed: KMAC matches NIST SP 800-185 sample 1 and the portable result', async () => {
		await packed.ready();
		const nist = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);
		expect(hex(packed.hash('kmac128', new Uint8Array([0, 1, 2, 3]), { key: nist, length: 32 }))).toBe(
			'e5780b0d3ea6f7d3a429c5706aa43a00fadbd7d49628839e3187243f456ee14e',
		);
		for (const length of [0, 167, 168, 169, 5000]) {
			const data = input(length);
			expect(hex(packed.hash('kmac256', data, { key, length: 40 }))).toBe(
				hex(portableSha3.hash('kmac256', data, { key, length: 40 })),
			);
		}
		expect(() => packed.hash('kmac128', 'abc')).toThrow(TypeError);
	});

	it('native: runs node:crypto only, and refuses what it lacks', () => {
		const data = input(1000);
		expect(hex(native.hash('sha512-256', data))).toBe(createHash('sha512-256').update(data).digest('hex'));
		expect(hex(native.hash('sha256', data, { key }))).toBe(createHmac('sha256', key).update(data).digest('hex'));
		expect(hex(native.create('sha384').update(data).digest())).toBe(createHash('sha384').update(data).digest('hex'));
		if (getHashes().includes('sm3')) expect(nativeNational.hash('sm3', 'abc').length).toBe(32);
		else expect(() => nativeNational.hash('sm3', 'abc')).toThrow(UnsupportedError);
	});

	it('portable: runs pure JavaScript only, and agrees with the auto entry', async () => {
		await sha3.ready();
		const data = input(3000);
		expect(hex(portable.hash('blake3', data, { length: 77 }))).toBe(
			hex(portable.create('blake3', { length: 77 }).update(data).digest()),
		);
		expect(hex(portable.hash('blake2b-256', 'abc'))).toBe(
			'bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319',
		);
		expect(hex(portableSha3.hash('shake256', data, { length: 100 }))).toBe(
			hex(sha3.hash('shake256', data, { length: 100 })),
		);
		expect(hex(portableChecksum.hash('CRC-32/ISO-HDLC', '123456789'))).toBe('cbf43926');
		expect(sha3.backend('shake256', 10)).toBe('wasm');
	});

	it('web: runs crypto.subtle, with HMAC from a key', async () => {
		const data = input(1000);
		expect(hex(await web.hash('sha384', data))).toBe(createHash('sha384').update(data).digest('hex'));
		expect(hex(await web.hash('sha512', data, { key }))).toBe(createHmac('sha512', key).update(data).digest('hex'));
		expect(hex(await webLegacy.hash('sha1', 'abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
		await expect(web.hash('sha256', 'abc', { key: new Uint8Array(0) })).rejects.toThrow(RangeError);
	});
});
