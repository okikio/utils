/** Optional incremental SHA-3, isolated from the native root graph. @module */
import { sha3_256 as hash256, sha3_512 as hash512 } from '@noble/hashes/sha3.js';
import { copy } from './_bytes.ts';
import type { InputType } from './_bytes.ts';
import { wrap } from './_hasher.ts';
import type { HasherType } from './_hasher.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
/** Standard SHA-3 variants; these are distinct from Keccak. */
export type AlgorithmType = 'sha3-256' | 'sha3-512';
/** Allocate a state to finalize or destroy. */
export function create(name: AlgorithmType = 'sha3-256'): HasherType {
	switch (name) {
		case 'sha3-256':
			return wrap(hash256.create());
		case 'sha3-512':
			return wrap(hash512.create());
		default:
			throw new TypeError('Unsupported SHA-3 algorithm.');
	}
}
/** Return the 32-byte SHA3-256 digest of UTF-8 text or visible bytes. */
export function sha3_256(input: InputType): Uint8Array {
	return hash256(copy(input));
}
/** Return the 64-byte SHA3-512 digest of UTF-8 text or visible bytes. */
export function sha3_512(input: InputType): Uint8Array {
	return hash512(copy(input));
}
