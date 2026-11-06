/** A fresh checkout must be able to install dependencies before importing dependency-backed tools. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { chmod, copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

it('selects preparation and container recipes without an installed workspace', async () => {
	// Copy only the entry point: accidental imports of release or CI tools must fail here.
	const evidence = resolve('.tmp/tests');
	await mkdir(evidence, { recursive: true });
	const root = await mkdtemp(resolve(evidence, 'bootstrap-'));
	await mkdir(resolve(root, 'tools/workspace'), { recursive: true });
	await mkdir(resolve(root, 'packages'));
	await mkdir(resolve(root, 'bin'));
	await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n');
	await copyFile(new URL('./run.ts', import.meta.url), resolve(root, 'tools/workspace/run.ts'));
	// Record recipe selection instead of installing packages or touching the network.
	const mise = resolve(root, 'bin/mise');
	await writeFile(mise, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
	await chmod(mise, 0o755);
	const result = spawnSync('node', [resolve(root, 'tools/workspace/run.ts'), 'prepare', '--kind', 'deps'], {
		encoding: 'utf8',
		env: { ...process.env, PATH: `${resolve(root, 'bin')}:${process.env.PATH}` },
	});
	expect(result.stderr).toBe('');
	expect(result.status).toBe(0);
	expect(result.stdout.trim().split('\n')).toEqual(['run', 'ops:prepare:deps', '--']);

	// Default preparation stays small; explicit engine names reach Playwright unchanged.
	for (
		const [args, expected] of [
			[['prepare', '--kind', 'browser'], ['chromium']],
			[['prepare', '--kind', 'browser', 'firefox', 'webkit', '--with-deps'], ['firefox', 'webkit', '--with-deps']],
			[['ci:run', '--lane', 'containers'], ['chromium', 'firefox', 'webkit', '--with-deps']],
		] as const
	) {
		const selected = spawnSync('node', [resolve(root, 'tools/workspace/run.ts'), ...args], {
			encoding: 'utf8',
			env: { ...process.env, PATH: `${resolve(root, 'bin')}:${process.env.PATH}` },
		});
		expect(selected.stderr).toBe('');
		expect(selected.status).toBe(0);
		expect(selected.stdout.trim().split('\n').slice(0, expected.length + 3))
			.toEqual(['run', 'ops:prepare:browser', '--', ...expected]);
	}
});
