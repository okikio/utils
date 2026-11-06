/** Optional BLAKE digests with fixed standard output sizes. @module */
import { blake2b as hash2b, blake2s as hash2s } from '@noble/hashes/blake2.js';
import { blake3 as hash3 } from '@noble/hashes/blake3.js';
import { copy } from './_bytes.ts';
import type { InputType } from './_bytes.ts';
import { wrap } from './_hasher.ts';
import type { HasherType } from './_hasher.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
/** BLAKE2b-512, BLAKE2s-256 and BLAKE3-256; keyed and variable outputs are excluded. */
export type AlgorithmType = 'blake2b' | 'blake2s' | 'blake3';
/** Allocate independent incremental state; finalize or destroy it after use. */
export function create(name: AlgorithmType = 'blake3'): HasherType {
	switch (name) {
		case 'blake2b':
			return wrap(hash2b.create());
		case 'blake2s':
			return wrap(hash2s.create());
		case 'blake3':
			return wrap(hash3.create());
		default:
			throw new TypeError('Unsupported BLAKE algorithm.');
	}
}
/** Return a 64-byte BLAKE2b digest. */
export function blake2b(input: InputType): Uint8Array {
	return hash2b(copy(input));
}
/** Return a 32-byte BLAKE2s digest. */
export function blake2s(input: InputType): Uint8Array {
	return hash2s(copy(input));
}
/** Return a 32-byte BLAKE3 digest. */
export function blake3(input: InputType): Uint8Array {
	return hash3(copy(input));
}
