/** Hash the actual workspace runtime import closure used by the generated treatments. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

/** Exact bytes, independent of JSON formatting or syntax normalization. */
export function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Derive portable names while rejecting a generated treatment that escapes its source checkout. */
function name(root, path) {
	const value = relative(root, path).split(sep).join('/');
	if (value === '..' || value.startsWith('../')) throw new Error(`Treatment dependency escapes source root: ${value}`);
	return value;
}

/** Resolve workspace exports from their owned manifests, never from an unrelated installed package version. */
async function local(root, specifier, parent, inputs) {
	if (specifier.startsWith('.')) return resolve(dirname(parent), specifier);
	const owned = /^@okikio\/([^/]+)(.*)$/.exec(specifier);
	if (!owned) return undefined;
	const directory = resolve(root, 'packages', owned[1]);
	const path = resolve(directory, 'package.json');
	let bytes;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if (error.code === 'ENOENT') return undefined;
		throw error;
	}
	inputs[name(root, path)] = digest(bytes);
	const denoManifest = resolve(directory, 'deno.jsonc');
	inputs[name(root, denoManifest)] = digest(await readFile(denoManifest));
	const manifest = JSON.parse(bytes.toString('utf8'));
	const target = manifest.exports[owned[2] ? '.' + owned[2] : '.'];
	if (typeof target !== 'string') throw new Error(`No literal workspace export for ${specifier}.`);
	return resolve(directory, target);
}

/** Type-only imports disappear before the runtime graph is inspected. Literal dynamic imports are included. */
function imports(ts, path, bytes) {
	const emitted = ts.transpileModule(bytes.toString('utf8'), {
		fileName: path,
		compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
	}).outputText;
	const source = ts.createSourceFile(path, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const values = new Set();
	const visit = (node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
			if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`Nonliteral module dependency in ${path}.`);
			values.add(node.moduleSpecifier.text);
		}
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) {
				throw new Error(`Computed runtime dependency needs an explicit provenance policy: ${path}.`);
			}
			values.add(node.arguments[0].text);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return values;
}

/** Hash shared local implementations, treatment bytes, controls and lockfiles; external specifiers stay explicit. */
export async function provenance(root, output, generated, ts, require) {
	const inputs = {};
	const external = new Set();
	const seen = new Set();
	async function visit(path) {
		path = resolve(path);
		if (seen.has(path)) return;
		seen.add(path);
		const key = name(root, path), bytes = await readFile(path);
		inputs[key] = digest(bytes);
		for (const specifier of imports(ts, path, bytes)) {
			const target = await local(root, specifier, path, inputs);
			if (target) await visit(target);
			else external.add(specifier);
		}
	}
	for (const entry of generated) {
		await visit(resolve(output, entry.generated));
		for (const path of [entry.path, name(root, resolve(output, entry.declarations))]) {
			inputs[path] = digest(await readFile(resolve(root, path)));
		}
	}
	for (
		const path of [
			'package.json',
			'pnpm-lock.yaml',
			'deno.jsonc',
			'deno.lock',
			'mise.toml',
			'bench/freeze/freeze.bench.ts',
			'tools/bench/freeze/prepare.mjs',
			'tools/bench/freeze/verify.mjs',
			'tools/bench/freeze/summarize.mjs',
			'tools/bench/freeze/provenance.mjs',
		]
	) inputs[path] = digest(await readFile(resolve(root, path)));
	return {
		inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))),
		externalSpecifiers: [...external].sort(),
		compiler: {
			version: ts.version,
			entrySha256: digest(await readFile(require.resolve('typescript'))),
			packageSha256: digest(await readFile(require.resolve('typescript/package.json'))),
		},
		boundary:
			'Literal runtime imports through workspace export maps; external specifiers are governed by the hashed manifests and lockfiles. Type-only edges are excluded.',
	};
}
