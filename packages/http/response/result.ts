import { temporal } from '@okikio/duration/temporal';
import * as recordCore from '@okikio/collection/record';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { headers as normalizeHeaders, mergeHeaders } from './headers.ts';
import type {
	CreateResponseOptions,
	CursorPageWindow,
	FinalizedResponseResult,
	FinalizeResponseOptions,
	NormalizedPageWindow,
	OffsetPageWindow,
	PageWindow,
	PaginationLinkContext,
	PaginationLinks,
	PaginationMetadata,
	PaginationParameters,
	PreparedResponseBody,
	ResponseBody,
	ResponseDefinition,
	ResponseHeaders,
	ResponseResult,
	ResponseResultMetadata,
	SuccessEnvelope,
} from './types.ts';

/**
 * Keep the exact declaration beside each result without adding private fields to
 * its public tuple. A matching status or body shape cannot establish which
 * response the handler selected. Weak keys also let completed results be collected.
 */
const responseResultMetadata = new WeakMap<ReadonlyArray<unknown>, ResponseResultMetadata>();
type NormalizedCreateOptions = Readonly<
	Omit<CreateResponseOptions, 'headers' | 'location' | 'url'> & {
		readonly headers?: ResponseHeaders;
		readonly location?: string;
		readonly url?: string;
	}
>;
type CreatedResponseBody<Definition extends ResponseDefinition> = Definition['mode'] extends 'empty' | 'redirect' ? null
	: Exclude<ResponseBody<Definition>, undefined>;

const defaultParameters = Object.freeze(
	{
		cursor: 'cursor',
		limit: 'limit',
		offset: 'offset',
		page: 'page',
		perPage: 'per_page',
	} satisfies PaginationParameters,
);

/**
 * Associate [body, status, headers] with its exact response declaration.
 * This does not validate or serialize the body. prepare() validates it;
 * finalize() adds request-dependent links and optional metadata. Adapters can
 * call materialize() for both stages before creating the native Response.
 */
export function create<Definition extends ResponseDefinition>(
	definition: Definition,
	body: ResponseBody<Definition>,
	options: CreateResponseOptions = {},
): ResponseResult<Definition, CreatedResponseBody<Definition>> {
	const normalizedOptions = normalizeCreateOptions(options);
	const baseHeaders = mergeHeaders(definition.headers, normalizedOptions.headers);
	const additional: Record<string, string> = Object.create(null);
	if (normalizedOptions.location !== undefined) additional.Location = normalizedOptions.location;
	if (definition.mode === 'redirect' && additional.Location === undefined && !hasHeader(baseHeaders, 'Location')) {
		throw new TypeError(`Redirect response ${JSON.stringify(definition.id)} requires a Location header.`);
	}
	if (definition.contentType !== undefined && !hasHeader(baseHeaders, 'Content-Type')) {
		additional['Content-Type'] = definition.contentType;
	}
	const filename = normalizedOptions.filename ?? definition.filename;
	if (filename !== undefined && !hasHeader(baseHeaders, 'Content-Disposition')) {
		additional['Content-Disposition'] = `attachment; filename="${escapeFilename(filename)}"`;
	}
	// `ResponseDefinition` is not a discriminated union over `mode`, so TypeScript
	// cannot derive the conditional body type from this runtime check. Keep the
	// assertion at this one construction seam rather than widening every caller.
	const resolvedBody =
		(definition.mode === 'empty' || definition.mode === 'redirect' ? null : body) as CreatedResponseBody<Definition>;
	const tuple = responseTuple<Definition, CreatedResponseBody<Definition>>(
		resolvedBody,
		definition.status,
		mergeHeaders(baseHeaders, additional),
	);
	responseResultMetadata.set(tuple, Object.freeze({ definition, options: normalizedOptions }));
	return tuple;
}

/**
 * Validate handler input once and retain the actual transformed wire representation.
 * Codecs explicitly encode application values; ordinary schemas parse their declared input.
 * The logical input tuple stays unchanged, and page item issues retain their index paths.
 */
