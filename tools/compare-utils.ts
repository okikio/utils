/** Compare parsed utility modules without treating comments or formatting as behavior changes. */
import { parseSync } from 'oxc-parser';

/** Portable evidence about one source file; equal hashes are triage, not a compatibility proof. */
interface SourceType {
	/** Original UTF-8 source hash, including comments and formatting. */
	readonly source: string;
	/** Hash of parsed nodes after removing source positions and import-prefix differences. */
	readonly ast: string;
	/** Whether this file is a test, a benchmark or a production module. */
	readonly role: 'test' | 'benchmark' | 'production';
}

const roots = {
	core: Deno.args[0],
	mediad: Deno.args[1],
	utils: new URL('../packages/', import.meta.url).pathname,
};
if (roots.core === undefined || roots.mediad === undefined) {
	throw new TypeError('Usage: deno run -A tools/compare-utils.ts <core-utils-path> <mediad-utils-path>');
}
const snapshots: Record<string, Readonly<Record<string, SourceType>>> = {};
for (const [name, root] of Object.entries(roots)) {
	if (root === undefined) throw new TypeError(`Missing ${name} source root.`);
	snapshots[name] = await scan(root);
}
const comparisons: Record<string, readonly Readonly<{ file: string; status: string }>[]> = {};
for (const name of ['core', 'mediad']) {
	const from = snapshots[name]!;
	const to = snapshots.utils!;
	comparisons[name] = [...new Set([...Object.keys(from), ...Object.keys(to)])].toSorted().map((file) => ({
		file,
		status: from[file] === undefined
			? 'utils-only'
			: to[file] === undefined
			? `${name}-only`
			: from[file]!.source === to[file]!.source
			? 'same-source'
			: from[file]!.ast === to[file]!.ast
			? 'same-ast'
			: 'changed',
	}));
}
console.log(
	JSON.stringify(
		{
			roots,
			normalization: 'Oxc nodes without positions, raw spelling or comments; @utils/ imports use @okikio/',
			snapshots,
			comparisons,
		},
		null,
		2,
	),
);

/** Scan ordinary files only; dependency links, build output and temporary example modules are excluded. */
async function scan(root: string): Promise<Readonly<Record<string, SourceType>>> {
	const values: Record<string, SourceType> = {};
	async function visit(directory: string, relative = ''): Promise<void> {
		for await (const entry of Deno.readDir(directory)) {
			if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue;
			const path = `${directory}/${entry.name}`;
			const file = `${relative}${entry.name}`;
			if (entry.isDirectory) await visit(path, `${file}/`);
			else if (entry.isFile && /\.tsx?$/u.test(file)) {
				const source = await Deno.readTextFile(path);
				const parsed = parseSync(path, source);
				if (parsed.errors.length > 0) {
					throw new Error(`Cannot compare malformed source ${path}: ${JSON.stringify(parsed.errors)}`);
				}
				const key = file.replace(/_(test|bench)\.ts$/u, '.$1.ts').replace('/type.test.ts', '/types.test.ts');
				if (Object.hasOwn(values, key)) throw new Error(`Ambiguous normalized file path ${key} under ${root}.`);
				values[key] = {
					source: await hash(source),
					ast: await hash(JSON.stringify(normalize(parsed.program))),
					role: /(?:_|\.)test\.ts$/u.test(file)
						? 'test'
						: /(?:_|\.)bench\.ts$/u.test(file)
						? 'benchmark'
						: 'production',
				};
			}
		}
	}
	await visit(root);
	return values;
}

/** Remove only syntax presentation and the repository's known utility namespace difference. */
function normalize(value: unknown, importSource = false): unknown {
	if (typeof value === 'bigint') return { bigint: value.toString() };
	if (typeof value === 'number' && Object.is(value, -0)) return { number: '-0' };
	if (Array.isArray(value)) return value.map((item) => normalize(item, importSource));
	if (typeof value === 'string') {
		return importSource && value.startsWith('@utils/') ? value.replace('@utils/', '@okikio/') : value;
	}
	if (value === null || typeof value !== 'object') return value;
	const type = Reflect.get(value, 'type');
	const hasSource = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression']
		.includes(type);
	return Object.fromEntries(
		Object.entries(value).filter(([key]) =>
			!['start', 'end', 'loc', 'range', 'span', 'raw', 'comments', 'leadingComments', 'trailingComments'].includes(key)
		).toSorted(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [
			key,
			normalize(
				item,
				importSource || (hasSource && key === 'source') || (type === 'TSImportType' && key === 'argument'),
			),
		]),
	);
}

/** Hash normalized evidence rather than storing complete source files or private application data. */
async function hash(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
