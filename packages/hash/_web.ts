/** Web Crypto SHA-2 for hosts without built-in `node:crypto`. @module */
import { copy } from './_bytes.ts';
import type { InputType } from './_bytes.ts';
import { algorithm, output } from './_output.ts';
import type { AlgorithmType, EncodingType } from './digest.ts';

/**
 * Hash with Web Crypto. `crypto.subtle.digest` copies a BufferSource before it returns its promise, so a later change
 * to the caller's buffer cannot reach the digest. Only text, which needs UTF-8 encoding, and shared memory, which Web
 * Crypto refuses, are copied here.
 */
export async function web(name: AlgorithmType, input: InputType, encoding: EncodingType): Promise<Uint8Array | string> {
	const label = algorithm(name);
	const storage = typeof input === 'string' ? undefined : ArrayBuffer.isView(input) ? input.buffer : input;
	const source = storage instanceof ArrayBuffer ? input as ArrayBuffer | ArrayBufferView<ArrayBuffer> : copy(input);
	return output(new Uint8Array(await crypto.subtle.digest(label, source)), encoding);
}
