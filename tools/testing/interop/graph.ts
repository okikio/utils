/**
 * Find every file and npm package a test cell can run, by following imports from its root modules.
 *
 * The walk reads each module's static imports, re-exports and literal dynamic imports with `oxc-parser`, so it sees
 * what Node, Bun and Deno load rather than guessing from folder names. Type-only imports are skipped: they compile
 * away. A module may also export `inputs`, paths it reads at run time, such as a Prisma schema, and `packages`, npm
 * packages it loads in a way no import shows, such as a generated Prisma client's runtime.
 *
 * @module
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { parseSync } from 'oxc-parser';

/** What a walk found: repository files, and npm packages by the importer that declares them. */
export interface GraphType {
	readonly files: ReadonlySet<string>;
	/** `importer path` + NUL + `package name`, such as `tests/interop\0knex`. */
	readonly packages: ReadonlySet<string>;
}

/** How to treat the modules a walk reaches. */
export interface WalkOptions {
	/** Repository-relative files to read but not follow, such as a registry that imports every client. */
	readonly stop?: ReadonlySet<string>;
	/** Repository-relative files to leave out entirely, because the key holds their meaning instead. */
	readonly skip?: ReadonlySet<string>;
	/** Whether to follow a literal dynamic import from one file to another. Defaults to yes. */
	readonly dynamic?: (from: string, to: string) => boolean;
}

/** A workspace package: its folder, its name, and where each subpath export points. */
interface WorkspaceType {
	readonly dir: string;
	readonly exports: Readonly<Record<string, unknown>>;
}

/** Read every `packages/*` manifest once, by package name. */
export function workspaces(root: string): ReadonlyMap<string, WorkspaceType> {
	const found = new Map<string, WorkspaceType>();
	for (const name of readdirSync(path.join(root, 'packages'))) {
		const manifest = path.join(root, 'packages', name, 'package.json');
		if (!existsSync(manifest)) continue;
		const data = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; exports?: Record<string, unknown> };
		found.set(data.name, { dir: `packages/${name}`, exports: data.exports ?? {} });
	}
	return found;
}

/** The file a conditional export points at: a plain path, or its `import` or `default` condition. */
function target(entry: unknown): string | undefined {
	if (typeof entry === 'string') return entry;
	if (entry && typeof entry === 'object') {
		const record = entry as Record<string, unknown>;
		return target(record.import ?? record.default);
	}
	return undefined;
}

