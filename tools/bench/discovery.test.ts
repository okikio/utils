/** New benchmark files join discovery without task or CI edits. */
import { describe, it } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect } from '@std/expect';
import { discoverBenchmarks, selectPrograms } from './suite.ts';

describe('benchmark discovery', () => {
	it('discovers a new package and excludes registration-only modules', async () => {
		await mkdir('.tmp/bench-discovery', { recursive: true });
		const directory = await mkdtemp(resolve('.tmp/bench-discovery/run-'));
		// Dispose lexically: Deno does not run node:test per-test after hooks.
		await using _cleanup = { [Symbol.asyncDispose]: () => rm(directory, { recursive: true }) };
		await mkdir(`${directory}/packages/new`, { recursive: true });
		await mkdir(`${directory}/bench`, { recursive: true });
		await writeFile(`${directory}/packages/new/new.bench.ts`, '// real standalone workload\n');
		await writeFile(`${directory}/bench/part.bench.ts`, '// @benchmark register-only\n');
		const found = discoverBenchmarks(pathToFileURL(`${directory}/`));
		expect(found.map((value) => value.path)).toEqual(['packages/new/new.bench.ts']);
		expect(selectPrograms(found.map((value) => value.path), '@okikio/new')).toEqual(['packages/new/new.bench.ts']);
		expect(() => selectPrograms(found.map((value) => value.path), 'typo')).toThrow(TypeError);
	});
});
