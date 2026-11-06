/** Validate and copy the finite JSON data model without invoking data-property getters. @module */
import { hasOrdinaryPrototype } from './object.ts';

/** Finite JSON values. Containers are structurally readonly and copies retain no input references. */
export type Value = null | boolean | number | string | readonly Value[] | { readonly [key: string]: Value };

/** Limits count the expanded representation, including each occurrence of an aliased object. */
export interface Options {
	/** Maximum object or array nesting. A primitive root has depth zero. @default 128 */
	readonly maximumDepth?: number;
	/** Maximum primitive and container nodes copied. @default 1000000 */
	readonly maximumNodes?: number;
	/** Maximum total UTF-16 code units in record keys and string values, counted after alias expansion. @default 16777216 */
	readonly maximumStringCodeUnits?: number;
}

/**
 * Copy JSON data through own descriptors into fresh arrays and null-prototype records.
 *
 * Sparse arrays, extra array properties, classes, symbols, accessors, undefined, non-finite
 * numbers and cycles reject. Shared references are copied by value. Prototype-shaped record
 * keys are ordinary data in the returned null-prototype objects. Signed zero becomes zero.
 *
 * Limits bound the expanded copy, not the cost of inspecting a hostile Proxy or
 * allocating all property descriptors. Proxy traps can run during inspection.
 */
export function copy(value: unknown, options: Options = {}): Value {
	const maximumDepth = options.maximumDepth ?? 128;
	const maximumNodes = options.maximumNodes ?? 1_000_000;
	const maximumStringCodeUnits = options.maximumStringCodeUnits ?? 16_777_216;
	if (
		!Number.isSafeInteger(maximumDepth) || maximumDepth < 0 || !Number.isSafeInteger(maximumNodes) ||
		maximumNodes < 1 ||
		!Number.isSafeInteger(maximumStringCodeUnits) || maximumStringCodeUnits < 0
	) {
		throw new TypeError('JSON limits require non-negative depth/string limits and a positive node limit.');
	}
	let nodes = 0;
	let stringCodeUnits = 0;
	/** Count keys as well as values so many long property names cannot bypass the text budget. */
	const string = (value: string): string => {
		stringCodeUnits += value.length;
		if (stringCodeUnits > maximumStringCodeUnits) throw new RangeError('JSON value exceeds maximumStringCodeUnits.');
		return value;
	};
	const ancestors = new WeakSet<object>();
	/** Inspect one occurrence. Ancestors detect cycles without rejecting legitimate repeated references. */
	const visit = (current: unknown, depth: number): Value => {
		if (++nodes > maximumNodes) throw new RangeError('JSON value exceeds maximumNodes.');
		if (typeof current === 'string') return string(current);
		if (current === null || typeof current === 'boolean') return current;
		if (typeof current === 'number') {
			if (!Number.isFinite(current)) throw new TypeError('JSON values require finite numbers.');
			return current === 0 ? 0 : current;
		}
		if (typeof current !== 'object') throw new TypeError('Expected a JSON value.');
		if (depth >= maximumDepth) throw new RangeError('JSON value exceeds maximumDepth.');
		if (ancestors.has(current)) throw new TypeError('JSON values must not contain cycles.');
		if (Object.getOwnPropertySymbols(current).length !== 0) {
			throw new TypeError('JSON values must not contain symbol properties.');
		}
		ancestors.add(current);
		try {
			if (Array.isArray(current)) {
				const descriptors = Object.getOwnPropertyDescriptors(current);
				if (Object.keys(descriptors).length !== current.length + 1) {
					throw new TypeError('JSON arrays must be dense and have no additional properties.');
				}
				const output: Value[] = [];
				for (let index = 0; index < current.length; index++) {
					const descriptor = descriptors[index];
					if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
						throw new TypeError('JSON arrays require own data elements.');
					}
					output.push(visit(descriptor.value, depth + 1));
				}
				return output;
			}
			if (!hasOrdinaryPrototype(current)) {
				throw new TypeError('JSON records must be ordinary data objects.');
			}
			const output: Record<string, Value> = Object.create(null);
			for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
				if (!descriptor.enumerable || !('value' in descriptor)) {
					throw new TypeError('JSON records require enumerable data properties.');
				}
				output[string(key)] = visit(descriptor.value, depth + 1);
			}
			return output;
		} finally {
			// Track the active path, not every object ever seen. The same object in
			// two sibling fields is copied twice; only a reference to an ancestor is a cycle.
			ancestors.delete(current);
		}
	};
	return visit(value, 0);
}

/** Bounded deterministic JSON profile. This is not RFC 8785 or a cryptographic canonicalization claim. */
export interface StringifyOptionsType extends Options {
	/** Maximum encoded UTF-8 output bytes. Required because escaping can expand the validated text. */
	readonly maximumBytes: number;
}

/**
 * Encode finite JSON with lexicographically sorted UTF-16 record keys and JSON.stringify primitive rendering.
 * Signed zero becomes zero; lone surrogates use JSON escaping. Arrays retain order and aliases expand by value.
 * The explicit byte cap covers punctuation and escaping as well as text. No caller object is mutated.
 */
export function stringify(value: unknown, options: StringifyOptionsType): string {
	if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 0) {
		throw new TypeError('maximumBytes must be a non-negative safe integer.');
	}
	const owned = copy(value, options);
	let bytes = 0;
	const chunks: string[] = [];
	const encoder = new TextEncoder();
	/** Account each fragment before retaining it; the joined result never exceeds the chosen byte policy. */
	const append = (part: string): void => {
		bytes += encoder.encode(part).byteLength;
		if (bytes > options.maximumBytes) throw new RangeError('JSON output exceeds maximumBytes.');
		chunks.push(part);
	};
	/** Emit one already-validated subtree; only record keys are sorted, so array position keeps its meaning. */
	const visit = (current: Value): void => {
		if (current === null || typeof current !== 'object') {
			append(JSON.stringify(current));
			return;
		}
		if (Array.isArray(current)) {
			append('[');
			current.forEach((entry, index) => {
				if (index) append(',');
				visit(entry);
			});
			append(']');
			return;
		}
		append('{');
		Object.keys(current).sort().forEach((key, index) => {
			if (index) append(',');
			append(JSON.stringify(key));
			append(':');
			visit((current as Record<string, Value>)[key]!);
		});
		append('}');
	};
	visit(owned);
	return chunks.join('');
}
