import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as file from './file.ts';

describe('atomic Deno file replacement', () => {
	it('publishes complete replacement bytes and removes temporary state', async () => {
		const directory = await Deno.makeTempDir({ prefix: 'okikio-deno-file-' });
		try {
			const path = `${directory}/nested/value.txt`;
			await file.write(path, 'first');
			await file.write(path, 'second');
			expect(await Deno.readTextFile(path)).toBe('second');
			expect((await Array.fromAsync(Deno.readDir(`${directory}/nested`))).map((entry) => entry.name)).toEqual(['value.txt']);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});

	it('honors cancellation before publishing replacement bytes', async () => {
		const directory = await Deno.makeTempDir({ prefix: 'okikio-deno-file-cancel-' });
		try {
			const path = `${directory}/value.txt`;
			await Deno.writeTextFile(path, 'stable');
			const controller = new AbortController();
			controller.abort(new Error('cancelled'));
			await expect(file.write(path, 'replacement', { signal: controller.signal })).rejects.toThrow('cancelled');
			expect(await Deno.readTextFile(path)).toBe('stable');
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
});
