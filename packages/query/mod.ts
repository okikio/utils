/**
 * Declare an HTTP collection query once and validate its filter, sort, selection and pagination grammar before reaching a database. Parsing strings directly into SQL makes hidden fields, unsupported operators and ambiguous list values easy to accept.
 *
 * Start with flat filters, enable bounded all/any/not groups when the provider supports them, and encode values for lossless URL round trips. The tagged wire codec preserves commas, empty text, bigint, dates and negative zero. normalize() produces canonical query data; it does not run a query. Adapters must explicitly declare capabilities and fail closed for unsupported groups. Preserve opaque cursors with a trusted codec rather than interpreting arbitrary client strings.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as query from '@okikio/query';
 * import { z } from 'zod';
 * const Search = query.define({
 *   fields: { id: query.field(z.string(), { sortable: true }), name: query.field(z.string()) },
 *   filters: { name: [query.eq, query.in] },
 *   order: [query.asc('id', { tiebreaker: true })],
 *   pagination: query.offset({ defaultLimit: 20 }),
 * });
 * const value = await Search.parse(new URLSearchParams('filter[name]=Ada&limit=2'));
 * console.log(value.filters[0]?.field, value.pagination.limit);
 * console.log((await Search.parse(Search.encode(value))).filters[0]?.value);
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
export { inspect, normalize } from './normalize.ts';
export { stringify } from './url.ts';
export { inspectExpression } from './expression.ts';
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
	QueryExpressionLeafPredicate,
	QueryExpressionLeafVisit,
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
	QueryDefinition,
	QueryDefinitionInput,
	QueryDocument,
	QueryExpressionKind,
	QueryField,
	QueryFieldOptions,
	QueryFields,
	QueryFieldSelection,
	QueryFieldsetDefinition,
	QueryFieldsetInput,
	QueryFieldsets,
	QueryFieldValue,
	QueryFilter,
	QueryFilters,
	QueryInspection,
	QueryIssue,
	QueryOperator,
	QueryOperatorName,
	QueryOrder,
	QueryPaginationDefinition,
	QueryPaginationParameters,
	QueryParseResult,
	QueryRequirements,
	QuerySort,
	QuerySortDirection,
	QueryValue,
	ResourceFieldSelection,
	SimpleFieldSelection,
} from './types.ts';
