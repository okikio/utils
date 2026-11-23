import { describe, it } from 'node:test';
import { createHash, createHmac, getHashes } from 'node:crypto';
import { expect } from '@std/expect';
import { keccak_224, keccak_256, keccak_384, keccak_512 } from '@noble/hashes/sha3.js';
import {
	cshake128,
	cshake256,
	kmac128,
	kmac256,
	kt128,
	kt256,
	turboshake128,
	turboshake256,
} from '@noble/hashes/sha3-addons.js';
import { blake2b, blake2s } from '@noble/hashes/blake2.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { type Engine, SLOTS, WINDOW } from './_wasm/engine.ts';
import { load, unpack } from './_wasm/load.ts';
import { type AlgorithmType, families, type FamilyType } from './_wasm/registry.ts';
import { text as sha2Text } from './_wasm/packed/sha2.ts';
import { text as sha3Text } from './_wasm/packed/sha3.ts';
import { text as blakeText } from './_wasm/packed/blake.ts';
import { text as legacyText } from './_wasm/packed/legacy.ts';
import { text as nationalText } from './_wasm/packed/national.ts';
import { text as contestText } from './_wasm/packed/contest.ts';
import { text as fsbText } from './_wasm/packed/fsb.ts';
import { text as macText } from './_wasm/packed/mac.ts';
import { text as fastText } from './_wasm/packed/fast.ts';
import { text as checksumText } from './_wasm/packed/checksum.ts';
import { crcs } from './_wasm/crc.ts';
import fixture from './fixtures/vectors.json' with { type: 'json' };

const packed: Record<FamilyType, string> = {
	sha2: sha2Text,
	sha3: sha3Text,
	blake: blakeText,
	legacy: legacyText,
	national: nationalText,
	contest: contestText,
	fsb: fsbText,
	mac: macText,
	fast: fastText,
	checksum: checksumText,
};
/** Upstream known answers: `family/algorithm` to pairs of input hex and digest hex. */
const vectors = fixture as unknown as Record<string, string[][]>;
const unhex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
const file = (family: FamilyType) => new URL(`./_wasm/raw/${family}.wasm`, import.meta.url);
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Deterministic input that is not periodic at block or window sizes. */
function input(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	for (let index = 0; index < length; index++) bytes[index] = (index * 167 + (index >>> 8) * 13) & 0xff;
	return bytes;
}

// Lengths around hash blocks (64, 128, 136, 168 bytes), the BLAKE3 chunk (1024) and the module window.
const lengths = [0, 1, 63, 64, 65, 135, 136, 137, 1023, 1024, 1025, WINDOW - 1, WINDOW, WINDOW + 1, 3 * WINDOW + 7];
const key = input(37).map((byte) => byte ^ 0x5c);
const context = new TextEncoder().encode('Utils hash tests 2026-11-23 derive key');

type ReferenceType = (data: Uint8Array) => Uint8Array;
const node = (name: string): ReferenceType => (data) => createHash(name).update(data).digest();
const hmac = (name: string): ReferenceType => (data) => createHmac(name, key).update(data).digest();

/** Families checked against independent implementations at every boundary length. */
type CrossType = 'sha2' | 'sha3' | 'blake';