export async function prepare<Definition extends ResponseDefinition>(
	result: ResponseResult<Definition>,
): Promise<ResponseResult<Definition, PreparedResponseBody<Definition>>> {
	const definition = definitionOf(result);
	if (definition.schema === undefined || definition.mode === 'empty' || definition.mode === 'redirect') {
		return clone(result, result[0], result[2], metadataOf(result).options) as ResponseResult<
			Definition,
			PreparedResponseBody<Definition>
		>;
	}
	const contract = definition.schema;
	// A codec writes application values into wire values; an ordinary schema
	// parses the authored input. Keep those directions explicit at this boundary.
	const convert = (value: unknown): Promise<unknown> =>
		codec.is(contract) ? codec.write(contract, value) : schema.parse(contract, value);
	let body: unknown;
	if (definition.mode === 'page') {
		const page = asPageWindow(result[0]);
		const items: unknown[] = [];
		const issues: import('@standard-schema/spec').StandardSchemaV1.Issue[] = [];
		for (let index = 0; index < page.items.length; index++) {
			try {
				items.push(await convert(page.items[index]));
			} catch (error) {
				if (!(error instanceof schema.SchemaValidationError)) throw error;
				issues.push(...schema.prefixIssues(error.issues, 'items', index));
			}
		}
		if (issues.length > 0) throw new schema.SchemaValidationError(issues);
		body = Object.freeze({ ...page, items: Object.freeze(items) });
	} else body = await convert(result[0]);
	return clone(result, body, result[2], metadataOf(result).options) as ResponseResult<
		Definition,
		PreparedResponseBody<Definition>
	>;
}

/** Validate and finalize a logical response for a standalone HTTP adapter. */
export async function materialize<Definition extends ResponseDefinition>(
	result: ResponseResult<Definition>,
	options: FinalizeResponseOptions = {},
): Promise<FinalizedResponseResult<Definition>> {
	return finalize(await prepare(result), options);
}

/**
 * Finalize one logical result with request-aware transport metadata.
 *
 * Handlers call {@link create} before a public request URL, current time, or
 * adapter-specific pagination parameter names necessarily exist. The server
 * adapter calls `finalize` exactly once after handler/result validation to:
 *
 * - generate pagination links from the current or explicitly supplied URL;
 * - preserve non-pagination query parameters and fragments;
 * - emit configured Link/count headers and body metadata;
 * - create optional data envelopes and timestamps.
 *
 * This function still returns a transport-neutral finalized value. The selected
 * server adapter owns the subsequent conversion to a native `Response`,
 * including prepared middleware headers and repeated Set-Cookie fields.
 */
export function finalize<Definition extends ResponseDefinition>(
	result: ResponseResult<Definition, unknown>,
	options: FinalizeResponseOptions = {},
): FinalizedResponseResult<Definition> {
	const normalizedOptions = finalizeOptions(options);
	const metadata = metadataOf(result);
	const definition = metadata.definition;
	let body: unknown = result[0];
	let resolvedHeaders = result[2];
	let links: PaginationLinks | undefined;
	let pagination: PaginationMetadata | undefined;
	if (definition.mode === 'page') {
		const page = asPageWindow(body);
		const baseUrl = metadata.options.url ?? normalizedOptions.url;
		const policy = definition.pagination!;
		links = baseUrl === undefined ? Object.freeze({}) : pageLinks(page, baseUrl, {
			...defaultParameters,
			...(normalizedOptions.pagination ?? {}),
		}, metadata.options.link);
		pagination = pageMetadata(page, policy.totals === 'body' || policy.totals === 'both');
		if ((policy.links === 'header' || policy.links === 'both') && Object.keys(links).length > 0) {
			resolvedHeaders = mergeHeaders(resolvedHeaders, { Link: linkHeader(links) });
		}
		if (policy.totals === 'headers' || policy.totals === 'both') {
			resolvedHeaders = mergeHeaders(resolvedHeaders, paginationHeaders(page, pagination));
		}
		body = page.items;
	}
	const generatedMeta = buildMeta(definition.timestamp, metadata.options.meta, pagination, normalizedOptions.now);
	const shouldEnvelope = definition.envelope === 'data' || generatedMeta !== undefined || definition.mode === 'page';
	if (shouldEnvelope && definition.mode !== 'empty' && definition.mode !== 'redirect') {
		const envelope = Object.freeze(
			{
				data: body,
				...(generatedMeta !== undefined ? { meta: generatedMeta } : {}),
				...(definition.mode === 'page' &&
						(definition.pagination!.links === 'body' || definition.pagination!.links === 'both') &&
						links !== undefined && Object.keys(links).length > 0
					? { links }
					: {}),
			} satisfies SuccessEnvelope,
		);
		body = envelope;
	}
	return Object.freeze({ definition, body, status: result[1], headers: resolvedHeaders });
}

