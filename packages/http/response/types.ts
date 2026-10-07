import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CatalogEntryIdentity } from '@okikio/catalog';
import type { HeaderInput, ResponseHeaders } from './headers.ts';

/** Standard Schema-compatible response body contract. */
export type ResponseSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** HTTP success and redirect status codes supported by response definitions. */
export type ResponseStatus =
	| 200
	| 201
	| 202
	| 203
	| 204
	| 205
	| 206
	| 207
	| 208
	| 226
	| 300
	| 301
	| 302
	| 303
	| 304
	| 307
	| 308;

/** Concrete request or response example retained for generated documentation. */
export interface ResponseExample<Value = unknown> {
	/** Authored name of this entry or example in its containing catalog. */
	readonly key: string;
	/** Short explanation shown beside this operation or example in generated references. */
	readonly summary?: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Concrete example payload retained for generated documentation. */
	readonly value: Value;
}

/** One string or encoded byte chunk accepted by a streaming HTML response. */
export type HtmlChunk = string | Uint8Array;

/** Complete one-off HTML body accepted as a string, Web Stream, or async iterable. */
export type HtmlBody = string | ReadableStream<Uint8Array> | AsyncIterable<HtmlChunk>;

/** Optional success envelope added during HTTP materialization. */
export type ResponseEnvelope = 'none' | 'data';

/** Pagination presentation policy retained by a paginated response definition. */
export interface PaginationResponsePolicy {
	/** Where pagination links are emitted: headers, body, both or neither. */
	readonly links: 'none' | 'header' | 'body' | 'both';
	/** Where known pagination totals are presented: headers, body, both or neither. */
	readonly totals: 'none' | 'headers' | 'body' | 'both';
}

/** Static successful response contract. */
export interface ResponseDefinition<
	Schema extends ResponseSchema | undefined = ResponseSchema | undefined,
	Status extends ResponseStatus = ResponseStatus,
> extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'response';
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status: Status;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Standard Schema validator and transform for the value accepted by this contract. */
	readonly schema?: Schema;
	/** Explicit JSON Schema for the serialized HTTP body when it differs from validation output. */
	readonly jsonSchema?: unknown;
	/** Declared HTTP media type for this input or response body. */
	readonly contentType?: string;
	/** Explicit transport headers retained for this boundary; credential forwarding uses its separate policy. */
	readonly headers?: ResponseHeaders;
	/** Concrete authored examples retained for API documentation. */
	readonly examples?: readonly ResponseExample[];
	/** Selected materialization or forwarding behavior for this definition. */
	readonly mode: 'body' | 'empty' | 'redirect' | 'stream' | 'download' | 'page' | 'html';
	/** Whether HTTP materialization wraps the body in the data envelope. */
	readonly envelope: ResponseEnvelope;
	/** Whether materialization includes the configured response timestamp. */
	readonly timestamp: boolean;
	/** Pagination presentation or URL parameter policy for this response. */
	readonly pagination?: PaginationResponsePolicy;
	/** Caller-selected download name projected into safe Content-Disposition metadata. */
	readonly filename?: string;
}

/** Input accepted by {@link define}. */
export interface ResponseDefinitionInput<Schema extends ResponseSchema | undefined, Status extends ResponseStatus> {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status: Status;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Standard Schema validator and transform for the value accepted by this contract. */
	readonly schema?: Schema;
	/** Explicit JSON Schema for the serialized HTTP body when it differs from validation output. */
	readonly jsonSchema?: unknown;
	/** Declared HTTP media type for this input or response body. */
	readonly contentType?: string;
	/** Explicit transport headers retained for this boundary; credential forwarding uses its separate policy. */
	readonly headers?: HeaderInput;
	/** Concrete authored examples retained for API documentation. */
	readonly examples?: readonly ResponseExample[];
	/** Selected materialization or forwarding behavior for this definition. */
	readonly mode?: ResponseDefinition['mode'];
	/** Whether HTTP materialization wraps the body in the data envelope. */
	readonly envelope?: ResponseEnvelope;
	/** Whether materialization includes the configured response timestamp. */
	readonly timestamp?: boolean;
	/** Pagination presentation or URL parameter policy for this response. */
	readonly pagination?: Partial<PaginationResponsePolicy>;
	/** Caller-selected download name projected into safe Content-Disposition metadata. */
	readonly filename?: string;
}

