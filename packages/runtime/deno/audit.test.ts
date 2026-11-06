import { directory as temporaryDirectory } from './fixtures/directory.ts';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as file from './file.ts';

describe('bounded operator files', () => {
	it('checks JSON input kind, original bytes, strict UTF-8 and cancellation', async () => {
		const dir = await temporaryDirectory();
		try {
			const path = `${dir}/input`;
			await Deno.writeTextFile(path, '{"ok":true}');
			expect(await file.readJson(path, 11)).toEqual({ ok: true });
			await expect(file.readJson(path, 10)).rejects.toThrow(RangeError);
			await expect(file.readJson(dir, 100)).rejects.toThrow(TypeError);
			await Deno.writeFile(path, new Uint8Array([34, 255, 34]));
			await expect(file.readJson(path, 10)).rejects.toThrow(TypeError);
			await expect(file.readJson(path, 10, AbortSignal.abort('stop'))).rejects.toBe('stop');
		} finally {
			await Deno.remove(dir, { recursive: true });
		}
	});
	it('creates audit files exclusively, rejects overlapping appends and closes once', async () => {
		const dir = await temporaryDirectory();
		try {
			const path = `${dir}/audit.jsonl`;
			await using output = await file.audit(path, 100);
			await expect(file.audit(path)).rejects.toThrow(Deno.errors.AlreadyExists);
			const first = output.append({ action: 'write' });
			await expect(output.append({ action: 'overlap' })).rejects.toThrow('active append');
			await first;
			await output.append(null);
			await output.close();
			await output.close();
			await expect(output.append('closed')).rejects.toThrow('closed');
			expect(await Deno.readTextFile(path)).toBe('{"action":"write"}\nnull\n');
			if (Deno.build.os !== 'windows') expect((await Deno.stat(path)).mode! & 0o777).toBe(0o600);
		} finally {
			await Deno.remove(dir, { recursive: true });
		}
	});
});
