/**
 * Algorithm ids of the WebAssembly families.
 *
 * Each family is one module built from `packages/hash/wasm/<family>/`. The ids here must match the
 * `match` arms in that crate's `src/lib.rs`; `wasm.test.ts` checks every entry against published test
 * vectors, so a wrong id fails a test rather than hashing with the wrong algorithm.
 *
 * @module
 */

/** How an algorithm uses a key. */
export type KeyType =
	/** No key. */
	| 'none'
	/** An HMAC key of any length, selected with the {@link HMAC} bit. */
	| 'hmac'
	/** The algorithm's own keyed mode; an empty key means unkeyed. */
	| 'native'
	/** Bytes that customize the output (cSHAKE customization, BLAKE3 derive-key context). */
	| 'custom'
	/** A key the algorithm cannot run without (SipHash, HighwayHash). */
	| 'required'
	/** An optional little-endian seed for a non-cryptographic hash. */
	| 'seed';

/** One algorithm in a family module. */
export interface AlgorithmType {
	/** Id passed to the module's `init` and `oneshot`. */
	readonly id: number;
	/** Output length in bytes. For an extendable output, the length used when the caller gives none. */
	readonly size: number;
	/** True when the caller may choose any output length. */
	readonly xof: boolean;
	/** How the algorithm uses a key. */
	readonly key: KeyType;
}

import { type CrcNameType, crcs } from './crc.ts';

/** Bit that selects the HMAC form of a fixed-length digest. */
export const HMAC = 0x8000;

const fixed = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'hmac' });
const xof = (id: number, size: number, key: KeyType = 'none'): AlgorithmType => ({ id, size, xof: true, key });
const keyed = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'native' });
const plain = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'none' });
const required = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'required' });
const seeded = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'seed' });

/** Every CRC in the catalogue, output in the fewest whole bytes that hold its width. */
const catalogue = Object.fromEntries(
	Object.entries(crcs).map(([name, crc]) => [name, plain(crc.id, Math.ceil(crc.width / 8))]),
) as Record<CrcNameType, AlgorithmType>;

/** Algorithm names of the `sha2` family. */
export type Sha2NameType = 'sha224' | 'sha256' | 'sha384' | 'sha512' | 'sha512-224' | 'sha512-256';

/** Algorithm names of the `sha3` family. */
export type Sha3NameType =
	| 'sha3-224'
	| 'sha3-256'
	| 'sha3-384'
	| 'sha3-512'
	| 'keccak224'
	| 'keccak256'
	| 'keccak384'
	| 'keccak512'
	| 'shake128'
	| 'shake256'
	| 'cshake128'
	| 'cshake256'
	| 'turboshake128'
	| 'turboshake256'
	| 'kt128'
	| 'kt256'
	| 'kmac128'
	| 'kmac256';

/** Algorithm names of the `blake` family. */
export type BlakeNameType =
	| 'blake2b-128'
	| 'blake2b-160'
	| 'blake2b-224'
	| 'blake2b-256'
	| 'blake2b-384'
	| 'blake2b-512'
	| 'blake2s-128'
	| 'blake2s-160'
	| 'blake2s-224'
	| 'blake2s-256'
	| 'blake3'
	| 'blake3-derive';

/** Algorithm names of the `legacy` family. */
export type LegacyNameType =
	| 'md2'
	| 'md4'
	| 'md5'
	| 'sha1'
	| 'ripemd128'
	| 'ripemd160'
	| 'ripemd256'
	| 'ripemd320'
	| 'tiger'
	| 'tiger2'
	| 'sha1-checked';

/** Algorithm names of the `national` family. */
export type NationalNameType =
	| 'streebog256'
	| 'streebog512'
	| 'gost94-cryptopro'
	| 'gost94-test'
	| 'gost94-ua'
	| 'gost94-s2015'
	| 'sm3'
	| 'kupyna224'
	| 'kupyna256'
	| 'kupyna384'
	| 'kupyna512'
	| 'belt'
	| 'bash256'
	| 'bash384'
	| 'bash512'
	| 'ascon-hash256'
	| 'ascon-xof128';

/** Algorithm names of the `contest` family. */
export type ContestNameType =
	| 'groestl224'
	| 'groestl256'
	| 'groestl384'
	| 'groestl512'
	| 'jh224'
	| 'jh256'
	| 'jh384'
	| 'jh512'
	| 'skein256-256'
	| 'skein256-512'
	| 'skein512-256'
	| 'skein512-512'
	| 'skein1024-256'
	| 'skein1024-512'
	| 'skein1024-1024'
	| 'shabal192'
	| 'shabal224'
	| 'shabal256'
	| 'shabal384'
	| 'shabal512'
	| 'whirlpool';

/** Algorithm names of the `fsb` family. */
export type FsbNameType = 'fsb160' | 'fsb224' | 'fsb256' | 'fsb384' | 'fsb512';

/** Algorithm names of the `mac` family. */
export type MacNameType =
	| 'siphash-2-4'
	| 'siphash-2-4-128'
	| 'siphash-1-3'
	| 'siphash-1-3-128'
	| 'highway-64'
	| 'highway-128'
	| 'highway-256';

/** Algorithm names of the `fast` family. */
export type FastNameType = 'xxh32' | 'xxh64' | 'xxh3-64' | 'xxh3-128' | 'rapidhash' | 'seahash' | 'fnv1a-64';

