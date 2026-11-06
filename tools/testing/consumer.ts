/** Reuse canonical ownership tests against installed JavaScript artifacts outside the source checkout. */
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolver } from './resolve.ts';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const selected = process.argv[2] ??
	(JSON.parse(await readFile(join(root, '.tmp/artifacts/npm/consumer-location.json'), 'utf8')) as { directory: string })
		.directory;
const consumer = await realpath(selected);
if (consumer === resolve(root) || consumer.startsWith(root)) {
	throw new Error('Artifact tests require an installed consumer outside the source checkout.');
}
const resolveInstalled = await resolver(consumer);
const compiler = createRequire(join(root, 'package.json'))('typescript') as typeof ts;
const resolvedArtifacts: Record<string, string> = {};
for (
	const name of [
		'@okikio/input',
		'@okikio/runtime/node/worker',
		'@okikio/runtime/node/process',
		'@okikio/runtime/bun/worker',
		'@okikio/worker/process',
		'@okikio/context/state',
		'@okikio/context/events',
		'@okikio/duration',
		'@okikio/duration/units',
		'@okikio/duration/conversion',
		'@okikio/query/expression',
		'@okikio/query/pagination',
		'@okikio/query/url',
		'@okikio/collection/record/change',
		'@okikio/collection/record/json',
		'@okikio/schema',
		'@okikio/schema/codec',
		'@okikio/storage/state',
		'@okikio/storage/state/web',
		'@okikio/storage/state/postgres',
		'@okikio/format/csv',
		'@okikio/format/sitemap',
		'@okikio/streams/reader',
		'@okikio/pool',
		'@okikio/scheduler/concurrency',
		'@okikio/scheduler/capacity',
		'@okikio/capability/resource',
		'@okikio/capability/execution',
		'@okikio/capability/resilience/attempt',
		'@okikio/workflow',
	]
) {
	const target = await realpath(resolveInstalled(name));
	if (!target.startsWith(consumer + sep) || !/\.[cm]?js$/.test(target)) {
		throw new Error(`${name} must resolve to emitted JavaScript physically inside the consumer.`);
	}
	resolvedArtifacts[name] = target;
}
// This is a test-only dependency. Production dependencies are supplied by the installed archives.
resolveInstalled('@std/expect');
resolveInstalled('fast-check');
// Conformance tools are installed only in this consumer fixture, never as core runtime dependencies.
for (const name of ['ajv', 'ajv-formats', 'typebox', '@sinclair/typebox']) resolveInstalled(name);
/** Copied scenarios remain beneath the consumer so they cannot import workspace packages by accident. */
const scratch = join(consumer, '.tmp', 'tests');
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(join(scratch, 'runtime-tests-'));
const reportRoot = join(root, '.tmp', 'artifacts', 'tests', 'consumers');
await mkdir(reportRoot, { recursive: true });
// A failed rerun must not overwrite the logs that explain an earlier failure.
const reports = await mkdtemp(join(reportRoot, 'run-'));
console.log(`Installed-consumer evidence: ${reports}`);
const shared: string[] = [];
const supporting: string[] = [];
const typeFixtures: string[] = [];
/** Only archive-backed package entries contribute to the installation integrity receipt. */
const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8')) as {
	packages: Record<string, { resolved?: string; integrity?: string; version?: string }>;
};
const archives = [];
for (const [path, entry] of Object.entries(lock.packages)) {
	if (!path.startsWith('node_modules/@okikio/') || !entry.resolved?.startsWith('file:')) continue;
	const archive = resolve(consumer, entry.resolved.slice(5));
	const contents = await readFile(archive);
	const integrity = `sha512-${createHash('sha512').update(contents).digest('base64')}`;
	if (integrity !== entry.integrity) {
		throw new Error(`${path} installed integrity differs from the current archive; refresh this consumer first.`);
	}
	archives.push({
		name: path.slice('node_modules/'.length),
		version: entry.version,
		archive,
		sha256: createHash('sha256').update(contents).digest('hex'),
		integrity,
	});
}

/** Copy an unchanged canonical scenario, replacing only its library entry imports. */
async function copy(
	source: string,
	destination: string,
	replacements: readonly (readonly [string, string])[] = [],
): Promise<string> {
	let content = await readFile(join(root, source), 'utf8');
	for (const [before, after] of replacements) {
		if (!content.includes(before)) {
			throw new Error(`Canonical scenario changed: ${source} no longer contains ${before}.`);
		}
		content = content.replaceAll(before, after);
	}
	const target = join(directory, destination);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, content);
	return target;
}

