import { Crc32c } from '#/crc32c.ts';

/** Calculate CRC32C for a Deno-hosted file without retaining it in memory. */
export async function checksumFileCrc32c(path: string): Promise<string> {
	const checksum = new Crc32c();
	const file = await Deno.open(path, { read: true });
	const buffer = new Uint8Array(1024 * 1024);
	try {
		while (true) {
			const read = await file.read(buffer);
			if (read === null) break;
			checksum.update(buffer.subarray(0, read));
		}
		return checksum.digestBase64();
	} finally {
		file.close();
	}
}
