import * as recordCore from '@okikio/collection/record';
import type { QueryIssue } from './types.ts';
import { encodeValue, isTagged } from './value-codec.ts';
import { issue } from './validation.ts';

/**
 * Flatten URL parameters or plain wire records into repeated-name entries before asynchronous field validation.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function normalizeInput(
	input: unknown,
	issues: QueryIssue[],
	maximumParameters = 200,
	maximumDepth = 8,
): ReadonlyMap<string, readonly unknown[]> {
	if (input instanceof URL) input = input.searchParams;
	const result = new Map<string, unknown[]>();
	let count = 0;
	/** Retain one over-budget witness so callers can reject without collecting the rest of the input. */
	const add = (key: string, value: unknown): void => {
		count++;
		if (count > maximumParameters + 1) return;
		const values = result.get(key) ?? [];
		values.push(value);
		result.set(key, values);
	};
	if (input instanceof URLSearchParams) {
		for (const [key, value] of input) {
			add(key, value);
			if (count > maximumParameters) break;
		}
		return result;
	}
	if (!recordCore.is(input)) {
		issues.push(issue('invalid-input', 'A query must be a URLSearchParams or plain data record.', []));
		return result;
	}
	/** Read bounded own slots only; sparse/accessor arrays cannot execute code while supplying query operands. */
	function array(value: unknown[], path: readonly PropertyKey[]): unknown[] | undefined {
		if (Object.getPrototypeOf(value) !== Array.prototype || value.length > maximumParameters) {
			issues.push(issue('invalid-input', 'Query arrays must be bounded plain data arrays.', path));
			return undefined;
		}
		const copied: unknown[] = [];
		for (let index = 0; index < value.length; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (descriptor === undefined || !('value' in descriptor)) {
				issues.push(issue('invalid-input', 'Query arrays must use own data properties.', [...path, index]));
				return undefined;
			}
			if (Array.isArray(descriptor.value)) {
				issues.push(issue('invalid-input', 'Nested scalar arrays are not supported.', [...path, index]));
				return undefined;
			}
			copied.push(descriptor.value);
		}
		return copied;
	}
	/** Lower plain nested records to bracket names while charging depth and shared parameter admission. */
	function filterRecord(value: unknown, prefix: string, path: readonly PropertyKey[], depth: number): void {
		if (depth > maximumDepth) {
			issues.push(issue('expression-too-deep', `Filter depth may not exceed ${maximumDepth}.`, path));
			return;
		}
		if (!recordCore.is(value)) {
			issues.push(issue('invalid-input', 'Filter conditions must use plain data records.', path));
			return;
		}
		const entries = recordCore.entries(value, 'query filter input');
		if (entries.length === 0 && prefix !== 'filter') {
			add(prefix, undefined);
			return;
		}
		for (const [name, nested] of entries) {
			const next = `${prefix}[${name}]`;
			const nextPath = [...path, name];
			if (name === '$all' || name === '$any') {
				if (!Array.isArray(nested)) {
					issues.push(issue('invalid-expression', `${name} requires an array of conditions.`, nextPath));
					continue;
				}
				const children = array(nested, nextPath);
				if (children === undefined) continue;
				if (children.length === 0) add(next, undefined);
				children.forEach((child, index) => filterRecord(child, `${next}[${index}]`, [...nextPath, index], depth + 1));
			} else if (name === '$not') filterRecord(nested, next, nextPath, depth + 1);
			else if (recordCore.is(nested)) {
				const operators = recordCore.entries(nested, `query filter ${name}`);
				if (operators.length === 0) {
					issues.push(issue('invalid-expression', 'A filter field requires a value or operator.', nextPath));
					continue;
				}
				for (const [operator, raw] of operators) {
					const copied = Array.isArray(raw) ? array(raw, [...nextPath, operator]) : raw;
					if (Array.isArray(raw) && copied === undefined) continue;
					add(`${next}[${operator}]`, isTagged(copied) ? encodeValue(copied) : copied);
				}
			} else if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
				issues.push(issue('invalid-input', `filter ${name} must use plain data properties.`, nextPath));
			} else {
				const copied = Array.isArray(nested) ? array(nested, nextPath) : nested;
				if (Array.isArray(nested) && copied === undefined) continue;
				add(next, isTagged(copied) ? encodeValue(copied) : copied);
			}
			if (count > maximumParameters) break;
		}
	}
	for (const [key, value] of recordCore.entries(input, 'query input')) {
		if (key === 'filter') {
			filterRecord(value, 'filter', ['filter'], 1);
			continue;
		}
		if (key === 'fields' && recordCore.is(value)) {
			for (const [resource, nested] of recordCore.entries(value, 'query fields input')) {
				const copied = Array.isArray(nested) ? array(nested, ['fields', resource]) : nested;
				if (Array.isArray(nested) && copied === undefined) continue;
				add(`fields[${resource}]`, copied);
			}
			continue;
		}
		if (key === 'fields' && typeof value !== 'string' && !Array.isArray(value)) {
			issues.push(
				issue('invalid-input', 'fields must be a string, an array of strings, or a plain data record.', ['fields']),
			);
			continue;
		}
		if (key === 'pagination') {
			if (!recordCore.is(value)) {
				issues.push(issue('invalid-input', 'pagination must be a plain data record.', ['pagination']));
				continue;
			}
			for (const [name, nested] of recordCore.entries(value, 'query pagination input')) add(name, nested);
			continue;
		}
		if (Array.isArray(value)) {
			const copied = array(value, [key]);
			if (copied !== undefined) { for (const item of copied) add(key, item); }
		} else add(key, value);
		if (count > maximumParameters) break;
	}
	return result;
}
