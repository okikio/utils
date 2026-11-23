/**
 * Checksum family in pure JavaScript (the package's own CRC code), and nothing else.
 *
 * Runs everywhere, including hosts without WebAssembly or with a Content Security Policy that refuses it, and
 * QuickJS. It is 5 to 20 times slower than the WebAssembly module for most algorithms. `ready()` resolves at once.
 *
 * ```ts
 * import { hash } from '@okikio/hash/checksum/portable';
 *
 * hash('CRC-32/ISO-HDLC', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import { type HashOptionsType, runtime } from '../../_family.ts';
import type { HasherType } from '../../_hasher.ts';
import type { SourceType } from '../../_wasm/load.ts';
import { fallbacks } from '../../_fallback/checksum.ts';
export { CollisionError, NotReadyError, UnsupportedError } from '../../_family.ts';
export type { HashOptionsType } from '../../_family.ts';
export type { HasherType } from '../../_hasher.ts';
export type { InputType } from '../../_bytes.ts';
export type { SourceType } from '../../_wasm/load.ts';

/** Algorithm names this entry point runs. */
export type AlgorithmType = 'CRC-32/ISO-HDLC' | 'CRC-32/ISCSI';

const family = runtime({
	family: 'checksum',
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
