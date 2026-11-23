/**
 * Synchronous and incremental SHA-2 hashing.
 *
 * Where the host has built-in `node:crypto` (Deno, Node, Bun), the native hash does the work. Elsewhere, such as in a
 * browser, Noble's portable JavaScript does. Both produce the same bytes; the native one is many times faster.
 *
 * @module
 */
import { view } from './_bytes.ts';
import type { InputType } from './_bytes.ts';
import * as native from './_native.ts';
import { algorithm, output } from './_output.ts';
import type { AlgorithmType, EncodingType } from './digest.ts';
import { wrap } from './_hasher.ts';
import { portable } from './_portable.ts';
import type { HasherType } from './_hasher.ts';
export type { HasherType } from './_hasher.ts';
export type { AlgorithmType, EncodingType, InputType } from './digest.ts';
/** Allocate one incremental state; the owner must finalize or destroy it. */
export function create(name: AlgorithmType = 'sha256'): HasherType {
	if (native.provider) {
		algorithm(name);
		return wrap(native.state(native.provider.createHash(name)));
	}
	return portable(name);
}
/** Hash text or visible bytes synchronously and return bytes by default. */
export function digest(name: AlgorithmType, input: InputType, encoding?: 'bytes'): Uint8Array;
/** Return canonical text in the selected encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: 'hex' | 'base64url'): string;
/** Support a runtime-selected encoding. */
export function digest(name: AlgorithmType, input: InputType, encoding: EncodingType): Uint8Array | string;
export function digest(name: AlgorithmType, input: InputType, encoding: EncodingType = 'bytes'): Uint8Array | string {
	if (native.provider) return native.digest(native.provider, name, input, encoding);
	const state = portable(name);
	try {
		// Noble reads the bytes before update() returns, so a view is enough.
		return output(state.update(view(input)).digest(), encoding);
	} finally {
		// Release provider state even when encoding or finalization throws.
		state.destroy();
	}
}
/** Return lower-case SHA-256. */
export function sha256(input: InputType): string {
	return digest('sha256', input, 'hex');
}
/** Return lower-case SHA-384. */
export function sha384(input: InputType): string {
	return digest('sha384', input, 'hex');
}
/** Return lower-case SHA-512. */
export function sha512(input: InputType): string {
	return digest('sha512', input, 'hex');
}
