/**
 * Compare and patch finite JSON-shaped values with explicit additions, replacements and removals.
 *
 * Records use own enumerable data properties. Arrays must be dense and have no extra properties.
 * Cycles, symbols, accessors, classes, Map, Set, undefined and non-finite numbers
 * reject. Shared references are copied by value; alias identity is not part of this data model.
 * Neither operation mutates its inputs. Patch returns a JSON value, never a guessed source type.
 * Validate that result with an output schema when an application needs a narrower type.
 * @module
 */

import * as json from './json.ts';
import type { Value } from './json.ts';
export type { Value } from './json.ts';

/** Object property names and actual array indexes retain distinct path types. */
export type Path = readonly (string | number)[];
/** Explicit changes preserve deletion and replacement, including replacement of the root value. */
export type Change =
	| Readonly<{ readonly type: 'add' | 'replace'; readonly path: Path; readonly value: Value }>
	| Readonly<{ readonly type: 'remove'; readonly path: Path }>;

/** Depth and operation limits protect untrusted documents without selecting an application size policy. */
export interface Options extends json.Options {
	/** Maximum number of patch operations accepted or produced. @default 100000 */
	readonly maximumChanges?: number;
}

/** Validate per-operation controls once before copying or comparing user data. */
function limits(options: Options): json.Options & Required<Pick<Options, 'maximumDepth' | 'maximumChanges'>> {
	const maximumDepth = options.maximumDepth ?? 128;
	const maximumChanges = options.maximumChanges ?? 100_000;
	if (
		!Number.isSafeInteger(maximumDepth) || maximumDepth < 0 || !Number.isSafeInteger(maximumChanges) ||
		maximumChanges < 0
	) {
		throw new TypeError('Change limits must be non-negative safe integers.');
	}
	return { ...options, maximumDepth, maximumChanges };
}

/** Return whether a copied value is an object record rather than an array. */
function record(value: Value): value is { readonly [key: string]: Value } {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Compare validated JSON values without constructing a change list.
 *
 * Signed zeros compare equal. Input budgets still validate both complete
 * values, then comparison stops at the first mismatch. maximumChanges applies
 * only to diff and patch, so it cannot turn an unequal result into an error.
 */
export function equal(a: unknown, b: unknown, options: Options = {}): boolean {
	const before = json.copy(a, options);
	const after = json.copy(b, options);
	/** Compare owned trees only. Copying above has already rejected getters, cycles and out-of-budget data. */
	const compare = (left: Value, right: Value): boolean => {
		if (left === right) return true;
		if (Array.isArray(left)) {
			return Array.isArray(right) && left.length === right.length &&
				left.every((value, index) => compare(value, right[index]!));
		}
		if (!record(left) || !record(right)) return false;
		const keys = Object.keys(left);
		return keys.length === Object.keys(right).length &&
			keys.every((key) => Object.hasOwn(right, key) && compare(left[key]!, right[key]!));
	};
	return compare(before, after);
}

/** Produce deterministic, caller-owned changes without losing removals or nested parent paths. */
export function diff(a: unknown, b: unknown, options: Options = {}): Change[] {
	const policy = limits(options);
	const before = json.copy(a, policy);
	const after = json.copy(b, policy);
	const changes: Change[] = [];
	/** Stop before retaining one more operation than the caller allowed, including nested array edits. */
	const add = (change: Change): void => {
		if (changes.length >= policy.maximumChanges) throw new RangeError('Change list exceeds maximumChanges.');
		changes.push(change);
	};
	/** Compare one owned subtree; array removals proceed backwards so indexes retain meaning. */
	const compare = (left: Value, right: Value, path: Path): void => {
		if (left === right) return;
		if (Array.isArray(left) && Array.isArray(right)) {
			const shared = Math.min(left.length, right.length);
			for (let index = 0; index < shared; index++) compare(left[index]!, right[index]!, [...path, index]);
			for (let index = left.length - 1; index >= right.length; index--) add({ type: 'remove', path: [...path, index] });
			for (let index = shared; index < right.length; index++) {
				add({ type: 'add', path: [...path, index], value: right[index]! });
			}
			return;
		}
		if (record(left) && record(right)) {
			for (const key of Object.keys(left)) {
				if (!Object.hasOwn(right, key)) add({ type: 'remove', path: [...path, key] });
				else compare(left[key]!, right[key]!, [...path, key]);
			}
			for (const key of Object.keys(right)) {
				if (!Object.hasOwn(left, key)) add({ type: 'add', path: [...path, key], value: right[key]! });
			}
			return;
		}
		add({ type: 'replace', path: [...path], value: right });
	};
	compare(before, after, []);
	return changes;
}

/** Validate one path segment before accessing an already copied container. */
function key(container: Value, segment: string | number, allowEnd: boolean): string | number {
	if (Array.isArray(container)) {
		if (
			typeof segment !== 'number' || !Number.isSafeInteger(segment) || segment < 0 ||
			segment >= container.length + (allowEnd ? 1 : 0)
		) {
			throw new TypeError('Array paths require an existing numeric index, or the end index for addition.');
		}
		return segment;
	}
	if (!record(container) || typeof segment !== 'string') {
		throw new TypeError('Record paths require an own string key.');
	}
	return segment;
}

/** Copy a complete operation before traversal so untrusted getters and later mutation cannot change its meaning. */
function operation(value: unknown, policy: json.Options & { readonly maximumDepth: number }): Change {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('A change must be a data record.');
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Object.getOwnPropertySymbols(value).length > 0 ||
		Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !('value' in descriptor))
	) throw new TypeError('A change must contain own data properties.');
	const kind: unknown = descriptors.type?.value;
	const path: unknown = descriptors.path?.value;
	if (kind !== 'add' && kind !== 'replace' && kind !== 'remove' || !Array.isArray(path)) {
		throw new TypeError('Invalid change type or path.');
	}
	if (path.length > policy.maximumDepth) throw new RangeError('Change path exceeds maximumDepth.');
	const ownedPath: (string | number)[] = [];
	for (let index = 0; index < path.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(path, index);
		const segment: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
		if (
			typeof segment !== 'string' && typeof segment !== 'number' ||
			typeof segment === 'number' && (!Number.isSafeInteger(segment) || segment < 0)
		) throw new TypeError('Invalid change path segment.');
		ownedPath.push(segment);
	}
	const expected = kind === 'remove' ? ['type', 'path'] : ['type', 'path', 'value'];
	if (
		Object.keys(descriptors).length !== expected.length || expected.some((name) => !Object.hasOwn(descriptors, name))
	) throw new TypeError('A change has missing or unknown properties.');
	return kind === 'remove'
		? { type: kind, path: ownedPath }
		: { type: kind, path: ownedPath, value: json.copy(descriptors.value!.value, policy) };
}

