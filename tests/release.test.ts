/** Keep npm/JSR version identity aligned while preserving authored manifest comments. @module */
import { describe, it } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@std/expect';
import { candidates } from '#tools/releases/candidates.ts';
import { versions } from '#tools/releases/versions.ts';

/** Own a disposable repository partition; no assertion can write the actual package manifests. */
async function fixture() {
	await mkdir('.tmp/tests', { recursive: true });
	const root = await mkdtemp(resolve('.tmp/tests/release-'));
	await mkdir(resolve(root, 'packages/example'), { recursive: true });
	await writeFile(
		resolve(root, 'packages/example/package.json'),
		JSON.stringify({ name: '@example/owned', version: '1.2.3' }),
	);
	const path = resolve(root, 'packages/example/deno.jsonc');
	await writeFile(path, '{\n // Keep source publication intent.\n "name": "@example/owned", "version": "1.1.0",\n}\n');
	return { root, path, [Symbol.asyncDispose]: () => rm(root, { recursive: true }) };
}

describe('release version projection', () => {
	it('rejects drift, preserves JSONC, and synchronizes idempotently', async () => {
		await using scope = await fixture();
		await expect(versions(scope.root)).rejects.toThrow('differs');
		await versions(scope.root, true);
		const first = await readFile(scope.path, 'utf8');
		expect(first).toContain('// Keep source publication intent.');
		expect(first).toContain('1.2.3');
		await versions(scope.root);
		await versions(scope.root, true);
		expect(await readFile(scope.path, 'utf8')).toBe(first);
	});
	it('rejects name drift before writing a projection', async () => {
		await using scope = await fixture();
		const before = (await readFile(scope.path, 'utf8')).replace('@example/owned', '@example/other');
		await writeFile(scope.path, before);
		await expect(versions(scope.root, true)).rejects.toThrow('names differ');
		expect(await readFile(scope.path, 'utf8')).toBe(before);
	});
});

describe('npm candidate ownership', () => {
	it('rejects stale artifacts and publication redirects before publication', async () => {
		await using scope = await fixture();
		const source = {
			name: '@example/owned',
			version: '1.2.3',
			publishConfig: { directory: '../../.tmp/artifacts/npm/example', linkDirectory: false },
		};
		await writeFile(resolve(scope.root, 'packages/example/package.json'), JSON.stringify(source));
		const directory = resolve(scope.root, '.tmp/artifacts/npm/example');
		await mkdir(directory, { recursive: true });
		const path = resolve(directory, 'package.json');
		const artifact = { name: source.name, version: '1.2.2', type: 'module' };
		await writeFile(path, JSON.stringify(artifact));
		await expect(candidates(scope.root)).rejects.toThrow('identity differs');
		artifact.version = source.version;
		await writeFile(path, JSON.stringify(artifact));
		await candidates(scope.root);
		await writeFile(path, JSON.stringify({ ...artifact, publishConfig: { directory: '../other' } }));
		await expect(candidates(scope.root)).rejects.toThrow('publication redirect');
	});
});
