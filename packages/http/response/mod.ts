/**
 * Keep a successful representation tied to one schema and attach a safe download name.
 *
 * Add pagination, repeated headers, conditional responses or byte ranges as the representation needs them. The server validates an occurrence against its endpoint declarations and materializes the native Response; a filename header does not authorize access to a file.
 *
 * @example
 * ```ts
 * import * as response from '@okikio/http/response';
 * import { z } from 'zod';
 * const Saved = response.ok(z.object({ id: z.string() }), { id: 'asset.saved', description: 'Saved asset.' });
 * const value = response.finalize(response.create(Saved, { id: 'asset-1' }));
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
export { readText } from './body.ts';
export { byteRange, byteRangeHeaders, conditionalHeaders, notModified as isNotModified } from './http.ts';
export type { ByteRange } from './http.ts';
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
export { create, definitionOf, finalize, is, pageHeaders, pageLinks, withHeaders, withMeta } from './result.ts';
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
	ResponseBody,
	ResponseDefinition,
	ResponseDefinitionInput,
	ResponseDocument,
	ResponseEnvelope,
	ResponseExample,
	ResponseHeaders,
	ResponseResult,
	ResponseResultMetadata,
	ResponseSchema,
	ResponseStatus,
	SuccessEnvelope,
} from './types.ts';

export { attachmentDisposition } from './filename.ts';
