/** Build and qualify the additional npm projection without changing canonical JSR manifests. @module */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'tsdown';
import { parseSync } from 'oxc-parser';
import { projection } from '../tsdown.config.ts';

/** Source-owned npm metadata; the projection replaces only distribution-specific fields. */
interface Manifest {
	name: string;
	version: string;
	exports: Record<string, string | Record<string, Record<string, string>>>;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	imports?: Record<string, unknown>;
	sideEffects?: false | string[];
	[key: string]: unknown;
}
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.artifacts/npm');
const mode = process.argv[2] ?? 'build';
if (!['build', 'check', 'consumer', 'pack', 'verify', 'member'].includes(mode)) {
	throw new Error(`Unknown npm operation ${mode}.`);
}
const manifests = new Map<string, Manifest>();
for (const directory of await readdir(resolve(root, 'packages'))) {
	const manifest = JSON.parse(await readFile(resolve(root, 'packages', directory, 'package.json'), 'utf8')) as Manifest;
	manifests.set(directory, manifest);
}
const portable = [...manifests].filter(([name]) => name !== 'deno');

if (mode === 'build' || mode === 'verify') {
	await rm(output, { recursive: true, force: true });
	await mkdir(output, { recursive: true });
	// A fresh member process owns each declaration graph and releases it before the next package starts.
	for (const [name] of portable) command('node', [fileURLToPath(import.meta.url), 'member', name], root);
}
if (mode === 'member') {
	const selected = portable.filter(([name]) => name === process.argv[3]);
	if (selected.length !== 1) throw new Error('Select one supported npm member for isolated emission.');
	for (const [name, source] of selected) {
		const stage = resolve(output, name);
		await mkdir(resolve(stage, 'src'), { recursive: true });
		await symlink(resolve(root, 'packages', name, 'node_modules'), resolve(stage, 'node_modules'), 'dir');
		await cp(resolve(root, 'packages', name), resolve(stage, 'src'), {
			recursive: true,
			filter: (path) =>
				!/(?:\.test\.ts|\.bench\.ts|\/fixtures(?:\/|$)|\/dist(?:\/|$)|\/node_modules(?:\/|$))/.test(path),
		});
		if (name === 'utils') {
			for (const file of ['all.ts', 'mod.ts']) {
				const path = resolve(stage, 'src', file);
				await writeFile(path, (await readFile(path, 'utf8')).replace(/^.*['"]@okikio\/deno['"].*\n/gm, ''));
			}
		}
		const exports: Record<string, unknown> = {};
		const entries: Record<string, string> = {};
		for (const [key, target] of Object.entries(source.exports)) {
			if (excluded(name, key)) continue;
			if (typeof target !== 'string') throw new Error(`Canonical source export ${name}${key} must be a path.`);
			const stem = target.replace(/^\.\//, '').replace(/\.ts$/, '');
			entries[stem] = resolve(stage, 'src', target);
			exports[key] = {
				import: { types: `./dist/${stem}.d.mts`, default: `./dist/${stem}.mjs` },
				require: { types: `./dist/${stem}.d.cts`, default: `./dist/${stem}.cjs` },
			};
		}
		const manifest: Manifest = {
			...source,
			exports: exports as Manifest['exports'],
			files: ['dist', 'README.md', 'LICENSE'],
			engines: { node: '>=26.10.0' },
		};
		delete manifest.devDependencies;
		delete manifest.scripts;
		// Source-local test aliases do not address any emitted artifact; external runtime aliases remain explicit.
		if (manifest.imports) {
			manifest.imports = Object.fromEntries(
				Object.entries(manifest.imports as Record<string, unknown>).filter(([, target]) =>
					target !== './' && target !== './*'
				),
			);
			if (Object.keys(manifest.imports).length === 0) delete manifest.imports;
		}
		for (const field of ['dependencies', 'peerDependencies'] as const) {
			if (!manifest[field]) continue;
			manifest[field] = Object.fromEntries(
				Object.entries(manifest[field]!).filter(([dependency]) => dependency !== '@okikio/deno').map(
					([dependency, version]) => {
						const member = [...manifests.values()].find((value) => value.name === dependency);
						return [dependency, version.startsWith('workspace:') ? member!.version : version];
					},
				),
			);
		}
		manifest.sideEffects = Array.isArray(source.sideEffects)
			? source.sideEffects.flatMap((
				path,
			) => [
				path.replace(/\.ts$/, '.mjs').replace(/^\.\//, './dist/'),
				path.replace(/\.ts$/, '.cjs').replace(/^\.\//, './dist/'),
			])
			: false;
		await writeFile(resolve(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
		await cp(resolve(root, 'LICENSE'), resolve(stage, 'LICENSE'));
		await cp(resolve(root, 'packages', name, 'README.md'), resolve(stage, 'README.md'));
		await writeFile(
			resolve(stage, 'tsconfig.json'),
			JSON.stringify({
				extends: resolve(root, 'tsconfig.json'),
				include: ['src/**/*.ts'],
				compilerOptions: { rootDir: 'src' },
			}),
		);
		const bundles = await build(projection(stage, entries, root));
		for (const bundle of bundles) await bundle[Symbol.asyncDispose]();
		// Source copies exist only for the build. Published contents come from files plus actual pack inspection.
		await rm(resolve(stage, 'src'), { recursive: true });
		await rm(resolve(stage, 'node_modules'));
	}
}
if (['check', 'pack', 'consumer', 'verify'].includes(mode)) await inspect();
if (['pack', 'consumer', 'verify'].includes(mode)) await pack();
if (['consumer', 'verify'].includes(mode)) await consumer();

/** Runtime-specific adapters remain JSR-only; generic protocols and Node adapters remain portable. */
function excluded(name: string, key: string): boolean {
	return (name === 'process' || name === 'worker') && key === './deno' || name === 'utils' &&
			(key === './deno' || key.startsWith('./deno/') || key === './process/deno' || key === './worker/deno');
}

/** Inspect all staged public targets and runtime modules, not merely the root entry. */
async function inspect(): Promise<void> {
	let subpaths = 0;
	for (const [name] of portable) {
		const stage = resolve(output, name);
		const manifest = JSON.parse(await readFile(resolve(stage, 'package.json'), 'utf8'));
		for (const [key, value] of Object.entries(manifest.exports)) {
			if (excluded(name, key)) throw new Error(`${name} retained excluded export ${key}.`);
			for (const branch of Object.values(value as Record<string, Record<string, string>>)) {
				for (const target of Object.values(branch)) await readFile(resolve(stage, target));
			}
			subpaths++;
		}
		for await (const file of files(resolve(stage, 'dist'))) {
			if (!/\.(?:mjs|cjs)$/.test(file)) continue;
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
		`Inspected ${portable.length} npm packages and ${subpaths} public subpaths (both module formats and declarations).`,
	);
}

/** Pack the exact staging directories and validate extracted archives with the pinned package tools. */
async function pack(): Promise<void> {
	const archives = resolve(output, 'archives');
	await mkdir(archives, { recursive: true });
	const packed: string[] = [];
	for (const [name] of portable) {
		const stage = resolve(output, name);
		const result = command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', archives], stage, true);
		const record = JSON.parse(result)[0];
		if (record.files.some((file: { path: string }) => /(?:^src\/|\.test\.|\.bench\.)/.test(file.path))) {
			throw new Error(`${name} packed source-only files.`);
		}
		const archive = resolve(archives, record.filename);
		packed.push(archive);
		const extracted = resolve(output, 'extracted', name);
		await rm(extracted, { recursive: true, force: true });
		await mkdir(extracted, { recursive: true });
		command('tar', ['-xzf', archive, '-C', extracted]);
		command('pnpm', ['exec', 'publint', resolve(extracted, 'package'), '--strict'], root);
		command('pnpm', ['exec', 'attw', '--profile', 'node16', archive], root);
	}
	await writeFile(resolve(archives, 'manifest.json'), `${JSON.stringify(packed, null, 2)}\n`);
	await writeFile(
		resolve(archives, 'receipt.json'),
		`${
			JSON.stringify(
				await Promise.all(
					packed.map(async (path) => ({
						archive: path.split('/').at(-1),
						sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
					})),
				),
				null,
				2,
			)
		}\n`,
	);
}

/** Install physical archives in an empty consumer, then execute all supported import and require branches. */
async function consumer(): Promise<void> {
	// A consumer below the checkout could resolve missing packages from workspace ancestors.
	const directory = await mkdtemp(resolve(tmpdir(), 'okikio-utils-npm-consumer-'));
	await writeFile(resolve(output, 'consumer-location.json'), `${JSON.stringify({ directory }, null, 2)}\n`);
	await writeFile(resolve(directory, 'package.json'), '{"private":true,"type":"module"}\n');
	await writeFile(resolve(directory, '.npmrc'), '@jsr:registry=https://npm.jsr.io\n');
	const archives = JSON.parse(await readFile(resolve(output, 'archives/manifest.json'), 'utf8')) as string[];
	await writeFile(resolve(directory, 'archives.json'), `${JSON.stringify(archives, null, 2)}\n`);
	command(
		'npm',
		[
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			...archives,
			'zod@4.5.4',
			'valibot@1.4.2',
			'hono@4.13.5',
			'@types/node@26.4.0',
		],
		directory,
	);
	const paths = [];
	for (const [name, source] of portable) {
		for (const key of Object.keys(source.exports)) {
			if (!excluded(name, key)) paths.push(source.name + (key === '.' ? '' : key.slice(1)));
		}
	}
	await writeFile(resolve(directory, 'paths.json'), JSON.stringify(paths));
	const typeSource = paths.map((path, index) =>
		`import * as entry${index} from ${JSON.stringify(path)}; void entry${index};`
	).join('\n');
	for (const extension of ['mts', 'cts']) await writeFile(resolve(directory, `public.${extension}`), `${typeSource}\n`);
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
			include: ['public.mts', 'public.cts', 'scenario-*.test.ts', 'typed-scenario-*.cts'],
		}),
	);
	for (const name of ['discovery', 'coordination', 'host', 'workflow', 'provider', 'http-parity']) {
		await cp(resolve(root, `tests/${name}.test.ts`), resolve(directory, `scenario-${name}.test.ts`));
		await cp(resolve(root, `tests/${name}.test.ts`), resolve(directory, `typed-scenario-${name}.cts`));
	}
	await cp(resolve(root, 'tests/fixtures/http-parity'), resolve(directory, 'fixtures/http-parity'), {
		recursive: true,
	});
	const typeStarted = performance.now();
	const diagnostics = command(
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
						'One complete ESM+CJS all-subpath correctness check. Elapsed time includes Node/compiler startup and is diagnostic evidence, not an editor latency or performance regression threshold.',
				},
				null,
				2,
			)
		}\n`,
	);
	console.log(diagnostics);
	await cp(resolve(root, 'tools/npm-consumer.mjs'), resolve(directory, 'consumer.mjs'));
	command('node', ['consumer.mjs'], directory);
	await bundles(directory);
	await scenarios(directory);
}

/** Enumerate emitted files without depending on platform-specific shell glob behavior. */
async function* files(directory: string): AsyncGenerator<string> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) yield* files(path);
		else yield path;
	}
}

/** Run one bounded qualification command and preserve complete subprocess diagnostics on failure. */
function command(binary: string, args: string[], cwd = root, capture = false): string {
	const result = spawnSync(binary, args, {
		cwd,
		encoding: 'utf8',
		stdio: capture ? 'pipe' : 'inherit',
		timeout: 300_000,
		maxBuffer: 32 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${binary} ${args.join(' ')} failed (${result.status}).\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
		);
	}
	return result.stdout ?? '';
}

/** Prove selective adoption against installed ESM artifacts and actual bundled module graphs. */
async function bundles(directory: string): Promise<void> {
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
		const results = await build({
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
		});
		const modules = results.flatMap((result) =>
			result.chunks.flatMap((chunk) => 'modules' in chunk ? Object.keys(chunk.modules) : [])
		);
		if (!modules.some((path) => path.includes('/@okikio/result/'))) {
			throw new Error(`${item.name}: result was not bundled from the installed artifact.`);
		}
		for (const path of modules) {
			if (/\/@okikio\/(?:deno|process|worker|server|html|css)\//.test(path)) {
				throw new Error(`${item.name} retained unrelated capability ${path}.`);
			}
		}
		const emitted = results.flatMap((result) => result.chunks.filter((chunk) => chunk.type === 'chunk'));
		if (emitted.length !== 1) throw new Error(`${item.name}: expected one selective consumer chunk.`);
		sizes.push(Buffer.byteLength(emitted[0]!.code));
		command('node', [resolve(directory, `bundle-${item.name}`, emitted[0]!.fileName)], directory);
		for (const result of results) await result[Symbol.asyncDispose]();
	}
	console.log(
		`Installed focused and umbrella result bundles passed graph and behavior checks (${
			sizes.join(', ')
		} bytes; sizes are evidence, not a timing or byte threshold).`,
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

/** Reuse real cross-package source scenarios while resolving every production import to installed archives. */
async function scenarios(directory: string): Promise<void> {
	const names = ['discovery', 'coordination', 'host', 'workflow', 'provider', 'http-parity'];
	const entry: Record<string, string> = {};
	for (const name of names) {
		const source = resolve(root, `tests/${name}.test.ts`);
		const target = resolve(directory, `scenario-${name}.test.ts`);
		await cp(source, target);
		entry[`scenario-${name}.test`] = target;
	}
	const results = await build({
		config: false,
		cwd: directory,
		entry,
		outDir: resolve(directory, 'scenarios'),
		format: ['esm', 'cjs'],
		platform: 'node',
		target: 'esnext',
		dts: false,
		clean: true,
		publint: false,
		attw: false,
		deps: { neverBundle: [/^@okikio\//, /^node:/] },
	});
	for (const format of ['mjs', 'cjs']) {
		command('node', [
			'--import',
			'@okikio/dispose/polyfill',
			'--import',
			'@okikio/duration/polyfill',
			'--test',
			...names.map((name) => resolve(directory, `scenarios/scenario-${name}.test.${format}`)),
		], directory);
	}
	for (const result of results) await result[Symbol.asyncDispose]();
	console.log(
		'Installed ESM and CommonJS artifacts passed discovery, coordination, HTTP host, workflow, provider ownership and independent Hono parity scenarios.',
	);
}
