/** Build and test the additional npm projection without changing canonical JSR manifests. @module */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
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
const output = resolve(root, '.tmp/artifacts/npm');
const mode = process.argv[2] ?? 'build';
if (!['build', 'check', 'consumer', 'pack', 'verify', 'member'].includes(mode)) {
	throw new Error(`Unknown npm operation ${mode}.`);
}
const manifests = new Map<string, Manifest>();
for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const directory = entry.name;
	const manifest = JSON.parse(await readFile(resolve(root, 'packages', directory, 'package.json'), 'utf8')) as Manifest;
	manifests.set(directory, manifest);
}
const requested = mode === 'build' ? process.argv.slice(3) : [];
const selected = new Set(requested);
/** Include workspace dependencies so selected artifacts resolve outside workspace links. */
function include(name: string): void {
	const manifest = manifests.get(name);
	if (!manifest) throw new TypeError(`Unknown npm project ${name}.`);
	for (
		const dependency of Object.keys({
			...manifest.dependencies,
			...manifest.peerDependencies,
			...manifest.optionalDependencies as Record<string, string>,
		})
	) {
		const member = [...manifests].find(([, value]) => value.name === dependency)?.[0];
		if (member && !selected.has(member)) {
			selected.add(member);
			include(member);
		}
	}
}
for (const name of requested) include(name);
const portable = [...manifests].filter(([name]) => requested.length === 0 || selected.has(name));

/** Reuse canonical tests through public imports in both emitted formats; never substitute artifact-only oracles. */
const scenarioSources = {
	discovery: 'tests/discovery.test.ts',
	coordination: 'tests/coordination.test.ts',
	capabilities: 'tests/capabilities.test.ts',
	host: 'tests/host.test.ts',
	workflow: 'tests/workflow.test.ts',
	provider: 'tests/provider.test.ts',
	'http-parity': 'tests/http-parity.test.ts',
	bounded: 'packages/scheduler/concurrency/bounded.test.ts',
	expansion: 'tests/expansion.test.ts',
	protocol: 'tests/protocol.test.ts',
};

