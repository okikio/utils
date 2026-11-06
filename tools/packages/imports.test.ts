/** Protect package independence and the root's cross-runtime private import contract. */
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { parse } from '@std/jsonc';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);

/** Walk authored runtime modules without traversing dependencies or executable fixtures. */
async function* modules(directory: string): AsyncGenerator<string> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'fixtures') continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) yield* modules(path);
		else if (entry.name.endsWith('.ts') && !/\.(?:test|bench)\.ts$/u.test(entry.name)) yield path;
	}
}

/** Collect literal module specifiers from imports, re-exports, dynamic imports, and imported types. */
function specifiers(path: string, text: string): readonly string[] {
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const values: string[] = [];
	function visit(node: ts.Node): void {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
			if (ts.isStringLiteral(node.moduleSpecifier)) values.push(node.moduleSpecifier.text);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const argument = node.arguments[0];
			if (argument && ts.isStringLiteral(argument)) values.push(argument.text);
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			if (ts.isStringLiteral(node.argument.literal)) values.push(node.argument.literal.text);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return values;
}

describe('workspace import ownership', () => {
	it('keeps tools private, discoverable and independent of ancestor dependency hoisting', async () => {
		const npm = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
		const deno = parse(await readFile(new URL('deno.jsonc', root), 'utf8')) as { workspace: string[] };
		const tools = JSON.parse(await readFile(new URL('tools/package.json', root), 'utf8'));
		expect(npm.workspaces).toContain('tools');
		expect(deno.workspace).toContain('tools');
		expect(tools.private).toBe(true);
		expect(tools.version).toBeUndefined();
		expect(tools.type).toBe('module');
		expect(createRequire(new URL('tools/package.json', root)).resolve('#tools/packages/exports.ts')).toBe(
			fileURLToPath(new URL('tools/packages/exports.ts', root)),
		);
		for await (const path of modules(fileURLToPath(new URL('tools/', root)))) {
			for (const name of specifiers(path, await readFile(path, 'utf8'))) {
				if (name.startsWith('.') || name.startsWith('#') || name.startsWith('node:')) continue;
				const dependency = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!;
				expect(tools.dependencies, `${relative(fileURLToPath(root), path)} imports undeclared ${dependency}`)
					.toHaveProperty(dependency);
				// Both importers share the selected version; each still declares its own actual dependencies.
				if (npm.devDependencies[dependency]) {
					expect(tools.dependencies[dependency]).toBe(npm.devDependencies[dependency]);
				}
			}
		}
	});
	it('resolves root private imports to the same physical files in both manifest maps', async () => {
		const npm = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as {
			readonly imports: Readonly<Record<string, string>>;
		};
		const deno = parse(await readFile(new URL('deno.jsonc', root), 'utf8')) as {
			readonly imports: Readonly<Record<string, string>>;
		};
		for (
			const [prefix, target, sample] of [
				['#tools/', './tools/', 'bench/run.ts'],
				['#fixtures/', './tests/fixtures/', 'http-parity/corpus.ts'],
				['#bench/', './bench/', 'hono.bench.ts'],
			] as const
		) {
			expect(npm.imports[`${prefix}*`]).toBe(`${target}*`);
			expect(deno.imports[prefix]).toBe(target);
			const expected = new URL(target + sample, root);
			expect(pathToFileURL(createRequire(new URL('package.json', root)).resolve(prefix + sample)).href).toBe(
				expected.href,
			);
			expect((await readFile(expected)).length).toBeGreaterThan(0);
		}
	});

	it('keeps utility implementation imports inside their package or behind a named dependency', async () => {
		const packages = fileURLToPath(new URL('packages/', root));
		const problems: string[] = [];
		for (const entry of await readdir(packages, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const owner = resolve(packages, entry.name);
			for await (const path of modules(owner)) {
				for (const specifier of specifiers(path, await readFile(path, 'utf8'))) {
					if (/^#(?:tools|fixtures|bench)\//u.test(specifier)) {
						problems.push(`${relative(packages, path)} imports root tooling ${specifier}`);
					} else if (specifier.startsWith('.')) {
						const target = fileURLToPath(new URL(specifier, pathToFileURL(path)));
						const within = relative(owner, target);
						if (within === '..' || within.startsWith('../')) {
							problems.push(`${relative(packages, path)} escapes its package through ${specifier}`);
						}
					}
				}
			}
		}
		expect(problems).toEqual([]);
	});
});
