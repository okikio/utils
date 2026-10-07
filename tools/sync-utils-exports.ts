/**
 * Project focused exports into the umbrella without rewriting authored manifest text.
 *
 * Check is read-only. Write replaces generated bridges before the two manifest
 * values that advertise them. Each file replacement is atomic; the whole update
 * is not a transaction, so an interrupted write must be followed by another check.
 * @module
 */
import { parse } from '@std/jsonc';
import { parseSync } from 'oxc-parser';
import { fileURLToPath } from 'node:url';

/** Focused source metadata needed to derive one umbrella bridge per module export. */
export interface PackageType {
	/** Scoped focused-package identity used in the generated import, not a filesystem path. */
	readonly name: string;
	/** Public source subpath to local module target; package metadata exports are omitted from bridges. */
	readonly exports: Readonly<Record<string, string>>;
	/** Exact local modules that require evaluation even when their values are unused. */
	readonly sideEffects: false | readonly string[];
}

/** Generated bridge contents and manifest fields have the same focused-package authority. */
export interface ProjectionType {
	/** Umbrella-relative module filenames and their complete generated source text. */
	readonly bridges: Readonly<Record<string, string>>;
	/** Public umbrella subpaths, including its independently authored root and complete facade. */
	readonly exports: Readonly<Record<string, string>>;
	/** Generated setup bridge filenames whose evaluation must survive selective bundling. */
	readonly sideEffects: false | readonly string[];
}

/** Validate source metadata and sort by identity, independently of directory enumeration order. */
export function project(packages: readonly PackageType[]): ProjectionType {
	const exports: Record<string, string> = { '.': './mod.ts', './all': './all.ts' };
	const bridges: Record<string, string> = {};
	const sideEffects: string[] = [];
	const names = new Set<string>();
	for (const manifest of [...packages].sort((left, right) => left.name.localeCompare(right.name))) {
		if (!/^@okikio\/[a-z0-9-]+$/u.test(manifest.name) || names.has(manifest.name)) {
			throw new TypeError('Focused package identities must be unique local @okikio names.');
		}
		names.add(manifest.name);
		const short = manifest.name.slice('@okikio/'.length);
		for (const [key, target] of Object.entries(manifest.exports).sort(([left], [right]) => left.localeCompare(right))) {
			if (key === './package.json') continue;
			if (key !== '.' && (!key.startsWith('./') || !key.slice(2).split('/').every(segment))) {
				throw new TypeError('Focused exports must use literal local module subpaths.');
			}
			if (typeof target !== 'string' || !target.startsWith('./')) {
				throw new TypeError('Focused source exports must name local modules.');
			}
			const suffix = key === '.' ? '' : key.slice(1);
			const source = `${manifest.name}${suffix}`;
			const relative = `${short}${suffix}.ts`;
			const effect = Array.isArray(manifest.sideEffects) && manifest.sideEffects.includes(target);
			bridges[relative] = effect
				? `/** Explicit side-effect bridge to the module owned by \`${source}\`. @module */\nimport '${source}';\nexport {};\n`
				: `/** Focused single-install re-export of \`${source}\`. @module */\nexport * from '${source}';\n`;
			exports[`./${short}${suffix}`] = `./${relative}`;
			if (effect) sideEffects.push(`./${relative}`);
		}
	}
	return { bridges, exports, sideEffects: sideEffects.length === 0 ? false : sideEffects };
}

/** A generated filesystem segment cannot escape its package or alter import syntax. */
function segment(value: string): boolean {
	return /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/u.test(value);
}

/**
 * Replace only the values of existing owned top-level fields in valid JSONC.
 *
 * JSONC validation owns the data grammar. The already-selected Oxc parser supplies
 * value spans; strings and comments containing field names cannot select a region.
 * Duplicate owned fields reject before mutation. Surrounding comments, unknown
 * fields, Unicode, newline style and indentation remain authored bytes.
 */
export function patch(source: string, fields: Readonly<Record<string, unknown>>): string {
	if (!record(parse(source))) throw new TypeError('The umbrella manifest must be a JSONC object.');
	const prefix = 'const manifest = ';
	const parsed = parseSync('manifest.ts', prefix + source);
	if (parsed.errors.length) throw new SyntaxError('The manifest could not supply unambiguous field spans.');
	const declaration = recordValue(array(recordValue(parsed.program).body)[0]);
	const initializer = recordValue(array(declaration.declarations)[0]).init;
	const properties = array(recordValue(initializer).properties);
	const edits: { start: number; end: number; text: string }[] = [];
	for (const [field, value] of Object.entries(fields)) {
		const selected = properties.filter((property) => recordValue(recordValue(property).key).value === field);
		if (selected.length !== 1) throw new TypeError('Each owned manifest field must appear exactly once.');
		const node = recordValue(recordValue(selected[0]).value);
		if (typeof node.start !== 'number' || typeof node.end !== 'number') {
			throw new TypeError('An owned manifest value has no source span.');
		}
		const start = node.start - prefix.length, end = node.end - prefix.length;
		const line = source.slice(0, start).split(/\r?\n/u).at(-1)!;
		const indentation = /^\s*/u.exec(line)![0];
		const newline = source.includes('\r\n') ? '\r\n' : '\n';
		const serialized = JSON.stringify(value, null, '\t');
		if (serialized === undefined) throw new TypeError('Owned manifest values must be JSON serializable.');
		const text = serialized.replaceAll('\n', newline + indentation);
		edits.push({ start, end, text });
	}
	let result = source;
	for (const edit of edits.sort((left, right) => right.start - left.start)) {
		result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
	}
	const actual = recordValue(parse(result));
	for (const [field, value] of Object.entries(fields)) {
		if (JSON.stringify(actual[field]) !== JSON.stringify(value)) {
			throw new TypeError('The generated manifest value did not survive its source projection.');
		}
	}
	return result;
}

