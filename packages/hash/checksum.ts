/**
 * Checksums for accidental corruption, never authentication: every CRC in the RevEng catalogue (113,
 * CRC-3 … CRC-82, by catalogue name), Adler-32 and Fletcher-16.
 *
 * Results are big-endian bytes, in the fewest whole bytes that hold the CRC width, so their hex matches
 * the catalogue's check values. `crc32` and `crc32c` return the value as an unsigned number. CRC-32 and
 * CRC-32C also run in pure JavaScript before or without WebAssembly; the others need the module.
 *
 * ```ts
 * import { crc32, hash } from '@okikio/hash/checksum';
 *
 * crc32(new TextEncoder().encode('123456789')); // 0xcbf43926
 * hash('CRC-16/ARC', '123456789');
 * ```
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import { type HashOptionsType, runtime } from './_family.ts';
import { fallbacks } from './_fallback/checksum.ts';
import type { HasherType } from './_hasher.ts';
import type { SourceType } from './_wasm/load.ts';
import { text } from './_wasm/packed/checksum.ts';
import type { NameType } from './_wasm/registry.ts';

export { CollisionError, NotReadyError, UnsupportedError } from './_family.ts';
export type { HashOptionsType } from './_family.ts';
export type { HasherType } from './_hasher.ts';
export type { InputType } from './_bytes.ts';
export type { SourceType } from './_wasm/load.ts';

/** Algorithm names of this family: RevEng catalogue names, `adler32` and `fletcher16`. */
export type AlgorithmType = NameType<'checksum'>;

const family = runtime({
	family: 'checksum',
	mode: 'auto',
	packed: text,
	raw: () => new URL('./_wasm/raw/checksum.wasm', import.meta.url),
	fallbacks,
});

/** Load the WebAssembly module now instead of on first use. Pass `source` to use your own copy. */
export function ready(source?: SourceType): Promise<void> {
	return family.ready(source);
}

/** Checksum complete input. Text is UTF-8. */
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

/** Start an incremental checksum; finalize it with `digest()` or release it with `destroy()`. */
export function create(name: AlgorithmType, options?: HashOptionsType): HasherType {
	return family.create(name, options);
}

const number = (bytes: Uint8Array): number => new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);

/** Return the unsigned IEEE CRC-32 (CRC-32/ISO-HDLC: zlib, PNG, Ethernet) of bytes. */
export function crc32(input: Uint8Array): number {
	return number(hash('CRC-32/ISO-HDLC', input));
}

/** Return the unsigned Castagnoli CRC-32C (CRC-32/ISCSI) of bytes. */
export function crc32c(input: Uint8Array): number {
	return number(hash('CRC-32/ISCSI', input));
}
