/**
 * Strict lower-case hexadecimal on its own entry point.
 *
 * Encoding uses the host's `Uint8Array.prototype.toHex` and decoding `Uint8Array.fromHex` where they exist,
 * and `@std/encoding` elsewhere. Decoding accepts only lower-case, even-length text with no prefix or
 * whitespace, so each byte string has exactly one spelling.
 *
 * ```ts
 * import { hex, unhex } from '@okikio/hash/hex';
 *
 * hex(new Uint8Array([251, 255, 239])); // 'fbffef'
 * unhex('fbffef');
 * ```
 *
 * @module
 */
import { decodeHex, encodeHex } from '@std/encoding/hex';
import type { BytesType } from './base64.ts';

export type { BytesType } from './base64.ts';

interface NativeType {
	fromHex?(text: string): Uint8Array<ArrayBuffer>;
	prototype: { toHex?(): string };
}
const native = Uint8Array as unknown as NativeType;
const encodes = typeof native.prototype.toHex === 'function';
const decodes = typeof native.fromHex === 'function';

/** Encode lower-case hexadecimal without a prefix. */
export function hex(input: BytesType): string {
	const bytes = ArrayBuffer.isView(input)
		? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
		: new Uint8Array(input);
	return encodes ? (bytes as unknown as NativeType['prototype']).toHex!() : encodeHex(bytes);
}

/** Decode lower-case, even-length hexadecimal. Upper-case and whitespace are rejected. */
export function unhex(input: string): Uint8Array {
	// The native decoder also accepts upper case, so the alphabet is checked first.
	if (!/^(?:[0-9a-f]{2})*$/u.test(input)) throw new TypeError('Expected canonical lower-case hexadecimal.');
	return decodes ? native.fromHex!(input) : decodeHex(input);
}