if (mode === 'build' || mode === 'verify') {
	try {
		await rename(output, `${output}-before-${Date.now()}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	await mkdir(output, { recursive: true });
	// A fresh member process owns each declaration graph and releases it before the next package starts.
	for (const [name] of portable) command('node', [fileURLToPath(import.meta.url), 'member', name], root);
}
if (mode === 'member') {
	const selected = portable.filter(([name]) => name === process.argv[3]);
	if (selected.length !== 1) throw new Error('Select one supported npm member for isolated emission.');
	for (const [name, source] of selected) {
		const stage = resolve(output, name);
		const documents = (await readdir(resolve(root, 'packages', name))).filter((file) =>
			['diagram.png', 'diagram.mmd'].includes(file)
		);
		await mkdir(resolve(stage, 'src'), { recursive: true });
		await symlink(resolve(root, 'packages', name, 'node_modules'), resolve(stage, 'node_modules'), 'dir');
		await cp(resolve(root, 'packages', name), resolve(stage, 'src'), {
			recursive: true,
			filter: (path) =>
				!/(?:\.test\.ts|\.bench\.ts|\/\.example-[^/]+(?:\/|$)|\/fixtures(?:\/|$)|\/dist(?:\/|$)|\/node_modules(?:\/|$))/
					.test(path),
		});
		// Package-local guides must accompany root README links, including focused pages such as record/json.md.
		for await (const file of files(resolve(stage, 'src'))) {
			const document = relative(resolve(stage, 'src'), file).replaceAll('\\', '/');
			if (document.endsWith('.md') && document !== 'README.md') documents.push(document);
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
			files: ['dist', 'README.md', 'LICENSE', ...documents],
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
		for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
			if (!manifest[field]) continue;
			manifest[field] = Object.fromEntries(
				Object.entries(manifest[field] as Record<string, string>).map(
					([dependency, version]) => {
						const member = [...manifests.values()].find((value) => value.name === dependency);
						if (version.startsWith('workspace:') && member === undefined) {
							throw new Error(`Unknown workspace dependency ${dependency} in ${name}.`);
						}
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
		for (const document of documents) {
			await mkdir(dirname(resolve(stage, document)), { recursive: true });
			await cp(resolve(root, 'packages', name, document), resolve(stage, document));
		}
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

/** Deno adapters remain JSR-only; generic protocols and Node, Bun and browser adapters ship on npm. */
function excluded(name: string, key: string): boolean {
	return name === 'runtime' && (key === './deno' || key.startsWith('./deno/')) ||
		name === 'utils' && (key === './runtime/deno' || key.startsWith('./runtime/deno/'));
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
		// Run the installed pinned tools directly; validation must not trigger a package-manager reinstall.
		command(
			'node',
			[resolve(root, 'node_modules/publint/src/cli.js'), resolve(extracted, 'package'), '--strict'],
			root,
		);
		command(
			'node',
			[resolve(root, 'node_modules/@arethetypeswrong/cli/dist/index.js'), '--profile', 'node16', archive],
			root,
		);
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
	// Copied scenarios retain their authored fixture imports in the physically isolated consumer.
	await writeFile(
		resolve(directory, 'package.json'),
		JSON.stringify({ private: true, type: 'module', imports: { '#fixtures/*': './fixtures/*' } }) + '\n',
	);
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
			include: [
				'public.mts',
				'public.cts',
				'public-inference.mts',
				'public-inference.cts',
				'scenario-*.test.ts',
				'typed-scenario-*.cts',
			],
		}),
	);
	// Check the same literal, field-selection and codec inference promises against
	// physical declaration files in both Node module-resolution branches.
	for (const extension of ['mts', 'cts']) {
		await cp(resolve(root, 'tests/publication.types.test.ts'), resolve(directory, `public-inference.${extension}`));
	}
	for (const [name, source] of Object.entries(scenarioSources)) {
		await cp(resolve(root, source), resolve(directory, `scenario-${name}.test.ts`));
		await cp(resolve(root, source), resolve(directory, `typed-scenario-${name}.cts`));
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
	await cp(resolve(root, 'tests/npm-consumer.mjs'), resolve(directory, 'consumer.mjs'));
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

/** Run one bounded checks command and preserve complete subprocess diagnostics on failure. */
function command(binary: string, args: string[], cwd = root, capture = false): string {
	const result = spawnSync(binary, args, {
		cwd,
		encoding: 'utf8',
		stdio: 'pipe',
		timeout: 300_000,
		maxBuffer: 32 * 1024 * 1024,
	});
	// Keep complete native diagnostics even when a compiler or install fails before
	// its normal report exists. Commands own no credentials in argv or environment logs.
	const commands = resolve(output, 'commands');
	mkdirSync(commands, { recursive: true });
	const evidence = mkdtempSync(resolve(commands, `${Date.now()}-`));
	writeFileSync(resolve(evidence, 'stdout.log'), result.stdout ?? '');
	writeFileSync(resolve(evidence, 'stderr.log'), result.stderr ?? '');
	writeFileSync(
		resolve(evidence, 'result.json'),
		JSON.stringify(
			{
				binary,
				args,
				cwd,
				status: result.status,
				signal: result.signal,
				error: result.error?.message,
			},
			null,
			2,
		) + '\n',
	);
	if (!capture) {
		process.stdout.write(result.stdout ?? '');
		process.stderr.write(result.stderr ?? '');
	}
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
			if (/\/@okikio\/(?:runtime|worker|server|storage)\//.test(path)) {
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
	const names = Object.keys(scenarioSources);
	const entry: Record<string, string> = {};
	for (const [name, path] of Object.entries(scenarioSources)) {
		const source = resolve(root, path);
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
		'Installed ESM and CommonJS artifacts passed discovery, coordination, HTTP host, workflow, durable client, provider ownership, bounded mapper failures and independent Hono parity scenarios.',
	);
}
