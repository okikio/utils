import { inspectExpression } from './expression.ts';
import type { QueryBooleanExpression, QueryExpression } from './expression.ts';
import type { QueryFields, QueryFilter, QueryInspection, QueryValue } from './types.ts';
import { encodeValue } from './value-codec.ts';

/** Distinguish a validated field condition from a Boolean node by its field discriminant. */
export function isFilter<Fields extends QueryFields>(
	value: QueryExpression<QueryFilter<Fields>>,
): value is QueryFilter<Fields> {
	return 'field' in value;
}

/** Preserve the conjunction view without ever flattening ANY or NOT. */
export function conjunction<Fields extends QueryFields>(
	value: QueryExpression<QueryFilter<Fields>> | undefined,
): readonly QueryFilter<Fields>[] | undefined {
	if (value === undefined) return Object.freeze([]);
	if (isFilter(value)) return Object.freeze([value]);
	if (value.kind !== 'all') return undefined;
	const result: QueryFilter<Fields>[] = [];
	for (const child of value.filters) {
		const leaves = conjunction(child);
		if (leaves === undefined) return undefined;
		result.push(...leaves);
	}
	return Object.freeze(result);
}

/** Read the original expression without canonicalizing or flattening its groups. */
export function authoredFilter<Fields extends QueryFields>(
	value: QueryValue<Fields>,
): QueryExpression<QueryFilter<Fields>> | undefined {
	return value.filter;
}

/** Create one immutable query value with one explicit expression representation. */
export function withFilter<Fields extends QueryFields>(
	filter: QueryExpression<QueryFilter<Fields>> | undefined,
	rest: Omit<QueryValue<Fields>, 'filter'>,
): QueryValue<Fields> {
	return Object.freeze({ ...(filter === undefined ? {} : { filter }), ...rest });
}

/** Canonical semantics; the input's authored expression and field order stay intact. */
export function normalize<Fields extends QueryFields>(value: QueryValue<Fields>): QueryValue<Fields> {
	const authored = authoredFilter(value);
	const filter = authored === undefined ? undefined : normalizeFilter(authored);
	const fields = value.fields.kind === 'simple'
		? Object.freeze({ kind: 'simple' as const, fields: Object.freeze([...new Set(value.fields.fields)].sort(compare)) })
		: Object.freeze({
			kind: 'resource' as const,
			resources: Object.freeze(
				Object.fromEntries(
					Object.entries(value.fields.resources).sort(([a], [b]) => compare(a, b)).map(
						([name, fields]) => [name, Object.freeze([...new Set(fields)].sort(compare))],
					),
				),
			),
		});
	return withFilter(filter, {
		order: Object.freeze(value.order.map((entry) => Object.freeze({ ...entry }))),
		fields,
		pagination: Object.freeze(
			value.pagination.kind === 'offset'
				? {
					kind: 'offset' as const,
					limit: value.pagination.limit,
					offset: value.pagination.offset,
					source: 'offset' as const,
				}
				: { ...value.pagination },
		),
	});
}

/** Inspect authored order and a separate normalized projection. */
export function inspect<Fields extends QueryFields>(value: QueryValue<Fields>): QueryInspection<Fields> {
	const filter = authoredFilter(value);
	return Object.freeze({
		...(filter === undefined ? {} : { filter }),
		normalized: normalize(value),
		expression: filter === undefined
			? Object.freeze({ maximumDepth: 0, leafCount: 0, maximumSiblings: 0 })
			: inspectExpression(filter, isFilter<Fields>),
	});
}

/** Canonicalize commutative groups and membership values while retaining NOT and typed scalar identity. */
function normalizeFilter<Fields extends QueryFields>(
	value: QueryExpression<QueryFilter<Fields>>,
): QueryExpression<QueryFilter<Fields>> {
	if (isFilter(value)) {
		if (value.operator !== 'in' && value.operator !== 'nin') return Object.freeze({ ...value }) as QueryFilter<Fields>;
		const values = value.value as readonly unknown[];
		const unique = new Map(values.map((entry) => [encodeValue(entry), entry]));
		return Object.freeze({
			...value,
			value: Object.freeze([...unique].sort(([a], [b]) => compare(a, b)).map(([, entry]) => entry)),
		}) as QueryFilter<Fields>;
	}
	if (value.kind === 'not') {
		const child = normalizeFilter(value.filter);
		return !isFilter(child) && child.kind === 'not' ? child.filter : Object.freeze({ kind: 'not', filter: child });
	}
	const children = value.filters.flatMap((child) => {
		const result = normalizeFilter(child);
		return !isFilter(result) && result.kind === value.kind ? result.filters : [result];
	});
	const unique = new Map(children.map((child) => [expressionKey(child), child]));
	const filters = Object.freeze([...unique].sort(([a], [b]) => compare(a, b)).map(([, child]) => child));
	return filters.length === 1 ? filters[0]! : Object.freeze({ kind: value.kind, filters });
}

/** Encode unambiguous typed identity for deduplication; author order remains in the original tree. */
function expressionKey<Fields extends QueryFields>(value: QueryExpression<QueryFilter<Fields>>): string {
	if (isFilter(value)) {
		return JSON.stringify([value.field, value.operator, value.value === undefined ? '' : encodeValue(value.value)]);
	}
	const node: QueryBooleanExpression<QueryFilter<Fields>> = value;
	return node.kind === 'not'
		? JSON.stringify(['not', expressionKey(node.filter)])
		: JSON.stringify([node.kind, node.filters.map(expressionKey)]);
}

/** Compare canonical text by code units, independent of machine locale. */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
