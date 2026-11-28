/** Real Git revisions and native pnpm manifests must retain both sides of a moved package file. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { copyFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('retains both old and new package consumers when Git detects a rename', async () => {
	const evidence = resolve('.tmp/tests');
	await mkdir(evidence, { recursive: true });
	const root = await mkdtemp(resolve(evidence, 'ci-rename-'));
	await using _cleanup = { [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) };
	await mkdir(resolve(root, 'tools/workspace/ci'), { recursive: true });
	await writeFile(resolve(root, 'package.json'), '{"type":"module","private":true}\n');
	await writeFile(resolve(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
	await mkdir(resolve(root, 'tools/packages'), { recursive: true });
	await writeFile(resolve(root, '.gitignore'), '/node_modules\n');
	await symlink(resolve('node_modules'), resolve(root, 'node_modules'), 'dir');
	await copyFile(new URL('./plan.ts', import.meta.url), resolve(root, 'tools/workspace/ci/plan.ts'));
	await copyFile(new URL('../../packages/source.ts', import.meta.url), resolve(root, 'tools/packages/source.ts'));
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
		[resolve(root, 'tools/workspace/ci/plan.ts'), '--base', base, '--head', head],
		{
			cwd: root,
			encoding: 'utf8',
		},
	);
	expect(result.status, result.stderr).toBe(0);
	expect(JSON.parse(result.stdout).projects).toEqual(['a', 'b', 'new-consumer', 'old-consumer']);
});