/** The package name of a bare specifier: `pg` for `pg/lib`, `@scope/name` for `@scope/name/sub`. */
export function packageName(specifier: string): string {
	const parts = specifier.split('/');
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** The nearest folder above a file that has a `package.json`, as a repository-relative importer path. */
function importer(root: string, file: string): string {
	let dir = path.dirname(file);
	while (dir !== '.' && !existsSync(path.join(root, dir, 'package.json'))) dir = path.dirname(dir);
	return dir === '.' ? '.' : dir;
}

/** The leading string literal of a dynamic import's argument, such as `'bun'` in `import('bun' as string)`. */
function literal(source: string): string | undefined {
	return /^\s*(['"`])([^'"`$]+)\1/u.exec(source)?.[2];
}

/** Strings a module exports as a list, such as `export const inputs = ['../prisma/schema.prisma']`. */
function declared(source: string, name: 'inputs' | 'packages'): readonly string[] {
	const block = new RegExp(`export\\s+const\\s+${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`, 'u').exec(source)?.[1];
	return block ? [...block.matchAll(/(['"`])([^'"`]+)\1/gu)].map((match) => match[2]!) : [];
}

/** Every repository file under a path, or the path itself when it is a file. */
function under(root: string, relative: string): readonly string[] {
	const full = path.join(root, relative);
	if (!existsSync(full)) throw new Error(`Declared input ${relative} does not exist.`);
	if (!statSync(full).isDirectory()) return [relative];
	return readdirSync(full, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
		.sort();
}

/** Parsed module requests by file, so the planner reads each file once however many cells reach it. */
const parsed = new Map<string, ParsedType>();

/** What one module loads. */
interface ParsedType {
	readonly requests: readonly RequestType[];
	readonly inputs: readonly string[];
}

/** One specifier a module loads, and whether it is a dynamic import. */
interface RequestType {
	readonly specifier: string;
	readonly dynamic: boolean;
}

/** The specifiers a module loads and the paths it declares in `inputs`. */
function read(root: string, file: string): ParsedType {
	const known = parsed.get(file);
	if (known) return known;
	const source = readFileSync(path.join(root, file), 'utf8');
	const result = parseSync(file, source);
	if (result.errors.length) throw new Error(`Cannot parse ${file}: ${result.errors[0]!.message}`);
	const record = result.module;
	const requests: RequestType[] = [];
	for (const item of record.staticImports) {
		// A side-effect import has no entries and always runs; a type-only import compiles away.
		if (item.entries.length === 0 || item.entries.some((entry) => !entry.isType)) {
			requests.push({ specifier: item.moduleRequest.value, dynamic: false });
		}
	}
	for (const item of record.staticExports) {
		for (const entry of item.entries) {
			if (entry.moduleRequest && !entry.isType) {
				requests.push({ specifier: entry.moduleRequest.value, dynamic: false });
			}
		}
	}
	for (const item of record.dynamicImports) {
		const specifier = literal(source.slice(item.moduleRequest.start, item.moduleRequest.end));
		if (specifier) requests.push({ specifier, dynamic: true });
	}
	for (const name of declared(source, 'packages')) requests.push({ specifier: name, dynamic: false });
	const found = { requests, inputs: declared(source, 'inputs') };
	parsed.set(file, found);
	return found;
}

/** Walk from root modules and collect every file and npm package they can load. */
export function walk(root: string, roots: readonly string[], options: WalkOptions = {}): GraphType {
	const spaces = workspaces(root);
	const files = new Set<string>();
	const packages = new Set<string>();
	const pending = [...roots];
	while (pending.length) {
		const file = pending.pop()!;
		if (files.has(file) || options.skip?.has(file)) continue;
		files.add(file);
		if (!/\.[cm]?[jt]sx?$/u.test(file) || options.stop?.has(file)) continue;
		const { requests, inputs: declares } = read(root, file);
		for (const declared of declares) {
			pending.push(...under(root, path.normalize(path.join(path.dirname(file), declared))));
		}
		for (const { specifier, dynamic } of requests) {
			const next = resolve(root, spaces, file, specifier);
			if (next === undefined) continue;
			if (next.startsWith('npm:')) {
				packages.add(`${importer(root, file)}\0${next.slice(4)}`);
				continue;
			}
			if (dynamic && options.dynamic && !options.dynamic(file, next)) continue;
			pending.push(next);
			// A workspace package's manifest decides its exports and npm versions.
			const space = [...spaces.values()].find((item) => next.startsWith(`${item.dir}/`));
			if (space) pending.push(`${space.dir}/package.json`);
		}
	}
	return { files, packages };
}

/**
 * Resolve one specifier from a file: a repository path, `npm:<name>` for an npm package, or `undefined` for a runtime
 * built-in or a registry specifier (`jsr:`, `npm:`) whose exact text is already part of the importing file.
 */
function resolve(
	root: string,
	spaces: ReadonlyMap<string, WorkspaceType>,
	from: string,
	specifier: string,
): string | undefined {
	if (isBuiltin(specifier) || specifier === 'bun' || /^(jsr|npm|node|https?):/u.test(specifier)) return undefined;
	if (specifier.startsWith('.')) {
		const file = path.normalize(path.join(path.dirname(from), specifier));
		if (!existsSync(path.join(root, file))) throw new Error(`${from} imports missing ${specifier}.`);
		return file;
	}
	const name = packageName(specifier);
	const space = spaces.get(name);
	if (!space) return `npm:${name}`;
	const subpath = '.' + specifier.slice(name.length);
	const entry = target(space.exports[subpath]);
	if (!entry) throw new Error(`${from} imports ${specifier}, which ${name} does not export.`);
	return path.normalize(path.join(space.dir, entry));
}
