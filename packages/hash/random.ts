/** Cryptographically secure random bytes and unbiased integers. @module */
import { size } from './_size.ts';
/** Maximum one-shot allocation prevents accidental multi-gigabyte requests. */
export const MAX_BYTES = 16 * 1024 * 1024;
/** Fill an existing visible byte range, splitting Web Crypto's 65,536-byte quota. */
export function fill(target: Uint8Array): Uint8Array {
	for (let offset = 0; offset < target.length; offset += 65536) {
		const length = Math.min(65536, target.length - offset);
		if (target.buffer instanceof ArrayBuffer) {
			crypto.getRandomValues(new Uint8Array(target.buffer, target.byteOffset + offset, length));
		} else {
			// Web Crypto's portable type contract excludes shared buffers. Fill ordinary
			// temporary storage and copy into the caller's visible shared range.
			target.set(crypto.getRandomValues(new Uint8Array(length)), offset);
		}
	}
	return target;
}
/** Allocate secure bytes. Zero is allowed; the maximum allocation is MAX_BYTES. */
export function bytes(length: number): Uint8Array {
	size(length, MAX_BYTES);
	return fill(new Uint8Array(length));
}
/**
 * Choose an unbiased safe integer in [minimum, maximum). Both bounds and their
 * difference must be safe integers. Rejection sampling avoids modulo bias.
 */
export function integer(minimum: number, maximum: number): number {
	const range = maximum - minimum;
	if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || !Number.isSafeInteger(range) || range <= 0) {
		throw new RangeError('Expected increasing safe integer bounds with a safe difference.');
	}
	const bound = BigInt(range);
	const domain = 1n << 64n;
	// Admit the largest multiple of the requested range. Every remainder
	// then has exactly the same number of preimages in the admitted domain.
	const limit = domain - domain % bound;
	const storage = new Uint8Array(8);
	const view = new DataView(storage.buffer);
	for (;;) {
		fill(storage);
		const value = view.getBigUint64(0);
		if (value < limit) return minimum + Number(value % bound);
	}
}