/** Independent implementations: OpenSSL through node:crypto, and @noble/hashes where OpenSSL lacks one. */
const references: {
	[F in CrossType]: Record<keyof (typeof families)[F], { plain?: ReferenceType; keyed?: ReferenceType }>;
} = {
	sha2: {
		sha224: { plain: node('sha224'), keyed: hmac('sha224') },
		sha256: { plain: node('sha256'), keyed: hmac('sha256') },
		sha384: { plain: node('sha384'), keyed: hmac('sha384') },
		sha512: { plain: node('sha512'), keyed: hmac('sha512') },
		'sha512-224': { plain: node('sha512-224'), keyed: hmac('sha512-224') },
		'sha512-256': { plain: node('sha512-256'), keyed: hmac('sha512-256') },
	},
	sha3: {
		'sha3-224': { plain: node('sha3-224'), keyed: hmac('sha3-224') },
		'sha3-256': { plain: node('sha3-256'), keyed: hmac('sha3-256') },
		'sha3-384': { plain: node('sha3-384'), keyed: hmac('sha3-384') },
		'sha3-512': { plain: node('sha3-512'), keyed: hmac('sha3-512') },
		keccak224: { plain: keccak_224 },
		keccak256: { plain: keccak_256 },
		keccak384: { plain: keccak_384 },
		keccak512: { plain: keccak_512 },
		shake128: { plain: (data) => createHash('shake128', { outputLength: 32 }).update(data).digest() },
		shake256: { plain: (data) => createHash('shake256', { outputLength: 64 }).update(data).digest() },
		cshake128: {
			plain: (data) => cshake128(data, { dkLen: 32 }),
			keyed: (data) => cshake128(data, { dkLen: 32, personalization: key }),
		},
		cshake256: {
			plain: (data) => cshake256(data, { dkLen: 64 }),
			keyed: (data) => cshake256(data, { dkLen: 64, personalization: key }),
		},
		turboshake128: { plain: (data) => turboshake128(data) },
		turboshake256: { plain: (data) => turboshake256(data) },
		kt128: { plain: (data) => kt128(data) },
		kt256: { plain: (data) => kt256(data) },
		kmac128: { keyed: (data) => kmac128(key, data, { dkLen: 32 }) },
		kmac256: { keyed: (data) => kmac256(key, data, { dkLen: 64 }) },
	},
	blake: {
		'blake2b-128': { plain: (d) => blake2b(d, { dkLen: 16 }), keyed: (d) => blake2b(d, { dkLen: 16, key }) },
		'blake2b-160': { plain: (d) => blake2b(d, { dkLen: 20 }), keyed: (d) => blake2b(d, { dkLen: 20, key }) },
		'blake2b-224': { plain: (d) => blake2b(d, { dkLen: 28 }), keyed: (d) => blake2b(d, { dkLen: 28, key }) },
		'blake2b-256': { plain: (d) => blake2b(d, { dkLen: 32 }), keyed: (d) => blake2b(d, { dkLen: 32, key }) },
		'blake2b-384': { plain: (d) => blake2b(d, { dkLen: 48 }), keyed: (d) => blake2b(d, { dkLen: 48, key }) },
		'blake2b-512': { plain: node('blake2b512'), keyed: (d) => blake2b(d, { dkLen: 64, key }) },
		'blake2s-128': {
			plain: (d) => blake2s(d, { dkLen: 16 }),
			keyed: (d) => blake2s(d, { dkLen: 16, key: key.subarray(0, 32) }),
		},
		'blake2s-160': {
			plain: (d) => blake2s(d, { dkLen: 20 }),
			keyed: (d) => blake2s(d, { dkLen: 20, key: key.subarray(0, 32) }),
		},
		'blake2s-224': {
			plain: (d) => blake2s(d, { dkLen: 28 }),
			keyed: (d) => blake2s(d, { dkLen: 28, key: key.subarray(0, 32) }),
		},
		'blake2s-256': { plain: node('blake2s256'), keyed: (d) => blake2s(d, { dkLen: 32, key: key.subarray(0, 32) }) },
		blake3: { plain: (d) => blake3(d), keyed: (d) => blake3(d, { key: key.subarray(0, 32) }) },
		'blake3-derive': { plain: (d) => blake3(d, { context: new Uint8Array(0) }), keyed: (d) => blake3(d, { context }) },
	},
};

/** The key each algorithm takes in the keyed case. */
function keyFor(family: FamilyType, name: string): Uint8Array {
	if (family === 'blake' && (name.startsWith('blake2s') || name === 'blake3')) return key.subarray(0, 32);
	if (name === 'blake3-derive') return context;
	return key;
}

const engines = new Map<FamilyType, Engine>();
async function engine(family: FamilyType): Promise<Engine> {
	let value = engines.get(family);
	if (!value) engines.set(family, value = await load(await unpack(packed[family])));
	return value;
}

/** HMAC block sizes, for an HMAC built in the test from the module's own verified plain hash. */
const blocks: Record<string, number> = {
	md5: 64,
	sha1: 64,
	ripemd160: 64,
	streebog256: 64,
	streebog512: 64,
	'gost94-cryptopro': 32,
	'gost94-test': 32,
	'gost94-ua': 32,
	'gost94-s2015': 32,
	sm3: 64,
	belt: 32,
};

/** RFC 2104 HMAC over a hash function, written out so it shares no code with the Rust `hmac` crate. */
function rfc2104(hash: (data: Uint8Array) => Uint8Array, block: number, secret: Uint8Array, data: Uint8Array) {
	const padded = new Uint8Array(block);
	padded.set(secret.length > block ? hash(secret) : secret);
	const inner = hash(new Uint8Array([...padded.map((byte) => byte ^ 0x36), ...data]));
	return hash(new Uint8Array([...padded.map((byte) => byte ^ 0x5c), ...inner]));
}

