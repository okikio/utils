// @benchmark deno
/** Real same-filesystem publication; sync policy is compared without implying power-loss certification. @module */
import { deepStrictEqual } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as file from './deno/file.ts';

const scratch = new URL('../../.tmp/bench/file-policy/', import.meta.url);
await Deno.mkdir(scratch, { recursive: true });
const directory = await Deno.makeTempDir({ dir: fileURLToPath(scratch), prefix: 'run-' });
try {
	for (const size of [1024, 1024 * 1024]) {
		const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251);
		const path = directory + '/value';
		for (const durability of ['none', 'file', 'directory'] as const) {
			await file.write(path, bytes, { durability });
			deepStrictEqual(await Deno.readFile(path), bytes);
			group(`same-filesystem replace ${size} bytes; sync ${durability}`, () => {
				bench('owned file publication', async () => do_not_optimize(await file.write(path, bytes, { durability })));
			});
		}
		group(`native trusted rename reference ${size} bytes; no sync`, () => {
			bench('native write and rename; no cancellation or cleanup contract', async () => {
				const temporary = directory + '/native';
				await Deno.writeFile(temporary, bytes);
				await Deno.rename(temporary, path);
			});
		});
	}
	await run();
} finally {
	await Deno.remove(directory, { recursive: true });
}
