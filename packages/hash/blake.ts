/**
 * BLAKE: BLAKE2b at 128 … 512 bits and BLAKE2s at 128 … 256 bits, where `key` selects BLAKE2's own keyed
 * mode (1–64 bytes for BLAKE2b, 1–32 for BLAKE2s), and BLAKE3, where a 32-byte `key` selects keyed mode,
 * `blake3-derive` takes the context string as `key`, and `length` sets any output size.
 *
 * ```ts
 * import { blake3, hash } from '@okikio/hash/blake';
 *
 * blake3('hello');
 * hash('blake3-derive', 'key material', { key: new TextEncoder().encode('my app 2026 session keys') });
 * ```
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import { type HashOptionsType, runtime } from './_family.ts';
import type { HasherType } from './_hasher.ts';
import type { SourceType } from './_wasm/load.ts';
import { text } from './_wasm/packed/blake.ts';
import type { NameType } from './_wasm/registry.ts';
import { blake2b as noble2b, blake2s as noble2s } from '@noble/hashes/blake2.js';
import { blake3 as noble3 } from '@noble/hashes/blake3.js';
import type { FallbackType } from './_family.ts';
import type { StateType } from './_hasher.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_family.ts';
export type { HashOptionsType } from './_family.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
export type { SourceType } from './_wasm/load.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'blake'>;

const family = runtime({
	family: 'blake',
	packed: text,
	raw: new URL('./_wasm/raw/blake.wasm', import.meta.url),
	fallbacks: {
		'blake2b-128': two(noble2b, 16),
		'blake2b-160': two(noble2b, 20),
		'blake2b-224': two(noble2b, 28),
		'blake2b-256': two(noble2b, 32),
		'blake2b-384': two(noble2b, 48),
		'blake2b-512': { ...two(noble2b, 64), native: 'blake2b512' },
		'blake2s-128': two(noble2s, 16),
		'blake2s-160': two(noble2s, 20),
		'blake2s-224': two(noble2s, 28),
		'blake2s-256': { ...two(noble2s, 32), native: 'blake2s256' },
		blake3: { portable: (key, dkLen) => noble3.create({ dkLen, ...(key ? { key } : {}) }) },
		'blake3-derive': { portable: (key, dkLen) => noble3.create({ dkLen, context: key ?? new Uint8Array(0) }) },
	},
});

/**
 * Load the WebAssembly module now instead of on first use. Synchronous calls before it resolves run on
 * `node:crypto` or pure JavaScript where they can. Pass `source` to use a module you loaded
 * yourself.
 */
export function ready(source?: SourceType): Promise<void> {
	return family.ready(source);
}

/** Hash complete input. Text is UTF-8. */
export function hash(name: AlgorithmType, input: InputType, options?: HashOptionsType): Uint8Array {
	return family.hash(name, input, options);
}

/**
 * The backend the next `hash` call for `name` would use (`native`, `wasm`, `portable`, or `none` when it
 * would throw). `length` is the input size in bytes; omit it for `create`. For diagnostics and tests.
 */
export function backend(
	name: AlgorithmType,
	length?: number,
	options?: HashOptionsType,
): 'native' | 'wasm' | 'portable' | 'none' {
	return family.backend(name, length, options);
}

/** Start an incremental state; finalize it with `digest()` or release it with `destroy()`. */
export function create(name: AlgorithmType, options?: HashOptionsType): HasherType {
	return family.create(name, options);
}

/** Return the 64-byte BLAKE2b-512 digest. */
export function blake2b(input: InputType): Uint8Array {
	return hash('blake2b-512', input);
}

/** Return the 32-byte BLAKE2s-256 digest. */
export function blake2s(input: InputType): Uint8Array {
	return hash('blake2s-256', input);
}

/** Return the 32-byte BLAKE3 digest. */
export function blake3(input: InputType): Uint8Array {
	return hash('blake3', input);
}

/** BLAKE2 with Noble's `dkLen` and `key` options, which match the module's sizes and keyed mode. */
function two(hash: { create(options: { dkLen: number; key?: Uint8Array }): StateType }, dkLen: number): FallbackType {
	return { portable: (key) => hash.create({ dkLen, ...(key ? { key } : {}) }) };
}
