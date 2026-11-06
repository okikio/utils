/** Native asynchronous HMAC-SHA-2 with explicit key ownership. @module */
import { copy } from '../_bytes.ts';
import type { InputType } from '../_bytes.ts';
import { algorithm } from '../_output.ts';
import type { AlgorithmType } from '../digest.ts';
export type { AlgorithmType, InputType } from '../digest.ts';
/** A reusable non-extractable native key, owned by this signer rather than a global cache. */
export interface SignerType {
	/** Copy the admitted message before signing. Output is the complete tag. */
	sign(input: InputType): Promise<Uint8Array>;
	/** Copy message and tag before verification; malformed tag lengths return false. */
	verify(input: InputType, tag: Uint8Array): Promise<boolean>;
}
/**
 * Import a nonempty raw byte key once. This object retains its native key until
 * garbage collection; Web Crypto provides no explicit key erasure operation.
 * Keys are bytes, not passwords; choose random keys of at least the digest size.
 */
export async function create(name: AlgorithmType, secret: Uint8Array): Promise<SignerType> {
	const raw = copy(secret);
	if (raw.length === 0) throw new RangeError('HMAC key must not be empty.');
	let key: CryptoKey;
	try {
		key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: algorithm(name) }, false, ['sign', 'verify']);
	} finally {
		raw.fill(0);
	}
	return {
		async sign(input) {
			const bytes = copy(input);
			return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
		},
		async verify(input, tag) {
			const bytes = copy(input);
			const signature = copy(tag);
			return await crypto.subtle.verify('HMAC', key, signature, bytes);
		},
	};
}
/** Sign a copied message and key without retaining a reusable signer. */
export async function sign(name: AlgorithmType, secret: Uint8Array, input: InputType): Promise<Uint8Array> {
	const bytes = copy(input);
	return (await create(name, secret)).sign(bytes);
}
/** Verify complete tag bytes with native HMAC verification. No text or prefix matching is performed. */
export async function verify(
	name: AlgorithmType,
	secret: Uint8Array,
	input: InputType,
	tag: Uint8Array,
): Promise<boolean> {
	const bytes = copy(input);
	const signature = copy(tag);
	return (await create(name, secret)).verify(bytes, signature);
}
