/**
 * Inspect plain data records without accidentally invoking hidden getters or trusting inherited configuration. Object.keys plus direct reads can execute accessors and silently ignore properties that validation never saw.
 *
 * Validate authored options before snapshotting them. Enumerated keys and values remain broad because structural types can hide runtime properties; pick explicit keys when exact inference matters. Use the ordinary Web or JavaScript API when data is already trusted and the stronger record contract adds no value. Record inspection does not recursively validate application values or make external objects immutable.
 *
 * @example
 * ```ts
 * import * as record from '@okikio/collection/record';
 * const options = { host: 'localhost', port: 4321 } as const;
 * record.assert(options, 'server options');
 * console.log(record.keys(options).join(','));
 * console.log(record.entries(options).map(([key, value]) => `${key}=${value}`).join(' '));
 * ```
 *
 * @module
 */
import { hasOrdinaryPrototype } from './object.ts';

/** Return whether a value is a plain object or null-prototype record containing only own enumerable string data properties. */
export function is(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	if (!hasOrdinaryPrototype(value)) return false;
	if (Object.getOwnPropertySymbols(value).length > 0) return false;
	return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
		descriptor.enumerable && 'value' in descriptor
	);
}

/** Reject values whose type-visible properties cannot be preserved by ordinary record enumeration. */
export function assert<Value>(
	value: Value,
	name = 'record',
): asserts value is Value & Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object or null-prototype record.`);
	}
	if (!hasOrdinaryPrototype(value)) {
		throw new TypeError(`${name} must be a plain object or null-prototype record.`);
	}
	if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${name} must use string keys only.`);
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (!descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError(`${name} property ${JSON.stringify(key)} must be an enumerable data property.`);
		}
	}
}

/**
 * Return the own enumerable string keys of a validated data record.
 * Structural TypeScript types can hide additional runtime keys, so the result is string[].
 */
export function keys(value: Readonly<Record<string, unknown>>, name = 'record'): readonly string[] {
	assert(value, name);
	return Object.freeze(Object.keys(value));
}

/**
 * Return inspected own data entries. Values remain unknown until each caller validates its own contract.
 * Validation rejects ordinary accessors before values are read. This is not a
 * snapshot of a hostile Proxy: its inspection and enumeration traps can still run.
 */
export function entries(
	value: Readonly<Record<string, unknown>>,
	name = 'record',
): readonly (readonly [string, unknown])[] {
	assert(value, name);
	return Object.freeze(Object.entries(value).map(([key, entry]) => Object.freeze([key, entry] as const)));
}

/** Select explicit authored keys and preserve their values without claiming exhaustive runtime-key inference. */
export function pick<
	Value extends Readonly<Record<string, unknown>>,
	const Keys extends readonly (keyof Value & string)[],
>(
	value: Value,
	keys: Keys,
	name = 'record',
): Readonly<Pick<Value, Keys[number]>> {
	assert(value, name);
	const output: Record<string, unknown> = Object.create(null);
	for (const key of keys) {
		if (!Object.hasOwn(value, key)) throw new TypeError(`${name} has no own property ${JSON.stringify(key)}.`);
		Object.defineProperty(output, key, { value: value[key], enumerable: true, writable: false, configurable: false });
	}
	return Object.freeze(output) as Readonly<Pick<Value, Keys[number]>>;
}

/** Create a frozen null-prototype snapshot without dropping any validated record property. */
export function snapshot<const RecordType extends Readonly<Record<string, unknown>>>(
	value: RecordType,
	name = 'record',
): Readonly<RecordType> {
	assert(value, name);
	const target: Record<string, unknown> = Object.create(null);
	for (const [key, entry] of Object.entries(value)) {
		Object.defineProperty(target, key, { value: entry, enumerable: true, writable: false, configurable: false });
	}
	return Object.freeze(target) as Readonly<RecordType>;
}

