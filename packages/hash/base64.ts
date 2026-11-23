/**
 * Strict Base64 and Base64url on their own entry point, so a page that only encodes does not load any hash.
 *
 * Encoding uses the host's `Uint8Array.prototype.toBase64` and decoding `Uint8Array.fromBase64` where they
 * exist (Chrome 140+, Firefox 133+, Safari 18.2+, Deno, Bun), and `@std/encoding` elsewhere (Node.js 22).
 * Both paths accept only the canonical form: `base64` is padded with the standard alphabet, `base64url` is
 * unpadded with the URL alphabet, and neither allows whitespace or nonzero unused bits. A decoder that
 * accepted several spellings of the same bytes would let two different strings compare unequal.
 *
 * ```ts
 * import { base64url, unbase64url } from '@okikio/hash/base64';
 *
 * const token = base64url(new Uint8Array([251, 255, 239])); // '-__v'
 * unbase64url(token);
 * ```
 *
 * @module
 */
import { decodeBase64, encodeBase64 } from '@std/encoding/base64';
import { decodeBase64Url, encodeBase64Url } from '@std/encoding/base64url';

/** Byte storage, including an exact visible view into a larger buffer. */
export type BytesType = ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

interface NativeType {
	fromBase64?(text: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array<ArrayBuffer>;
	prototype: { toBase64?(options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string };
}
const native = Uint8Array as unknown as NativeType;
const encodes = typeof native.prototype.toBase64 === 'function';
const decodes = typeof native.fromBase64 === 'function';

/** Borrow the visible range for synchronous encoding; never retain caller storage. */
function view(input: BytesType): Uint8Array {
	return ArrayBuffer.isView(input)
		? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
		: new Uint8Array(input);
}

/** Encode standard Base64 with padding. */
export function base64(input: BytesType): string {
	const bytes = view(input);
	return encodes ? (bytes as unknown as NativeType['prototype']).toBase64!() : encodeBase64(bytes);
}

/** Decode canonical padded Base64, rejecting whitespace and nonzero unused bits. */
export function unbase64(input: string): Uint8Array {
	let bytes: Uint8Array;
	try {
		bytes = decodes ? native.fromBase64!(input) : decodeBase64(input);
	} catch {
		throw new TypeError('Expected canonical padded Base64.');
	}
	// Re-encoding rejects every non-canonical spelling at once: whitespace, missing padding, the URL
	// alphabet and nonzero bits in the last character.
	if (base64(bytes) !== input) throw new TypeError('Expected canonical padded Base64.');
	return bytes;
}

/** Encode URL-safe Base64 without padding. */
export function base64url(input: BytesType): string {
	const bytes = view(input);
	return encodes
		? (bytes as unknown as NativeType['prototype']).toBase64!({ alphabet: 'base64url', omitPadding: true })
		: encodeBase64Url(bytes);
}

/** Decode canonical unpadded Base64url, rejecting the standard alphabet, padding and unused bits. */
export function unbase64url(input: string): Uint8Array {
	let bytes: Uint8Array;
	try {
		bytes = decodes ? native.fromBase64!(input, { alphabet: 'base64url' }) : decodeBase64Url(input);
	} catch {
		throw new TypeError('Expected canonical unpadded Base64url.');
	}
	if (base64url(bytes) !== input) throw new TypeError('Expected canonical unpadded Base64url.');
	return bytes;
}
