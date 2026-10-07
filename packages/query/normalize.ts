import { inspectExpression } from './expression.ts';
import type { QueryBooleanExpression, QueryExpression } from './expression.ts';
import type { QueryFields, QueryFilter, QueryInspection, QueryValue } from './types.ts';
import { encodeValue } from './value-codec.ts';

export function isFilter<Fields extends QueryFields>(
	value: QueryExpression<QueryFilter<Fields>>,
): value is QueryFilter<Fields> {
	return 'field' in value;
}

/** Preserve the conjunction view without ever flattening ANY or NOT. */
export function conjunction<Fields extends QueryFields>(
	value: QueryExpression<QueryFilter<Fields>>,
): readonly QueryFilter<Fields>[] | undefined {
	if (isFilter(value)) return [value];
	if (value.kind !== 'all') return undefined;
	const result: QueryFilter<Fields>[] = [];
	for (const child of value.filters) {
		const leaves = conjunction(child);
		if (leaves === undefined) return undefined;
		result.push(...leaves);
	}
	return result;
}

export function authoredFilter<Fields extends QueryFields>(
	value: QueryValue<Fields>,
): QueryExpression<QueryFilter<Fields>> | undefined {
	return value.filter ?? (value.filters.length === 0 ? undefined : { kind: 'all', filters: value.filters });
}

/** Create a parsed value whose legacy adapter view fails closed on richer trees. */
export function withFilter<Fields extends QueryFields>(
	filter: QueryExpression<QueryFilter<Fields>> | undefined,
	rest: Omit<QueryValue<Fields>, 'filter' | 'filters'>,
): QueryValue<Fields> {
	const leaves = filter === undefined ? [] : conjunction(filter);
	if (leaves !== undefined) {
		return Object.freeze({
			...(filter === undefined ? {} : { filter }),
			filters: Object.freeze([...leaves]),
			...rest,
		});
	}
	// Non-enumerable keeps an expression value JSON-safe while explicit legacy
	// adapter access fails instead of silently changing ANY/NOT into conjunction.
	return Object.freeze(Object.defineProperty({ filter, ...rest }, 'filters', {
		get() {
			throw new TypeError('This query contains ANY/NOT. Use an expression-capable adapter and value.filter.');
		},
	})) as QueryValue<Fields>;
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

function normalizeFilter<Fields extends QueryFields>(
	value: QueryExpression<QueryFilter<Fields>>,
): QueryExpression<QueryFilter<Fields>> {
	if (isFilter(value)) {
		if (value.operator !== 'in' && value.operator !== 'nin') return Object.freeze({ ...value });
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

function expressionKey<Fields extends QueryFields>(value: QueryExpression<QueryFilter<Fields>>): string {
	if (isFilter(value)) {
		return JSON.stringify([value.field, value.operator, value.value === undefined ? '' : encodeValue(value.value)]);
	}
	const node: QueryBooleanExpression<QueryFilter<Fields>> = value;
	return node.kind === 'not'
		? JSON.stringify(['not', expressionKey(node.filter)])
		: JSON.stringify([node.kind, node.filters.map(expressionKey)]);
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
