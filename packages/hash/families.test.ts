import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { expect } from '@std/expect';
import * as encoding from './encoding.ts';
import * as sha3 from './sha3.ts';
import * as blake from './blake.ts';
import * as checksum from './checksum.ts';

/** Encode literal vectors without obscuring their published text. */
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('optional digest families and checksums', () => {
	it('matches published SHA3-256 and BLAKE3 empty vectors', () => {
		expect(encoding.hex(sha3.sha3_256(''))).toBe('a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
		expect(encoding.hex(blake.blake3(''))).toBe('af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
	});
	it('matches independent SHA-3 and BLAKE2 implementations', () => {
		for (
			const [name, hash] of [['sha3-256', sha3.sha3_256], ['sha3-512', sha3.sha3_512], ['blake2b512', blake.blake2b], [
				'blake2s256',
				blake.blake2s,
			]] as const
		) expect(encoding.hex(hash('abc'))).toBe(createHash(name).update('abc').digest('hex'));
	});
	describe('published BLAKE3 block and tree boundaries', () => {
		// BLAKE3-team/BLAKE3/test_vectors/test_vectors.json, unkeyed first 32 bytes.
		// The published input pattern repeats bytes 0 through 250.
		const vectors: readonly (readonly [number, string])[] = [
			[63, 'e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b'],
			[64, '4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98'],
			[65, 'de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee'],
			[1023, '10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11'],
			[1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
			[1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444'],
			[2048, 'e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a'],
			[2049, '5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030'],
			[8192, 'aae792484c8efe4f19e2ca7d371d8c467ffb10748d8a5a1ae579948f718a2a63'],
			[8193, 'bab6c09cb8ce8cf459261398d2e7aef35700bf488116ceb94a36d0f5f1b7bc3b'],
			[16384, 'f875d6646de28985646f34ee13be9a576fd515f76b5b0a26bb324735041ddde4'],
		];
		for (const [length, expected] of vectors) {
			it(`matches the ${length}-byte vector in one-shot and incremental forms`, () => {
				const bytes = Uint8Array.from({ length }, (_, index) => index % 251);
				expect(encoding.hex(blake.blake3(bytes))).toBe(expected);
				const state = blake.create();
				for (let offset = 0; offset < bytes.length; offset += 37) state.update(bytes.subarray(offset, offset + 37));
				expect(encoding.hex(state.digest())).toBe(expected);
			});
		}
	});
	it('forks optional family states', () => {
		for (
			const factory of [
				() => sha3.create(),
				() => sha3.create('sha3-512'),
				() => blake.create(),
				() => blake.create('blake2b'),
				() => blake.create('blake2s'),
			]
		) {
			const state = factory().update(text('abc'));
			const fork = state.clone();
			expect(state.digest()).toEqual(fork.digest());
			expect(() => state.digest()).toThrow();
		}
	});
	it('matches CRC check values and fork behavior', () => {
		expect(checksum.crc32(text('123456789'))).toBe(0xcbf43926);
		expect(checksum.crc32c(text('123456789'))).toBe(0xe3069283);
		for (const name of ['crc32', 'crc32c'] as const) {
			const state = checksum.create(name).update(text('1234'));
			const fork = state.clone();
			expect(state.update(text('56789')).digest()).toBe(checksum[name](text('123456789')));
			expect(fork.digest()).toBe(checksum[name](text('1234')));
			expect(() => state.digest()).toThrow();
		}
		expect(checksum.crc32(new Uint8Array())).toBe(0);
	});
});
