/** Portable synchronous and incremental SHA-2 hashing. @module */
import { sha256 as hash256, sha384 as hash384, sha512 as hash512 } from '@noble/hashes/sha2.js';
import { copy } from './_bytes.ts';
import type { InputType } from './_bytes.ts';
import { output } from './_output.ts';
import type { AlgorithmType, EncodingType } from './digest.ts';
import { wrap } from './_hasher.ts';
import type { HasherType } from './_hasher.ts';
export type { HasherType } from './_hasher.ts';
export type { AlgorithmType, EncodingType, InputType } from './digest.ts';
/** Allocate one incremental state; the owner must finalize or destroy it. */
export function create(name: AlgorithmType = 'sha256'): HasherType {
	switch (name) {
		case 'sha256':
			return wrap(hash256.create());
		case 'sha384':
			return wrap(hash384.create());
		case 'sha512':
			return wrap(hash512.create());
		default:
			throw new TypeError('Unsupported SHA-2 algorithm.');
	}
}
/** Hash text or visible bytes synchronously and return bytes by default. */
export function digest(name: AlgorithmType, input: InputType, encoding?: 'bytes'): Uint8Array;
/** Return canonical text in the selected encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: 'hex' | 'base64url'): string;
/** Support a runtime-selected encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: EncodingType): Uint8Array | string;
export function digest(name: AlgorithmType, input: InputType, encoding: EncodingType = 'bytes'): Uint8Array | string {
	const state = create(name);
	try {
		return output(state.update(copy(input)).digest(), encoding);
	} finally {
		// Release provider state even when encoding or finalization throws.
		state.destroy();
	}
}
/** Return lower-case SHA-256. */
export function sha256(input: InputType): string {
	return digest('sha256', input, 'hex');
}
/** Return lower-case SHA-384. */
export function sha384(input: InputType): string {
	return digest('sha384', input, 'hex');
}
/** Return lower-case SHA-512. */
export function sha512(input: InputType): string {
	return digest('sha512', input, 'hex');
}
