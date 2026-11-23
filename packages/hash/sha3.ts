/**
 * SHA-3: SHA3-224 … SHA3-512 and Keccak-224 … Keccak-512 (pass `key` for HMAC), SHAKE128/256, cSHAKE128/256
 * (`key` is the customization string), TurboSHAKE128/256, KangarooTwelve (KT128, KT256) and KMAC128/256
 * (`key` is the MAC key and is required). Pass `length` for the output size of the extendable outputs and KMAC.
 *
 * SHA-3 and Keccak differ only in padding; Ethereum uses Keccak-256, not SHA3-256.
 *
 * ```ts
 * import { hash, sha3_256 } from '@okikio/hash/sha3';
 *
 * sha3_256('hello');
 * hash('shake256', 'hello', { length: 100 });
 * ```
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import { type HashOptionsType, runtime } from './_family.ts';
import { fallbacks } from './_fallback/sha3.ts';
import type { HasherType } from './_hasher.ts';
import type { SourceType } from './_wasm/load.ts';
import { text } from './_wasm/packed/sha3.ts';
import type { NameType } from './_wasm/registry.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_family.ts';
export type { HashOptionsType } from './_family.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
export type { SourceType } from './_wasm/load.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'sha3'>;

const family = runtime({
	family: 'sha3',
	mode: 'auto',
	packed: text,
	raw: () => new URL('./_wasm/raw/sha3.wasm', import.meta.url),
	fallbacks,
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

/** Return the 32-byte SHA3-256 digest. */
export function sha3_256(input: InputType): Uint8Array {
	return hash('sha3-256', input);
}

/** Return the 64-byte SHA3-512 digest. */
export function sha3_512(input: InputType): Uint8Array {
	return hash('sha3-512', input);
}
