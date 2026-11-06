/**
 * Declare which fields a client may filter, sort, or select before a storage adapter receives the request.
 * A request for an unknown field fails during parsing rather than reaching the database.
 *
 * Start with flat filters. Enable bounded all/any/not groups only when the provider supports them.
 * normalize() produces canonical query data; it does not run a search.
 *
 * Adapters declare supported features. A trusted cursor codec checks continuation tokens before storage
 * uses them. Encoding preserves distinctions such as an empty string, a literal comma, bigint, and
 * negative zero.
 *
 * @example
 * ```ts
 * import * as query from '@okikio/query';
 * import * as schema from '@okikio/schema';
 * const Search = query.define({
 * 	fields: { id: query.field(schema.string(), { sortable: true }), name: query.field(schema.string()) },
 * 	filters: { name: [query.eq, query.in] },
 * 	order: [query.asc('id', { tiebreaker: true })],
 * 	pagination: query.offset({ defaultLimit: 20 }),
 * });
 * const value = await Search.parse(new URLSearchParams('filter[name]=Ada&limit=2'));
 * console.log(query.conjunction(value.filter)?.[0]?.field, value.pagination.limit);
 * console.log(query.conjunction((await Search.parse(Search.encode(value))).filter)?.[0]?.value);
 * ```
 *
 * @module
 */
export { define, is } from './definition.ts';
export { field } from './fields.ts';
export { asc, desc } from './sort.ts';
export { cursor, offset, pagination, paginationParameters } from './pagination.ts';
export { document, requirements, validateAdapter } from './description.ts';
export { QueryValidationError } from './validation.ts';
export { conjunction, inspect, normalize } from './normalize.ts';
export { stringify } from './url.ts';
export { all, any, inspectExpression, not } from './expression.ts';
export {
	between,
	contains,
	endsWith,
	eq,
	gt,
	gte,
	icontains,
	inArray,
	inArray as in,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	nin,
	notInArray,
	startsWith,
} from './operators.ts';
export type {
	QueryBooleanExpression,
	QueryExpression,
	QueryExpressionInspection,
	QueryExpressionLeaf,
	QueryExpressionLeafPredicate,
	QueryExpressionLeafVisit,
	QueryExpressionLimits,
	QueryExpressionPath,
} from './expression.ts';
export type {
	CursorCodec,
	CursorPagination,
	CursorPaginationDefinition,
	CursorPaginationOptions,
	CursorPaginationParameters,
	OffsetPagination,
	OffsetPaginationDefinition,
	OffsetPaginationOptions,
	OffsetPaginationParameters,
	PaginationModesDefinition,
	PaginationModesOptions,
	QueryAdapterCapabilities,
	QueryAdapterIssue,
	QueryAdapterValidationResult,
	QueryAllowedOperator,
	QueryCondition,
	QueryDefinition,
	QueryDefinitionInput,
	QueryDocument,
	QueryExpressionKind,
	QueryField,
	QueryFieldInput,
	QueryFieldOptions,
	QueryFields,
	QueryFieldSelection,
	QueryFieldsetDefinition,
	QueryFieldsetInput,
	QueryFieldsets,
	QueryFieldValue,
	QueryFilter,
	QueryFilters,
	QueryInput,
	QueryInputFilter,
	QueryInspection,
	QueryIssue,
	QueryOperandArguments,
	QueryOperator,
	QueryOperatorName,
	QueryOrder,
	QueryPageInput,
	QueryPaginationDefinition,
	QueryPaginationParameters,
	QueryParseResult,
	QueryPolicy,
	QueryRequirements,
	QuerySort,
	QuerySortDirection,
	QueryValue,
	ResourceFieldSelection,
	SimpleFieldSelection,
} from './types.ts';
