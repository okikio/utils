/**
 * Describe a successful HTTP answer once, then create individual results from that rule.
 * A definition holds the status, body schema and representation policy. A result contains
 * one answer. materialize() checks and prepares that answer for a native Web Response.
 *
 * Add pagination, repeated headers, conditional responses or byte ranges when the caller
 * needs them. Server checks that the result belongs to the endpoint's declarations before
 * sending it. A download filename changes presentation; it does not grant file access.
 *
 * @example
 * ```ts
 * import * as response from '@okikio/http/response';
 * import * as schema from '@okikio/schema';
 * const Saved = response.ok(schema.object({ id: schema.string() }), { id: 'asset.saved', description: 'Saved asset.' });
 * const value = await response.materialize(response.create(Saved, { id: 'asset-1' }));
 * console.log(value.status);
 * console.log(response.attachmentDisposition('reports/quarterly.csv'));
 * ```
 *
 * @module
 */
export {
	accepted,
	compose,
	created,
	define,
	document,
	download,
	html,
	mediaType,
	noContent,
	notModified,
	ok,
	paginated,
	partialContent,
	redirect,
	responseCatalog as catalog,
	select,
	stream,
} from './definition.ts';
export { onComplete } from './completion.ts';
export { discard } from './discard.ts';
export { bodyCleanup, readBytes, readText } from './body.ts';
export {
	byteRange,
	byteRangeHeaders,
	conditionalHeaders,
	notModified as isNotModified,
	preconditions,
} from './http.ts';
export type { ByteRange, PreconditionsType, RepresentationType } from './http.ts';
export type { ResponseCompletion } from './completion.ts';
export { appendHeaders, headerEntries, headers, headerValues, mergeHeaders, mergeVary, toHeaders } from './headers.ts';
export {
	any as statusAny,
	clientError as clientErrorStatus,
	contentful as contentfulStatus,
	contentless as contentlessStatus,
	informational as informationalStatus,
	is as isStatus,
	isContentless as isContentlessStatus,
	isProblem as isProblemStatus,
	problem as problemStatus,
	redirect as redirectStatus,
	serverError as serverErrorStatus,
	success as successStatus,
} from './status.ts';
/** HTTP status recognition schemas; constructible response statuses are a separate policy. */
export * as status from './status.ts';
export type {
	ClientErrorStatus,
	ContentfulStatus,
	ContentlessStatus,
	HttpStatus,
	HttpStatusSchema,
	InformationalStatus,
	ProblemStatus,
	RedirectStatus,
	ServerErrorStatus,
	SuccessStatus,
} from './status.ts';
export {
	create,
	definitionOf,
	finalize,
	is,
	materialize,
	pageHeaders,
	pageLinks,
	prepare,
	withHeaders,
	withMeta,
} from './result.ts';
export type {
	CreateResponseOptions,
	CursorPageWindow,
	FinalizedResponseResult,
	FinalizeResponseOptions,
	HeaderField,
	HeaderInput,
	HeaderValue,
	HtmlBody,
	HtmlChunk,
	NormalizedPageWindow,
	OffsetPageWindow,
	PageWindow,
	PaginationLinkContext,
	PaginationLinks,
	PaginationMetadata,
	PaginationParameters,
	PaginationResponsePolicy,
	PreparedResponseBody,
	ResponseBody,
	ResponseDefinition,
	ResponseDefinitionInput,
	ResponseDocument,
	ResponseEnvelope,
	ResponseExample,
	ResponseHeaders,
	ResponseInput,
	ResponseMode,
	ResponseOutput,
	ResponseResult,
	ResponseResultMetadata,
	ResponseSchema,
	ResponseStatus,
	SuccessEnvelope,
} from './types.ts';

export { attachmentDisposition } from './filename.ts';

/** Bounded native JSONL responses and their body/cleanup outcome. */
export { jsonl, jsonlCompletion } from './jsonl.ts';
export type { JsonlCompletionType, JsonlOptions } from './jsonl.ts';
