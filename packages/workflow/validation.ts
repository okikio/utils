import * as schema from '@okikio/schema';
/** Small readers for the workflow's fixed wire format. This is internal validation, not a public schema language. @module */
import * as record from '@okikio/collection/record';

/** Read plain data and reject fields not declared by this version of a wire record. */
export function object(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
	if (!record.is(value)) schema.reject('Expected plain workflow data.');
	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) schema.reject(`Unknown workflow field ${key}.`);
	}
	return value;
}
/** Require uncoerced text within its declared length bounds. */
export function text(value: unknown, minimum = 0, maximum = Infinity): string {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
		schema.reject(`Expected text with ${minimum}..${maximum} characters.`);
	}
	return value;
}
/** Require a safe whole number in the inclusive range. */
export function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		schema.reject(`Expected a safe integer in ${minimum}..${maximum}.`);
	}
	return value;
}
/** Return one explicitly allowed string without coercion. */
export function choice<const Choices extends readonly string[]>(value: unknown, choices: Choices): Choices[number] {
	if (typeof value !== 'string' || !choices.includes(value)) {
		schema.reject(`Expected one of ${choices.join(', ')}.`);
	}
	return value;
}
/** Validate a bounded array and snapshot its items through the supplied reader. */
export function list<Value>(value: unknown, read: (value: unknown) => Value, maximum = Infinity, minimum = 0): Value[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		schema.reject(`Expected ${minimum}..${maximum} array items.`);
	}
	return Array.from(value, read);
}
/** Accept RFC 9562 UUIDs, including the special nil and maximum values. */
export function uuid(value: unknown): string {
	const result = text(value);
	if (
		!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i
			.test(result)
	) {
		schema.reject('Expected a UUID.');
	}
	return result;
}
