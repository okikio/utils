/** Hash the actual workspace runtime import closure used by the generated treatments. */
import type * as TypeScript from 'typescript';
import type { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

/** A treatment copy and its immutable source and generated-byte identities. */
export interface GeneratedType {
	/** Logical workload module name used to match frozen/plain copies. */
	readonly name: string;
	/** Source path relative to the repository root. */
	readonly path: string;
	/** Plain copies remove freeze calls; both retain every other measured operation. */
	readonly variant: 'frozen' | 'plain';
	/** Digest of exact source bytes, before AST transformation. */
	readonly sourceSha256: string;
	/** Emitted module path relative to the ignored experiment output folder. */
	readonly generated: string;
	/** Source-derived declaration sidecar, also relative to the output folder. */
	readonly declarations: string;
	readonly generatedSha256: string;
	readonly declarationsSha256: string;
	/** Syntactic calls removed from this copy, not runtime invocation frequency. */
	readonly removedFreezeCalls: number;
}

/** Hashes and compiler identity required to attribute a run to one source checkpoint. */
export interface ProvenanceType {
	/** Repository-relative input names mapped to SHA-256 digests of exact bytes. */
	readonly inputs: Readonly<Record<string, string>>;
	/** Non-workspace dependencies whose resolution is governed by the hashed manifests and locks. */
	readonly externalSpecifiers: readonly string[];
	readonly compiler: { readonly version: string; readonly entrySha256: string; readonly packageSha256: string };
	readonly boundary: string;
}

/** Exact bytes, independent of JSON formatting or syntax normalization. */
export function digest(bytes: string | Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Derive portable names while rejecting a generated treatment that escapes its source checkout. */
function name(root: string, path: string): string {
	const value = relative(root, path).split(sep).join('/');
	if (value === '..' || value.startsWith('../')) throw new Error(`Treatment dependency escapes source root: ${value}`);
	return value;
}

/** Resolve workspace exports from their owned manifests, never from an unrelated installed package version. */
async function local(
	root: string,
	specifier: string,
	parent: string,
	inputs: Record<string, string>,
): Promise<string | undefined> {
	if (specifier.startsWith('.')) return resolve(dirname(parent), specifier);
	const owned = /^@okikio\/([^/]+)(.*)$/.exec(specifier);
	if (!owned) return undefined;
	const directory = resolve(root, 'packages', owned[1]!);
	const path = resolve(directory, 'package.json');
	let bytes;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
		throw error;
	}
	inputs[name(root, path)] = digest(bytes);
	const denoManifest = resolve(directory, 'deno.jsonc');
	inputs[name(root, denoManifest)] = digest(await readFile(denoManifest));
	const manifest = JSON.parse(Buffer.from(bytes).toString('utf8')) as { exports: Record<string, unknown> };
	const target = manifest.exports[owned[2] ? '.' + owned[2] : '.'];
	if (typeof target !== 'string') throw new Error(`No literal workspace export for ${specifier}.`);
	return resolve(directory, target);
}

/** Type-only imports disappear before the runtime graph is inspected. Literal dynamic imports are included. */
function imports(ts: typeof TypeScript, path: string, bytes: Uint8Array): Set<string> {
	const emitted = ts.transpileModule(Buffer.from(bytes).toString('utf8'), {
		fileName: path,
		compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
	}).outputText;
	const source = ts.createSourceFile(path, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const values = new Set<string>();
	const visit = (node: TypeScript.Node): void => {
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
export async function provenance(
	root: string,
	output: string,
	generated: readonly GeneratedType[],
	ts: typeof TypeScript,
	require: ReturnType<typeof createRequire>,
): Promise<ProvenanceType> {
	const inputs: Record<string, string> = {};
	const external = new Set<string>();
	const seen = new Set<string>();
	/** A visited-path set terminates cycles while hashing each shared implementation once. */
	async function visit(path: string): Promise<void> {
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
			'tools/workspace/run.ts',
			'.mise/tasks/ops/bench/freeze/prepare.sh',
			'.mise/tasks/ops/bench/freeze/verify.sh',
			'.mise/tasks/ops/bench/freeze/check.sh',
			'.mise/tasks/ops/bench/freeze/run.sh',
			'.mise/tasks/ops/bench/freeze/summarize.sh',
			'bench/freeze/freeze.bench.ts',
			'tools/bench/freeze/prepare.ts',
			'tools/bench/freeze/verify.ts',
			'tools/bench/freeze/summarize.ts',
			'tools/bench/freeze/provenance.ts',
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
