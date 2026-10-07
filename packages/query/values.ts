import type { QueryOperatorName } from './types.ts';

/**
 * Maps the wire operator into the representation understood by provider-neutral query definitions.
 *
 * @internal
 */
export function wireOperator(operator: QueryOperatorName): string {
	if (operator === 'startsWith') return 'startswith';
	if (operator === 'endsWith') return 'endswith';
	if (operator === 'isNull') return 'is_null';
	if (operator === 'isNotNull') return 'is_not_null';
	return operator;
}

/**
 * Maps the implicit operator into the representation understood by provider-neutral query definitions.
 *
 * @internal
 */
export function implicitOperator(value: unknown): QueryOperatorName {
	if (value === 'null') return 'isNull';
	if (value === 'not_null') return 'isNotNull';
	return 'eq';
}

/**
 * Returns the scalar values consumed by provider-neutral query definitions.
 *
 * @internal
 */
export function scalarValues(value: unknown): unknown[] {
	if (Array.isArray(value)) return value.flatMap(scalarValues);
	return value === undefined ? [] : [value];
}

/**
 * Returns the list values consumed by provider-neutral query definitions.
 *
 * @internal
 */
export function listValues(value: unknown): unknown[] {
	if (Array.isArray(value)) return value.flatMap(listValues);
	if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
	return value === undefined ? [] : [value];
}

/**
 * Validates integer before it is used by provider-neutral query definitions.
 *
 * @internal
 */
export function integer(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
	if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Normalizes the optional string while preserving absence as `undefined` for provider-neutral query definitions.
 *
 * @internal
 */
export function optionalString(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	return typeof value === 'string' ? value : undefined;
}

/**
 * Generates the unique strings without colliding with identities already owned by provider-neutral query definitions.
 *
 * @internal
 */
export function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/**
 * Checks whether any is present for provider-neutral query definitions.
 *
 * @internal
 */
export function hasAny(entries: ReadonlyMap<string, readonly unknown[]>, names: readonly string[]): boolean {
	return names.some((name) => entries.has(name));
}

/**
 * Returns the last available value required by provider-neutral query definitions, or absence when the collection is empty.
 *
 * @internal
 */
export function last(values: readonly unknown[] | undefined): unknown {
	return values?.at(-1);
}
