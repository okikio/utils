/**
 * Keyed hashes: SipHash-2-4 and SipHash-1-3 (64 and 128 bits, 16-byte key) and HighwayHash (64, 128 and
 * 256 bits, 32-byte key). The key is required; outputs are little-endian words.
 *
 * There is no fallback outside WebAssembly, so await `ready()` before synchronous calls.
 *
 * ```ts ignore
 * import { hash, ready } from '@okikio/hash/mac';
 *
 * await ready();
 * hash('siphash-2-4', 'hello', { key: new Uint8Array(16) });
 * ```
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import { type HashOptionsType, runtime } from './_family.ts';
import type { HasherType } from './_hasher.ts';
import type { SourceType } from './_wasm/load.ts';
import { text } from './_wasm/packed/mac.ts';
import type { NameType } from './_wasm/registry.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_family.ts';
export type { HashOptionsType } from './_family.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
export type { SourceType } from './_wasm/load.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'mac'>;

const family = runtime({
	family: 'mac',
	mode: 'auto',
	packed: text,
	raw: () => new URL('./_wasm/raw/mac.wasm', import.meta.url),
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
