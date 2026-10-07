/**
 * Read bounded request bytes and preserve query multiplicity before domain validation.
 *
 * Choose the body budget before reading, then validate the decoded shape with an endpoint schema. Cancellation and one-byte-over-limit cases fail without returning a partial body.
 *
 * @example
 * ```ts
 * import * as request from '@okikio/http/request';
 * console.log(JSON.stringify(request.parseQuery('?tag=a&tag=b')));
 * const incoming = new Request('https://service.invalid/import', { method: 'POST', body: 'abc' });
 * console.log(new TextDecoder().decode(await request.readBody(incoming, { maximumBodyBytes: 3 })));
 * ```
 *
 * @module
 */
export { parseAuthorization } from './authorization.ts';
export { parseForm, parseJson, readBody } from './body.ts';
export { negotiateContent, parseMediaType, requireContentType } from './content.ts';
export { parseCookies } from './cookies.ts';
export { forwardHeaders } from './forward.ts';
export type { ForwardHeaderOptionsType } from './forward.ts';
export { externalUrl } from './forwarded.ts';
export { parseHeaders, redactHeaders } from './headers.ts';
export { parseContentLength } from './length.ts';
export { formatPath, normalizePath, validationDetail, validationDetails } from './issues.ts';
export { DefaultRequestParsingLimits, limits } from './limits.ts';
export { dispose as disposeMemo, invalidate as invalidateMemo, memoize } from './memo.ts';
export { parseParameters } from './parameters.ts';
export {
	correlation,
	correlationFields,
	parseTraceParent,
	parseTraceState,
	propagationHeaders,
	requestId,
} from './trace.ts';
export { parseQuery } from './query.ts';
export { RequestTransportError } from './types.ts';
export type {
	DuplicateCookiePolicy,
	ForwardedHeaderPolicy,
	MediaType,
	ParsedAuthorization,
	RequestIssue,
	RequestIssueCode,
	RequestParsingLimits,
	RequestParsingOptions,
	SensitiveCredential,
	WireRecord,
	WireValue,
} from './types.ts';

export type { RequestInputSource, RequestValidationDetail } from './issues.ts';
export type { RequestCorrelation, RequestCorrelationFieldOptions, RequestCorrelationOptions } from './trace.ts';
