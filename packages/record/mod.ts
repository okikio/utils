/**
 * Ordinary string-keyed data-record validation and immutable snapshot helpers.
 *
 * @module
 */
import type { Entry } from './types.ts';

/** Return whether a value is a plain object or null-prototype record containing only own enumerable string data properties. */
export function is(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	if (Object.getOwnPropertySymbols(value).length > 0) return false;
	return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
		descriptor.enumerable && 'value' in descriptor
	);
}

/** Reject values whose type-visible properties cannot be preserved by ordinary record enumeration. */
export function assert<Value>(value: Value, name = 'record'): asserts value is Value & Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object or null-prototype record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object or null-prototype record.`);
	}
	if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${name} must use string keys only.`);
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (!descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError(`${name} property ${JSON.stringify(key)} must be an enumerable data property.`);
		}
	}
}

/** Return exact own string keys after validating that no type-visible key can be omitted. */
export function keys<const RecordType extends Readonly<Record<string, unknown>>>(
	value: RecordType,
	name = 'record',
): readonly Extract<keyof RecordType, string>[] {
	assert(value, name);
	return Object.freeze(Object.keys(value)) as readonly Extract<keyof RecordType, string>[];
}

/** Return exact own string entries after validating the authoring record shape. */
export function entries<const RecordType extends Readonly<Record<string, unknown>>>(
	value: RecordType,
	name = 'record',
): readonly Entry<RecordType>[] {
	const result: Entry<RecordType>[] = [];
	for (const key of keys(value, name)) result.push(Object.freeze([key, value[key]] as const));
	return Object.freeze(result);
}

/** Create a frozen null-prototype snapshot without dropping any validated record property. */
export function snapshot<const RecordType extends Readonly<Record<string, unknown>>>(
	value: RecordType,
	name = 'record',
): RecordType {
	assert(value, name);
	const target: Record<string, unknown> = Object.create(null);
	for (const [key, entry] of Object.entries(value)) {
		Object.defineProperty(target, key, { value: entry, enumerable: true, writable: false, configurable: false });
	}
	return Object.freeze(target) as RecordType;
}

export type { Entry } from './types.ts';
