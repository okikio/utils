import type { CursorPaginationDefinition } from './types.ts';
import type {
	CursorPaginationOptions,
	OffsetPaginationDefinition,
	OffsetPaginationOptions,
	PaginationModesDefinition,
	PaginationModesOptions,
	QueryDefinition,
	QueryFields,
	QueryIssue,
	QueryPaginationDefinition,
	QueryPaginationParameters,
} from './types.ts';
import { hasAny, integer, last, optionalString } from './values.ts';
import { assertParameterName, assertPositiveInteger, issue } from './validation.ts';

/** Define opaque cursor pagination. Cursor verification belongs to a codec resource. */
export function cursor(options: CursorPaginationOptions = {}): CursorPaginationDefinition {
	const definition: CursorPaginationDefinition = Object.freeze({
		kind: 'query-pagination',
		type: 'cursor',
		defaultLimit: options.defaultLimit ?? 50,
		maximumLimit: options.maximumLimit ?? 200,
		minimumLimit: options.minimumLimit ?? 1,
		...(options.ttl !== undefined ? { ttl: options.ttl } : {}),
		parameters: Object.freeze({
			cursor: options.parameters?.cursor ?? 'cursor',
			limit: options.parameters?.limit ?? 'limit',
		}),
	});
	assertCursorPagination(definition);
	return definition;
}

/** Define bounded offset pagination with both offset/limit and page/per_page syntax. */
export function offset(options: OffsetPaginationOptions = {}): OffsetPaginationDefinition {
	const definition: OffsetPaginationDefinition = Object.freeze({
		kind: 'query-pagination',
		type: 'offset',
		defaultLimit: options.defaultLimit ?? 50,
		maximumLimit: options.maximumLimit ?? 200,
		minimumLimit: options.minimumLimit ?? 1,
		maximumOffset: options.maximumOffset ?? 1_000_000,
		defaultStyle: options.defaultStyle ?? 'offset',
		parameters: Object.freeze({
			offset: options.parameters?.offset ?? 'offset',
			limit: options.parameters?.limit ?? 'limit',
			page: options.parameters?.page ?? 'page',
			perPage: options.parameters?.perPage ?? 'per_page',
		}),
	});
	assertOffsetPagination(definition);
	return definition;
}

/** Explicitly enable more than one pagination strategy for an endpoint. */
export function pagination(options: PaginationModesOptions): PaginationModesDefinition {
	if (options.cursor === undefined && options.offset === undefined) {
		throw new TypeError('Pagination modes require a cursor or offset definition.');
	}
	const defaultMode = options.default ?? (options.cursor !== undefined ? 'cursor' : 'offset');
	if (defaultMode === 'cursor' && options.cursor === undefined) {
		throw new TypeError('Cursor cannot be the default when cursor pagination is disabled.');
	}
	if (defaultMode === 'offset' && options.offset === undefined) {
		throw new TypeError('Offset cannot be the default when offset pagination is disabled.');
	}
	if (options.cursor !== undefined) assertCursorPagination(options.cursor);
	if (options.offset !== undefined) assertOffsetPagination(options.offset);
	assertPaginationParameterCompatibility(options.cursor, options.offset);
	return Object.freeze({
		kind: 'query-pagination-modes',
		type: 'modes',
		default: defaultMode,
		...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
		...(options.offset !== undefined ? { offset: options.offset } : {}),
	});
}

/** Return exact query parameter names for request-aware pagination links. */
export function paginationParameters<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
	mode: 'cursor' | 'offset',
): QueryPaginationParameters | undefined {
	const modes = paginationDefinitions(definition.pagination);
	if (mode === 'cursor') {
		const value = modes.cursor;
		return value === undefined ? undefined : Object.freeze({
			cursor: value.parameters.cursor,
			limit: value.parameters.limit,
		});
	}
	const value = modes.offset;
	return value === undefined ? undefined : Object.freeze({
		offset: value.parameters.offset,
		limit: value.parameters.limit,
		page: value.parameters.page,
		perPage: value.parameters.perPage,
	});
}

