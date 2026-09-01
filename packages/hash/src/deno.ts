import { createHash } from 'node:crypto';

import { Crc32c } from './crc32c.ts';

/** Hashes retained from one bounded-memory file scan. */
export interface FileDigestType {
	readonly bytes: number;
	readonly sha256: string;
	readonly crc32c: string;
}

/**
 * Read one Deno-hosted file once and calculate the hashes used by immutable storage.
 *
 * SHA-256 is the durable content identity. CRC32C remains the transport-integrity
 * checksum used by S3-compatible WACZ uploads. The implementation intentionally
 * shares one file scan so callers do not read large archives once per algorithm.
 */
export async function digestFile(path: string): Promise<FileDigestType> {
	const sha256 = createHash('sha256');
	const crc32c = new Crc32c();
	const file = await Deno.open(path, { read: true });
	const buffer = new Uint8Array(1024 * 1024);
	let bytes = 0;
	try {
		while (true) {
			const read = await file.read(buffer);
			if (read === null) break;
			const chunk = buffer.subarray(0, read);
			bytes += read;
			sha256.update(chunk);
			crc32c.update(chunk);
		}
		return Object.freeze({ bytes, sha256: sha256.digest('hex'), crc32c: crc32c.digestBase64() });
	} finally {
		file.close();
	}
}
