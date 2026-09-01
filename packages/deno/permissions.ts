/**
 * Deno permission normalization and command-line permission argument planning.
 *
 * The module describes permission requirements. It does not request permissions or mutate the runtime permission state.
 */
import type { PermissionGrant, PermissionGrants, PermissionName } from './types.ts';

const order = Object.freeze([
	'read',
	'write',
	'net',
	'env',
	'sys',
	'run',
	'ffi',
	'import',
] as const satisfies readonly PermissionName[]);

const names = Object.freeze({
	read: true,
	write: true,
	net: true,
	env: true,
	sys: true,
	run: true,
	ffi: true,
	import: true,
} satisfies Record<PermissionName, true>);

/**
 * Build canonical `--allow-*` arguments for one Deno subprocess.
 *
 * Scoped values are deduplicated without reordering them. Literal commas are
 * escaped using Deno's doubled-comma CLI syntax.
 *
 * @example
 * ```ts
 * import * as permissions from '@okikio/deno/permissions';
 *
 * const args = permissions.args({
 * 	read: true,
 * 	write: ['/srv/output', '/srv/tmp,1'],
 * 	run: ['chromium'],
 * });
 * ```
 */
export function args(grants: PermissionGrants): readonly string[] {
	const result: string[] = [];
	for (const name of order) {
		const grant = grants[name];
		if (grant === undefined || grant === false) continue;
		result.push(allow(name, grant));
	}
	return Object.freeze(result);
}

/** Build one canonical Deno `--allow-*` argument. */
export function allow(name: PermissionName, grant: Exclude<PermissionGrant, false>): string {
	if (!Object.hasOwn(names, name)) throw new TypeError(`Unsupported Deno permission: ${String(name)}.`);
	if (grant === true) return `--allow-${name}`;
	return `--allow-${name}=${encodeList(grant)}`;
}

/**
 * Parse permission arguments produced by {@link args} or equivalent Deno CLI syntax.
 *
 * The function accepts only `--allow-*` arguments. Pass command options and the
 * entrypoint separately so unexpected input cannot be silently ignored.
 */
export function parse(input: Iterable<string>): PermissionGrants {
	const result: Partial<Record<PermissionName, true | string[]>> = {};
	for (const argument of input) {
		if (!argument.startsWith('--allow-')) {
			throw new TypeError(`Expected a Deno --allow-* permission argument, received ${JSON.stringify(argument)}.`);
		}
		const equals = argument.indexOf('=');
		const rawName = argument.slice('--allow-'.length, equals < 0 ? undefined : equals);
		if (!isName(rawName)) throw new TypeError(`Unsupported Deno permission: ${JSON.stringify(rawName)}.`);
		if (equals < 0) {
			result[rawName] = true;
			continue;
		}
		const decoded = decodeList(argument.slice(equals + 1));
		const current = result[rawName];
		if (current === true) continue;
		result[rawName] = dedupe([...(current ?? []), ...decoded]);
	}
	return Object.freeze(Object.fromEntries(Object.entries(result).map(([name, grant]) => [
		name,
		Array.isArray(grant) ? Object.freeze([...grant]) : grant,
	])) as PermissionGrants);
}

/** Encode one scoped Deno permission list. */
export function encodeList(values: Iterable<string>): string {
	const normalized = dedupe(values);
	if (normalized.length === 0) throw new TypeError('Deno permission scopes must contain at least one value.');
	return normalized.map(encodeValue).join(',');
}

/** Decode one scoped Deno permission list. */
export function decodeList(value: string): readonly string[] {
	if (value.length === 0) throw new TypeError('Deno permission scopes must not be empty.');
	const result: string[] = [];
	let current = '';
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index]!;
		if (character !== ',') {
			current += character;
			continue;
		}
		if (value[index + 1] === ',') {
			current += ',';
			index += 1;
			continue;
		}
		if (current.length === 0) throw new TypeError('Deno permission scopes must not contain empty values.');
		result.push(current);
		current = '';
	}
	if (current.length === 0) throw new TypeError('Deno permission scopes must not contain empty values.');
	result.push(current);
	return Object.freeze(result);
}

function encodeValue(value: string): string {
	if (value.length === 0) throw new TypeError('Deno permission scope values must not be empty.');
	if (value.includes('\0')) throw new TypeError('Deno permission scope values must not contain NUL.');
	return value.replaceAll(',', ',,');
}

function dedupe(values: Iterable<string>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		encodeValue(value);
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function isName(value: string): value is PermissionName {
	return Object.hasOwn(names, value);
}

export type { PermissionName, PermissionGrant, PermissionGrants } from './types.ts';