describe('hash WebAssembly families', () => {
	describe('published known-answer tests', () => {
		for (const [path, cases] of Object.entries(vectors)) {
			const [family, name] = path.split('/') as [FamilyType, string];
			const algorithm = (families[family] as Record<string, AlgorithmType>)[name];
			if (!algorithm) continue;
			it(`${path} matches the crate's upstream vectors`, async () => {
				const wasm = await engine(family);
				for (const [data = '', digest = '', secret] of cases) {
					const options = {
						...(algorithm.xof ? { length: digest.length / 2 } : {}),
						...(secret ? { key: unhex(secret) } : {}),
					};
					expect(hex(wasm.hash(algorithm, unhex(data), options))).toBe(digest);
				}
			});
		}
	});

	it('cross-checks legacy and national digests that OpenSSL also has', async () => {
		const legacy = await engine('legacy');
		const national = await engine('national');
		for (const length of lengths) {
			const data = input(length);
			for (const [name, openssl] of [['md5', 'md5'], ['sha1', 'sha1'], ['ripemd160', 'ripemd160']] as const) {
				expect(hex(legacy.hash(families.legacy[name], data))).toBe(hex(node(openssl)(data)));
				expect(hex(legacy.hash(families.legacy[name], data, { key }))).toBe(hex(hmac(openssl)(data)));
			}
			// Bun's BoringSSL has no SM3; its upstream vectors still run above.
			if (getHashes().includes('sm3')) {
				expect(hex(national.hash(families.national.sm3, data))).toBe(hex(node('sm3')(data)));
			}
		}
	});

	it('builds HMAC for every keyed legacy and national digest', async () => {
		for (const [name, block] of Object.entries(blocks)) {
			const family = name in families.legacy ? 'legacy' : 'national';
			const wasm = await engine(family);
			const algorithm = (families[family] as Record<string, AlgorithmType>)[name]!;
			for (const secret of [key, input(200)]) {
				for (const length of [0, 100, WINDOW + 3]) {
					const data = input(length);
					const expected = rfc2104((bytes) => wasm.hash(algorithm, bytes), block, secret, data);
					expect([name, hex(wasm.hash(algorithm, data, { key: secret }))]).toEqual([name, hex(expected)]);
				}
			}
		}
	});

	it('refuses a published SHA-1 collision and still hashes it with plain SHA-1', async () => {
		const legacy = await engine('legacy');
		const attack = unhex(vectors['legacy/sha1-checked-collision']![0]![0]!);
		expect(legacy.hash(families.legacy['sha1-checked'], attack).length).toBe(0);
		expect(hex(legacy.hash(families.legacy.sha1, attack))).toBe('8ac60ba76f1999a1ab70223f225aefdc78d4ddc0');
	});

	it('matches every CRC catalogue check value, Adler-32 and Fletcher-16', async () => {
		const wasm = await engine('checksum');
		const digits = new TextEncoder().encode('123456789');
		for (const [name, crc] of Object.entries(crcs)) {
			const width = Math.ceil(crc.width / 8) * 2;
			expect([name, hex(wasm.hash(families.checksum[name as keyof typeof crcs], digits))])
				.toEqual([name, crc.check.toString(16).padStart(width, '0')]);
		}
		// Wikipedia's examples for Adler-32 and Fletcher-16.
		expect(hex(wasm.hash(families.checksum.adler32, 'Wikipedia'))).toBe('11e60398');
		expect(hex(wasm.hash(families.checksum.fletcher16, 'abcde'))).toBe('c8f0');
		expect(hex(wasm.hash(families.checksum.fletcher16, 'abcdefgh'))).toBe('0627');
		const zlib = await import('node:zlib') as { crc32?(data: Uint8Array): number };
		for (const length of lengths) {
			const data = input(length);
			if (zlib.crc32) {
				expect(hex(wasm.hash(families.checksum['CRC-32/ISO-HDLC'], data)))
					.toBe(zlib.crc32(data).toString(16).padStart(8, '0'));
			}
		}
	});

	it('matches published empty-input values of the fast hashes', async () => {
		const wasm = await engine('fast');
		const empty = new Uint8Array(0);
		expect(hex(wasm.hash(families.fast.xxh32, empty))).toBe('02cc5d05');
		expect(hex(wasm.hash(families.fast.xxh64, empty))).toBe('ef46db3751d8e999');
		expect(hex(wasm.hash(families.fast['xxh3-64'], empty))).toBe('2d06800538d394c2');
		expect(hex(wasm.hash(families.fast['xxh3-128'], empty))).toBe('99aa06d3014798d86001c324468d497f');
		expect(hex(wasm.hash(families.fast['fnv1a-64'], empty))).toBe('cbf29ce484222325');
		expect(hex(wasm.hash(families.fast['fnv1a-64'], 'a'))).toBe('af63dc4c8601ec8c');
	});

	// Bun ships its own (Zig) xxHash, CRC-32 and Adler-32, an independent implementation. Its rapidhash
	// is version 1 with seed 0, while the module implements the current version 3, so it is not compared.
	const bun =
		(globalThis as { Bun?: { hash: Record<string, (data: Uint8Array, seed?: number | bigint) => number | bigint> } })
			.Bun?.hash;
	it('agrees with Bun.hash at block and window boundaries', { skip: !bun }, async () => {
		const fast = await engine('fast');
		const checksum = await engine('checksum');
		const word = (value: number | bigint, bytes: number) => BigInt(value).toString(16).padStart(bytes * 2, '0');
		const seed = new Uint8Array([0x78, 0x56, 0x34, 0x12, 0, 0, 0, 0]);
		for (const length of lengths) {
			const data = input(length);
			expect(hex(fast.hash(families.fast.xxh32, data))).toBe(word(bun!.xxHash32!(data), 4));
			expect(hex(fast.hash(families.fast.xxh64, data))).toBe(word(bun!.xxHash64!(data), 8));
			expect(hex(fast.hash(families.fast.xxh64, data, { key: seed }))).toBe(word(bun!.xxHash64!(data, 0x12345678n), 8));
			expect(hex(fast.hash(families.fast['xxh3-64'], data))).toBe(word(bun!.xxHash3!(data), 8));
			expect(hex(checksum.hash(families.checksum['CRC-32/ISO-HDLC'], data))).toBe(word(bun!.crc32!(data), 4));
			expect(hex(checksum.hash(families.checksum.adler32, data))).toBe(word(bun!.adler32!(data), 4));
		}
	});

	it('requires keys for SipHash and HighwayHash and refuses forks it cannot make', async () => {
		const mac = await engine('mac');
		expect(() => mac.hash(families.mac['siphash-2-4'], 'x')).toThrow(TypeError);
		expect(() => mac.hash(families.mac['siphash-2-4'], 'x', { key: new Uint8Array(15) })).toThrow(RangeError);
		expect(() => mac.hash(families.mac['highway-64'], 'x', { key: new Uint8Array(16) })).toThrow(RangeError);
		const fast = await engine('fast');
		expect(() => fast.hash(families.fast.xxh32, 'x', { key: new Uint8Array(8) })).toThrow(RangeError);
		const rapid = fast.create(families.fast.rapidhash);
		expect(() => rapid.fork()).toThrow(RangeError);
		rapid[Symbol.dispose]();
	});

	it('gives every algorithm the same result one-shot and in pieces', async () => {
		const keys: Record<string, Uint8Array> = { mac: input(32) };
		for (const family of Object.keys(families) as FamilyType[]) {
			const wasm = await engine(family);
			for (const [name, algorithm] of Object.entries(families[family] as Record<string, AlgorithmType>)) {
				const data = input(3 * WINDOW + 7);
				const key = family === 'mac'
					? keys.mac!.subarray(0, name.startsWith('siphash') ? 16 : 32)
					: algorithm.key === 'required'
					? keys.mac
					: undefined;
				const options = key ? { key } : {};
				const state = wasm.create(algorithm, options);
				for (let offset = 0; offset < data.length; offset += 1000) state.update(data.subarray(offset, offset + 1000));
				expect([name, hex(state.digest())]).toEqual([name, hex(wasm.hash(algorithm, data, options))]);
				expect([name, wasm.hash(algorithm, data, options).length]).toEqual([name, algorithm.size]);
			}
		}
	});

	for (const family of Object.keys(references) as CrossType[]) {
		describe(family, () => {
			for (const [name, algorithm] of Object.entries(families[family] as Record<string, AlgorithmType>)) {
				const reference =
					(references[family] as Record<string, { plain?: ReferenceType; keyed?: ReferenceType }>)[name]!;
				it(`${name} matches an independent implementation at block and window boundaries`, async () => {
					const wasm = await engine(family);
					for (const length of lengths) {
						const data = input(length);
						if (reference.plain) {
							expect([length, hex(wasm.hash(algorithm, data))]).toEqual([length, hex(reference.plain(data))]);
						}
						if (reference.keyed) {
							const options = { key: keyFor(family, name) };
							expect([length, hex(wasm.hash(algorithm, data, options))]).toEqual([length, hex(reference.keyed(data))]);
						}
					}
				});
			}
		});
	}

	it('agrees across one-shot, incremental and forked states', async () => {
		const wasm = await engine('sha3');
		const algorithm = families.sha3['sha3-256'];
		const data = input(2 * WINDOW + 99);
		const state = wasm.create(algorithm);
		state.update(data.subarray(0, 1000));
		const fork = state.fork();
		state.update(data.subarray(1000));
		fork.update(new Uint8Array([1, 2, 3]));
		expect(hex(state.digest())).toBe(hex(wasm.hash(algorithm, data)));
		const prefix = new Uint8Array([...data.subarray(0, 1000), 1, 2, 3]);
		expect(hex(fork.digest())).toBe(hex(wasm.hash(algorithm, prefix)));
	});

	it('hashes text as UTF-8 on the window path and the streaming path', async () => {
		const wasm = await engine('sha2');
		const algorithm = families.sha2.sha256;
		for (const value of ['', 'abc', 'naïve ☃ 𝄞', 'x'.repeat(WINDOW)]) {
			expect(hex(wasm.hash(algorithm, value))).toBe(createHash('sha256').update(value, 'utf8').digest('hex'));
		}
	});

	it('reads extendable output longer than the window', async () => {
		const sha3 = await engine('sha3');
		const blake = await engine('blake');
		const length = WINDOW * 2 + 5;
		const data = input(300);
		expect(hex(sha3.hash(families.sha3.shake256, data, { length })))
			.toBe(createHash('shake256', { outputLength: length }).update(data).digest('hex'));
		expect(hex(blake.hash(families.blake.blake3, data, { length }))).toBe(hex(blake3(data, { dkLen: length })));
	});

	it('loads every form of a module and gives the same digest', async () => {
		const bytes = await unpack(packed.sha2);
		const compiled = await WebAssembly.compile(bytes);
		const instance = await WebAssembly.instantiate(compiled, {});
		const sources = [
			bytes,
			bytes.buffer,
			compiled,
			instance,
			instance.exports as never,
			new Response(bytes.slice(), { headers: { 'content-type': 'application/wasm' } }),
			Promise.resolve(new Response(bytes.slice())),
			file('sha2'),
		];
		const expected = createHash('sha256').update('abc').digest('hex');
		for (const source of sources) {
			expect(hex((await load(source)).hash(families.sha2.sha256, 'abc'))).toBe(expected);
		}
	});

	it('matches the committed raw module byte for byte', async () => {
		const raw = await load(file('blake'));
		const data = input(5000);
		expect(hex(raw.hash(families.blake.blake3, data))).toBe(hex(blake3(data)));
		const { readFile } = await import('node:fs/promises');
		expect(hex(await unpack(packed.blake))).toBe(hex(await readFile(file('blake'))));
	});

	it('rejects invalid keys, lengths and spent states', async () => {
		const blake = await engine('blake');
		expect(() => blake.hash(families.blake.blake3, 'x', { key: new Uint8Array(31) })).toThrow(RangeError);
		expect(() => blake.hash(families.blake['blake2s-256'], 'x', { key: new Uint8Array(33) })).toThrow(RangeError);
		expect(() => blake.hash(families.blake['blake2b-512'], 'x', { length: 10 })).toThrow(TypeError);
		const sha3 = await engine('sha3');
		expect(() => sha3.hash(families.sha3.shake128, 'x', { length: 0 })).toThrow(RangeError);
		expect(() => sha3.hash(families.sha3.shake128, 'x', { key: new Uint8Array(1) })).toThrow(TypeError);
		const state = sha3.create(families.sha3['sha3-256']);
		state.digest();
		expect(() => state.update(new Uint8Array(1))).toThrow(RangeError);
		expect(() => state.digest()).toThrow(RangeError);
	});

	it('frees slots on digest and dispose, and reports exhaustion', async () => {
		const wasm = await load(await unpack(packed.sha2));
		const states = Array.from({ length: SLOTS }, () => wasm.create(families.sha2.sha256));
		expect(() => wasm.create(families.sha2.sha256)).toThrow(/hash states are in use/);
		states[0]![Symbol.dispose]();
		states[0]![Symbol.dispose]();
		states[1]!.digest();
		const again = [wasm.create(families.sha2.sha256), wasm.create(families.sha2.sha256)];
		for (const state of [...states.slice(2), ...again]) state[Symbol.dispose]();
		expect(hex(wasm.hash(families.sha2.sha256, ''))).toBe(createHash('sha256').digest('hex'));
	});
});
