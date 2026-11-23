/**
 * National-standard family on the host's `node:crypto` (OpenSSL in Node.js and Deno, BoringSSL in Bun), and nothing else.
 *
 * Calls throw `UnsupportedError` where the host has no `node:crypto`, such as a browser, or where it lacks an
 * algorithm or an option (HMAC, output length). Incremental HMAC states cannot be cloned. `ready()` resolves at once.
 *
 * ```ts
 * import { hash } from '@okikio/hash/national/native';
 *
 * hash('sm3', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import { type HashOptionsType, runtime } from '../../_family.ts';
import type { HasherType } from '../../_hasher.ts';
import type { SourceType } from '../../_wasm/load.ts';
import { fallbacks } from '../../_fallback/national.ts';
export { CollisionError, NotReadyError, UnsupportedError } from '../../_family.ts';
export type { HashOptionsType } from '../../_family.ts';
export type { HasherType } from '../../_hasher.ts';
export type { InputType } from '../../_bytes.ts';
export type { SourceType } from '../../_wasm/load.ts';

/** Algorithm names this entry point runs. */
export type AlgorithmType = 'sm3';

const family = runtime({
	family: 'national',
	mode: 'native',
	fallbacks,
});

/** Resolves at once; `node:crypto` needs no loading. Present so that every entry point has the same shape. */
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
