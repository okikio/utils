/** Required runtime work must fail when one selected native member lacks its script. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

it('rejects a missing task in a mixed selection before completing the runtime lane', async () => {
	const repository = fileURLToPath(new URL('../../../', import.meta.url));
	await mkdir(resolve(repository, '.tmp/tests'), { recursive: true });
	const root = await mkdtemp(resolve(repository, '.tmp/tests/required-task-'));
	await using _cleanup = { [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) };
	for (const directory of ['tools/workspace/ci', 'tools/packages', 'packages/ready', 'packages/missing', 'bin']) {
		await mkdir(resolve(root, directory), { recursive: true });
	}
	// Mise owns the runtime; this offline fixture must not trigger a pnpm version download.
	await writeFile(resolve(root, 'package.json'), '{"private":true,"type":"module"}\n');
	await writeFile(resolve(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
	for (const name of ['ready', 'missing']) {
		await writeFile(
			resolve(root, 'packages', name, 'package.json'),
			JSON.stringify({
				name: `@probe/${name}`,
				scripts: name === 'ready' ? { 'test:node': 'node -e "console.log(\'owner executed\')"' } : {},
			}),
		);
	}
	const installed = spawnSync('pnpm', ['install', '--offline', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
	expect(installed.status, installed.stderr).toBe(0);
	await symlink(resolve(repository, 'node_modules'), resolve(root, 'tools/node_modules'), 'dir');
	await copyFile(new URL('./execute.ts', import.meta.url), resolve(root, 'tools/workspace/ci/execute.ts'));
	await copyFile(new URL('../../packages/source.ts', import.meta.url), resolve(root, 'tools/packages/source.ts'));
	const mise = resolve(root, 'bin/mise');
	await writeFile(mise, '#!/bin/sh\nprintf "composition executed\\n"\n');
	await chmod(mise, 0o755);
	const result = spawnSync('node', [
		resolve(root, 'tools/workspace/ci/execute.ts'),
		'--lane',
		'runtimes',
		'--runtime',
		'node',
		'--projects-json',
		'["ready","missing"]',
	], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${resolve(root, 'bin')}:${process.env.PATH}` } });
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain('Missing script: test:node');
	expect(result.stdout).not.toContain('composition executed');
});

it('splits the container lane into shards and installs browsers only where a browser test runs', async (context) => {
	const evidence = resolve('.tmp/tests');
	await mkdir(evidence, { recursive: true });
	const root = await mkdtemp(resolve(evidence, 'ci-shards-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (
		const directory of [
			'tools/workspace/ci',
			'tools/packages',
			'tools/testing',
			'tests/workflows',
			'packages',
			'bench',
			'bin',
		]
	) {
		await mkdir(resolve(root, directory), { recursive: true });
	}
	await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n');
	await copyFile(new URL('./execute.ts', import.meta.url), resolve(root, 'tools/workspace/ci/execute.ts'));
	await copyFile(new URL('../../packages/source.ts', import.meta.url), resolve(root, 'tools/packages/source.ts'));
	await symlink(resolve('node_modules'), resolve(root, 'node_modules'), 'dir');
	await copyFile(new URL('../../testing/discover.ts', import.meta.url), resolve(root, 'tools/testing/discover.ts'));
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
		spawnSync('node', [resolve(root, 'tools/workspace/ci/execute.ts'), '--lane', 'containers', '--shard', shard], {
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
