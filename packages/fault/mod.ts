/**
 * Bounded diagnostic projection for arbitrary runtime faults.
 *
 * The utility converts unknown thrown values to cloneable JSON-safe data. It is
 * intentionally separate from `@okikio/failure`, whose definitions represent
 * expected domain failures with stable durable identity.
 *
 * @module
 */
import * as record from '@okikio/record';

import type { FaultValue, Options } from './types.ts';

/** Normalized internal limits used by one fault projection. @internal */
interface Limits {
	readonly maximumDepth: number;
	readonly maximumEntries: number;
	readonly maximumStringLength: number;
	readonly includeStack: boolean;
}

/** Convert arbitrary runtime fault data to a bounded JSON-safe diagnostic value. */
export function encode(value: unknown, options: Options = {}): FaultValue {
	const limits = normalize(options);
	return visit(value, 0, new WeakSet<object>(), limits);
}

/** Return one bounded human-readable message without invoking caller-defined object coercion. */
export function message(value: unknown, options: Options = {}): string {
	const limits = normalize(options, false);
	const diagnostic = visit(value, 0, new WeakSet<object>(), limits);
	if (typeof diagnostic === 'string') return text(diagnostic, limits.maximumStringLength);
	if (isRecord(diagnostic)) {
		const candidate = diagnostic.message;
		if (typeof candidate === 'string' && candidate.length > 0) return text(candidate, limits.maximumStringLength);
		const name = diagnostic.name;
		if (typeof name === 'string' && name.length > 0) return text(name, limits.maximumStringLength);
	}
	const serialized = JSON.stringify(diagnostic);
	return text(serialized ?? '[unknown]', limits.maximumStringLength);
}

/** Return whether a projected diagnostic value is a record rather than an array or primitive. */
export function isRecord(value: FaultValue): value is import('./types.ts').FaultRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize caller limits once before recursive projection begins. @internal */
function normalize(options: Options, includeStackOverride?: boolean): Limits {
	record.assert(options, 'fault options');
	if (options.includeStack !== undefined && typeof options.includeStack !== 'boolean') {
		throw new TypeError('includeStack must be a boolean.');
	}
	return Object.freeze({
		maximumDepth: nonNegative(options.maximumDepth ?? 6, 'maximumDepth'),
		maximumEntries: nonNegative(options.maximumEntries ?? 32, 'maximumEntries'),
		maximumStringLength: nonNegative(options.maximumStringLength ?? 4096, 'maximumStringLength'),
		includeStack: includeStackOverride ?? options.includeStack ?? true,
	});
}

/** Reject invalid limits before they can control recursive work. @internal */
function nonNegative(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer.`);
	return value;
}

/** Project one value without allowing cycles, accessors, or custom objects to execute behavior. @internal */
function visit(value: unknown, depth: number, path: WeakSet<object>, limits: Limits): FaultValue {
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') return text(value, limits.maximumStringLength);
	if (typeof value === 'number') return Number.isFinite(value) ? value : marker(String(value));
	if (typeof value === 'bigint') return `${value}n`;
	if (value === undefined) return marker('undefined');
	if (typeof value === 'symbol') return marker('symbol');
	if (typeof value === 'function') return marker('function');
	if (typeof value !== 'object') return marker('unknown');
	if (depth >= limits.maximumDepth) return marker('maximum-depth');
	if (path.has(value)) return marker('circular');

	path.add(value);
	try {
		if (value instanceof Error) return errorValue(value, depth, path, limits);
		if (Array.isArray(value)) return arrayValue(value, depth, path, limits);
		return recordValue(value, depth, path, limits);
	} catch {
		return marker('uninspectable');
	} finally {
		path.delete(value);
	}
}

/** Project one Error using own data descriptors instead of potentially overridden getters. @internal */
function errorValue(value: Error, depth: number, path: WeakSet<object>, limits: Limits): FaultValue {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const output: Record<string, FaultValue> = Object.create(null);
	output.name = stringDescriptor(descriptors.name) ?? 'Error';
	output.message = text(stringDescriptor(descriptors.message) ?? '', limits.maximumStringLength);
	if (limits.includeStack) {
		const stack = stringDescriptor(descriptors.stack);
		if (stack !== undefined) output.stack = text(stack, limits.maximumStringLength);
	}
	const cause = dataDescriptor(descriptors.cause);
	if (cause.found) output.cause = visit(cause.value, depth + 1, path, limits);

	const keys = Object.keys(descriptors).filter((key) => !['name', 'message', 'stack', 'cause'].includes(key)).sort();
	for (const key of keys.slice(0, limits.maximumEntries)) {
		const descriptor = descriptors[key];
		if (descriptor === undefined || !descriptor.enumerable) continue;
		output[key] = 'value' in descriptor ? visit(descriptor.value, depth + 1, path, limits) : marker('accessor');
	}
	return Object.freeze(output);
}

/** Project an array through own element descriptors so accessors are never invoked. @internal */
function arrayValue(value: readonly unknown[], depth: number, path: WeakSet<object>, limits: Limits): FaultValue {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const rawLength = lengthDescriptor !== undefined && 'value' in lengthDescriptor && typeof lengthDescriptor.value === 'number'
		? lengthDescriptor.value
		: 0;
	const length = Number.isSafeInteger(rawLength) && rawLength > 0 ? rawLength : 0;
	const count = Math.min(length, limits.maximumEntries);
	const output: FaultValue[] = [];
	for (let index = 0; index < count; index++) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined) output.push(marker('empty'));
		else if ('value' in descriptor) output.push(visit(descriptor.value, depth + 1, path, limits));
		else output.push(marker('accessor'));
	}
	return Object.freeze(output);
}

/** Project only ordinary object data properties; custom objects become a stable marker. @internal */
function recordValue(value: object, depth: number, path: WeakSet<object>, limits: Limits): FaultValue {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return marker('object');
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const output: Record<string, FaultValue> = Object.create(null);
	const keys = Object.keys(descriptors).sort();
	let accepted = 0;
	for (const key of keys) {
		if (accepted >= limits.maximumEntries) break;
		const descriptor = descriptors[key];
		if (descriptor === undefined || !descriptor.enumerable) continue;
		output[key] = 'value' in descriptor ? visit(descriptor.value, depth + 1, path, limits) : marker('accessor');
		accepted++;
	}
	return Object.freeze(output);
}

/** Return an own string data descriptor without invoking property access. @internal */
function stringDescriptor(descriptor: PropertyDescriptor | undefined): string | undefined {
	return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
}

/** Return one own data descriptor as an explicit found/value pair. @internal */
function dataDescriptor(descriptor: PropertyDescriptor | undefined): Readonly<{ found: boolean; value?: unknown }> {
	return descriptor !== undefined && 'value' in descriptor
		? Object.freeze({ found: true, value: descriptor.value })
		: Object.freeze({ found: false });
}

/** Bound one diagnostic string without allowing one fault to dominate transport size. @internal */
function text(value: string, maximum: number): string {
	if (value.length <= maximum) return value;
	if (maximum === 0) return '';
	return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

/** Build a small stable diagnostic marker without inspecting the source value further. @internal */
function marker(name: string): string {
	return `[${name}]`;
}

export type { FaultArray, FaultRecord, FaultValue, Options } from './types.ts';
