/**
 * Bitwise CRC-32 and CRC-32C in JavaScript, the fallback of the checksum family where WebAssembly is
 * unavailable. Both are reflected, start at 0xffffffff and finish with XOR 0xffffffff. The bitwise
 * recurrence avoids a lookup table and module initialization work.
 *
 * @module
 */
import type { StateType } from './_hasher.ts';

/** Reflected polynomials: IEEE for CRC-32/ISO-HDLC, Castagnoli for CRC-32/ISCSI. */
export const polynomials = { ieee: 0xedb88320, castagnoli: 0x82f63b78 } as const;

/** A CRC state whose digest is the 4 big-endian bytes of the CRC, like the WebAssembly module's. */
export function crc(polynomial: number, initial = 0xffffffff): StateType {
	let register = initial;
	return {
		update(input) {
			// Reflected CRC consumes the low bit first. The unfinished register stays separate from the
			// final XOR so clone() can resume the same prefix.
			for (const byte of input) {
				register ^= byte;
				for (let bit = 0; bit < 8; bit++) register = (register >>> 1) ^ ((register & 1) ? polynomial : 0);
			}
			return this;
		},
		digest() {
			const value = (register ^ 0xffffffff) >>> 0;
			register = 0;
			return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value].map((byte) => byte & 0xff));
		},
		clone: () => crc(polynomial, register),
		destroy() {
			register = 0;
		},
	};
}