/** Return a copy of a logical result with occurrence headers merged in. */
export function withHeaders<Definition extends ResponseDefinition, Body>(
	result: ResponseResult<Definition, Body>,
	headers: import('./headers.ts').HeaderInput,
): ResponseResult<Definition, Body> {
	if (!is(result)) throw new TypeError('Value is not a response result.');
	return clone(result, result[0], mergeHeaders(result[2], headers), metadataOf(result).options);
}

/** Return a copy whose final body contains merged metadata in a data envelope. */
export function withMeta<Definition extends ResponseDefinition, Body>(
	result: ResponseResult<Definition, Body>,
	meta: Readonly<Record<string, unknown>>,
): ResponseResult<Definition, Body> {
	if (!is(result)) throw new TypeError('Value is not a response result.');
	recordCore.assert(meta, 'response metadata');
	const current = metadataOf(result);
	return clone(
		result,
		result[0],
		result[2],
		Object.freeze({
			...current.options,
			meta: mergeMeta(current.options.meta, meta),
		}),
	);
}

/** Return whether a value is a response tuple created by this package. */
export function is(value: unknown): value is ResponseResult {
	return Array.isArray(value) && responseResultMetadata.has(value);
}

/** Return the exact imported definition retained by a response tuple. */
export function definitionOf<Definition extends ResponseDefinition>(value: ResponseResult<Definition>): Definition {
	return metadataOf(value).definition;
}

/** Construct request-aware pagination links without instantiating a response. */
export function pageLinks<const Page extends PageWindow<unknown>>(
	page: Page,
	baseUrl: string | URL,
	parameters: Partial<PaginationParameters> = {},
	custom?: (context: PaginationLinkContext<NormalizedPageWindow<Page>>) => string | URL | undefined,
): PaginationLinks {
	if (custom !== undefined && typeof custom !== 'function') {
		throw new TypeError('Pagination link builder must be a function when provided.');
	}
	const normalizedPage = asPageWindow(page) as NormalizedPageWindow<Page>;
	const names = paginationParameters(parameters);
	const parsed = parseBaseUrl(baseUrl);
	const generated = normalizedPage.kind === 'cursor'
		? cursorLinks(normalizedPage, parsed.url, names)
		: offsetLinks(normalizedPage, parsed.url, names);
	const result: Partial<Record<keyof PaginationLinks, string>> = Object.create(null);
	for (const relation of ['self', 'first', 'previous', 'next', 'last'] as const) {
		const candidate = generated[relation];
		if (candidate === undefined && custom === undefined) continue;
		const replacement = custom?.({
			relation,
			page: normalizedPage,
			url: new URL(parsed.url),
			...(candidate ? { generated: new URL(candidate) } : {}),
		});
		const selected = replacement === undefined ? candidate : new URL(replacement, parsed.url).href;
		if (selected !== undefined) result[relation] = formatUrl(selected, parsed.relative);
	}
	return Object.freeze(result as PaginationLinks);
}

/** Construct RFC 8288 Link and count/page fields from a page window. */
export function pageHeaders<Item>(
	page: PageWindow<Item>,
	url?: string | URL,
	parameters: Partial<PaginationParameters> = {},
): ResponseHeaders {
	const normalizedPage = asPageWindow<Item>(page);
	const pagination = pageMetadata(normalizedPage, true);
	return mergeHeaders(
		url === undefined ? undefined : { Link: linkHeader(pageLinks(normalizedPage, url, parameters)) },
		paginationHeaders(normalizedPage, pagination),
	);
}

