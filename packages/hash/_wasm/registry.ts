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
	| 'custom';

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

/** Bit that selects the HMAC form of a fixed-length digest. */
export const HMAC = 0x8000;

const fixed = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'hmac' });
const xof = (id: number, size: number, key: KeyType = 'none'): AlgorithmType => ({ id, size, xof: true, key });
const keyed = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'native' });
const plain = (id: number, size: number): AlgorithmType => ({ id, size, xof: false, key: 'none' });

/** Every family and its algorithms, by the name the public API accepts. */
export const families = {
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
} as const satisfies Record<string, Record<string, AlgorithmType>>;

/** Name of a family. */
export type FamilyType = keyof typeof families;

/** Name of an algorithm in family `F`. */
export type NameType<F extends FamilyType> = keyof (typeof families)[F] & string;
