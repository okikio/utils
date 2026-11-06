/** Check public consumers with one host's types at a time, optionally against installed npm archives. @module */
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const consumer = process.argv[2] === undefined ? root : resolve(process.argv[2]);
await mkdir(join(consumer, '.tmp', 'artifacts'), { recursive: true });
const directory = await mkdtemp(join(consumer, '.tmp/artifacts/portable-types-'));
await cp(join(root, 'tests/types'), directory, { recursive: true });

/** Ambient libraries are deliberately disjoint so a permissive repository config cannot hide host coupling. */
const environments = {
	browser: { lib: ['esnext', 'dom', 'dom.iterable'], types: [] },
	worker: { lib: ['esnext', 'webworker'], types: [] },
	node: { lib: ['esnext'], types: ['node'] },
} as const;
const compiler = join(root, 'node_modules/typescript-native/bin/tsc');
const results = [];
for (const [name, environment] of Object.entries(environments)) {
	const config = join(directory, `${name}.json`);
	await writeFile(
		config,
		JSON.stringify(
			{
				compilerOptions: {
					target: 'esnext',
					module: 'nodenext',
					moduleResolution: 'nodenext',
					strict: true,
					noUncheckedIndexedAccess: true,
					verbatimModuleSyntax: true,
					noEmit: true,
					allowImportingTsExtensions: true,
					skipLibCheck: false,
					...environment,
				},
				files: [`${name}.ts`],
			},
			null,
			2,
		) + '\n',
	);
	const result = spawnSync(process.execPath, [compiler, '--project', config, '--pretty', 'false'], {
		cwd: consumer,
		encoding: 'utf8',
		timeout: 120_000,
	});
	await writeFile(join(directory, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${name} types failed:\n${result.stdout}${result.stderr}`);
	console.log(`${name}: public API inference and absent-host assertions passed.`);
	results.push({ environment: name, exitCode: result.status });
}
const report = join(root, '.tmp/artifacts/tests/portable-types.json');
await mkdir(dirname(report), { recursive: true });
await writeFile(
	report,
	JSON.stringify(
		{
			consumer,
			directory,
			node: process.version,
			compiler: JSON.parse(await readFile(join(root, 'node_modules/typescript-native/package.json'), 'utf8')).version,
			results,
		},
		null,
		2,
	) + '\n',
);
