import { describe, it } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { expect } from '@std/expect';
import { keccak_224, keccak_256, keccak_384, keccak_512 } from '@noble/hashes/sha3.js';
import { cshake128, cshake256, kt128, kt256, turboshake128, turboshake256 } from '@noble/hashes/sha3-addons.js';
import { blake2b, blake2s } from '@noble/hashes/blake2.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { type Engine, SLOTS, WINDOW } from './_wasm/engine.ts';
import { load, unpack } from './_wasm/load.ts';
import { families, type FamilyType } from './_wasm/registry.ts';
import { text as sha2Text } from './_wasm/packed/sha2.ts';
import { text as sha3Text } from './_wasm/packed/sha3.ts';
import { text as blakeText } from './_wasm/packed/blake.ts';

const packed: Record<FamilyType, string> = { sha2: sha2Text, sha3: sha3Text, blake: blakeText };
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

/** Independent implementations: OpenSSL through node:crypto, and @noble/hashes where OpenSSL lacks one. */
const references: {
	[F in FamilyType]: Record<keyof (typeof families)[F], { plain: ReferenceType; keyed?: ReferenceType }>;
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

describe('hash WebAssembly families', () => {
	for (const family of Object.keys(families) as FamilyType[]) {
		describe(family, () => {
			for (const [name, algorithm] of Object.entries(families[family])) {
				const reference =
					(references[family] as Record<string, { plain: ReferenceType; keyed?: ReferenceType }>)[name]!;
				it(`${name} matches an independent implementation at block and window boundaries`, async () => {
					const wasm = await engine(family);
					for (const length of lengths) {
						const data = input(length);
						expect([length, hex(wasm.hash(algorithm, data))]).toEqual([length, hex(reference.plain(data))]);
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
