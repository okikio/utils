/**
 * Framework-neutral successful HTTP response contracts and constructors.
 *
 * The namespace owns response documents, headers, range/status helpers, and serialization without selecting a server framework.
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