/**
 * Parses pagination into the validated internal model used by later phases.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function parsePagination(
	definition: QueryPaginationDefinition,
	entries: ReadonlyMap<string, readonly unknown[]>,
	issues: QueryIssue[],
) {
	const modes = paginationDefinitions(definition);
	const cursorDefinition = modes.cursor;
	const offsetDefinition = modes.offset;
	const cursorExplicit = cursorDefinition !== undefined && entries.has(cursorDefinition.parameters.cursor);
	const offsetExplicit = offsetDefinition !== undefined && entries.has(offsetDefinition.parameters.offset);
	const pageExplicit = offsetDefinition !== undefined && entries.has(offsetDefinition.parameters.page);
	const perPageExplicit = offsetDefinition !== undefined && entries.has(offsetDefinition.parameters.perPage);
	const pageModeExplicit = pageExplicit || perPageExplicit;
	const explicitModes = Number(cursorExplicit) + Number(offsetExplicit) + Number(pageModeExplicit);
	if (explicitModes > 1) {
		issues.push(issue('pagination-conflict', 'Cursor, offset, and page pagination cannot be mixed.', ['pagination']));
	}

	const unsupportedCursor = cursorDefinition === undefined && hasAny(entries, ['cursor']);
	const unsupportedOffset = offsetDefinition === undefined && hasAny(entries, ['offset', 'page', 'per_page']);
	if (unsupportedCursor) {
		issues.push(issue('unsupported-pagination', 'Cursor pagination is not supported by this endpoint.', ['cursor']));
	}
	if (unsupportedOffset) {
		issues.push(issue('unsupported-pagination', 'Offset/page pagination is not supported by this endpoint.', ['page']));
	}

	let selected = modes.default;
	if (cursorExplicit) selected = 'cursor';
	else if (offsetExplicit || pageExplicit || perPageExplicit) selected = 'offset';
	if (selected === 'cursor') {
		if (!cursorDefinition) {
			issues.push(issue('unsupported-pagination', 'Cursor pagination is not supported by this endpoint.', ['cursor']));
			return Object.freeze({ kind: 'cursor' as const, limit: 1 });
		}
		const rawCursor = last(entries.get(cursorDefinition.parameters.cursor));
		const cursorValue = optionalString(rawCursor);
		if (cursorExplicit && cursorValue === undefined) {
			issues.push(issue('invalid-cursor', 'Cursor cannot be empty.', [cursorDefinition.parameters.cursor]));
		}
		const limit = parseLimit(
			last(entries.get(cursorDefinition.parameters.limit)),
			cursorDefinition,
			issues,
			cursorDefinition.parameters.limit,
		);
		return Object.freeze({
			kind: 'cursor' as const,
			limit,
			...(cursorValue !== undefined ? { cursor: cursorValue } : {}),
		});
	}

	if (!offsetDefinition) {
		issues.push(issue('unsupported-pagination', 'Offset pagination is not supported by this endpoint.', ['offset']));
		return Object.freeze({ kind: 'offset' as const, limit: 1, offset: 0, source: 'offset' as const });
	}
	const usePage = pageModeExplicit || (!offsetExplicit && offsetDefinition.defaultStyle === 'page');
	if (usePage) {
		if (entries.has(offsetDefinition.parameters.limit)) {
			issues.push(issue(
				'pagination-conflict',
				`Page pagination uses ${offsetDefinition.parameters.perPage}, not ${offsetDefinition.parameters.limit}.`,
				['pagination'],
			));
		}
		const page = integer(last(entries.get(offsetDefinition.parameters.page)) ?? 1);
		if (page === undefined || page < 1) {
			issues.push(issue('invalid-page', 'Page must be a positive integer.', [offsetDefinition.parameters.page]));
		}
		const limit = parseLimit(
			last(entries.get(offsetDefinition.parameters.perPage)),
			offsetDefinition,
			issues,
			offsetDefinition.parameters.perPage,
		);
		const offsetValue = Math.max(0, ((page ?? 1) - 1) * limit);
		if (!Number.isSafeInteger(offsetValue) || offsetValue > offsetDefinition.maximumOffset) {
			issues.push(issue(
				'invalid-offset',
				`Page resolves beyond the maximum offset of ${offsetDefinition.maximumOffset}.`,
				[offsetDefinition.parameters.page],
			));
		}
		return Object.freeze({
			kind: 'offset' as const,
			limit,
			offset: offsetValue,
			source: 'page' as const,
			page: page ?? 1,
		});
	}

	if (entries.has(offsetDefinition.parameters.perPage)) {
		issues.push(issue(
			'pagination-conflict',
			`Offset pagination uses ${offsetDefinition.parameters.limit}, not ${offsetDefinition.parameters.perPage}.`,
			['pagination'],
		));
	}
	const offsetValue = integer(last(entries.get(offsetDefinition.parameters.offset)) ?? 0);
	if (offsetValue === undefined || offsetValue < 0 || offsetValue > offsetDefinition.maximumOffset) {
		issues.push(issue(
			'invalid-offset',
			`Offset must be between 0 and ${offsetDefinition.maximumOffset}.`,
			[offsetDefinition.parameters.offset],
		));
	}
	const limit = parseLimit(
		last(entries.get(offsetDefinition.parameters.limit)),
		offsetDefinition,
		issues,
		offsetDefinition.parameters.limit,
	);
	return Object.freeze({ kind: 'offset' as const, limit, offset: offsetValue ?? 0, source: 'offset' as const });
}

/**
 * Parses limit into the validated internal model used by later phases.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function parseLimit(
	raw: unknown,
	definition: CursorPaginationDefinition | OffsetPaginationDefinition,
	issues: QueryIssue[],
	parameter: string,
): number {
	const value = integer(raw ?? definition.defaultLimit);
	if (value === undefined || value < definition.minimumLimit || value > definition.maximumLimit) {
		issues.push(issue(
			'invalid-limit',
			`Limit must be between ${definition.minimumLimit} and ${definition.maximumLimit}.`,
			[parameter],
		));
	}
	return value ?? definition.defaultLimit;
}

/**
 * Rejects invalid cursor pagination before it can enter authoritative module state.
 *
 * @internal
 */