/** Cursor-based page returned by a storage adapter. */
export interface CursorPageWindow<Item> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'cursor';
	/** Items in this exact page window, in provider order. */
	readonly items: readonly Item[];
	/** Maximum requested items in this page window. */
	readonly limit: number;
	/** Whether the provider reports additional items beyond this window. */
	readonly hasMore: boolean;
	/** Opaque position used for this cursor page; the provider owns its interpretation. */
	readonly cursor?: string;
	/** Opaque position for the next page, when supplied by the provider. */
	readonly nextCursor?: string;
	/** Opaque position for the previous page, when supplied by the provider. */
	readonly previousCursor?: string;
	/** Exact total item count, when the provider knows it. */
	readonly total?: number;
	/** Estimated total retained separately from an exact count. */
	readonly approximateTotal?: number;
	/** Optional expiry instant for provider-owned cursor validity. */
	readonly expiresAt?: Temporal.Instant | string;
}

/** Offset/page-number page returned by a storage adapter. */
export interface OffsetPageWindow<Item> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'offset';
	/** Items in this exact page window, in provider order. */
	readonly items: readonly Item[];
	/** Zero-based starting item offset in this page window. */
	readonly offset: number;
	/** Maximum requested items in this page window. */
	readonly limit: number;
	/** Whether the provider reports additional items beyond this window. */
	readonly hasMore: boolean;
	/** Whether this offset was requested directly or derived from a one-based page. */
	readonly source?: 'offset' | 'page';
	/** One-based page number retained for page-style presentation. */
	readonly page?: number;
	/** Exact total item count, when the provider knows it. */
	readonly total?: number;
	/** Estimated total retained separately from an exact count. */
	readonly approximateTotal?: number;
}

/** Transport-neutral page window supplied to a paginated response definition. */
export type PageWindow<Item> = CursorPageWindow<Item> | OffsetPageWindow<Item>;

/** Logical body accepted when instantiating one response definition. */
export type ResponseBody<Definition extends ResponseDefinition> = Definition['mode'] extends 'empty' | 'redirect'
	? undefined
	: Definition extends ResponseDefinition<infer Schema>
		? Schema extends ResponseSchema
			? Definition['mode'] extends 'page' ? PageWindow<StandardSchemaV1.InferOutput<Schema>>
			: StandardSchemaV1.InferOutput<Schema>
		: unknown
	: unknown;

/** Standard pagination URL parameter names used during materialization. */
export interface PaginationParameters {
	/** URL parameter name for an opaque cursor. */
	readonly cursor: string;
	/** URL parameter name for the requested cursor/offset limit. */
	readonly limit: string;
	/** URL parameter name for a zero-based offset. */
	readonly offset: string;
	/** URL parameter name for a one-based page number. */
	readonly page: string;
	/** URL parameter name for page size. */
	readonly perPage: string;
}

/** Generated pagination links. */
export interface PaginationLinks {
	/** Link to this page window. */
	readonly self?: string;
	/** Link to the first page, when it can be constructed. */
	readonly first?: string;
	/** Link to the previous page, when the provider supplies a usable position. */
	readonly previous?: string;
	/** Link to the next page, when the provider supplies a usable position. */
	readonly next?: string;
	/** Link to the last page, when its position is known. */
	readonly last?: string;
}

/** Normalized page-window variant retained after runtime validation. */
export type NormalizedPageWindow<Page extends PageWindow<unknown>> = Page extends OffsetPageWindow<infer Item>
	? OffsetPageWindow<Item>
	: Page extends CursorPageWindow<infer Item> ? CursorPageWindow<Item>
	: never;

/** Context supplied to a custom pagination link builder. */
export interface PaginationLinkContext<Page extends PageWindow<unknown> = PageWindow<unknown>> {
	/** Pagination link relation requested from the custom builder. */
	readonly relation: keyof PaginationLinks;
	/** Validated page window for which this link is being constructed. */
	readonly page: Page;
	/** Base request URL used for link generation. */
	readonly url: URL;
	/** Default generated pagination URL offered to the custom link builder. */
	readonly generated?: URL;
}

/** Options applied when instantiating a successful response. */
export interface CreateResponseOptions {
	/** Explicit transport headers retained for this boundary; credential forwarding uses its separate policy. */
	readonly headers?: HeaderInput;
	/** Source location of this validation observation. */
	readonly location?: string | URL;
	/** Caller-selected download name projected into safe Content-Disposition metadata. */
	readonly filename?: string;
	/** Explicit link-generation base URL. The server request URL is used when omitted. */
	readonly url?: string | URL;
	/** Optional override for each generated pagination link. */
	readonly link?: (context: PaginationLinkContext) => string | URL | undefined;
	/** Application-owned metadata added to the success envelope. */
	readonly meta?: Readonly<Record<string, unknown>>;
}

