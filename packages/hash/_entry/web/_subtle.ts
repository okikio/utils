/** Web Crypto digest and HMAC for the `/web` entry points. @module */
import { copy } from '../../_bytes.ts';
import type { InputType } from '../../_bytes.ts';

/** Options for a Web Crypto hash. */
export interface WebOptionsType {
	/** HMAC key bytes. Present means HMAC; absent means a plain digest. The key must not be empty. */
	readonly key?: Uint8Array;
}

/**
 * Hash with `crypto.subtle` only. Input and key are copied before the first await, so a later change to the
 * caller's buffers cannot reach the result. A host without `crypto.subtle`, such as an insecure browser context,
 * rejects with `TypeError`.
 */
export async function subtle(label: string, input: InputType, options?: WebOptionsType): Promise<Uint8Array> {
	const bytes = copy(input);
	const secret = options?.key === undefined ? undefined : copy(options.key);
	const api = globalThis.crypto?.subtle;
	if (!api) throw new TypeError('crypto.subtle is not available; it needs a secure context.');
	if (!secret) return new Uint8Array(await api.digest(label, bytes));
	if (secret.length === 0) throw new RangeError('HMAC key must not be empty.');
	try {
		const key = await api.importKey('raw', secret, { name: 'HMAC', hash: label }, false, ['sign']);
		return new Uint8Array(await api.sign('HMAC', key, bytes));
	} finally {
		secret.fill(0);
	}
}