export type { Entry } from './types.ts';
/** Copy JSON-compatible values while enforcing depth, node and aggregate text limits. */
export * as json from './json.ts';
/** Compare, describe and apply JSON-tree changes without mutating the supplied values. */
export * as change from './change.ts';

/** Copy all own data keys except the selected names. Missing omitted keys are harmless; input is never mutated. */
export function omit<
	Value extends Readonly<Record<string, unknown>>,
	const Keys extends readonly (keyof Value & string)[],
>(
	value: Value,
	keys: Keys,
	name = 'record',
): Readonly<Omit<Value, Keys[number]>> {
	assert(value, name);
	const excluded = new Set<string>(keys);
	return fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)), {
		maximumItems: Object.keys(value).length,
		duplicates: 'reject',
	}) as Readonly<Omit<Value, Keys[number]>>;
}

/** Transform own data values in enumeration order. Hidden structural keys make callback values unknown. Defects propagate. */
export function map<Next>(
	value: Readonly<Record<string, unknown>>,
	transform: (value: unknown, key: string) => Next,
): Readonly<Record<string, Next>> {
	const inspected = entries(value);
	return fromEntries(inspected.map(([key, entry]) => [key, transform(entry, key)] as const), {
		maximumItems: inspected.length,
		duplicates: 'reject',
	});
}

/** Retain matching own entries in enumeration order; no predicate is called until the entire record is safe. */
export function filter<Value extends Readonly<Record<string, unknown>>>(
	value: Value,
	predicate: (value: unknown, key: string) => boolean,
): Readonly<Partial<Value>> {
	const inspected = entries(value);
	return fromEntries(inspected.filter(([key, entry]) => predicate(entry, key)), {
		maximumItems: inspected.length,
		duplicates: 'reject',
	}) as Readonly<Partial<Value>>;
}

/** Explicit admission and collision policy for a possibly lazy source of record entries. */
export interface EntriesOptionsType {
	/** Maximum consumed entries, including duplicates. The max+1 entry rejects and closes the iterator. */
	readonly maximumItems: number;
	/** Keep the first or last value, or reject every repeated key. */
	readonly duplicates: 'first' | 'last' | 'reject';
}

/**
 * Materialize bounded string entries as a frozen null-prototype record.
 * Prototype-shaped names are ordinary data. Sources and entry values are borrowed;
 * early failure calls iterator return through for-of. Value references are not deep copied.
 *
 * @example
 * ```ts
 * const values = fromEntries([['port', 4321]], { maximumItems: 8, duplicates: 'reject' });
 * console.log(values.port);
 * ```
 */
export function fromEntries<Value>(
	source: Iterable<readonly [string, Value]>,
	options: EntriesOptionsType,
): Readonly<Record<string, Value>> {
	if (!Number.isSafeInteger(options.maximumItems) || options.maximumItems < 0) {
		throw new TypeError('maximumItems must be a non-negative safe integer.');
	}
	if (!['first', 'last', 'reject'].includes(options.duplicates)) throw new TypeError('Unknown duplicate key policy.');
	const output: Record<string, Value> = Object.create(null);
	let count = 0;
	for (const entry of source) {
		if (++count > options.maximumItems) throw new RangeError('Record entries exceed maximumItems.');
		if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError('Expected a string/value pair.');
		const descriptors = Object.getOwnPropertyDescriptors(entry);
		const keyField = descriptors['0'];
		const valueField = descriptors['1'];
		if (
			!keyField || !valueField || !('value' in keyField) || !('value' in valueField) || !keyField.enumerable ||
			!valueField.enumerable
		) throw new TypeError('Record entries require own data elements.');
		const key = keyField.value as unknown;
		const value = valueField.value as Value;
		if (typeof key !== 'string') throw new TypeError('Record entry keys must be strings.');
		if (Object.hasOwn(output, key)) {
			if (options.duplicates === 'reject') throw new TypeError(`Duplicate record key ${JSON.stringify(key)}.`);
			if (options.duplicates === 'first') continue;
		}
		output[key] = value;
	}
	return Object.freeze(output);
}
