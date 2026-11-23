/**
 * SHA-3 competition designs: Grøstl, JH, Skein (state size, then output size), Shabal, and Whirlpool.
 *
 * There is no fallback outside WebAssembly, so await `ready()` before synchronous calls.
 *
 * ```ts ignore
 * import { hash, ready } from '@okikio/hash/contest';
 *
 * await ready();
 * hash('skein512-512', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import { type HashOptionsType, runtime } from './_family.ts';
import type { HasherType } from './_hasher.ts';
import type { SourceType } from './_wasm/load.ts';
import { text } from './_wasm/packed/contest.ts';
import type { NameType } from './_wasm/registry.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_family.ts';
export type { HashOptionsType } from './_family.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
export type { SourceType } from './_wasm/load.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'contest'>;

const family = runtime({
	family: 'contest',
	packed: text,
	raw: new URL('./_wasm/raw/contest.wasm', import.meta.url),
	fallbacks: {},
});

/**
 * Load the WebAssembly module now instead of on first use. Synchronous calls before it resolves run on
 * `node:crypto` or pure JavaScript where they can (this family has none, so await `ready()` first). Pass `source` to use a module you loaded
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