/**
 * Build cursor navigation from opaque authored cursors.
 * No last-page link is inferred because a cursor does not reveal a page number.
 *
 * @internal
 */
function cursorLinks(
	page: CursorPageWindow<unknown>,
	base: URL,
	names: PaginationParameters,
): Partial<Record<keyof PaginationLinks, string>> {
	const self = cursorUrl(base, page.cursor, page.limit, names);
	return {
		self: self.href,
		first: cursorUrl(base, undefined, page.limit, names).href,
		...(page.previousCursor !== undefined
			? { previous: cursorUrl(base, page.previousCursor, page.limit, names).href }
			: {}),
		...(page.nextCursor !== undefined ? { next: cursorUrl(base, page.nextCursor, page.limit, names).href } : {}),
	};
}

/**
 * Build page-number or offset navigation from the selected window.
 * A known total permits a last link; hasMore independently controls next.
 * Each link removes only pagination parameters so filters survive navigation.
 *
 * @internal
 */
function offsetLinks(
	page: OffsetPageWindow<unknown>,
	base: URL,
	names: PaginationParameters,
): Partial<Record<keyof PaginationLinks, string>> {
	const usePage = page.source === 'page' || page.page !== undefined;
	const currentPage = page.page ?? Math.floor(page.offset / page.limit) + 1;
	const totalPages = page.total === undefined ? undefined : Math.max(1, Math.ceil(page.total / page.limit));
	/** Build each relation from a fresh URL so one relation cannot alter another. */
	const create = (offset: number, pageNumber: number): string => {
		const url = cleanPagination(base, names);
		if (usePage) {
			url.searchParams.set(names.page, String(pageNumber));
			url.searchParams.set(names.perPage, String(page.limit));
		} else {
			url.searchParams.set(names.offset, String(offset));
			url.searchParams.set(names.limit, String(page.limit));
		}
		return url.href;
	};
	return {
		self: create(page.offset, currentPage),
		first: create(0, 1),
		...(page.offset > 0
			? { previous: create(Math.max(0, page.offset - page.limit), Math.max(1, currentPage - 1)) }
			: {}),
		...(page.hasMore ? { next: create(page.offset + page.limit, currentPage + 1) } : {}),
		...(totalPages !== undefined ? { last: create(Math.max(0, (totalPages - 1) * page.limit), totalPages) } : {}),
	};
}

/**
 * Copy the base URL, replace pagination fields and retain non-pagination filters.
 *
 * @internal
 */
function cursorUrl(base: URL, cursor: string | undefined, limit: number, names: PaginationParameters): URL {
	const url = cleanPagination(base, names);
	if (cursor !== undefined) url.searchParams.set(names.cursor, cursor);
	url.searchParams.set(names.limit, String(limit));
	return url;
}

/**
 * Removes only pagination query fields before new pagination links are generated, preserving filters and sorting.
 *
 * @internal
 */
function cleanPagination(base: URL, names: PaginationParameters): URL {
	const url = new URL(base);
	for (const name of Object.values(names)) url.searchParams.delete(name);
	return url;
}

/**
 * Describe the selected window without querying or counting its data source.
 * Include exact or estimated totals only when the response policy permits them.
 *
 * @internal
 */
function pageMetadata(page: PageWindow<unknown>, includeTotals: boolean): PaginationMetadata {
	if (page.kind === 'cursor') {
		return Object.freeze({
			kind: 'cursor',
			limit: page.limit,
			hasMore: page.hasMore,
			...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
			...(includeTotals && page.total !== undefined ? { total: page.total } : {}),
			...(includeTotals && page.approximateTotal !== undefined ? { approximateTotal: page.approximateTotal } : {}),
			...(page.expiresAt !== undefined ? { expiresAt: String(page.expiresAt) } : {}),
		});
	}
	const currentPage = page.page ?? Math.floor(page.offset / page.limit) + 1;
	return Object.freeze({
		kind: 'offset',
		limit: page.limit,
		hasMore: page.hasMore,
		offset: page.offset,
		page: currentPage,
		perPage: page.limit,
		...(includeTotals && page.total !== undefined
			? { total: page.total, totalPages: Math.ceil(page.total / page.limit) }
			: {}),
		...(includeTotals && page.approximateTotal !== undefined ? { approximateTotal: page.approximateTotal } : {}),
	});
}

