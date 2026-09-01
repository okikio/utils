import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { checksumFileCrc32c } from '#/crc32c-deno.ts';
import { checksumCrc32c, Crc32c } from '#/crc32c.ts';

async function makeTestTempFile(): Promise<string> {
	const root = `${Deno.cwd()}/.tmp/tests`;
	await Deno.mkdir(root, { recursive: true });
	return await Deno.makeTempFile({ dir: root, prefix: 'kaiju-crc32c-' });
}

describe('CRC32C', () => {
	it('matches the standard check value', async () => {
		const bytes = new TextEncoder().encode('123456789');
		const checksum = new Crc32c().update(bytes);
		expect(checksum.digest()).toBe(0xe3069283);
		expect(checksum.digestBase64()).toBe('4waSgw==');
		expect(
			await checksumCrc32c((async function* () {
				yield bytes;
			})()),
		).toBe('4waSgw==');
	});

	it('supports incremental updates', () => {
		const encoder = new TextEncoder();
		const checksum = new Crc32c()
			.update(encoder.encode('1234'))
			.update(encoder.encode('56789'));
		expect(checksum.digest()).toBe(0xe3069283);
	});

	it('streams Deno files without retaining the complete input', async () => {
		const path = await makeTestTempFile();
		try {
			await Deno.writeTextFile(path, '123456789');
			expect(await checksumFileCrc32c(path)).toBe('4waSgw==');
		} finally {
			await Deno.remove(path);
		}
	});
});
