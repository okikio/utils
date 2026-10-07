/** Emit the pinned TypeScript-only Vixeny dependency for portable benchmark consumers, without rewriting its source. */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { build } from 'tsdown';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await realpath(resolve(root, 'node_modules/vixeny'));
const manifest = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'));
if (manifest.name !== 'vixeny' || manifest.version !== '0.1.53' || manifest.main !== 'main.ts') {
	throw new Error('Benchmark preparation requires the pinned Vixeny0.1.53 TypeScript package.');
}
const compiler = JSON.parse(await readFile(resolve(root, 'node_modules/tsdown/package.json'), 'utf8'));
if (compiler.version !== '0.22.14') throw new Error('Benchmark preparation requires tsdown0.22.14.');
if (ts.version !== '6.0.3') throw new Error('Benchmark preparation requires TypeScript6.0.3 type erasure.');
const output = resolve(root, '.artifacts/challengers');
await mkdir(output, { recursive: true });
const hashes = {};
/** Include the complete package graph, metadata and license, not only the root module. */
async function visit(directory, prefix = '') {
	for (
		const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
	) {
		if (entry.isSymbolicLink() || entry.name === 'node_modules') continue;
		const name = `${prefix}${entry.name}`, path = resolve(directory, entry.name);
		if (entry.isDirectory()) await visit(path, `${name}/`);
		else if (entry.isFile()) hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
	}
}
await visit(source);
const configuration = {
	format: 'esm',
	platform: 'neutral',
	target: 'esnext',
	dts: false,
	minify: false,
	treeshake: false,
	sourcemap: true,
};
const inputs = {
	name: manifest.name,
	version: manifest.version,
	source: hashes,
	compiler: { name: compiler.name, version: compiler.version, typeErasure: ts.version },
	configuration,
	lockSha256: createHash('sha256').update(await readFile(resolve(root, 'pnpm-lock.yaml'))).digest('hex'),
	builderSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
};
const path = resolve(output, 'vixeny.mjs'), receiptPath = resolve(output, 'vixeny-build.json');
try {
	const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
	if (
		JSON.stringify(receipt.inputs) === JSON.stringify(inputs) &&
		createHash('sha256').update(await readFile(path)).digest('hex') === receipt.outputSha256 &&
		createHash('sha256').update(await readFile(`${path}.map`)).digest('hex') === receipt.sourceMapSha256
	) {
		console.log('Pinned Vixeny benchmark emission is current.');
		process.exit(0);
	}
} catch (error) {
	if (error.code !== 'ENOENT') throw error;
}
await build({
	config: false,
	tsconfig: false,
	cwd: root,
	entry: { vixeny: resolve(source, 'main.ts') },
	outDir: output,
	...configuration,
	fixedExtension: true,
	clean: false,
	publint: false,
	attw: false,
	deps: { neverBundle: [...builtinModules, /^node:/], onlyBundle: ['vixeny'] },
	failOnWarn: true,
	plugins: [{
		name: 'vixeny-typescript-emission',
		/** Erase upstream types before parsing; the archive contains an empty type-only generic list. */
		transform(code, id) {
			if (!id.startsWith(`${source}/`) || !id.endsWith('.ts')) return;
			const emitted = ts.transpileModule(code, {
				fileName: id,
				reportDiagnostics: true,
				compilerOptions: {
					target: ts.ScriptTarget.ESNext,
					module: ts.ModuleKind.ESNext,
					sourceMap: true,
					inlineSources: true,
				},
			});
			if (emitted.diagnostics?.some((value) => value.category === ts.DiagnosticCategory.Error)) {
				throw new Error(ts.formatDiagnostics(emitted.diagnostics, {
					getCanonicalFileName: (name) => name,
					getCurrentDirectory: () => root,
					getNewLine: () => '\n',
				}));
			}
			return { code: emitted.outputText, map: emitted.sourceMapText };
		},
	}],
});
await writeFile(
	receiptPath,
	`${
		JSON.stringify(
			{
				status: 'pass',
				inputs,
				runtime: process.version,
				createdAt: new Date().toISOString(),
				outputSha256: createHash('sha256').update(await readFile(path)).digest('hex'),
				sourceMapSha256: createHash('sha256').update(await readFile(`${path}.map`)).digest('hex'),
				boundary:
					'Unminified third-party JS emission for benchmark fixtures only; no declarations or upstream strict-source compatibility claim.',
			},
			null,
			2,
		)
	}\n`,
);
console.log(`Prepared pinned Vixeny benchmark dependency at ${path}.`);
