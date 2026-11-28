/** Inspect the actual public paths and emitted runtime graph of every npm package. @module */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSync } from 'oxc-parser';
import { files } from './files.ts';
import { excluded } from './source.ts';
import type { SourceType } from './source.ts';

/** Inspect all staged public targets and runtime modules, not merely the root entry. */
export async function inspect(workspace: SourceType): Promise<void> {
	const { output, manifests } = workspace;
	const portable = [...manifests];

	let subpaths = 0;
	for (const [name] of portable) {
		const stage = resolve(output, name);
		const manifest = JSON.parse(await readFile(resolve(stage, 'package.json'), 'utf8'));
		for (const [key, value] of Object.entries(manifest.exports)) {
			if (excluded(name, key)) throw new Error(`${name} retained excluded export ${key}.`);
			// A raw WebAssembly export is a file path, not import conditions; it must exist in the stage.
			if (typeof value === 'string') {
				await readFile(resolve(stage, value));
				subpaths++;
				continue;
			}
			for (const branch of Object.values(value as Record<string, Record<string, string>>)) {
				for (const target of Object.values(branch)) await readFile(resolve(stage, target));
			}
			subpaths++;
		}
		for await (const file of files(resolve(stage, 'dist'))) {
			if (!/\.mjs$/.test(file)) continue;
			const text = await readFile(file, 'utf8');
			const parsed = parseSync(file, text);
			if (parsed.errors.length) throw new Error(`Cannot parse emitted runtime module ${file}.`);
			visit(parsed.program, (node) => {
				let specifier: unknown;
				if (
					['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(
						String(node.type),
					)
				) specifier = (node.source as Record<string, unknown> | undefined)?.value;
				if (
					node.type === 'CallExpression' && (node.callee as Record<string, unknown> | undefined)?.name === 'require'
				) specifier = (node.arguments as Record<string, unknown>[])[0]?.value;
				if (typeof specifier === 'string' && (specifier.startsWith('jsr:') || /\.ts(?:[?#]|$)/.test(specifier))) {
					throw new Error(`Source runtime import ${specifier} leaked into ${file}.`);
				}
				// Comments and optional globalThis.Deno capability detection are not hard runtime dependencies.
				if (
					node.type === 'MemberExpression' &&
					(node.object as Record<string, unknown> | undefined)?.type === 'Identifier' &&
					(node.object as Record<string, unknown>).name === 'Deno'
				) throw new Error(`Deno runtime dependency leaked into ${file}.`);
			});
		}
	}
	console.log(
		`Inspected ${portable.length} npm packages and ${subpaths} public subpaths (ESM modules and declarations).`,
	);
}

/** Visit parsed code nodes so examples and diagnostic strings cannot become false runtime dependencies. */
function visit(value: unknown, inspect: (node: Record<string, unknown>) => void): void {
	if (Array.isArray(value)) {
		for (const child of value) visit(child, inspect);
		return;
	}
	if (value === null || typeof value !== 'object') return;
	const node = value as Record<string, unknown>;
	if (typeof node.type === 'string') inspect(node);
	for (const child of Object.values(node)) if (typeof child === 'object') visit(child, inspect);
}
