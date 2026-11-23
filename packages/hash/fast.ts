/**
 * Non-cryptographic hashes: XXH32, XXH64, XXH3-64 and XXH3-128 (optional little-endian seed as `key`),
 * rapidhash v3, SeaHash (optional 32-byte seed) and FNV-1a 64. Outputs are big-endian. Never use these where an
 * attacker chooses the input; use `@okikio/hash/mac` instead.
 *
 * There is no fallback outside WebAssembly, so await `ready()` before synchronous calls. Where the host has the
 * WebAssembly wide-arithmetic feature (Bun, Firefox 155, recent WebKit), `ready()` loads a build that uses it; results
 * are the same.
 *
 * ```ts ignore
 * import { hash, ready } from '@okikio/hash/fast';
 *
 * await ready();
 * hash('xxh3-64', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import { type HashOptionsType, runtime } from './_family.ts';
import type { HasherType } from './_hasher.ts';
import type { SourceType } from './_wasm/load.ts';
import { wide } from './_wasm/wide.ts';
import type { NameType } from './_wasm/registry.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_family.ts';
export type { HashOptionsType } from './_family.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
export type { SourceType } from './_wasm/load.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'fast'>;

const family = runtime({
	family: 'fast',
	mode: 'auto',
	// The wide-arithmetic build runs rapidhash 5 to 7 times faster; hosts without the feature get the plain one.
	packed: async () =>
		(wide() ? await import('./_wasm/packed/fast-wide.ts') : await import('./_wasm/packed/fast.ts')).text,
	raw: () =>
		wide() ? new URL('./_wasm/raw/fast-wide.wasm', import.meta.url) : new URL('./_wasm/raw/fast.wasm', import.meta.url),
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
