/**
 * Translate collection queries to and from URL parameters using a declared policy.
 *
 * This functional entrypoint composes with a separately imported definition.
 * It accepts a URL, URLSearchParams, or the documented plain wire record.
 * Encoding returns URLSearchParams for links, requests, and browser history.
 *
 * @example Create request parameters from a checked search
 * ```ts
 * import { parse, encode } from '@okikio/query/url';
 * const value = await parse(Search, new URL('https://example.test/people?filter[name]=Ada'));
 * const parameters = encode(Search, value);
 * ```
 *
 * @module
 */
import { safeParse as validate } from './parse.ts';
import { QueryValidationError } from './validation.ts';
import type { QueryFields, QueryParseResult, QueryPolicy, QueryValue } from './types.ts';

/** Validate a URL or plain wire input through its policy; failed input throws QueryValidationError. */
export async function parse<Fields extends QueryFields>(
	policy: QueryPolicy<Fields>,
	input: unknown,
): Promise<QueryValue<Fields>> {
	const result = await validate(policy, input);
	if (!result.success) throw new QueryValidationError(result.issues);
	return result.value;
}

/** Return structured field, operator, grammar, or limit issues without QueryValidationError. */
export function safeParse<Fields extends QueryFields>(
	policy: QueryPolicy<Fields>,
	input: unknown,
): Promise<QueryParseResult<QueryValue<Fields>>> {
	return validate(policy, input);
}

export { encode, stringify } from './url.ts';
export { QueryValidationError } from './validation.ts';
export type { QueryParseResult, QueryPolicy, QueryValue } from './types.ts';