/**
 * Render declared counts and page coordinates as transport fields.
 * Exact totals take precedence over estimated totals in Preference-Applied;
 * this function does not verify the data source's count.
 *
 * @internal
 */
function paginationHeaders(page: PageWindow<unknown>, metadata: PaginationMetadata): ResponseHeaders {
	const fields: Record<string, string> = Object.create(null);
	fields['X-Per-Page'] = String(page.limit);
	if (page.total !== undefined) {
		fields['X-Total-Count'] = String(page.total);
		fields['Preference-Applied'] = 'count=exact';
	}
	if (page.approximateTotal !== undefined) {
		fields['X-Approximate-Total-Count'] = String(page.approximateTotal);
		if (page.total === undefined) fields['Preference-Applied'] = 'count=estimated';
	}
	if (page.kind === 'cursor') {
		if (page.expiresAt !== undefined) fields['X-Pagination-Expires-At'] = String(page.expiresAt);
	} else {
		fields['X-Offset'] = String(page.offset);
		fields['X-Page'] = String(metadata.page);
		if (metadata.totalPages !== undefined) fields['X-Total-Pages'] = String(metadata.totalPages);
	}
	return mergeHeaders(fields);
}

/**
 * Render existing pagination links as one Link field.
 * Translate the application relation previous to the protocol relation prev.
 *
 * @internal
 */
function linkHeader(links: PaginationLinks): string {
	return (['self', 'first', 'previous', 'next', 'last'] as const)
		.flatMap((relation) =>
			links[relation] === undefined
				? []
				: [`<${links[relation]}>; rel="${relation === 'previous' ? 'prev' : relation}"`]
		)
		.join(', ');
}

/**
 * Merge custom metadata with authoritative pagination and optional timestamp.
 * Generated fields replace custom fields of the same name. Read the clock only
 * when the declaration enables a timestamp.
 *
 * @internal
 */
function buildMeta(
	timestamp: boolean,
	custom: Readonly<Record<string, unknown>> | undefined,
	pagination: PaginationMetadata | undefined,
	now: FinalizeResponseOptions['now'],
): Readonly<Record<string, unknown>> | undefined {
	if (!timestamp && custom === undefined && pagination === undefined) return undefined;
	return Object.freeze({
		...(custom ?? {}),
		...(pagination !== undefined ? { pagination } : {}),
		...(timestamp ? { timestamp: instantString(now?.() ?? temporal.Now.instant(), 'Response timestamp') } : {}),
	});
}

/**
 * Validate a handler-supplied pagination window before constructing links.
 * Snapshot item membership and check coordinates/counts; item values remain
 * borrowed until prepare() validates them against the declared response schema.
 *
 * @internal
 */
