import { encodeHex } from '@std/encoding';

/** Return lowercase hexadecimal text for a byte buffer. */
export function toHex(bytes: Uint8Array): string {
	return encodeHex(bytes);
}

/**
 * Hash a byte or text payload with SHA-256 and return the lowercase hex digest.
 *
 * Source adapters and artifact writers use this helper instead of importing a
 * source-specific hashing module. That keeps integrity checks shared while WARC,
 * browser, and Common Crawl adapters stay independently testable.
 */
export async function sha256Hex(
	input: string | ArrayBufferLike | ArrayBufferView<ArrayBufferLike>,
): Promise<string> {
	const bytes = typeof input === 'string'
		? new TextEncoder().encode(input)
		: ArrayBuffer.isView(input)
		? Uint8Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
		: Uint8Array.from(new Uint8Array(input));
	return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** Hash small stable ids that do not need cryptographic secrecy. */
export async function stableId(prefix: string, parts: readonly string[]): Promise<string> {
	return `${prefix}-${(await sha256Hex(parts.join('\u0000'))).slice(0, 16)}`;
}
