/**
 * Read the parts of `pnpm-lock.yaml` that decide which npm code a test runs: each importer's resolved dependencies and
 * the dependency closure of every snapshot.
 *
 * The lockfile is YAML with a fixed shape, so this reads only that shape: two-space nesting, one key per line, and
 * quoted keys where pnpm quotes them. A pnpm 11+ lockfile holds two documents; the workspace one is the last.
 *
 * @module
 */

/** A resolved npm dependency of one importer, such as `tests/interop` → `knex`. */
export interface LockType {
	/** Importer path → dependency name → resolved version, such as `3.3.0(pg@8.23.1)` or `link:../../packages/sql`. */
	readonly importers: ReadonlyMap<string, ReadonlyMap<string, string>>;
	/** Snapshot key, such as `knex@3.3.0(pg@8.23.1)` → its dependencies, name → resolved version. */
	readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const groups = new Set(['dependencies', 'devDependencies', 'optionalDependencies']);

/** A key without the quotes pnpm puts around keys that start with `@` or hold special characters. */
const unquote = (key: string): string => key.replace(/^'(.*)'$/u, '$1').replace(/^"(.*)"$/u, '$1');

/** Parse the workspace document of a pnpm lockfile. */
export function parseLock(text: string): LockType {
	const documents = text.split(/^---$/mu).filter((part) => part.trim());
	const lines = documents.at(-1)!.split('\n');
	const importers = new Map<string, Map<string, string>>();
	const snapshots = new Map<string, Map<string, string>>();
	let section = '';
	let entry = '';
	let group = '';
	let dependency = '';
	for (const line of lines) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;
		const content = line.trim();
		const colon = content.indexOf(': ');
		const key = unquote(colon === -1 ? content.replace(/:$/u, '') : content.slice(0, colon));
		const value = colon === -1 ? '' : unquote(content.slice(colon + 2));
		if (indent === 0) {
			section = key;
			continue;
		}
		if (section === 'importers') {
			if (indent === 2) {
				entry = key;
				importers.set(entry, new Map());
			} else if (indent === 4) {
				group = key;
			} else if (indent === 6 && groups.has(group)) {
				dependency = key;
			} else if (indent === 8 && groups.has(group) && key === 'version') {
				importers.get(entry)!.set(dependency, value);
			}
		} else if (section === 'snapshots') {
			if (indent === 2) {
				entry = key;
				snapshots.set(entry, new Map());
			} else if (indent === 4) {
				group = key;
			} else if (indent === 6 && groups.has(group)) {
				snapshots.get(entry)!.set(key, value);
			}
		}
	}
	return { importers, snapshots };
}

/** The snapshot key for a dependency: `name@version`, or the version itself for an alias such as `@jsr/std__expect@1`. */
export function snapshotKey(name: string, version: string): string {
	return /^@?[^@(]+@/u.test(version) ? version : `${name}@${version}`;
}

/**
 * Every snapshot one importer's dependency reaches, sorted. A workspace link (`link:`) is not npm code; the caller reads
 * that package's source instead. Throws when the importer does not declare the dependency, so a missing declaration
 * cannot hide an input.
 */
export function closure(lock: LockType, importer: string, name: string): readonly string[] {
	const version = lock.importers.get(importer)?.get(name);
	if (version === undefined) {
		throw new Error(`${importer || '.'} imports ${name}, which its package.json does not declare.`);
	}
	if (version.startsWith('link:')) return [];
	const seen = new Set<string>();
	const pending = [snapshotKey(name, version)];
	while (pending.length) {
		const key = pending.pop()!;
		if (seen.has(key)) continue;
		seen.add(key);
		for (const [child, childVersion] of lock.snapshots.get(key) ?? []) {
			if (!childVersion.startsWith('link:')) pending.push(snapshotKey(child, childVersion));
		}
	}
	return [...seen].sort();
}
