import * as recordCore from '@okikio/record';
import type { QueryDefinition, QueryFields, QueryIssue, QueryOrder, QuerySort, QueryValue } from './types.ts';

import { paginationDefinitions } from './pagination.ts';
import { wireOperator } from './values.ts';
import type { QueryExpression } from './expression.ts';
import type { QueryFilter } from './types.ts';
import { authoredFilter, isFilter, normalize } from './normalize.ts';
import { encodeLegacyValue, encodeValue, isTagged } from './value-codec.ts';
import { issue } from './validation.ts';

/**
 * Encodes value into the module's external representation.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function encode<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
	value: QueryValue<Fields>,
	canonical = false,
): URLSearchParams {
	const parameters = new URLSearchParams();
	const filter = authoredFilter(value);
	if (filter !== undefined) {
		const flat = canonical
			? undefined
			: isFilter(filter)
			? [filter]
			: filter.kind === 'all' && filter.filters.every(isFilter)
			? filter.filters
			: undefined;
		const encoded = flat?.map((leaf) => {
			const implicit = leaf.operator === 'eq' || leaf.operator === 'isNull' || leaf.operator === 'isNotNull';
			const name = `filter[${leaf.field}]${implicit ? '' : `[${wireOperator(leaf.operator)}]`}`;
			const raw = leaf.operator === 'isNull'
				? 'null'
				: leaf.operator === 'isNotNull'
				? 'not_null'
				: encodeLegacyValue(leaf.value);
			return [name, raw] as const;
		});
		const forms = new Map<string, number>();
		for (const [name, raw] of encoded ?? []) forms.set(name, (forms.get(name) ?? 0) | (isTagged(raw) ? 1 : 2));
		if (encoded !== undefined && ![...forms.values()].includes(3)) {
			for (const [name, raw] of encoded) parameters.append(name, raw);
		} else appendExpression(filter, 'filter');
	}
	function appendExpression(node: QueryExpression<QueryFilter<Fields>>, name: string): void {
		if (isFilter(node)) {
			parameters.append(
				`${name}[${node.field}][${wireOperator(node.operator)}]`,
				node.operator === 'isNull' || node.operator === 'isNotNull' ? '' : encodeValue(node.value),
			);
		} else if (node.kind === 'not') appendExpression(node.filter, `${name}[$not]`);
		else node.filters.forEach((child, index) => appendExpression(child, `${name}[$${node.kind}][${index}]`));
	}
	if (!sameOrder(value.order, definition.order)) {
		parameters.set('sort', value.order.map((entry) => `${entry.field}:${entry.direction}`).join(','));
	}
	if (value.fields.kind === 'simple') {
		if (!sameStrings(value.fields.fields, definition.defaultFields)) {
			parameters.set('fields', value.fields.fields.join(','));
		}
	} else {
		for (const [resource, fields] of Object.entries(value.fields.resources)) {
			parameters.set(`fields[${resource}]`, fields.join(','));
		}
	}
	const modes = paginationDefinitions(definition.pagination);
	if (value.pagination.kind === 'cursor') {
		const policy = modes.cursor;
		if (!policy) throw new TypeError('Cannot encode cursor pagination for a query that does not support it.');
		if (value.pagination.cursor !== undefined) parameters.set(policy.parameters.cursor, value.pagination.cursor);
		parameters.set(policy.parameters.limit, String(value.pagination.limit));
	} else {
		const policy = modes.offset;
		if (!policy) throw new TypeError('Cannot encode offset pagination for a query that does not support it.');
		if (value.pagination.source === 'page') {
			const page = value.pagination.page ?? Math.floor(value.pagination.offset / value.pagination.limit) + 1;
			parameters.set(policy.parameters.page, String(page));
			parameters.set(policy.parameters.perPage, String(value.pagination.limit));
		} else {
			parameters.set(policy.parameters.offset, String(value.pagination.offset));
			parameters.set(policy.parameters.limit, String(value.pagination.limit));
		}
	}
	return parameters;
}

/**
 * Checks whether order are equivalent for the purposes of provider-neutral query definitions.
 *
 * @internal
 */
export function sameOrder(left: readonly QuerySort[], right: readonly QueryOrder[]): boolean {
	return left.length === right.length && left.every((entry, index) => {
		const candidate = right[index];
		return candidate !== undefined && entry.field === candidate.field && entry.direction === candidate.direction &&
			entry.tiebreaker === candidate.tiebreaker;
	});
}

/**
 * Checks whether strings are equivalent for the purposes of provider-neutral query definitions.
 *
 * @internal
 */
export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * Normalizes input into the canonical internal form used by later phases.
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
	const result = new Map<string, unknown[]>();
	let count = 0;
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

/** Canonical collection URL identity, independent of authored conjunction order. */
export function stringify<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
	value: QueryValue<Fields>,
): string {
	return encode(definition, normalize(value), true).toString();
}
