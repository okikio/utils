/**
 * SHA-2: SHA-224, SHA-256, SHA-384, SHA-512, SHA-512/224 and SHA-512/256. Pass `key` for HMAC.
 *
 * `node:crypto` hashes inputs of 512 bytes or more (any size on Bun), because OpenSSL uses the CPU's SHA
 * instructions. Smaller inputs use WebAssembly once it has loaded. For the root SHA-256 helpers, see
 * `@okikio/hash`.
 *
 * ```ts
 * import { hash } from '@okikio/hash/sha2';
 *
 * hash('sha512-256', 'hello');
 * hash('sha256', 'message', { key: new TextEncoder().encode('secret') });
 * ```
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import { type HashOptionsType, runtime } from './_family.ts';
import type { HasherType } from './_hasher.ts';
import type { SourceType } from './_wasm/load.ts';
import { text } from './_wasm/packed/sha2.ts';
import type { NameType } from './_wasm/registry.ts';
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from '@noble/hashes/sha2.js';
import { fixed } from './_fallback.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_family.ts';
export type { HashOptionsType } from './_family.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
export type { SourceType } from './_wasm/load.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'sha2'>;

const family = runtime({
	family: 'sha2',
	packed: text,
	raw: new URL('./_wasm/raw/sha2.wasm', import.meta.url),
	fallbacks: {
		sha224: fixed(sha224, 'sha224'),
		sha256: fixed(sha256, 'sha256'),
		sha384: fixed(sha384, 'sha384'),
		sha512: fixed(sha512, 'sha512'),
		'sha512-224': fixed(sha512_224, 'sha512-224'),
		'sha512-256': fixed(sha512_256, 'sha512-256'),
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