function asPageWindow<Item = unknown>(value: unknown): PageWindow<Item> {
	recordCore.assert(value, 'pagination page window');
	const kind = value.kind;
	if (kind !== 'cursor' && kind !== 'offset') throw new TypeError('PageWindow.kind must be cursor or offset.');
	const limit = value.limit;
	if (!Number.isSafeInteger(limit) || (limit as number) < 1) {
		throw new TypeError('Paginated response bodies require a positive safe-integer limit.');
	}
	if (typeof value.hasMore !== 'boolean') {
		throw new TypeError('Paginated response bodies require a boolean hasMore value.');
	}
	const items = pageItems<Item>(value.items, limit as number);
	const total = optionalCount(value.total, 'total');
	const approximateTotal = optionalCount(value.approximateTotal, 'approximateTotal');

	if (kind === 'cursor') {
		const cursor = optionalCursor(value.cursor, 'cursor');
		const nextCursor = optionalCursor(value.nextCursor, 'nextCursor');
		const previousCursor = optionalCursor(value.previousCursor, 'previousCursor');
		const expiresAt = optionalInstant(value.expiresAt);
		return Object.freeze({
			kind,
			items,
			limit: limit as number,
			hasMore: value.hasMore,
			...(cursor === undefined ? {} : { cursor }),
			...(nextCursor === undefined ? {} : { nextCursor }),
			...(previousCursor === undefined ? {} : { previousCursor }),
			...(total === undefined ? {} : { total }),
			...(approximateTotal === undefined ? {} : { approximateTotal }),
			...(expiresAt === undefined ? {} : { expiresAt }),
		}) as CursorPageWindow<Item>;
	}

	const offset = value.offset;
	if (!Number.isSafeInteger(offset) || (offset as number) < 0) {
		throw new TypeError('Offset pages require a non-negative safe-integer offset.');
	}
	const source = value.source;
	if (source !== undefined && source !== 'offset' && source !== 'page') {
		throw new TypeError('Offset page source must be offset or page when provided.');
	}
	const authoredPage = value.page;
	if (authoredPage !== undefined && (!Number.isSafeInteger(authoredPage) || (authoredPage as number) < 1)) {
		throw new TypeError('Offset page number must be a positive safe integer when provided.');
	}
	const derivedPage = Math.floor((offset as number) / (limit as number)) + 1;
	if (authoredPage !== undefined && authoredPage !== derivedPage) {
		throw new TypeError(`Offset page number ${authoredPage} does not match offset ${offset} and limit ${limit}.`);
	}
	return Object.freeze({
		kind,
		items,
		offset: offset as number,
		limit: limit as number,
		hasMore: value.hasMore,
		...(source === undefined ? {} : { source }),
		...(authoredPage === undefined ? {} : { page: authoredPage as number }),
		...(total === undefined ? {} : { total }),
		...(approximateTotal === undefined ? {} : { approximateTotal }),
	}) as OffsetPageWindow<Item>;
}

/** Snapshot page-item membership without invoking accessor-backed or sparse array elements. @internal */
function pageItems<Item>(value: unknown, limit: number): readonly Item[] {
	if (!Array.isArray(value)) throw new TypeError('Paginated response bodies require an items array.');
	if (value.length > limit) {
		throw new TypeError(`Paginated response items length ${value.length} exceeds limit ${limit}.`);
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError('Paginated response items must not contain symbol properties.');
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Object.keys(descriptors).filter((key) => key !== 'length');
	if (keys.length !== value.length) throw new TypeError('Paginated response items must be a dense data array.');
	const items: Item[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError('Paginated response items must contain only enumerable data elements.');
		}
		items.push(descriptor.value as Item);
	}
	return Object.freeze(items);
}

/** Validate one optional exact pagination count. @internal */
function optionalCount(value: unknown, name: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(`Pagination ${name} must be a non-negative safe integer.`);
	}
	return value as number;
}

/** Validate one opaque cursor without interpreting its contents. @internal */
function optionalCursor(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`Pagination ${name} must be a non-empty string when provided.`);
	}
	return value;
}

/** Normalize a pagination expiry using the intrinsic Temporal Instant formatter when needed. @internal */
function optionalInstant(value: unknown): string | undefined {
	return value === undefined ? undefined : instantString(value, 'Pagination expiresAt');
}

/** Format one Temporal Instant/string without invoking caller-owned coercion hooks. @internal */
function instantString(value: unknown, name: string): string {
	if (typeof value === 'string') {
		if (value.length === 0) throw new TypeError(`${name} must be a non-empty instant string.`);
		return value;
	}
	try {
		return temporal.Instant.prototype.toString.call(value as Temporal.Instant);
	} catch {
		throw new TypeError(`${name} must be a Temporal.Instant or string.`);
	}
}

/**
 * Copy an absolute URL or resolve a relative URL against a temporary origin.
 * Remember relative input so formatting removes that placeholder origin later.
 *
 * @internal
 */
