/** Strict canonical encodings for digests and random tokens. @module */
import { decodeHex, encodeHex } from '@std/encoding/hex';
import { decodeBase64, encodeBase64 } from '@std/encoding/base64';
import { decodeBase64Url, encodeBase64Url } from '@std/encoding/base64url';
/** Byte storage, including an exact visible view into a larger buffer. */
export type BytesType = ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;
/** Borrow the visible range for synchronous encoding; never retain caller storage. */
function view(input: BytesType): Uint8Array {
	return ArrayBuffer.isView(input)
		? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
		: new Uint8Array(input);
}
/** Encode lower-case hexadecimal without a prefix. */
export function hex(input: BytesType): string {
	return encodeHex(view(input));
}
/** Decode lower-case, even-length hexadecimal. Upper-case and whitespace are rejected. */
export function unhex(input: string): Uint8Array {
	if (!/^(?:[0-9a-f]{2})*$/.test(input)) throw new TypeError('Expected canonical lower-case hexadecimal.');
	return decodeHex(input);
}
/** Encode standard Base64 with padding. */
export function base64(input: BytesType): string {
	return encodeBase64(view(input));
}
/** Decode canonical padded Base64, rejecting whitespace and nonzero unused bits. */
export function unbase64(input: string): Uint8Array {
	const bytes = decodeBase64(input);
	if (base64(bytes) !== input) throw new TypeError('Expected canonical padded Base64.');
	return bytes;
}
/** Encode URL-safe Base64 without padding. */
export function base64url(input: BytesType): string {
	return encodeBase64Url(view(input));
}
/** Decode canonical unpadded Base64url, rejecting standard alphabet and unused bits. */
export function unbase64url(input: string): Uint8Array {
	const bytes = decodeBase64Url(input);
	if (base64url(bytes) !== input) throw new TypeError('Expected canonical unpadded Base64url.');
	return bytes;
}
