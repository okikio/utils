import { encodeBase64 } from '@std/encoding/base64';

const TABLE = createTable();

/** Incremental CRC32C checksum over byte chunks. */
export class Crc32c {
	#value = 0xffffffff;

	/** Add one byte chunk to the checksum state. */
	update(bytes: Uint8Array): this {
		let value = this.#value;
		for (const byte of bytes) {
			const index = (value ^ byte) & 0xff;
			const tableValue = TABLE[index];
			if (tableValue === undefined) throw new RangeError(`CRC32C table index ${index} is outside the lookup table.`);
			value = tableValue ^ (value >>> 8);
		}
		this.#value = value;
		return this;
	}

	/** Return the unsigned 32-bit checksum value. */
	digest(): number {
		return (~this.#value) >>> 0;
	}

	/** Return the checksum as the base64-encoded big-endian value used by S3 CRC32C metadata. */
	digestBase64(): string {
		const value = this.digest();
		return encodeBase64(Uint8Array.of(value >>> 24, value >>> 16 & 0xff, value >>> 8 & 0xff, value & 0xff));
	}

	/** @deprecated Use {@link digestBase64}. */
	base64(): string {
		return this.digestBase64();
	}
}

/** Calculate CRC32C for a composable asynchronous byte stream. */
export async function checksumCrc32c(chunks: AsyncIterable<Uint8Array>): Promise<string> {
	const checksum = new Crc32c();
	for await (const chunk of chunks) checksum.update(chunk);
	return checksum.digestBase64();
}

function createTable(): Uint32Array {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0x82f63b78 ^ value >>> 1 : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
}
