/** Check installed declaration resolution and retain the compiler's full diagnostic receipt. @module */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { command } from '../command.ts';
import { files } from '../files.ts';
import type { SourceType } from '../source.ts';

/** Check every prepared public import against physical declarations in the isolated consumer. */
export async function types(workspace: SourceType, directory: string, paths: readonly string[]): Promise<void> {
	const { root, manifests } = workspace;
	const portable = [...manifests];
	const typeStarted = performance.now();
	const diagnostics = command(
		workspace,
		'node',
		[
			resolve(root, 'node_modules/typescript-native/bin/tsc'),
			'--project',
			resolve(directory, 'tsconfig.json'),
			'--pretty',
			'false',
			'--extendedDiagnostics',
		],
		root,
		true,
	);
	const elapsedMilliseconds = performance.now() - typeStarted;
	let declarationBytes = 0;
	for (const [name] of portable) {
		for await (const file of files(resolve(directory, 'node_modules', '@okikio', name, 'dist'))) {
			if (/\.d\.[cm]ts$/.test(file)) declarationBytes += (await readFile(file)).byteLength;
		}
	}
	await writeFile(
		resolve(directory, 'types-report.json'),
		`${
			JSON.stringify(
				{
					node: process.version,
					compiler:
						JSON.parse(await readFile(resolve(root, 'node_modules/typescript-native/package.json'), 'utf8')).version,
					declarationGenerator:
						JSON.parse(await readFile(resolve(root, 'node_modules/typescript/package.json'), 'utf8')).version,
					subpaths: paths.length,
					declarationBytes,
					elapsedMilliseconds,
					diagnostics,
					interpretation:
						'One complete ESM all-subpath correctness check. Elapsed time includes Node/compiler startup and is diagnostic evidence, not an editor latency or performance regression threshold.',
				},
				null,
				2,
			)
		}\n`,
	);
	console.log(diagnostics);
}
