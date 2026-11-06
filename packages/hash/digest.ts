/** Native asynchronous SHA-2 hashing. @module */
import { copy } from './_bytes.ts';
import type { InputType } from './_bytes.ts';
import { algorithm, output } from './_output.ts';
export type { InputType } from './_bytes.ts';
/** Algorithms supported by native Web Crypto in every supported runtime. */
export type AlgorithmType = 'sha256' | 'sha384' | 'sha512';
/** Explicit output spelling avoids ambiguous strings at call sites. */
export type EncodingType = 'bytes' | 'hex' | 'base64url';
/**
 * Hash UTF-8 text or the visible bytes of a buffer view; output defaults to bytes.
 * Input is copied before the first await, so later caller mutations cannot change
 * this digest. Web Crypto owns the asynchronous operation; no cancellation is offered.
 */
export function digest(name: AlgorithmType, input: InputType, encoding?: 'bytes'): Promise<Uint8Array>;
/** Hash copied input and return the selected canonical text encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: 'hex' | 'base64url'): Promise<string>;
/** Hash input with a runtime-selected output encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: EncodingType): Promise<Uint8Array | string>;
export async function digest(
	name: AlgorithmType,
	input: InputType,
	encoding: EncodingType = 'bytes',
): Promise<Uint8Array | string> {
	// Snapshot the visible range before awaiting Web Crypto; callers may reuse their buffer immediately.
	const bytes = copy(input);
	return output(new Uint8Array(await crypto.subtle.digest(algorithm(name), bytes)), encoding);
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
