/**
 * Durable workflow value snapshots.
 *
 * Workflow history and activity-job stores ultimately persist JSON-shaped data.
 * This module creates that representation before storage so instruction identity,
 * retries, and replay do not depend on caller-owned mutation or property access.
 *
 * @module
 */
import type { WorkflowDurableValue } from './types.ts';

/** Snapshot one JSON-shaped value without executing caller-owned accessors. */
export function snapshot(value: unknown, label: string): WorkflowDurableValue {
	return snapshotValue(value, label, new Set<object>());
}

/** Recursively snapshot one durable value while tracking only the active parent chain. */
function snapshotValue(value: unknown, path: string, parents: Set<object>): WorkflowDurableValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
		// JSON persistence cannot distinguish -0 from 0. Normalize before hashing or
		// replay identity can describe a value that storage cannot reproduce.
		return Object.is(value, -0) ? 0 : value;
	}
	if (typeof value !== 'object') throw new TypeError(`${path} must contain only JSON-safe durable values.`);
	if (parents.has(value)) throw new TypeError(`${path} contains a cycle.`);

	parents.add(value);
	try {
		return Array.isArray(value)
			? snapshotArray(value, path, parents)
			: snapshotRecord(value, path, parents);
	} finally {
		parents.delete(value);
	}
}

/** Snapshot a dense array without dropping caller-visible enumerable properties. */
function snapshotArray(value: readonly unknown[], path: string, parents: Set<object>): readonly WorkflowDurableValue[] {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	assertNoEnumerableSymbols(value, path);

	for (const [key, descriptor] of Object.entries(descriptors)) {
		if (key === 'length' || isArrayIndex(key, value.length) || !descriptor.enumerable) continue;
		throw new TypeError(`${path} contains extra enumerable array property ${JSON.stringify(key)}.`);
	}

	const output: WorkflowDurableValue[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined) throw new TypeError(`${path} contains a sparse array element at index ${index}.`);
		if (!descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError(`${path}[${index}] must be an enumerable data property.`);
		}
		output.push(snapshotValue(descriptor.value, `${path}[${index}]`, parents));
	}
	return Object.freeze(output);
}

/** Return whether one own property name is a canonical index inside the current array length. */
function isArrayIndex(key: string, length: number): boolean {
	if (key.length === 0) return false;
	const index = Number(key);
	return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

/** Snapshot enumerable string data from one plain object in stable key order. */
function snapshotRecord(value: object, path: string, parents: Set<object>): Readonly<Record<string, WorkflowDurableValue>> {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} contains a non-plain object.`);
	assertNoEnumerableSymbols(value, path);

	const descriptors = Object.getOwnPropertyDescriptors(value);
	const output: Record<string, WorkflowDurableValue> = Object.create(null);
	for (const key of Object.keys(descriptors).sort()) {
		const descriptor = descriptors[key];
		if (descriptor === undefined || !descriptor.enumerable) continue;
		if (!('value' in descriptor)) throw new TypeError(`${path}.${key} must be an enumerable data property.`);
		output[key] = snapshotValue(descriptor.value, `${path}.${key}`, parents);
	}
	return Object.freeze(output);
}

/** Reject enumerable symbol data because string-keyed durable state cannot preserve it. */
function assertNoEnumerableSymbols(value: object, path: string): void {
	for (const symbol of Object.getOwnPropertySymbols(value)) {
		if (Object.getOwnPropertyDescriptor(value, symbol)?.enumerable) {
			throw new TypeError(`${path} contains an enumerable symbol property.`);
		}
	}
}
