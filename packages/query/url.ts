import type { QueryFields, QueryOrder, QueryPolicy, QuerySort, QueryValue } from './types.ts';

import { encode as encodePage } from './page.ts';
import { wireOperator } from './values.ts';
import type { QueryExpression } from './expression.ts';
import type { QueryFilter } from './types.ts';
import { authoredFilter, isFilter, normalize } from './normalize.ts';
import { encodeLegacyValue, encodeValue, isTagged } from './value-codec.ts';

/**
 * Encode a checked query as URL parameters while preserving authored filter order,
 * literal values, sort priority, field selection, and page style. Pass only values
 * produced by parse() or create(); encoding does not rerun field schemas.
 * Pagination is checked against the policy before a link is returned.
 */
export function encode<Fields extends QueryFields>(
	definition: QueryPolicy<Fields>,
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
				: encodeLegacyValue(operand(leaf));
			return [name, raw] as const;
		});
		const forms = new Map<string, number>();
		for (const [name, raw] of encoded ?? []) forms.set(name, (forms.get(name) ?? 0) | (isTagged(raw) ? 1 : 2));
		if (encoded !== undefined && ![...forms.values()].includes(3)) {
			for (const [name, raw] of encoded) parameters.append(name, raw);
		} else appendExpression(filter, 'filter');
	}
	/** Explicit indices retain authored sibling order and typed payloads avoid implicit null/list interpretation. */
	function appendExpression(node: QueryExpression<QueryFilter<Fields>>, name: string): void {
		if (isFilter(node)) {
			parameters.append(
				`${name}[${node.field}][${wireOperator(node.operator)}]`,
				node.operator === 'isNull' || node.operator === 'isNotNull' ? '' : encodeValue(operand(node)),
			);
		} else if (node.kind === 'not') appendExpression(node.filter, `${name}[$not]`);
		else node.filters.forEach((child, index) => appendExpression(child, `${name}[$${node.kind}][${index}]`));
	}
	/** A field owns the inverse of its transformation; the URL codec owns scalar escaping. */
	function operand(leaf: QueryFilter<Fields>): unknown {
		const encoder = definition.fields[leaf.field]?.encode;
		if (encoder === undefined) return leaf.value;
		/** URL encoding is synchronous; observe a rejected async inverse before refusing its result. */
		const write = (value: unknown): unknown => {
			const result = encoder(value);
			if (
				result !== null && (typeof result === 'object' || typeof result === 'function') &&
				typeof (result as { then?: unknown }).then === 'function'
			) {
				void Promise.resolve(result).catch(() => undefined);
				throw new TypeError('Query field encoders must return synchronously.');
			}
			return result;
		};
		return leaf.operator === 'in' || leaf.operator === 'nin' || leaf.operator === 'between'
			? leaf.value.map(write)
			: write(leaf.value);
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
	for (const [name, entry] of encodePage(definition.pagination, value.pagination)) parameters.set(name, entry);
	return parameters;
}

/**
 * Compare complete sort priority and tiebreaker flags before omitting a default order from a URL.
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
 * Compare selection order exactly before omitting default fields from an authored URL.
 *
 * @internal
 */
export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/** Canonical collection URL identity, independent of authored conjunction order. */
export function stringify<Fields extends QueryFields>(
	definition: QueryPolicy<Fields>,
	value: QueryValue<Fields>,
): string {
	return encode(definition, normalize(value), true).toString();
}