/** Report drift without writes, or replace validated generated files and owned manifest values. */
export async function sync(root: URL, mode: 'check' | 'write' = 'check'): Promise<readonly string[]> {
	const focused: PackageType[] = [];
	const packages = new URL('packages/', root), umbrella = new URL('utils/', packages);
	for await (const entry of Deno.readDir(packages)) {
		if (!entry.isDirectory || entry.name === 'utils') continue;
		const source = recordValue(parse(await Deno.readTextFile(new URL(`${entry.name}/package.json`, packages))));
		if (typeof source.name !== 'string' || !source.name.startsWith('@okikio/')) continue;
		const exports = recordValue(source.exports);
		if (!Object.values(exports).every((value) => typeof value === 'string')) {
			throw new TypeError('Source export targets must be strings.');
		}
		if (
			source.sideEffects !== false && (!Array.isArray(source.sideEffects) ||
				!source.sideEffects.every((value) => typeof value === 'string'))
		) {
			throw new TypeError('Source side effects must be false or explicit module targets.');
		}
		focused.push({
			name: source.name,
			exports: exports as Readonly<Record<string, string>>,
			sideEffects: source.sideEffects as false | readonly string[],
		});
	}
	const projection = project(focused);
	const planned = new Map(Object.entries(projection.bridges).map(([path, source]) => [path, source]));
	for (const name of ['package.json', 'deno.jsonc']) {
		const source = await Deno.readTextFile(new URL(name, umbrella));
		planned.set(
			name,
			patch(source, {
				exports: projection.exports,
				...(name === 'package.json' ? { sideEffects: projection.sideEffects } : {}),
			}),
		);
	}
	const changed: string[] = [];
	for (const [path, source] of planned) {
		let current: string | undefined;
		try {
			current = await Deno.readTextFile(new URL(path, umbrella));
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}
		if (source !== current) changed.push(path);
	}
	if (mode === 'write') {
		// Bridges precede the manifests that advertise them. Validate every plan
		// first so a malformed second manifest cannot trigger any first-file write.
		for (const path of changed) await replace(new URL(path, umbrella), planned.get(path)!);
	}
	return changed;
}

/** Publish complete file bytes with a same-directory rename; never leave a truncated generated file. */
async function replace(url: URL, source: string): Promise<void> {
	const directory = new URL('./', url);
	await Deno.mkdir(directory, { recursive: true });
	const temporary = await Deno.makeTempFile({ dir: fileURLToPath(directory), prefix: '.sync-' });
	try {
		await Deno.writeTextFile(temporary, source);
		await Deno.rename(temporary, url);
	} catch (primary) {
		try {
			await Deno.remove(temporary);
		} catch (cleanup) {
			if (!(cleanup instanceof Deno.errors.NotFound)) {
				throw new AggregateError([primary, cleanup], 'Export replacement and temporary-file cleanup failed.', {
					cause: primary,
				});
			}
		}
		throw primary;
	}
}

/** Keep untrusted manifest/parser values unknown until their object shape is established. */
function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Require an object instead of silently treating malformed metadata as empty. */
function recordValue(value: unknown): Readonly<Record<string, unknown>> {
	if (!record(value)) throw new TypeError('Expected a manifest or parser object.');
	return value;
}

/** Require a parser collection before selecting its owned source nodes. */
function array(value: unknown): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError('Expected a parser node collection.');
	return value;
}

if (import.meta.main) {
	if (Deno.args.length > 1 || Deno.args.some((value) => value !== '--check' && value !== '--write')) {
		throw new TypeError('Use --check (the default) or --write.');
	}
	const mode = Deno.args.includes('--write') ? 'write' : 'check';
	const changed = await sync(new URL('../', import.meta.url), mode);
	if (mode === 'check' && changed.length) throw new Error(`Umbrella exports have drifted: ${changed.join(', ')}.`);
	console.log(`${mode}: ${changed.length} generated files ${mode === 'write' ? 'updated' : 'need changes'}.`);
}