/** Translate actual import nodes through the package export map, leaving scenario code and comments unchanged. */
async function copyPackage(
	name: string,
	selectedFiles?: readonly string[],
	supportingFiles: readonly string[] = [],
): Promise<void> {
	const sourceDirectory = join(root, 'packages', name);
	const manifest = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8')) as {
		name: string;
		exports: Record<string, string>;
	};
	const exports = new Map(
		Object.entries(manifest.exports).map(([subpath, target]) => [
			target,
			manifest.name + (subpath === '.' ? '' : subpath.slice(1)),
		]),
	);
	const files: string[] = [];
	/** Find canonical tests while excluding fixtures until their imports identify them as dependencies. */
	async function visitDirectory(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.isSymbolicLink() || ['fixtures', 'node_modules'].includes(entry.name)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visitDirectory(path);
			else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(relative(sourceDirectory, path));
		}
	}
	if (selectedFiles === undefined) await visitDirectory(sourceDirectory);
	else files.push(...selectedFiles);
	const fixtures = new Set(supportingFiles);
	const pending = [...new Set([...files, ...supportingFiles])].sort();
	for (let index = 0; index < pending.length; index++) {
		const filename = pending[index]!;
		const content = await readFile(join(sourceDirectory, filename), 'utf8');
		const source = compiler.createSourceFile(filename, content, compiler.ScriptTarget.Latest, true);
		const edits: { start: number; end: number; target: string }[] = [];
		/** Rewrite only import specifier spans; assertions and lifecycle code retain their source bytes. */
		const visit = (node: ts.Node): void => {
			if (compiler.isImportDeclaration(node) && compiler.isStringLiteral(node.moduleSpecifier)) {
				const value = node.moduleSpecifier.text;
				if (value.startsWith('./') || value.startsWith('../')) {
					const relativeTarget = relative(sourceDirectory, resolve(sourceDirectory, dirname(filename), value)).split(
						sep,
					)
						.join('/');
					// Follow test-owned fixtures as a graph. Never copy production internals to
					// make an installed-package test pass: those imports must be public.
					if (
						!relativeTarget.startsWith('../') && relativeTarget.split('/').includes('fixtures') &&
						relativeTarget.endsWith('.ts')
					) {
						if (!fixtures.has(relativeTarget)) {
							fixtures.add(relativeTarget);
							if (!pending.includes(relativeTarget)) pending.push(relativeTarget);
						}
					}
					if (fixtures.has(relativeTarget)) return;
					const exported = './' + relativeTarget;
					const target = exports.get(exported);
					if (target === undefined) throw new Error(`${name}/${filename} imports a non-public library file ${value}.`);
					edits.push({ start: node.moduleSpecifier.getStart(source) + 1, end: node.moduleSpecifier.end - 1, target });
				}
			}
			compiler.forEachChild(node, visit);
		};
		visit(source);
		let rewritten = content;
		for (const edit of edits.sort((a, b) => b.start - a.start)) {
			rewritten = rewritten.slice(0, edit.start) + edit.target + rewritten.slice(edit.end);
		}
		const target = join(directory, name, filename);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, rewritten);
		if (fixtures.has(filename)) {
			supporting.push(target);
			continue;
		}
		if (basename(filename) === 'types.test.ts' || filename.endsWith('.types.test.ts')) {
			typeFixtures.push(target);
		} else shared.push(target);
	}
}
await copyPackage('input', undefined, ['fixtures/target.ts']);
for (const name of ['context', 'duration', 'schema', 'pool', 'dispose']) await copyPackage(name);
// Persisted-state behavior must also resolve through installed public exports. Database
// ownership stays in its explicitly provisioned suite; these adapters need no service.
await copyPackage('storage', ['state/mod.test.ts', 'state/web.test.ts', 'state/web.types.test.ts']);
await copyPackage('result', ['fault/mod.test.ts']);
await copyPackage('query', [
	'authoring.test.ts',
	'authoring.types.test.ts',
	'pagination.test.ts',
	'expression.test.ts',
]);
await copyPackage('collection', [
	'usability.test.ts',
	'record/change.test.ts',
	'record/types.test.ts',
	'catalog/ownership.test.ts',
]);
await copyPackage('scheduler', [
	'capacity/admission.test.ts',
	'concurrency/admission.test.ts',
	'concurrency/channel.test.ts',
]);
await copyPackage('activity', ['call.test.ts', 'types.test.ts']);
await copyPackage('capability', [
	'resource/open.test.ts',
	'resource/session/open.test.ts',
	'session.test.ts',
	'effect/meter/schema.test.ts',
	'resource/lifetime.test.ts',
	'execution.test.ts',
	'execution.types.test.ts',
	'resilience/attempt.test.ts',
]);
await copyPackage('workflow', ['serve.test.ts']);
await copyPackage('worker', ['thread/mod.test.ts']);
// Inspection is implemented internally but the schemas are intentionally exported
// by the Postgres entry. Exercise that real public route in the installed fixture.
shared.push(
	await copy('packages/storage/workflow/postgres/inspect.test.ts', 'storage/inspection.test.ts', [
		["from './inspect.ts'", "from '@okikio/storage/workflow/postgres'"],
	]),
);
for (const name of ['mod', 'reader', 'cancellation', 'json']) {
	const source = `packages/streams/${name}.test.ts`;
	const content = await readFile(join(root, source), 'utf8');
	const replacements = [...new Set([...content.matchAll(/from '(\.\/[^']+)'/g)].map((match) => match[1]!))].map((
		value,
	) =>
		[
			`from '${value}'`,
			`from '@okikio/streams${value === './mod.ts' ? '' : '/' + value.slice(2, -3)}'`,
		] as const
	);
	shared.push(await copy(source, `streams/${name}.test.ts`, replacements));
}
for (const name of ['csv', 'sitemap']) {
	shared.push(
		await copy(`packages/format/${name}/cancellation.test.ts`, `format/${name}.test.ts`, [
			["from './mod.ts'", `from '@okikio/format/${name}'`],
		]),
	);
}
const nodeWorker = await copy('packages/runtime/node/worker.test.ts', 'runtime/node/worker.test.ts', [
	["from './worker.ts'", "from '@okikio/runtime/node/worker'"],
]);
await copy('packages/runtime/node/fixtures/thread.ts', 'runtime/node/fixtures/thread.ts', [
	["from '../worker.ts'", "from '@okikio/runtime/node/worker'"],
]);
await copy('packages/runtime/node/fixtures/protocol.ts', 'runtime/node/fixtures/protocol.ts');
await copy('packages/runtime/fixtures/web-thread.ts', 'runtime/fixtures/web-thread.ts');
const bunWorker = await copy('packages/runtime/web.test.ts', 'runtime/web.test.ts', [
	["import * as deno from '@okikio/runtime/deno/worker';\n", ''],
	["from './bun/worker.ts'", "from '@okikio/runtime/bun/worker'"],
	["const isDeno = 'Deno' in globalThis;\n", ''],
	['const open = isDeno ? deno.open : bun.open;', 'const open = bun.open;'],
	['skip: !isDeno && !isBun', 'skip: !isBun'],
]);
const processTests: string[] = [];
for (const name of ['node', 'lifecycle']) {
	const changes: [string, string][] = [["from './mod.ts'", "from '@okikio/worker/process'"]];
	if (name === 'lifecycle') changes.push(["from './types.ts'", "from '@okikio/worker/process/types'"]);
	processTests.push(await copy(`packages/worker/process/${name}.test.ts`, `process/${name}.test.ts`, changes));
}
await writeFile(
	join(directory, 'tsconfig.json'),
	JSON.stringify(
		{
			compilerOptions: {
				target: 'esnext',
				module: 'nodenext',
				moduleResolution: 'nodenext',
				strict: true,
				noEmit: true,
				lib: ['esnext', 'dom', 'dom.iterable'],
				types: ['node'],
				skipLibCheck: false,
			},
			include: typeFixtures.map((file) => `./${file.slice(directory.length + 1)}`),
		},
		null,
		2,
	) + '\n',
);

