/** Validate source export parity, local module targets, and explicit setup retention metadata. @module */
import { parse } from '@std/jsonc';

/** Validate manifest claims against an independently discovered set of physical local files. */
export function packageProblems(npm: unknown, deno: unknown, files: ReadonlySet<string>): readonly string[] {
	const errors: string[] = [];
	if (!record(npm) || !record(deno)) return ['Both package manifests must be objects.'];
	if (!same(npm.exports, deno.exports)) errors.push('npm and Deno source exports differ.');
	if (!record(npm.exports) || Object.keys(npm.exports).length === 0) {
		errors.push('A package needs its source export map.');
	}
	const exports = record(npm.exports) ? npm.exports : {};
	for (const [key, target] of Object.entries(exports)) {
		if (!local(target) || !files.has(target)) errors.push(`Export ${key} has a missing or non-local module target.`);
	}
	const effects = npm.sideEffects;
	if (effects !== false && (!Array.isArray(effects) || !effects.every((value) => typeof value === 'string'))) {
		errors.push('sideEffects must be false or an explicit list of local module files.');
	}
	const selected: readonly unknown[] = Array.isArray(effects) ? effects : [];
	if (new Set(selected).size !== selected.length) errors.push('sideEffects contains duplicate module files.');
	for (const target of selected) {
		if (!local(target) || !files.has(target)) {
			errors.push('A declared side effect has a missing or non-local module target.');
		}
	}
	for (const [key, target] of Object.entries(exports)) {
		if (key.endsWith('/polyfill') && !selected.includes(target)) {
			errors.push(`Explicit setup export ${key} must be retained by sideEffects.`);
		}
	}
	return errors;
}

/** Read JSONC without treating malformed data as an absent manifest. */
async function readJson(url: URL): Promise<unknown> {
	try {
		return parse(await Deno.readTextFile(url));
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return undefined;
		throw error;
	}
}

/** Compare values structurally; object-key ordering is not a publication contract. */
function same(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
			left.every((value, index) => same(value, right[index]));
	}
	if (!record(left) || !record(right)) return false;
	const leftKeys = Object.keys(left).toSorted();
	const rightKeys = Object.keys(right).toSorted();
	return leftKeys.length === rightKeys.length &&
		leftKeys.every((key, index) => key === rightKeys[index] && same(left[key], right[key]));
}

/** Source setup metadata names exact package-relative files, rather than a blanket or glob exemption. */
function local(value: unknown): value is string {
	if (typeof value !== 'string' || !value.startsWith('./')) return false;
	const resolved = new URL(value, 'file:///package/');
	return resolved.pathname.startsWith('/package/') && resolved.search === '' && resolved.hash === '';
}

/** Adapt parsed JSON objects without admitting arrays or null. */
function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
	const root = new URL('../packages/', import.meta.url);
	const failures: string[] = [];
	for await (const entry of Deno.readDir(root)) {
		if (!entry.isDirectory) continue;
		const directory = new URL(`${entry.name}/`, root);
		const npm = await readJson(new URL('package.json', directory));
		const deno = await readJson(new URL('deno.jsonc', directory));
		if (npm === undefined && deno === undefined) continue;
		const targets = new Set<string>();
		if (record(npm)) {
			const exports = record(npm.exports) ? Object.values(npm.exports) : [];
			const effects = Array.isArray(npm.sideEffects) ? npm.sideEffects : [];
			for (const target of [...exports, ...effects]) {
				if (!local(target)) continue;
				try {
					if ((await Deno.stat(new URL(target, directory))).isFile) targets.add(target);
				} catch (error) {
					if (!(error instanceof Deno.errors.NotFound)) throw error;
				}
			}
		}
		failures.push(...packageProblems(npm, deno, targets).map((failure) => `${entry.name}: ${failure}`));
	}
	if (failures.length > 0) throw new Error(`Package validation failed:\n${failures.join('\n')}`);
	console.log('Source export parity, physical targets, and explicit setup retention metadata are valid.');
}