/** Adapter-owned materialization options. */
export interface FinalizeResponseOptions {
	/** Explicit URL used by this contract; transport owners validate origins separately. */
	readonly url?: string | URL;
	/** Pagination presentation or URL parameter policy for this response. */
	readonly pagination?: Partial<PaginationParameters>;
	/** Application-owned clock for response timestamp materialization. */
	readonly now?: () => Temporal.Instant | string;
}

/** JSON-safe pagination metadata emitted in a response body. */
export interface PaginationMetadata {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'cursor' | 'offset';
	/** Maximum requested items in this page window. */
	readonly limit: number;
	/** Whether the provider reports additional items beyond this window. */
	readonly hasMore: boolean;
	/** Opaque position used for this cursor page; the provider owns its interpretation. */
	readonly cursor?: string;
	/** Zero-based starting item offset in this page window. */
	readonly offset?: number;
	/** One-based page number retained for page-style presentation. */
	readonly page?: number;
	/** Requested items per page in page-style presentation. */
	readonly perPage?: number;
	/** Exact total item count, when the provider knows it. */
	readonly total?: number;
	/** Estimated total retained separately from an exact count. */
	readonly approximateTotal?: number;
	/** Total page count derived from an exact total and page size. */
	readonly totalPages?: number;
	/** Optional expiry instant for provider-owned cursor validity. */
	readonly expiresAt?: string;
}

/** Default success envelope. */
export interface SuccessEnvelope<Data = unknown> {
	/** Logical successful response data carried by the envelope. */
	readonly data: Data;
	/** Application-owned metadata added to the success envelope. */
	readonly meta?: Readonly<Record<string, unknown>>;
	/** Generated pagination links retained in the body envelope. */
	readonly links?: PaginationLinks;
}

/** Fully request-aware result ready for native HTTP response conversion. */
export interface FinalizedResponseResult<Definition extends ResponseDefinition = ResponseDefinition> {
	/** Exact successful response definition used to validate and materialize this result. */
	readonly definition: Definition;
	/** Final validated HTTP representation after envelope, timestamp and pagination policy. */
	readonly body: unknown;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status: Definition['status'];
	/** Explicit transport headers retained for this boundary; credential forwarding uses its separate policy. */
	readonly headers: ResponseHeaders;
}

/** JSON-safe documentation projection for a successful response definition. */
export interface ResponseDocument {
	/** Authored name of this entry or example in its containing catalog. */
	readonly key?: string;
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status: ResponseStatus;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Declared HTTP media type for this input or response body. */
	readonly contentType?: string;
	/** Selected materialization or forwarding behavior for this definition. */
	readonly mode: ResponseDefinition['mode'];
	/** Whether HTTP materialization wraps the body in the data envelope. */
	readonly envelope: ResponseEnvelope;
	/** Whether materialization includes the configured response timestamp. */
	readonly timestamp: boolean;
	/** Projected pagination presentation policy; parameter names are adapter options. */
	readonly pagination?: PaginationResponsePolicy;
	/** Concrete authored examples retained for API documentation. */
	readonly examples: readonly ResponseExample[];
	/** Explicit transport headers retained for this boundary; credential forwarding uses its separate policy. */
	readonly headers: ResponseHeaders;
	/** Caller-selected download name projected into safe Content-Disposition metadata. */
	readonly filename?: string;
}

/** Hidden metadata attached to each response tuple. */
export interface ResponseResultMetadata<Definition extends ResponseDefinition = ResponseDefinition> {
	/** Exact response definition retained with this logical tuple. */
	readonly definition: Definition;
	/** Occurrence-specific options retained before response materialization. */
	readonly options: CreateResponseOptions;
}

/** Logical tuple returned by endpoint handlers before request-aware materialization. */
export type ResponseResult<
	Definition extends ResponseDefinition = ResponseDefinition,
	Body = unknown,
	Headers extends ResponseHeaders = ResponseHeaders,
> = readonly [body: Body, status: Definition['status'], headers: Headers];

export type { HeaderField, HeaderInput, HeaderValue, ResponseHeaders } from './headers.ts';
