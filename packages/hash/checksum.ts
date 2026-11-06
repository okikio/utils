/** Incremental CRC checksums for accidental corruption, never authentication. @module */
/** Supported reflected CRC-32 polynomials. */
export type AlgorithmType = 'crc32' | 'crc32c';
/** A mutable checksum with the same terminal and fork rules as digest states. */
export interface ChecksumType {
	/** Consume bytes immediately. */
	update(input: Uint8Array): this;
	/** Finalize once into an unsigned 32-bit number. */
	digest(): number;
	/** Fork the unfinished checksum. */
	clone(): ChecksumType;
	/** End use without producing a checksum. */
	destroy(): void;
}
/**
 * Allocate reflected CRC state. CRC-32 uses the IEEE polynomial; CRC-32C uses
 * Castagnoli. Both start and finish with XOR 0xffffffff. The bitwise recurrence
 * avoids mutable global tables and module initialization work.
 */
export function create(name: AlgorithmType = 'crc32'): ChecksumType {
	const polynomial = name === 'crc32' ? 0xedb88320 : name === 'crc32c' ? 0x82f63b78 : undefined;
	if (polynomial === undefined) throw new TypeError('Unsupported CRC algorithm.');
	/** Build a fork from its pre-finalized register, owned by this instance alone. */
	function state(initial: number): ChecksumType {
		/** Running reflected register before final XOR. */
		let register = initial;
		/** Finalization and disposal prevent accidental reuse. */
		let closed = false;
		/** Guard register access after termination. */
		const assert = (): void => {
			if (closed) throw new Error('Checksum is finalized or destroyed.');
		};
		return {
			update(input) {
				assert();
				// Reflected CRC consumes the low bit first. Keep the unfinished register
				// separate from the final XOR so clone() can resume the same prefix.
				for (const byte of input) {
					register ^= byte;
					for (let bit = 0; bit < 8; bit++) register = (register >>> 1) ^ ((register & 1) ? polynomial! : 0);
				}
				return this;
			},
			digest() {
				assert();
				closed = true;
				const result = (register ^ 0xffffffff) >>> 0;
				register = 0;
				return result;
			},
			clone() {
				assert();
				return state(register);
			},
			destroy() {
				closed = true;
				register = 0;
			},
		};
	}
	return state(0xffffffff);
}
/** Return the unsigned IEEE CRC-32 of bytes. */
export function crc32(input: Uint8Array): number {
	return create('crc32').update(input).digest();
}
/** Return the unsigned Castagnoli CRC-32C of bytes. */
export function crc32c(input: Uint8Array): number {
	return create('crc32c').update(input).digest();
}
