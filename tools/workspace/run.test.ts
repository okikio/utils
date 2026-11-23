/** A fresh checkout must be able to install dependencies before importing dependency-backed tools. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

it('selects preparation recipes without an installed workspace', async () => {
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
	expect(result.stdout.trim().split('\n')).toEqual(['run', 'prepare:node', '--']);

	// Default preparation stays small; explicit engine names reach Playwright unchanged.
	for (
		const [args, expected] of [
			[['prepare', '--kind', 'browser'], ['chromium']],
			[['prepare', '--kind', 'browser', 'firefox', 'webkit', '--with-deps'], ['firefox', 'webkit', '--with-deps']],
		] as const
	) {
		const selected = spawnSync('node', [resolve(root, 'tools/workspace/run.ts'), ...args], {
			encoding: 'utf8',
			env: { ...process.env, PATH: `${resolve(root, 'bin')}:${process.env.PATH}` },
		});
		expect(selected.stderr).toBe('');
		expect(selected.status).toBe(0);
		expect(selected.stdout.trim().split('\n').slice(0, expected.length + 3))
			.toEqual(['run', 'fixture:browser', '--', ...expected]);
	}
});

it('forwards affected runtime files without dropping repository compositions or comparisons', async (context) => {
	const evidence = resolve('.tmp/tests');
	await mkdir(evidence, { recursive: true });
	const root = await mkdtemp(resolve(evidence, 'ci-selection-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (
		const directory of [
			'tools/workspace',
			'tools/testing',
			'packages/changed',
			'packages/unrelated',
			'tests',
			'bench',
			'bin',
		]
	) {
		await mkdir(resolve(root, directory), { recursive: true });
	}
	await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n');
	await copyFile(new URL('./run.ts', import.meta.url), resolve(root, 'tools/workspace/run.ts'));
	await copyFile(new URL('../testing/discover.ts', import.meta.url), resolve(root, 'tools/testing/discover.ts'));
	for (
		const file of [
			'packages/changed/value.test.ts',
			'packages/unrelated/value.test.ts',
			'tests/composed.test.ts',
			'tools/workspace/owner.test.ts',
			'bench/owner.test.ts',
		]
	) {
		await writeFile(resolve(root, file), 'throw new Error("Selection must not execute a test fixture");\n');
	}
	// Observe actual CLI argv so a correct planner cannot hide a lost workflow input.
	const mise = resolve(root, 'bin/mise');
	await writeFile(mise, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
	await chmod(mise, 0o755);
	const invoke = (selection: string) =>
		spawnSync('node', [
			resolve(root, 'tools/workspace/run.ts'),
			'ci:run',
			'--lane',
			'runtimes',
			'--runtime',
			'node',
			'--projects-json',
			selection,
		], { encoding: 'utf8', env: { ...process.env, PATH: `${resolve(root, 'bin')}:${process.env.PATH}` } });
	const result = invoke('["changed"]');
	expect(result.status).toBe(0);
	expect(result.stderr).toBe('');
	expect(result.stdout.trim().split('\n')).toEqual([
		'run',
		'test:node',
		'--',
		'bench/owner.test.ts',
		'packages/changed/value.test.ts',
		'tests/composed.test.ts',
		'tools/workspace/owner.test.ts',
		'run',
		'test:comparisons',
		'--',
		'node',
	]);
	for (const invalid of ['["typo"]', '"changed"', '[1]']) expect(invoke(invalid).status).not.toBe(0);
});

it('retains both old and new package consumers when Git detects a rename', async (context) => {
	const evidence = resolve('.tmp/tests');
	await mkdir(evidence, { recursive: true });
	const root = await mkdtemp(resolve(evidence, 'ci-rename-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(resolve(root, 'tools/workspace'), { recursive: true });
	await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n');
	await writeFile(resolve(root, '.gitignore'), '/node_modules\n');
	await symlink(resolve('node_modules'), resolve(root, 'node_modules'), 'dir');
	for (const file of ['run.ts', 'ci.ts']) {
		await copyFile(new URL(file, import.meta.url), resolve(root, 'tools/workspace', file));
	}
	for (const name of ['a', 'b', 'old-consumer', 'new-consumer']) {
		await mkdir(resolve(root, 'packages', name), { recursive: true });
		const target = name === 'old-consumer' ? 'a' : name === 'new-consumer' ? 'b' : undefined;
		await writeFile(
			resolve(root, 'packages', name, 'package.json'),
			JSON.stringify({
				name: `@okikio/${name}`,
				devDependencies: target ? { [`@okikio/${target}`]: 'workspace:*' } : {},
			}),
		);
	}
	await writeFile(resolve(root, 'packages/a/value.ts'), 'export const value = 1;\n');
	/** Real Git rename detection proves the CLI keeps the deleted owner too. */
	const git = (...args: string[]): string => {
		const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
		expect(result.status, result.stderr).toBe(0);
		return result.stdout.trim();
	};
	git('init', '-q');
	git('add', '--all');
	git(
		'-c',
		'user.name=CI test',
		'-c',
		'user.email=ci@example.invalid',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-qm',
		'Before rename',
	);
	const base = git('rev-parse', 'HEAD');
	await rename(resolve(root, 'packages/a/value.ts'), resolve(root, 'packages/b/value.ts'));
	git('add', '--all');
	git(
		'-c',
		'user.name=CI test',
		'-c',
		'user.email=ci@example.invalid',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-qm',
		'After rename',
	);
	const head = git('rev-parse', 'HEAD');
	expect(git('diff', '--name-status', base, head)).toContain('R100');
	const result = spawnSync(
		'node',
		[resolve(root, 'tools/workspace/run.ts'), 'ci:plan', '--base', base, '--head', head],
		{
			cwd: root,
			encoding: 'utf8',
		},
	);
	expect(result.status, result.stderr).toBe(0);
	expect(JSON.parse(result.stdout).projects).toEqual(['a', 'b', 'new-consumer', 'old-consumer']);
});

