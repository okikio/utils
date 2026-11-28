/** Install npm archives outside the checkout and compose the consumer evidence. @module */
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { command } from './command.ts';
import { excluded } from './source.ts';
import type { SourceType } from './source.ts';
import { bundles } from './consumer/bundles.ts';
import { scenarios } from './consumer/scenarios.ts';
import { types } from './consumer/types.ts';

/** Install physical archives in an empty consumer, then execute the supported ESM exports. */
export async function consumer(workspace: SourceType): Promise<void> {
	const { root, output, manifests, scenarioSources } = workspace;
	const portable = [...manifests];

	// A consumer below the checkout could resolve missing packages from workspace ancestors.
	const directory = await mkdtemp(resolve(tmpdir(), 'okikio-utils-npm-consumer-'));
	await writeFile(resolve(output, 'consumer-location.json'), `${JSON.stringify({ directory }, null, 2)}\n`);
	// Copied scenarios retain their authored fixture imports in the physically isolated consumer.
	await writeFile(
		resolve(directory, 'package.json'),
		JSON.stringify({ private: true, type: 'module', imports: { '#fixtures/*': './fixtures/*' } }) + '\n',
	);
	await writeFile(resolve(directory, '.npmrc'), '@jsr:registry=https://npm.jsr.io\n');
	const archives = JSON.parse(await readFile(resolve(output, 'archives/manifest.json'), 'utf8')) as string[];
	await writeFile(resolve(directory, 'archives.json'), `${JSON.stringify(archives, null, 2)}\n`);
	command(
		workspace,
		'npm',
		[
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--cache',
			resolve(root, '.tmp/cache/npm'),
			...archives,
			'zod@4.5.4',
			'valibot@1.4.2',
			'hono@4.13.5',
			'fast-check@4.9.0',
			'ajv@8.20.0',
			'ajv-formats@3.0.1',
			'typebox@1.4.3',
			'@sinclair/typebox@0.34.52',
			'@types/node@26.4.0',
			'@std/expect@npm:@jsr/std__expect@1.0.20',
		],
		directory,
	);
	const paths = [];
	for (const [name, source] of portable) {
		for (const [key, target] of Object.entries(source.exports)) {
			// Raw WebAssembly files are not ESM entry points; inspect() already proved they are packed.
			if (String(target).endsWith('.wasm')) continue;
			if (!excluded(name, key)) paths.push(source.name + (key === '.' ? '' : key.slice(1)));
		}
	}
	await writeFile(resolve(directory, 'paths.json'), JSON.stringify(paths));
	const typeSource = paths.map((path, index) =>
		`import * as entry${index} from ${JSON.stringify(path)}; void entry${index};`
	).join('\n');
	for (const extension of ['mts']) await writeFile(resolve(directory, `public.${extension}`), `${typeSource}\n`);
	await writeFile(
		resolve(directory, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				target: 'esnext',
				module: 'nodenext',
				moduleResolution: 'nodenext',
				strict: true,
				noEmit: true,
				lib: ['esnext', 'dom', 'dom.iterable'],
				types: ['node'],
				skipLibCheck: false,
				allowImportingTsExtensions: true,
			},
			include: [
				'public.mts',
				'public-inference.mts',
				'scenario-*.test.ts',
			],
		}),
	);
	// Check the same literal, field-selection and codec inference promises against
	// physical declaration files in the Node ESM resolution branch.
	for (const extension of ['mts']) {
		await cp(resolve(root, 'tests/publication.types.test.ts'), resolve(directory, `public-inference.${extension}`));
	}
	for (const [name, source] of Object.entries(scenarioSources)) {
		await cp(resolve(root, source), resolve(directory, `scenario-${name}.test.ts`));
	}
	await cp(resolve(root, 'tests/fixtures/http-parity'), resolve(directory, 'fixtures/http-parity'), {
		recursive: true,
	});
	await types(workspace, directory, paths);
	await cp(resolve(root, 'tests/npm-consumer.mjs'), resolve(directory, 'consumer.mjs'));
	command(workspace, 'node', ['consumer.mjs'], directory);
	await bundles(workspace, directory);
	await scenarios(workspace, directory);
}