function parseBaseUrl(value: string | URL): { readonly url: URL; readonly relative: boolean } {
	if (value instanceof URL) return { url: new URL(value), relative: false };
	if (typeof value !== 'string') throw new TypeError('Pagination base URL must be a string or URL.');
	const relative = !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
	return { url: new URL(value, 'https://service.invalid'), relative };
}

/**
 * Remove the temporary origin for relative links while retaining query and fragment.
 *
 * @internal
 */
function formatUrl(value: string, relative: boolean): string {
	const url = new URL(value);
	return relative ? `${url.pathname}${url.search}${url.hash}` : url.href;
}

/**
 * Compare record field names without case sensitivity.
 *
 * @internal
 */
function hasHeader(headers: ResponseHeaders, name: string): boolean {
	const lower = name.toLowerCase();
	return Object.keys(headers).some((candidate) => candidate.toLowerCase() === lower);
}

/**
 * Reject NUL and line breaks before a Location value enters the header record.
 *
 * @internal
 */
function safeHeaderValue(value: string, name: string): string {
	if (/\0|\r|\n/.test(value)) throw new TypeError(`${name} contains a forbidden control character.`);
	return value;
}

/**
 * Escape quoting characters and remove line breaks for a quoted filename.
 * This is not filesystem path sanitization; use attachmentDisposition() for
 * a standalone Content-Disposition field with path-component handling.
 *
 * @internal
 */
function escapeFilename(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll(/[\r\n]/g, '');
}

/**
 * Validate and snapshot response-creation options before any option field is consumed.
 *
 * Native `Headers`/`URL` instances are converted to immutable logical values so later
 * caller mutation cannot change the response after `create()` returns.
 *
 * @internal
 */
function normalizeCreateOptions(options: CreateResponseOptions): NormalizedCreateOptions {
	recordCore.assert(options, 'response create options');
	assertKnownKeys(options, ['headers', 'location', 'filename', 'url', 'link', 'meta'], 'response create options');
	if (options.link !== undefined && typeof options.link !== 'function') {
		throw new TypeError('Response link builder must be a function when provided.');
	}
	if (options.url !== undefined && typeof options.url !== 'string' && !(options.url instanceof URL)) {
		throw new TypeError('Response url must be a string or URL when provided.');
	}
	if (options.location !== undefined && typeof options.location !== 'string' && !(options.location instanceof URL)) {
		throw new TypeError('Response location must be a string or URL when provided.');
	}
	if (options.filename !== undefined && typeof options.filename !== 'string') {
		throw new TypeError('Response filename must be a string when provided.');
	}
	const headers = options.headers === undefined ? undefined : normalizeHeaders(options.headers);
	const location = options.location === undefined
		? undefined
		: safeHeaderValue(options.location instanceof URL ? options.location.href : options.location, 'Location');
	let meta: Readonly<Record<string, unknown>> | undefined;
	if (options.meta !== undefined) {
		recordCore.assert(options.meta, 'response metadata');
		meta = recordCore.snapshot(options.meta, 'response metadata');
	}
	return Object.freeze({
		...(headers === undefined ? {} : { headers }),
		...(location === undefined ? {} : { location }),
		...(options.filename === undefined ? {} : { filename: options.filename }),
		...(options.url === undefined ? {} : { url: options.url instanceof URL ? options.url.href : options.url }),
		...(options.link === undefined ? {} : { link: options.link }),
		...(meta === undefined ? {} : { meta }),
	});
}

/** Validate and snapshot request-aware response finalization options. @internal */
function finalizeOptions(options: FinalizeResponseOptions): FinalizeResponseOptions {
	recordCore.assert(options, 'response finalize options');
	assertKnownKeys(options, ['url', 'pagination', 'now'], 'response finalize options');
	if (options.url !== undefined && typeof options.url !== 'string' && !(options.url instanceof URL)) {
		throw new TypeError('Finalize url must be a string or URL when provided.');
	}
	if (options.now !== undefined && typeof options.now !== 'function') {
		throw new TypeError('Finalize now must be a function when provided.');
	}
	const pagination = options.pagination === undefined ? undefined : paginationParameters(options.pagination);
	return Object.freeze({
		...(options.url === undefined ? {} : { url: options.url instanceof URL ? options.url.href : options.url }),
		...(pagination === undefined ? {} : { pagination }),
		...(options.now === undefined ? {} : { now: options.now }),
	});
}

