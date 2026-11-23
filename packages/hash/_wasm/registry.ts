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
} as const satisfies Record<string, Record<string, AlgorithmType>>;

/** Name of a family. */
export type FamilyType = keyof typeof families;

/** Name of an algorithm in family `F`. */
export type NameType<F extends FamilyType> = keyof (typeof families)[F] & string;