it('splits the container lane into shards and installs browsers only where a browser test runs', async (context) => {
	const evidence = resolve('.tmp/tests');
	await mkdir(evidence, { recursive: true });
	const root = await mkdtemp(resolve(evidence, 'ci-shards-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const directory of ['tools/workspace', 'tools/testing', 'tests/workflows', 'packages', 'bench', 'bin']) {
		await mkdir(resolve(root, directory), { recursive: true });
	}
	await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n');
	await copyFile(new URL('./run.ts', import.meta.url), resolve(root, 'tools/workspace/run.ts'));
	await copyFile(new URL('../testing/discover.ts', import.meta.url), resolve(root, 'tools/testing/discover.ts'));
	for (const name of ['containers', 'duplex-browser', 'duplex-proxy', 'postgres-load']) {
		await writeFile(
			resolve(root, `tests/workflows/${name}.test.ts`),
			'throw new Error("Selection must not run tests");\n',
		);
	}
	const mise = resolve(root, 'bin/mise');
	await writeFile(mise, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
	await chmod(mise, 0o755);
	const invoke = (shard: string) =>
		spawnSync('node', [resolve(root, 'tools/workspace/run.ts'), 'ci:run', '--lane', 'containers', '--shard', shard], {
			encoding: 'utf8',
			env: { ...process.env, PATH: `${resolve(root, 'bin')}:${process.env.PATH}` },
		});
	// Sorted: containers, duplex-browser, duplex-proxy, postgres-load. Shard 1 of 2 takes the 1st and 3rd.
	const first = invoke('1/2');
	expect(first.stderr).toBe('');
	expect(first.stdout.trim().split('\n')).toEqual([
		'run',
		'test:containers',
		'--',
		'tests/workflows/containers.test.ts',
		'tests/workflows/duplex-proxy.test.ts',
	]);
	const second = invoke('2/2');
	expect(second.stderr).toBe('');
	expect(second.stdout.trim().split('\n')).toEqual([
		'run',
		'fixture:browser',
		'--',
		'chromium',
		'firefox',
		'webkit',
		'--with-deps',
		'run',
		'test:containers',
		'--',
		'tests/workflows/duplex-browser.test.ts',
		'tests/workflows/postgres-load.test.ts',
	]);
	expect(invoke('3/2').status).not.toBe(0);
	expect(invoke('two').status).not.toBe(0);
});
