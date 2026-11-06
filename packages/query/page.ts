/**
 * Parse and encode bounded pages without declaring searchable fields.
 *
 * Use offset() for page/offset controls or cursor() for an opaque continuation
 * token. These functions validate counts and parameter conflicts; a trusted
 * cursor codec still owns token verification and expiry enforcement.
 *
 * @example Read a UI page and create its next link
 * ```ts
 * import { offset, parse, encode } from '@okikio/query/pagination';
 * const policy = offset({ defaultLimit: 20, maximumLimit: 100 });
 * const page = parse(policy, new URLSearchParams('page=2&per_page=20'));
 * if (page.kind !== 'offset') throw new Error('Expected offset pagination.');
 * console.log(page.offset); // 20
 * console.log(encode(policy, { ...page, offset: 40, source: 'page', page: 3 }).toString()); // page=3&per_page=20
 * ```
 *
 * @module
 */
import * as record from '@okikio/collection/record';
import { paginationDefinitions, parsePagination } from './pagination.ts';
import { normalizeInput } from './wire.ts';
import { failure, issue, QueryValidationError } from './validation.ts';
import type {
	CursorPagination,
	OffsetPagination,
	QueryIssue,
	QueryPaginationDefinition,
	QueryParseResult,
} from './types.ts';

/** Wire-input resource limit for standalone page parsing. */
export interface PaginationParseOptions {
	/** Maximum parameters, counting repeated names separately. Unrelated names count but are ignored semantically. @default 32 */
	readonly maximumParameters?: number;
}

/**
 * Validate URL parameters or a plain parameter record and return one page.
 * Invalid counts, conflicting modes, or empty explicit cursors throw
 * QueryValidationError. Unknown unrelated parameters are ignored so pagination
 * can coexist with other endpoint controls. The policy supplies parameter names.
 */
export function parse(
	policy: QueryPaginationDefinition,
	input: unknown,
	options: PaginationParseOptions = {},
): CursorPagination | OffsetPagination {
	const result = safeParse(policy, input, options);
	if (!result.success) throw new QueryValidationError(result.issues);
	return result.value;
}

/** Parse the same page input while returning structured issues for user feedback. No asynchronous work is started. */
export function safeParse(
	policy: QueryPaginationDefinition,
	input: unknown,
	options: PaginationParseOptions = {},
): QueryParseResult<CursorPagination | OffsetPagination> {
	const maximum = options.maximumParameters ?? 32;
	if (!Number.isSafeInteger(maximum) || maximum < 1) {
		throw new RangeError('maximumParameters must be a positive safe integer.');
	}
	const issues: QueryIssue[] = [];
	const entries = normalizeInput(input, issues, maximum);
	if ([...entries.values()].reduce((count, values) => count + values.length, 0) > maximum) {
		issues.push(issue('too-many-parameters', `At most ${maximum} query parameters are allowed.`, []));
	}
	if (issues.length > 0) return failure(issues);
	const value = parsePagination(policy, entries, issues);
	return issues.length > 0 ? failure(issues) : { success: true, value };
}

/**
 * Encode a checked page using its policy's names and authored page/offset style.
 * Values are checked again so JavaScript callers cannot emit an out-of-policy
 * link. A page-number value must agree with its offset and limit. A first cursor
 * page without a token is only representable when cursor is the default mode.
 */
export function encode(
	policy: QueryPaginationDefinition,
	page: CursorPagination | OffsetPagination,
): URLSearchParams {
	if (!record.is(page)) throw new TypeError('A page must be a plain data record.');
	const parameters = new URLSearchParams();
	const policies = paginationDefinitions(policy);
	if (!Number.isSafeInteger(page.limit)) {
		throw new QueryValidationError([issue('invalid-limit', 'A page limit must be a safe integer.', ['limit'])]);
	}
	if (page.kind === 'cursor') {
		if (!policies.cursor) {
			throw new QueryValidationError([
				issue('unsupported-pagination', 'Cursor pagination is not enabled.', ['pagination']),
			]);
		}
		if (page.cursor !== undefined) {
			if (typeof page.cursor !== 'string') {
				throw new QueryValidationError([issue('invalid-cursor', 'A cursor must be a string.', ['cursor'])]);
			}
			parameters.set(policies.cursor.parameters.cursor, page.cursor);
		}
		parameters.set(policies.cursor.parameters.limit, String(page.limit));
	} else if (page.kind === 'offset') {
		if (!policies.offset) {
			throw new QueryValidationError([
				issue('unsupported-pagination', 'Offset pagination is not enabled.', ['pagination']),
			]);
		}
		if (!Number.isSafeInteger(page.offset)) {
			throw new QueryValidationError([issue('invalid-offset', 'A page offset must be a safe integer.', ['offset'])]);
		}
		const names = policies.offset.parameters;
		if (page.source === 'page') {
			const pageNumber = page.page ?? page.offset / page.limit + 1;
			if (!Number.isSafeInteger(pageNumber) || (pageNumber - 1) * page.limit !== page.offset) {
				throw new QueryValidationError([
					issue('invalid-page', 'Page number, offset, and limit must describe the same window.', ['page']),
				]);
			}
			parameters.set(names.page, String(pageNumber));
			parameters.set(names.perPage, String(page.limit));
		} else if (page.source === 'offset') {
			parameters.set(names.offset, String(page.offset));
			parameters.set(names.limit, String(page.limit));
		} else {throw new QueryValidationError([
				issue('invalid-page', 'An offset page source must be offset or page.', ['source']),
			]);}
	} else {throw new QueryValidationError([
			issue('unsupported-pagination', 'A page kind must be cursor or offset.', ['kind']),
		]);}
	const decoded = parse(policy, parameters);
	if (decoded.kind !== page.kind) {
		throw new QueryValidationError([
			issue(
				'pagination-conflict',
				'This page cannot be represented by the configured default mode without a cursor token.',
				['pagination'],
			),
		]);
	}
	return parameters;
}

export { cursor, offset, pagination } from './pagination.ts';
export { QueryValidationError } from './validation.ts';
export type {
	CursorPagination,
	CursorPaginationDefinition,
	CursorPaginationOptions,
	OffsetPagination,
	OffsetPaginationDefinition,
	OffsetPaginationOptions,
	PaginationModesDefinition,
	PaginationModesOptions,
	QueryPageInput,
	QueryPaginationDefinition,
} from './types.ts';
