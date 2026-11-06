/** A fresh checkout must be able to install dependencies before importing dependency-backed tools. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { chmod, copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

it('selects dependency installation without an installed workspace', async () => {
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
});
