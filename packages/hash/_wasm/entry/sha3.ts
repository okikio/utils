/**
 * WebAssembly-only SHA-3: SHA3-224 … SHA3-512, Keccak, SHAKE, cSHAKE, TurboSHAKE and KangarooTwelve, with HMAC for the fixed-length digests.
 *
 * Nothing loads until you call `ready()`, and nothing falls back to another backend. Pass the module in
 * the form you already have, or call `ready()` with no argument to load the file beside this module:
 *
 * ```ts ignore
 * import * as module from './vendor/sha3.wasm'; // a copy of _wasm/raw/sha3.wasm from this package
 * import { hash, ready } from '@okikio/hash/sha3/wasm';
 *
 * await ready(module);
 * hash('sha3-256', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import { type HashOptionsType, runtime } from '../../_family.ts';
import type { HasherType } from '../../_hasher.ts';
import type { SourceType } from '../load.ts';
import type { NameType } from '../registry.ts';

export { CollisionError, NotReadyError, UnsupportedError } from '../../_family.ts';
export type { HashOptionsType } from '../../_family.ts';
export type { HasherType } from '../../_hasher.ts';
export type { InputType } from '../../_bytes.ts';
export type { SourceType } from '../load.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'sha3'>;

const family = runtime({ family: 'sha3', raw: new URL('../raw/sha3.wasm', import.meta.url) });

/**
 * Load the module. Without `source`, read or fetch `sha3.wasm` beside this module. With `source`, use it
 * as it is: the exports of a WASM ESM import, a `WebAssembly.Module`, an `Instance`, a `Response`, bytes
 * or a URL.
 */
export function ready(source?: SourceType): Promise<void> {
	return family.ready(source);
}

/** Hash complete input. Throws `NotReadyError` before `ready()` resolves. Text is UTF-8. */
export function hash(name: AlgorithmType, input: InputType, options?: HashOptionsType): Uint8Array {
	return family.hash(name, input, options);
}

/** Start an incremental state. Throws `NotReadyError` before `ready()` resolves. */
export function create(name: AlgorithmType, options?: HashOptionsType): HasherType {
	return family.create(name, options);
}
