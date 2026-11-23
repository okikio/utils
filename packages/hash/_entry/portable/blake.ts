/**
 * BLAKE family in pure JavaScript (`@noble/hashes`), and nothing else.
 *
 * Runs everywhere, including hosts without WebAssembly or with a Content Security Policy that refuses it, and
 * QuickJS. It is 5 to 20 times slower than the WebAssembly module for most algorithms. `ready()` resolves at once.
 *
 * ```ts
 * import { hash } from '@okikio/hash/blake/portable';
 *
 * hash('blake3', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import { type HashOptionsType, runtime } from '../../_family.ts';
import type { HasherType } from '../../_hasher.ts';
import type { SourceType } from '../../_wasm/load.ts';
import type { NameType } from '../../_wasm/registry.ts';
import { fallbacks } from '../../_fallback/blake.ts';
export { CollisionError, NotReadyError, UnsupportedError } from '../../_family.ts';
export type { HashOptionsType } from '../../_family.ts';
export type { HasherType } from '../../_hasher.ts';
export type { InputType } from '../../_bytes.ts';
export type { SourceType } from '../../_wasm/load.ts';

/** Algorithm names this entry point runs. */
export type AlgorithmType = NameType<'blake'>;

const family = runtime({
	family: 'blake',
	mode: 'portable',
	fallbacks,
});

/** Resolves at once; pure JavaScript needs no loading. Present so that every entry point has the same shape. */
export function ready(source?: SourceType): Promise<void> {
	return family.ready(source);
}

/** Hash complete input with this backend only. Text is UTF-8. */
export function hash(name: AlgorithmType, input: InputType, options?: HashOptionsType): Uint8Array {
	return family.hash(name, input, options);
}

/** Start an incremental state with this backend only. */
export function create(name: AlgorithmType, options?: HashOptionsType): HasherType {
	return family.create(name, options);
}
