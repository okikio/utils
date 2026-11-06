/** Keep focused measurements independently runnable and prevent package coverage from disappearing. */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import ts from 'typescript';
import { integrationPrograms, packagePrograms } from './suite.ts';
import { discover } from '../testing/discover.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('package benchmark ownership', () => {
	it('registers every package workload once and leaves integration programs at root', async () => {
		const found: string[] = [];
		const tests = await discover(root);
		for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const directory = resolve(root, 'packages', entry.name);
			const files = await readdir(directory);
			if (!files.includes('package.json')) continue;
			const programs = files.filter((name) => name.endsWith('.bench.ts'));
			expect(programs.length, `${entry.name} needs a measured public capability`).toBeGreaterThan(0);
			const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
			const deno = JSON.parse(await readFile(resolve(directory, 'deno.jsonc'), 'utf8'));
			expect(manifest.devDependencies.mitata).toBeDefined();
			expect(deno.tasks.test).toBeDefined();
			expect(
				tests.some((file) => file.path.startsWith(`packages/${entry.name}/`) && file.family !== 'types'),
				`${entry.name} needs executable unit tests`,
			).toBe(true);
			for (const name of programs) {
				expect(deno.tasks.bench).toContain('--project');
				expect(deno.tasks['bench:check']).toContain('--check');
				found.push(`packages/${entry.name}/${name}`);
				const source = ts.createSourceFile(
					name,
					await readFile(resolve(directory, name), 'utf8'),
					ts.ScriptTarget.Latest,
					true,
				);
				const inspect = (node: ts.Node): void => {
					if (
						ts.isStringLiteral(node) && (
							(ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) ||
							(ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword)
						)
					) {
						const specifier = node.text;
						expect(specifier.startsWith('#'), `${entry.name}: root-private import ${specifier}`).toBe(false);
						if (specifier.startsWith('.')) {
							expect(
								resolve(directory, specifier).startsWith(directory + '/'),
								`${entry.name}: escaping import ${specifier}`,
							).toBe(true);
						} else if (!specifier.startsWith('node:')) {
							const name = specifier.startsWith('@')
								? specifier.split('/').slice(0, 2).join('/')
								: specifier.split('/')[0]!;
							expect(
								name === manifest.name ||
									[manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some((group) =>
										group?.[name]
									),
								`${entry.name}: undeclared ${name}`,
							).toBe(true);
						}
					}
					ts.forEachChild(node, inspect);
				};
				inspect(source);
			}
		}
		expect([...packagePrograms].sort()).toEqual(found.sort());
		expect(new Set(packagePrograms).size).toBe(packagePrograms.length);
		expect(integrationPrograms.every((path) => path.startsWith('bench/'))).toBe(true);
	});
});