/** Apply a change list to a private copy, then enforce the same supported value domain on the final result. */
export function patch(base: unknown, changes: readonly Change[], options: Options = {}): Value {
	const policy = limits(options);
	if (!Array.isArray(changes) || changes.length > policy.maximumChanges) {
		throw new RangeError('Change list exceeds maximumChanges or is not an array.');
	}
	let output = json.copy(base, policy);
	for (const candidate of changes) {
		const change = operation(candidate, policy);
		if (change.path.length === 0) {
			if (change.type === 'remove') {
				throw new TypeError('Removing the document root is not a JSON value; replace it explicitly.');
			}
			output = change.value;
			continue;
		}
		let parent = output;
		for (const segment of change.path.slice(0, -1)) {
			if (parent === null || typeof parent !== 'object') {
				throw new TypeError('Change path traverses a primitive value.');
			}
			const name = key(parent, segment, false);
			if (!Object.hasOwn(parent, name)) throw new TypeError('Change path traverses a missing own property.');
			parent = (parent as Record<string | number, Value>)[name]!;
		}
		const last = key(parent, change.path.at(-1)!, change.type === 'add');
		if (Array.isArray(parent)) {
			const array = parent as Value[];
			if (change.type === 'add') array.splice(last as number, 0, change.value);
			else if (change.type === 'remove') array.splice(last as number, 1);
			else array[last as number] = change.value;
		} else {
			const target = parent as Record<string, Value>;
			const exists = Object.hasOwn(target, last);
			if (change.type === 'add' ? exists : !exists) {
				throw new TypeError('Change does not match the property existence required by its operation.');
			}
			if (change.type === 'remove') delete target[last];
			else target[last] = change.value;
		}
	}
	return json.copy(output, policy);
}

/**
 * Return changes that undo this exact patch from its resulting base. Invalid patches reject before output.
 * This is a value inverse, not preservation of the original operation list or object alias identity.
 */
export function invert(base: unknown, changes: readonly Change[], options: Options = {}): Change[] {
	return diff(patch(base, changes, options), base, options);
}

/** Compose two sequential patches against an explicit base, validating the intermediate value before the second patch. */
export function compose(
	base: unknown,
	first: readonly Change[],
	second: readonly Change[],
	options: Options = {},
): Change[] {
	return diff(base, patch(patch(base, first, options), second, options), options);
}
