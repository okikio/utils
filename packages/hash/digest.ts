/** Native asynchronous SHA-2 hashing. @module */
import type { InputType } from './_bytes.ts';
import * as native from './_native.ts';
import { web } from './_web.ts';
export type { InputType } from './_bytes.ts';
/** Algorithms supported by native Web Crypto in every supported runtime. */
export type AlgorithmType = 'sha256' | 'sha384' | 'sha512';
/** Explicit output spelling avoids ambiguous strings at call sites. */
export type EncodingType = 'bytes' | 'hex' | 'base64url';
/**
 * Hash UTF-8 text or the visible bytes of a buffer view; output defaults to bytes.
 *
 * Where the host has built-in `node:crypto` (Deno, Node, Bun), the digest is computed before this returns, so the
 * promise resolves without waiting on Web Crypto. Elsewhere Web Crypto computes it. Either way the bytes are read
 * before the first await: later changes to the caller's buffer cannot change this digest. No cancellation is offered.
 */
export function digest(name: AlgorithmType, input: InputType, encoding?: 'bytes'): Promise<Uint8Array>;
/** Hash input and return the selected canonical text encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: 'hex' | 'base64url'): Promise<string>;
/** Hash input with a runtime-selected output encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: EncodingType): Promise<Uint8Array | string>;
export function digest(
	name: AlgorithmType,
	input: InputType,
	encoding: EncodingType = 'bytes',
): Promise<Uint8Array | string> {
	try {
		return native.provider
			? Promise.resolve(native.digest(native.provider, name, input, encoding))
			: web(name, input, encoding);
	} catch (error) {
		return Promise.reject(error);
	}
}

/** Return a lower-case SHA-256 digest, preserving the original package contract. */
export function sha256(input: InputType): Promise<string> {
	return digest('sha256', input, 'hex');
}
/** Return a lower-case SHA-384 digest. */
export function sha384(input: InputType): Promise<string> {
	return digest('sha384', input, 'hex');
}
/** Return a lower-case SHA-512 digest. */
export function sha512(input: InputType): Promise<string> {
	return digest('sha512', input, 'hex');
}
