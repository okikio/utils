import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { expect } from '@std/expect';
import * as sha2 from './sha2.ts';
import * as sha3 from './sha3.ts';
import * as blake from './blake.ts';
import * as legacy from './legacy.ts';
import * as mac from './mac.ts';
import * as checksum from './checksum.ts';
import * as sha3Wasm from './_wasm/entry/sha3.ts';
import * as fastWasm from './_wasm/entry/fast.ts';
import { NotReadyError } from './_family.ts';
import { unpack } from './_wasm/load.ts';
import { text as fastText } from './_wasm/packed/fast.ts';
import fixture from './fixtures/vectors.json' with { type: 'json' };

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const input = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 0xff);
const key = input(24);

describe('family entry points', () => {
	it('hash synchronously before the module loads, on node:crypto or @noble/hashes', () => {
		// These run before any ready(): the first call starts loading in the background.
		expect(hex(sha3.sha3_256('abc'))).toBe(createHash('sha3-256').update('abc').digest('hex'));
		expect(hex(blake.hash('blake2b-256', 'abc'))).toBe(
			'bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319',
		);
		expect(hex(legacy.hash('md5', 'abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
		expect(checksum.crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
		expect(() => mac.hash('siphash-2-4', 'abc', { key: input(16) })).toThrow(NotReadyError);
	});

	it('give the same bytes on every backend after ready()', async () => {
		const names = ['sha3-256', 'keccak256', 'shake128', 'cshake256', 'kt128'] as const;
		const before = names.map((name) => hex(sha3.hash(name, input(3000), name === 'cshake256' ? { key } : {})));
		await sha3.ready();
		expect(sha3.backend('keccak256', 10)).toBe('wasm');
		const after = names.map((name) => hex(sha3.hash(name, input(3000), name === 'cshake256' ? { key } : {})));
		expect(after).toEqual(before);
		for (const length of [0, 100, 600, 70_000]) {
			const data = input(length);
			expect(hex(sha2.hash('sha256', data, { key }))).toBe(
				hex(createHash('sha256').update(data).digest()).length
					? hex(
						(await import('node:crypto')).createHmac('sha256', key).update(data).digest(),
					)
					: '',
			);
			expect(hex(blake.hash('blake3', data, { key: input(32), length: 99 }))).toBe(
				hex(blake.create('blake3', { key: input(32), length: 99 }).update(data).digest()),
			);
		}
	});

	it('prefer node:crypto for large SHA-2 inputs and WASM for small ones', async () => {
		await sha2.ready();
		const bun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
		expect(sha2.backend('sha256', 64)).toBe(bun ? 'native' : 'wasm');
		expect(sha2.backend('sha256', 4096)).toBe('native');
		expect(sha2.backend('sha512-256', 4096)).toBe('native');
	});

	it('throws CollisionError for a published SHA-1 collision through sha1-checked', async () => {
		await legacy.ready();
		const attack = (fixture as unknown as Record<string, string[][]>)['legacy/sha1-checked-collision']![0]![0]!;
		const bytes = Uint8Array.from(attack.match(/../gu)!, (pair) => Number.parseInt(pair, 16));
		expect(() => legacy.hash('sha1-checked', bytes)).toThrow(legacy.CollisionError);
		expect(() => legacy.create('sha1-checked').update(bytes).digest()).toThrow(legacy.CollisionError);
		expect(hex(legacy.hash('sha1-checked', 'abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
	});

	it('mac and checksum work after ready()', async () => {
		await mac.ready();
		await checksum.ready();
		// SipHash-2-4 of the empty input under key 00..0f, from the SipHash paper.
		const sipKey = Uint8Array.from({ length: 16 }, (_, index) => index);
		expect(hex(mac.hash('siphash-2-4', '', { key: sipKey }))).toBe('310e0edd47db6f72');
		expect(hex(checksum.hash('CRC-64/NVME', '123456789'))).toBe('ae8b14860a799888');
		expect(checksum.backend('CRC-32/ISO-HDLC', 10)).toBe('wasm');
	});
});

describe('WASM-only entry points', () => {
	it('throw NotReadyError until ready(), and never fall back', () => {
		expect(() => fastWasm.hash('xxh64', 'abc')).toThrow(NotReadyError);
		expect(() => sha3Wasm.create('sha3-256')).toThrow(NotReadyError);
	});

	it('accept a module the caller loaded, and load the raw file without a source', async () => {
		await fastWasm.ready(await WebAssembly.compile(await unpack(fastText)));
		expect(hex(fastWasm.hash('xxh64', ''))).toBe('ef46db3751d8e999');
		await sha3Wasm.ready();
		expect(hex(sha3Wasm.hash('sha3-256', 'abc'))).toBe(createHash('sha3-256').update('abc').digest('hex'));
	});
});