/** One joined child and the diagnostic files that establish its result. */
interface ScenarioResult {
	/** Stable scenario name used in receipt and log filenames. */
	readonly name: string;
	/** Native host selected by the caller. */
	readonly binary: string;
	/** Exact argument vector; values are never interpolated into a shell command. */
	readonly arguments: readonly string[];
	/** Native termination status; failed children throw before returning this receipt. */
	readonly exitCode: number | null;
	/** Counts reported by the host, when its output format includes them. */
	readonly counts: Readonly<Record<string, number>>;
	/** Complete output retained beneath this run's evidence directory. */
	readonly log: string;
}

/** Run one finite scenario process and preserve its complete diagnostics. */
async function run(name: string, binary: string, args: readonly string[]): Promise<ScenarioResult> {
	const result = spawnSync(binary, args, {
		cwd: consumer,
		encoding: 'utf8',
		timeout: 60_000,
		maxBuffer: 16 * 1024 * 1024,
	});
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	await writeFile(
		join(reports, `${name}.json`),
		JSON.stringify(
			{
				name,
				binary,
				arguments: args,
				consumer,
				exitCode: result.status,
				signal: result.signal,
				error: result.error?.message,
			},
			null,
			2,
		) + '\n',
	);
	const log = `final-artifact-${name}.log`;
	await writeFile(join(reports, log), output);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${name} artifact check failed (${result.status}); see ${log}.`);
	console.log(`${name}: passed; ${log}`);
	const counts: Record<string, number> = {};
	for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
		const match = output.match(new RegExp(`^[ℹ#] ${key} (\\d+)$`, 'm'));
		if (match) counts[key] = Number(match[1]);
	}
	const bun = output.match(/Ran (\d+) tests across (\d+) files\./);
	if (bun) {
		counts.tests = Number(bun[1]);
		counts.files = Number(bun[2]);
		for (const key of ['pass', 'fail']) {
			const match = output.match(new RegExp(`^\\s*(\\d+) ${key}$`, 'm'));
			if (match) counts[key] = Number(match[1]);
		}
	}
	return { name, binary, arguments: args, exitCode: result.status, counts, log };
}

