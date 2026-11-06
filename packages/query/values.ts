import type { QueryOperatorName } from './types.ts';

/**
 * Choose the public lowercase URL spelling for operators whose internal names use camel case.
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
 * Interpret legacy null/not_null tokens; tagged strings bypass this inference and remain literal values.
 *
 * @internal
 */
export function implicitOperator(value: unknown): QueryOperatorName {
	if (value === 'null') return 'isNull';
	if (value === 'not_null') return 'isNotNull';
	return 'eq';
}

/**
 * Flatten operand containers without comma splitting; undefined means no supplied operand.
 *
 * @internal
 */
export function scalarValues(value: unknown): unknown[] {
	if (Array.isArray(value)) return value.flatMap(scalarValues);
	return value === undefined ? [] : [value];
}

/**
 * Read legacy comma lists with trimming and blank omission; typed lists use scalarValues to preserve literal text.
 *
 * @internal
 */
export function listValues(value: unknown): unknown[] {
	if (Array.isArray(value)) return value.flatMap(listValues);
	if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
	return value === undefined ? [] : [value];
}

/**
 * Accept only safe integer numbers or decimal integer text for page arithmetic.
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
 * Treat absent, null, empty, or non-string cursor input as missing; explicit presence is checked by the caller.
 *
 * @internal
 */
export function optionalString(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	return typeof value === 'string' ? value : undefined;
}

/**
 * Deduplicate selected names in first-occurrence order without sorting authored presentation.
 *
 * @internal
 */
export function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/**
 * Detect explicit mode parameters by presence, even when their value is empty or invalid.
 *
 * @internal
 */
export function hasAny(entries: ReadonlyMap<string, readonly unknown[]>, names: readonly string[]): boolean {
	return names.some((name) => entries.has(name));
}

/**
 * Use the final repeated scalar parameter; an absent or empty collection has no value.
 *
 * @internal
 */
export function last(values: readonly unknown[] | undefined): unknown {
	return values?.at(-1);
}
