import { describe, it } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect } from '@std/expect';
import { claimOutput } from '#tools/bench/output.ts';

describe('benchmark output ownership', () => {
	it('refuses to replace existing reports or a file at the output path', async () => {
		await mkdir('.tmp/tests', { recursive: true });
		const root = await mkdtemp(resolve('.tmp/tests/benchmark-output-'));
		await using _cleanup = { [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) };
		const output = join(root, 'evidence');
		await mkdir(output);
		const prior = '{"status":"pass","run":"original"}\n';
		await writeFile(join(output, 'meta.json'), prior);
		await writeFile(join(output, '0.json'), 'original samples\n');
		await expect(claimOutput(output)).rejects.toThrow('Choose a fresh directory.');
		expect(await readFile(join(output, 'meta.json'), 'utf8')).toBe(prior);
		expect(await readFile(join(output, '0.json'), 'utf8')).toBe('original samples\n');
		const file = join(root, 'file');
		await writeFile(file, 'retained');
		await expect(claimOutput(file)).rejects.toThrow('Choose a fresh directory.');
		expect(await readFile(file, 'utf8')).toBe('retained');
	});

	it('admits exactly one concurrent writer while creating missing parents', async () => {
		await mkdir('.tmp/tests', { recursive: true });
		const root = await mkdtemp(resolve('.tmp/tests/benchmark-output-'));
		await using _cleanup = { [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) };
		const output = join(root, 'nested', 'evidence');
		const results = await Promise.allSettled([claimOutput(output), claimOutput(output)]);
		expect(results.filter((result) => result.status === 'fulfilled').length).toBe(1);
		expect(results.filter((result) => result.status === 'rejected').length).toBe(1);
		await writeFile(join(output, 'meta.json'), 'winning run');
		await expect(claimOutput(output)).rejects.toThrow('Choose a fresh directory.');
		expect(await readFile(join(output, 'meta.json'), 'utf8')).toBe('winning run');
	});
});