export function assertCursorPagination(definition: CursorPaginationDefinition): void {
	assertLimits(definition);
	for (const parameter of Object.values(definition.parameters)) assertParameterName(parameter);
	if (definition.parameters.cursor === definition.parameters.limit) {
		throw new TypeError('Cursor and limit parameter names must differ.');
	}
	if (definition.ttl !== undefined && durationMilliseconds(definition.ttl) <= 0) {
		throw new TypeError('Cursor ttl must be positive.');
	}
}

/**
 * Rejects invalid offset pagination before it can enter authoritative module state.
 *
 * @internal
 */
export function assertOffsetPagination(definition: OffsetPaginationDefinition): void {
	assertLimits(definition);
	assertPositiveInteger(definition.maximumOffset, 'maximumOffset', true);
	const names = Object.values(definition.parameters);
	for (const parameter of names) assertParameterName(parameter);
	if (new Set(names).size !== names.length) throw new TypeError('Offset pagination parameter names must be unique.');
}

/**
 * Rejects invalid pagination parameter compatibility before it can enter authoritative module state.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function assertPaginationParameterCompatibility(
	cursorDefinition: CursorPaginationDefinition | undefined,
	offsetDefinition: OffsetPaginationDefinition | undefined,
): void {
	if (!cursorDefinition || !offsetDefinition) return;
	const sharedLimit = cursorDefinition.parameters.limit === offsetDefinition.parameters.limit;
	const cursorName = cursorDefinition.parameters.cursor;
	if (Object.values(offsetDefinition.parameters).includes(cursorName)) {
		throw new TypeError('Cursor parameter name conflicts with offset pagination parameters.');
	}
	if (!sharedLimit && Object.values(offsetDefinition.parameters).includes(cursorDefinition.parameters.limit)) {
		throw new TypeError('Cursor limit parameter conflicts with offset pagination parameters.');
	}
}

/**
 * Rejects invalid limits before it can enter authoritative module state.
 *
 * @internal
 */
export function assertLimits(definition: CursorPaginationDefinition | OffsetPaginationDefinition): void {
	assertPositiveInteger(definition.minimumLimit, 'minimumLimit');
	assertPositiveInteger(definition.defaultLimit, 'defaultLimit');
	assertPositiveInteger(definition.maximumLimit, 'maximumLimit');
	if (definition.minimumLimit > definition.defaultLimit || definition.defaultLimit > definition.maximumLimit) {
		throw new TypeError('Pagination limits must satisfy minimumLimit <= defaultLimit <= maximumLimit.');
	}
}

/**
 * Derives the pagination definitions from the query contract used by provider-neutral query definitions.
 *
 * @internal
 */
export function paginationDefinitions(definition: QueryPaginationDefinition): Readonly<{
	readonly default: 'cursor' | 'offset';
	readonly cursor?: CursorPaginationDefinition;
	readonly offset?: OffsetPaginationDefinition;
}> {
	if (definition.type === 'modes') return definition;
	return definition.type === 'cursor'
		? Object.freeze({ default: 'cursor' as const, cursor: definition })
		: Object.freeze({ default: 'offset' as const, offset: definition });
}

/**
 * Returns the enabled pagination modes derived from the active configuration of provider-neutral query definitions.
 *
 * @internal
 */
export function enabledPaginationModes(definition: QueryPaginationDefinition): ('cursor' | 'offset')[] {
	const modes = paginationDefinitions(definition);
	return [
		...(modes.cursor !== undefined ? ['cursor' as const] : []),
		...(modes.offset !== undefined ? ['offset' as const] : []),
	];
}

/**
 * Derives the pagination wire examples from the query contract used by provider-neutral query definitions.
 *
 * @internal
 */
export function paginationWireExamples(definition: QueryPaginationDefinition): string[] {
	const modes = paginationDefinitions(definition);
	const examples: string[] = [];
	if (modes.cursor) examples.push(`${modes.cursor.parameters.cursor}=opaque&${modes.cursor.parameters.limit}=50`);
	if (modes.offset) {
		examples.push(`${modes.offset.parameters.offset}=40&${modes.offset.parameters.limit}=20`);
		examples.push(`${modes.offset.parameters.page}=3&${modes.offset.parameters.perPage}=20`);
	}
	return examples;
}

/**
 * Converts duration into the millisecond value used by provider-neutral query definitions.
 *
 * @internal
 */
export function durationMilliseconds(
	duration: {
		total(options: { unit: 'milliseconds'; relativeTo: { year: number; month: number; day: number } }): number;
	},
): number {
	return duration.total({ unit: 'milliseconds', relativeTo: { year: 2000, month: 1, day: 1 } } as const);
}
