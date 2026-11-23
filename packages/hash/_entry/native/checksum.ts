/**
 * CRC-32 on the host's built-in `zlib.crc32()`, and nothing else.
 *
 * `node:zlib` uses the CPU's carry-less multiply, so it runs at 5 to 90 GB/s, against about 2.5 GB/s for the
 * WebAssembly module. Node.js 22.2 and later, Deno and Bun have it. Calls throw `UnsupportedError` where the host has
 * no `zlib.crc32`, such as a browser. `ready()` resolves at once.
 *
 * ```ts
 * import { hash } from '@okikio/hash/checksum/native';
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
export type AlgorithmType = 'CRC-32/ISO-HDLC';

const family = runtime({
	family: 'checksum',
	mode: 'native',
	fallbacks,
});

/** Resolves at once; `node:zlib` needs no loading. Present so that every entry point has the same shape. */
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
