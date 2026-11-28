/** Native workspace identity remains independent of source nesting and publication policy. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packages } from './source.ts';

it('retains nested public owners and rejects a selection containing only private packages', async () => {
	await mkdir('.tmp/tests', { recursive: true });
	const root = await mkdtemp(join(process.cwd(), '.tmp/tests/native-owners-'));
	await using _cleanup = { [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) };
	await writeFile(join(root, 'package.json'), '{"private":true}\n');
	await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/**'\n");
	for (
		const [directory, name, privatePackage] of [
			['packages/group/source', '@probe/identity', false],
			['packages/private', '@probe/private', true],
		] as const
	) {
		await mkdir(join(root, directory), { recursive: true });
		await writeFile(join(root, directory, 'package.json'), JSON.stringify({ name, private: privatePackage }));
	}
	const expected = [{
		name: '@probe/identity',
		path: join(root, 'packages/group/source'),
		directory: 'packages/group/source',
	}];
	expect(packages(root)).toEqual(expected);
	expect(packages(root, ['@probe/identity'])).toEqual(expected);
	expect(packages(root, ['./packages/group/source'])).toEqual(expected);
	expect(() => packages(root, ['@probe/private'])).toThrow('no public source package');
	expect(() => packages(root, ['@probe/absent'])).toThrow('Native package selection failed');
});