// This configuration lives in the external installation. It adds no workspace
// aliases, so Deno must resolve the same packed packages as Node and Bun.
// Deno resolves manual node_modules from the configuration directory. Keep this
// beside the installed package.json, not inside the copied test scratch tree.
const denoConfig = join(consumer, 'deno.consumer.json');
await writeFile(
	denoConfig,
	JSON.stringify(
		{
			nodeModulesDir: 'manual',
			compilerOptions: {
				strict: true,
				noUncheckedIndexedAccess: true,
				lib: ['deno.window', 'dom', 'dom.iterable'],
				types: ['npm:@types/node'],
			},
		},
		null,
		2,
	) + '\n',
);
const results = [];
results.push(
	await run('deno-public-types', process.env.UTILS_DENO ?? 'deno', [
		'check',
		'--config',
		denoConfig,
		...typeFixtures.filter((file) => file.endsWith('.ts')),
	]),
);
results.push(
	await run('deno-runtime-input-io', process.env.UTILS_DENO ?? 'deno', [
		'test',
		'--config',
		denoConfig,
		'--no-check',
		'--allow-read',
		'--allow-env',
		'--allow-run',
		'--allow-net',
		...shared,
	]),
);
results.push(
	await run('public-types', process.execPath, [
		join(root, 'node_modules/typescript-native/bin/tsc'),
		'--project',
		join(directory, 'tsconfig.json'),
		'--pretty',
		'false',
	]),
);
results.push(
	await run('isolated-host-types', process.execPath, [
		join(root, 'tools/testing/portable.ts'),
		consumer,
	]),
);
results.push(
	await run('node-runtime-input-io', process.execPath, [
		'--import',
		'@okikio/duration/polyfill',
		'--import',
		'@okikio/dispose/polyfill',
		'--test',
		nodeWorker,
		...processTests,
		...shared,
	]),
);
if (process.env.UTILS_BUN !== undefined) {
	results.push(
		await run('bun-runtime-input-io', process.env.UTILS_BUN, [
			'test',
			// Match the source runner: finite retry schedules can exceed Bun's 5s default.
			'--timeout',
			'30000',
			'--preload',
			'@okikio/duration/polyfill',
			'--preload',
			'@okikio/dispose/polyfill',
			bunWorker,
			...shared,
		]),
	);
}
await writeFile(
	join(reports, 'runtime-artifact.json'),
	JSON.stringify(
		{
			checkedAt: new Date().toISOString(),
			consumer,
			fixtureDirectory: directory,
			node: process.version,
			resolvedArtifacts,
			archives,
			typeChecks: {
				formats: ['ESM (.ts)'],
				consumerLibs: [['esnext', 'dom', 'dom.iterable'], ['esnext']],
				fixtures: [
					'native DOM positive inference',
					'native DOM invalid-property rejection',
					'structural mock positive inference',
					'structural mock invalid-property rejection',
				],
				files: typeFixtures,
			},
			results,
			method:
				'Canonical source tests copied into the clean installation; library imports use public emitted package exports. No source runtime or workspace links are used.',
		},
		null,
		2,
	) + '\n',
);
