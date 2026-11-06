/** Validated native algorithms and canonical result formatting. @module */
import { base64url, hex } from './encoding.ts';
import type { AlgorithmType, EncodingType } from './digest.ts';
/** Reject unknown algorithms before forwarding to a runtime implementation. */
export function algorithm(name: AlgorithmType): 'SHA-256' | 'SHA-384' | 'SHA-512' {
	switch (name) {
		case 'sha256':
			return 'SHA-256';
		case 'sha384':
			return 'SHA-384';
		case 'sha512':
			return 'SHA-512';
		default:
			throw new TypeError('Unsupported SHA-2 algorithm.');
	}
}
/** Encode a fresh digest result according to the explicit output contract. */
export function output(bytes: Uint8Array, encoding: EncodingType): Uint8Array | string {
	switch (encoding) {
		case 'bytes':
			return bytes;
		case 'hex':
			return hex(bytes);
		case 'base64url':
			return base64url(bytes);
		default:
			throw new TypeError('Unsupported digest encoding.');
	}
}
