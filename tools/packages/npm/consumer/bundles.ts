/** Prove selective adoption through installed focused and umbrella entry points. @module */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'tsdown';
import { command } from '../command.ts';
import type { SourceType } from '../source.ts';

/** Prove selective adoption against installed ESM artifacts and actual bundled module graphs. */
export async function bundles(workspace: SourceType, directory: string): Promise<void> {
	const cases = [
		{ name: 'focused', specifier: '@okikio/result' },
		{ name: 'umbrella', specifier: '@okikio/utils/result' },
	];
	const sizes: number[] = [];
	for (const item of cases) {
		const entry = resolve(directory, `${item.name}.mjs`);
		await writeFile(
			entry,
			`import { ok, unwrap } from ${
				JSON.stringify(item.specifier)
			}; if (unwrap(ok(42)) !== 42) throw new Error('result bundle changed behavior'); console.log('result bundle passed');`,
		);
		const results = (await build({
			config: false,
			cwd: directory,
			entry: [entry],
			outDir: resolve(directory, `bundle-${item.name}`),
			format: ['esm'],
			platform: 'node',
			target: 'esnext',
			dts: false,
			minify: true,
			treeshake: true,
			publint: false,
			attw: false,
			deps: { alwaysBundle: [/^@okikio\//] },
		})).bundles;
		const modules = results.flatMap((result) =>
			result.chunks.flatMap((chunk) => 'modules' in chunk ? Object.keys(chunk.modules) : [])
		);
		if (!modules.some((path) => path.includes('/@okikio/result/'))) {
			throw new Error(`${item.name}: result was not bundled from the installed artifact.`);
		}
		for (const path of modules) {
			if (/\/@okikio\/(?:runtime|worker|server|storage)\//.test(path)) {
				throw new Error(`${item.name} retained unrelated capability ${path}.`);
			}
		}
		const emitted = results.flatMap((result) => result.chunks.filter((chunk) => chunk.type === 'chunk'));
		if (emitted.length !== 1) throw new Error(`${item.name}: expected one selective consumer chunk.`);
		sizes.push(Buffer.byteLength(emitted[0]!.code));
		command(workspace, 'node', [resolve(directory, `bundle-${item.name}`, emitted[0]!.fileName)], directory);
		for (const result of results) await result[Symbol.asyncDispose]();
	}
	console.log(
		`Installed focused and umbrella result bundles passed graph and behavior checks (${
			sizes.join(', ')
		} bytes; sizes are evidence, not a timing or byte threshold).`,
	);
}
