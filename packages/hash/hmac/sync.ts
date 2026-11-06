/** Portable synchronous HMAC-SHA-2 with disposable reusable keys. @module */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { copy } from '../_bytes.ts';
import type { InputType } from '../_bytes.ts';
import type { AlgorithmType } from '../digest.ts';
export type { AlgorithmType, InputType } from '../digest.ts';
/** A copied secret belongs to this signer until destroy(). */
export interface SignerType {
	/** Return the complete tag of a synchronous message snapshot. */
	sign(input: InputType): Uint8Array;
	/** Compare complete tag bytes; wrong lengths return false. */
	verify(input: InputType, tag: Uint8Array): boolean;
	/** Clear owned key bytes and reject future use. Does not erase caller storage. */
	destroy(): void;
}
/** Import a copied nonempty key for repeated signing; destroy it when finished. */
export function create(name: AlgorithmType, secret: Uint8Array): SignerType {
	const hash = name === 'sha256' ? sha256 : name === 'sha384' ? sha384 : name === 'sha512' ? sha512 : undefined;
	if (hash === undefined) throw new TypeError('Unsupported HMAC SHA-2 algorithm.');
	const raw = copy(secret);
	if (raw.length === 0) throw new RangeError('HMAC key must not be empty.');
	/** Disposed key material must never silently become a zero-key signer. */
	let closed = false;
	/** Check the lifetime before reading the owned secret. */
	const assert = (): void => {
		if (closed) throw new Error('HMAC signer is destroyed.');
	};
	/** Keep verification tied to the owned key even if a caller replaces a public method. */
	const sign = (input: InputType): Uint8Array => {
		assert();
		return hmac(hash, raw, copy(input));
	};
	return {
		sign,
		verify(input, tag) {
			const expected = sign(input);
			try {
				if (expected.length !== tag.length) return false;
				let difference = 0;
				for (let index = 0; index < expected.length; index++) difference |= expected[index]! ^ tag[index]!;
				return difference === 0;
			} finally {
				expected.fill(0);
			}
		},
		destroy() {
			closed = true;
			raw.fill(0);
		},
	};
}
/** Sign once and dispose the copied secret on success or error. */
export function sign(name: AlgorithmType, secret: Uint8Array, input: InputType): Uint8Array {
	const signer = create(name, secret);
	try {
		return signer.sign(input);
	} finally {
		signer.destroy();
	}
}
/** Verify once and dispose the copied secret. JavaScript does not promise constant-time execution. */
export function verify(name: AlgorithmType, secret: Uint8Array, input: InputType, tag: Uint8Array): boolean {
	const signer = create(name, secret);
	try {
		return signer.verify(input, tag);
	} finally {
		signer.destroy();
	}
}