/** Normalize pagination query parameter names and reject aliases that would overwrite one another. @internal */
function paginationParameters(parameters: Partial<PaginationParameters>): PaginationParameters {
	recordCore.assert(parameters, 'pagination parameters');
	const allowed = new Set<keyof PaginationParameters>(['cursor', 'limit', 'offset', 'page', 'perPage']);
	for (const key of Object.keys(parameters)) {
		if (!allowed.has(key as keyof PaginationParameters)) {
			throw new TypeError(`Unknown pagination parameter ${JSON.stringify(key)}.`);
		}
	}
	const result = Object.freeze(
		{
			cursor: parameterName(parameters.cursor ?? defaultParameters.cursor, 'cursor'),
			limit: parameterName(parameters.limit ?? defaultParameters.limit, 'limit'),
			offset: parameterName(parameters.offset ?? defaultParameters.offset, 'offset'),
			page: parameterName(parameters.page ?? defaultParameters.page, 'page'),
			perPage: parameterName(parameters.perPage ?? defaultParameters.perPage, 'perPage'),
		} satisfies PaginationParameters,
	);
	const names = Object.values(result);
	if (new Set(names).size !== names.length) throw new TypeError('Pagination parameter names must be distinct.');
	return result;
}

/** Validate one query parameter name used for generated pagination links. @internal */
function parameterName(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`Pagination parameter ${name} must be a non-empty string.`);
	}
	return value;
}

/** Merge response metadata records without invoking accessor-backed fields. @internal */
function mergeMeta(
	base: Readonly<Record<string, unknown>> | undefined,
	additional: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const target: Record<string, unknown> = Object.create(null);
	for (const source of [base, additional]) {
		if (source === undefined) continue;
		recordCore.assert(source, 'response metadata');
		for (const [key, value] of recordCore.entries(source, 'response metadata')) target[key] = value;
	}
	return Object.freeze(target);
}

/** Reject unknown option keys so misspelled runtime policy cannot be silently ignored. @internal */
function assertKnownKeys(
	value: Readonly<Record<string, unknown>>,
	allowed: readonly string[],
	name: string,
): void {
	const accepted = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!accepted.has(key)) throw new TypeError(`${name} contains unknown property ${JSON.stringify(key)}.`);
	}
}

/**
 * Read definition identity and creation options from this package's private tuple registry.
 * An array with the same visible elements is not a registered response result.
 *
 * @internal
 */
function metadataOf<Definition extends ResponseDefinition>(
	value: ResponseResult<Definition>,
): ResponseResultMetadata<Definition> {
	if (!is(value)) throw new TypeError('Value is not a response result.');
	const metadata = responseResultMetadata.get(value);
	if (metadata === undefined) throw new TypeError('Response result metadata is unavailable.');
	return metadata as ResponseResultMetadata<Definition>;
}

/**
 * Create a new tuple with the same declaration identity and fresh option snapshot.
 * Enrichment leaves the original handler result unchanged.
 *
 * @internal
 */
function clone<Definition extends ResponseDefinition, Body>(
	original: ResponseResult<Definition>,
	body: Body,
	headers: ResponseHeaders,
	options: CreateResponseOptions,
): ResponseResult<Definition, Body> {
	const metadata = metadataOf(original);
	const tuple = responseTuple<Definition, Body>(body, original[1], headers);
	responseResultMetadata.set(
		tuple,
		Object.freeze({ definition: metadata.definition, options: normalizeCreateOptions(options) }),
	);
	return tuple;
}

/** Construct one frozen logical response tuple without widening its element types to an array union. */
function responseTuple<Definition extends ResponseDefinition, Body>(
	body: Body,
	status: Definition['status'],
	headers: ResponseHeaders,
): ResponseResult<Definition, Body> {
	return Object.freeze([body, status, headers] as const);
}