/** Every family and its algorithms, by the name the public API accepts. */
export interface FamiliesType {
	readonly sha2: Readonly<Record<Sha2NameType, AlgorithmType>>;
	readonly sha3: Readonly<Record<Sha3NameType, AlgorithmType>>;
	readonly blake: Readonly<Record<BlakeNameType, AlgorithmType>>;
	readonly legacy: Readonly<Record<LegacyNameType, AlgorithmType>>;
	readonly national: Readonly<Record<NationalNameType, AlgorithmType>>;
	readonly contest: Readonly<Record<ContestNameType, AlgorithmType>>;
	readonly fsb: Readonly<Record<FsbNameType, AlgorithmType>>;
	readonly mac: Readonly<Record<MacNameType, AlgorithmType>>;
	readonly fast: Readonly<Record<FastNameType, AlgorithmType>>;
	readonly checksum: Readonly<Record<CrcNameType | 'adler32' | 'fletcher16', AlgorithmType>>;
}

/** Every family and its algorithms. */
export const families: FamiliesType = {
	sha2: {
		sha224: fixed(1, 28),
		sha256: fixed(2, 32),
		sha384: fixed(3, 48),
		sha512: fixed(4, 64),
		'sha512-224': fixed(5, 28),
		'sha512-256': fixed(6, 32),
	},
	sha3: {
		'sha3-224': fixed(1, 28),
		'sha3-256': fixed(2, 32),
		'sha3-384': fixed(3, 48),
		'sha3-512': fixed(4, 64),
		keccak224: fixed(5, 28),
		keccak256: fixed(6, 32),
		keccak384: fixed(7, 48),
		keccak512: fixed(8, 64),
		shake128: xof(16, 32),
		shake256: xof(17, 64),
		cshake128: xof(18, 32, 'custom'),
		cshake256: xof(19, 64, 'custom'),
		turboshake128: xof(20, 32),
		turboshake256: xof(21, 64),
		kt128: xof(22, 32),
		kt256: xof(23, 64),
		// No maintained Rust crate implements KMAC, so id 0 marks it as fallback-only (@noble/hashes).
		kmac128: { id: 24, size: 32, xof: true, key: 'required' },
		kmac256: { id: 25, size: 64, xof: true, key: 'required' },
	},
	blake: {
		'blake2b-128': keyed(1, 16),
		'blake2b-160': keyed(2, 20),
		'blake2b-224': keyed(3, 28),
		'blake2b-256': keyed(4, 32),
		'blake2b-384': keyed(5, 48),
		'blake2b-512': keyed(6, 64),
		'blake2s-128': keyed(7, 16),
		'blake2s-160': keyed(8, 20),
		'blake2s-224': keyed(9, 28),
		'blake2s-256': keyed(10, 32),
		blake3: { id: 16, size: 32, xof: true, key: 'native' },
		'blake3-derive': xof(17, 32, 'custom'),
	},
	legacy: {
		md2: plain(1, 16),
		md4: plain(2, 16),
		md5: fixed(3, 16),
		sha1: fixed(4, 20),
		ripemd128: plain(5, 16),
		ripemd160: fixed(6, 20),
		ripemd256: plain(7, 32),
		ripemd320: plain(8, 40),
		tiger: plain(9, 24),
		tiger2: plain(10, 24),
		'sha1-checked': plain(16, 20),
	},
	national: {
		streebog256: fixed(1, 32),
		streebog512: fixed(2, 64),
		'gost94-cryptopro': fixed(3, 32),
		'gost94-test': fixed(4, 32),
		'gost94-ua': fixed(5, 32),
		'gost94-s2015': fixed(6, 32),
		sm3: fixed(7, 32),
		kupyna224: plain(8, 28),
		kupyna256: plain(9, 32),
		kupyna384: plain(10, 48),
		kupyna512: plain(11, 64),
		belt: fixed(12, 32),
		bash256: plain(13, 32),
		bash384: plain(14, 48),
		bash512: plain(15, 64),
		'ascon-hash256': plain(16, 32),
		'ascon-xof128': xof(32, 32),
	},
	contest: {
		groestl224: plain(1, 28),
		groestl256: plain(2, 32),
		groestl384: plain(3, 48),
		groestl512: plain(4, 64),
		jh224: plain(5, 28),
		jh256: plain(6, 32),
		jh384: plain(7, 48),
		jh512: plain(8, 64),
		'skein256-256': plain(9, 32),
		'skein256-512': plain(10, 64),
		'skein512-256': plain(11, 32),
		'skein512-512': plain(12, 64),
		'skein1024-256': plain(13, 32),
		'skein1024-512': plain(14, 64),
		'skein1024-1024': plain(15, 128),
		shabal192: plain(16, 24),
		shabal224: plain(17, 28),
		shabal256: plain(18, 32),
		shabal384: plain(19, 48),
		shabal512: plain(20, 64),
		whirlpool: plain(21, 64),
	},
	fsb: {
		fsb160: plain(1, 20),
		fsb224: plain(2, 28),
		fsb256: plain(3, 32),
		fsb384: plain(4, 48),
		fsb512: plain(5, 64),
	},
	mac: {
		'siphash-2-4': required(1, 8),
		'siphash-2-4-128': required(2, 16),
		'siphash-1-3': required(3, 8),
		'siphash-1-3-128': required(4, 16),
		'highway-64': required(5, 8),
		'highway-128': required(6, 16),
		'highway-256': required(7, 32),
	},
	fast: {
		xxh32: seeded(1, 4),
		xxh64: seeded(2, 8),
		'xxh3-64': seeded(3, 8),
		'xxh3-128': seeded(4, 16),
		rapidhash: plain(5, 8),
		seahash: seeded(6, 8),
		'fnv1a-64': plain(7, 8),
	},
	checksum: {
		...catalogue,
		adler32: plain(200, 4),
		fletcher16: plain(201, 2),
	},
};

/** Name of a family. */
export type FamilyType = keyof FamiliesType;

/** Name of an algorithm in family `F`. */
export type NameType<F extends FamilyType> = keyof FamiliesType[F] & string;
