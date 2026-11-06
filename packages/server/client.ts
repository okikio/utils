/** Typed calls through exact endpoint definitions. Fetch and streaming bodies have explicit owners. @module */
import * as endpoint from './endpoint/mod.ts';
import type {
	EndpointDefinition,
	EndpointOperation,
	InferEndpointWireInputs,
	MergeEndpointInputs,
} from './endpoint/types.ts';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import type { ContractOutput } from '@okikio/schema/codec';
import * as catalog from '@okikio/collection/catalog';
import type { DefinitionEntry } from '@okikio/collection/catalog';
import * as json from '@okikio/collection/record/json';
import * as record from '@okikio/collection/record';
import * as wire from '@okikio/http/request';
import * as response from '@okikio/http/response';
import { readBytes } from '@okikio/http/response/body';
import type { ResponseDefinition } from '@okikio/http/response';
import type { ProblemBody, ProblemDefinition } from '@okikio/http/problem';

/** A rejected response is a protocol defect, not a declared business problem. */
export class ClientResponseError extends Error {
	/** HTTP status observed before body validation, if available. */
	readonly status: number;
	/** Retain the observed status without treating an undeclared response as a business outcome. */
	constructor(status: number, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ClientResponseError';
		this.status = status;
	}
}
/** Exact successful declaration; byte/HTML streams transfer the untouched native Response to the caller. */
type Body<Definition extends ResponseDefinition> = NonNullable<Definition['schema']> extends never ? unknown
	: ContractOutput<NonNullable<Definition['schema']>>;
/** HEAD owns no response body, including declarations whose GET representation is streamed. */
type Success<Definition, Method> = Definition extends ResponseDefinition ? Readonly<
		{
			kind: 'success';
			definition: Definition;
			value: Method extends 'head' ? undefined : Definition['mode'] extends 'stream' | 'download' | 'html' ? Response
			: Definition['mode'] extends 'empty' | 'redirect' ? undefined
			: Definition['mode'] extends 'page' ? readonly Body<Definition>[]
			: Body<Definition>;
			response: Response;
		}
	>
	: never;
/** Success and declared problems remain distinct; unknown statuses/types reject. */
export type OutcomeType<Operation extends EndpointOperation, Endpoint extends EndpointDefinition> =
	| Success<DefinitionEntry<NonNullable<Operation['responses']>>, Operation['method']>
	| Readonly<
		{
			kind: 'problem';
			definition: Extract<
				DefinitionEntry<NonNullable<Operation['problems'] | Endpoint['problems']>>,
				ProblemDefinition
			>;
			value: ProblemBody;
			response: Response;
		}
	>;
/** One endpoint's exact operation identity is required, avoiding string lookup drift. */
export interface Client<Definition extends EndpointDefinition> {
	/** Validate each request location once locally, then send its original wire representation. Server validation is independent. */
	call<Operation extends Definition['operations'][number]>(
		operation: Operation,
		input: InferEndpointWireInputs<MergeEndpointInputs<Definition['inputs'], Operation['inputs']>>,
		options?: CallOptions,
	): Promise<OutcomeType<Operation, Definition>>;
}
/** Call-scoped transport settings. Credentials are omitted unless deliberately selected. */
export interface CallOptions {
	/** Abort native fetch and bounded response reads; it does not prove a server-side effect was undone. */
	readonly signal?: AbortSignal;
	/** Native credential policy; default is omit. Browsers may prohibit explicit Cookie headers. */
	readonly credentials?: RequestCredentials;
}
/** Construction reads declarations only, and never invokes fetch or server resource factories. */
export interface Options {
	/** Absolute HTTP(S) mount prefix, without credentials, query or fragment. */
	readonly baseUrl: string | URL;
	/** Borrowed Fetch implementation. No ambient fallback or automatic retries. */
	readonly fetch: (
		request: Request,
		init: Pick<RequestInit, 'credentials' | 'redirect' | 'signal'>,
	) => Response | PromiseLike<Response>;
	/** Maximum normalized operations and response/problem declarations per operation. */
	readonly maximumDeclarations: number;
	/** JSON/raw request body and serialized form-text budget. Native File bytes are counted by size. */
	readonly maximumRequestBytes: number;
	/** Maximum bytes materialized for JSON success/problem responses. Streaming success transfers ownership instead. */
	readonly maximumResponseBytes: number;
}

/**
 * Call one imported endpoint through a caller-supplied Fetch transport.
 *
 * baseUrl supplies the full service/group mount prefix. Each call checks wire
 * input locally, then sends that original representation; server validation
 * remains independent. There are no implicit retries or redirect following.
 *
 * Body responses require a Codec or an owned identity schema because a general
 * validator cannot reverse its transformations. Use codec.identity() explicitly
 * when a third-party schema preserves the same representation.
 *
 * JSON responses are read within maximumResponseBytes. Stream, download and HTML
 * success return the untouched Response; the caller must consume or cancel it.
 * Request form budgets count names and payloads, not multipart framing overhead.
 */
export function create<const Definition extends EndpointDefinition>(
	definition: Definition,
	options: Options,
): Client<Definition> {
	for (const value of [options.maximumDeclarations, options.maximumRequestBytes, options.maximumResponseBytes]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('Client bounds must be non-negative safe integers.');
		}
	}
	const base = new URL(options.baseUrl);
	if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
		throw new TypeError('Client baseUrl must be an HTTP(S) mount prefix without credentials, query or fragment.');
	}
	if (typeof options.fetch !== 'function') throw new TypeError('Client requires a fetch capability.');
	if (definition.operations.length > options.maximumDeclarations) {
		throw new RangeError('Client exceeds maximumDeclarations.');
	}
	const transport = options.fetch;
	const requestMaximum = options.maximumRequestBytes, responseMaximum = options.maximumResponseBytes;
	const plans = new Map<
		EndpointOperation,
		{
			inputs: endpoint.EndpointInputSlots;
			successes: readonly ResponseDefinition[];
			problems: readonly ProblemDefinition[];
		}
	>();
	for (const operation of definition.operations) {
		const successes = catalog.values(operation.responses ?? []),
			problems = catalog.values([definition.problems ?? [], operation.problems ?? []]);
		if (successes.length + problems.length > options.maximumDeclarations) {
			throw new RangeError('Client exceeds maximumDeclarations.');
		}
		const statuses = new Set<number>();
		for (const entry of successes) {
			if (statuses.has(entry.status)) throw new TypeError('Client requires one successful declaration per status.');
			statuses.add(entry.status);
			if (entry.schema !== undefined && ['body', 'page'].includes(entry.mode)) codec.output(entry.schema);
		}
		plans.set(operation, { inputs: Object.freeze({ ...definition.inputs, ...operation.inputs }), successes, problems });
	}
	return Object.freeze(
		{
			/** Validate location inputs, send their wire representation, then classify the declared result. */
			async call(operation, input, callOptions = {}) {
				callOptions.signal?.throwIfAborted();
				const plan = plans.get(operation);
				if (!plan) throw new TypeError('Client operation does not belong to this endpoint.');
				const values: Readonly<Record<string, unknown>> = record.snapshot(input, 'client wire input');
				for (const key of Object.keys(values)) {
					if (!Object.hasOwn(plan.inputs, key)) {
						throw new TypeError('Client input has an undeclared location.');
					}
				}
				callOptions.signal?.throwIfAborted();
				const parameters = values.param === undefined ? {} : snapshot(values.param, 'client path parameters');
				let path = definition.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
					const value = parameters[key];
					if (typeof value !== 'string' || value === '' || value === '.' || value === '..') {
						throw new TypeError('Client path parameters need nonempty non-dot strings.');
					}
					return encodeURIComponent(value);
				});
				path = `${base.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
				const url = new URL(base.origin + path);
				const headers = new Headers();
				if (values.query !== undefined) pairs(values.query, (name, value) => url.searchParams.append(name, value));
				if (values.header !== undefined) pairs(values.header, (name, value) => headers.append(name, value));
				if (values.cookie !== undefined) {
					const cookies: string[] = [];
					pairs(values.cookie, (name, value) => {
						if (
							!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ||
							!/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)
						) throw new TypeError('Client cookies require valid opaque cookie octets.');
						cookies.push(`${name}=${value}`);
					});
					headers.set('cookie', cookies.join('; '));
				}
				// Serialization owns only this bounded request representation. Raw requests
				// are buffered here; a returned streaming response transfers its reader later.
				let body: BodyInit | undefined;
				if (Object.hasOwn(plan.inputs, 'json')) {
					body = json.stringify(values.json, {
						maximumDepth: 128,
						maximumNodes: 1_000_000,
						maximumStringCodeUnits: requestMaximum,
						maximumBytes: requestMaximum,
					});
					headers.set('content-type', 'application/json');
				} else if (Object.hasOwn(plan.inputs, 'form')) {
					const form = new FormData();
					let bytes = 0;
					for (const [name, field] of Object.entries(snapshot(values.form, 'client form input'))) {
						for (const item of Array.isArray(field) ? field : [field]) {
							if (typeof item !== 'string' && !(item instanceof Blob)) {
								throw new TypeError(
									'Client form values must be strings or native Blobs.',
								);
							}
							bytes += new TextEncoder().encode(name).byteLength +
								(typeof item === 'string' ? new TextEncoder().encode(item).byteLength : item.size);
							if (bytes > requestMaximum) throw new RangeError('Client form payload exceeds maximumRequestBytes.');
							form.append(name, item);
						}
					}
					body = form;
				} else if (Object.hasOwn(plan.inputs, 'raw')) {
					if (!(values.raw instanceof Request)) throw new TypeError('Raw client input requires a native Request.');
					body = new Uint8Array(await wire.readBody(values.raw, { maximumBodyBytes: requestMaximum }));
					for (const [name, value] of values.raw.headers) if (!headers.has(name)) headers.set(name, value);
				}
				const outgoing = new Request(url, {
					method: operation.method.toUpperCase(),
					headers,
					...(body === undefined ? {} : { body }),
					redirect: 'manual',
					credentials: callOptions.credentials ?? 'omit',
					...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
				});
				// Validate normalized wire values exactly once; application transforms are not wire encoders.
				for (const [source, slot] of Object.entries(plan.inputs)) {
					const parsing = endpoint.isInput(slot) ? slot.parsing : undefined;
					const value = source === 'param'
						? wire.parseParameters(
							`${base.pathname.replace(/\/$/, '')}/${definition.path.replace(/^\//, '')}`,
							url.pathname,
							parsing,
						)
						: source === 'query'
						? wire.parseQuery(url.search, parsing)
						: source === 'header'
						? wire.parseHeaders(outgoing.headers, parsing)
						: source === 'cookie'
						? wire.parseCookies(outgoing.headers.get('cookie'), parsing)
						: source === 'json'
						? JSON.parse(body as string)
						: source === 'raw'
						? outgoing
						: values[source];
					await schema.parse(endpoint.schemaOf(slot!), value);
				}
				callOptions.signal?.throwIfAborted();
				const incoming = await transport(outgoing, {
					credentials: callOptions.credentials ?? 'omit',
					redirect: 'manual',
					...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
				});
				if (callOptions.signal?.aborted) {
					cancel(incoming);
					throw callOptions.signal.reason;
				}
				const success = plan.successes.find((entry) => entry.status === incoming.status);
				if (!success && !plan.problems.some((entry) => entry.status === incoming.status)) {
					cancel(incoming);
					throw new ClientResponseError(incoming.status, 'Undeclared response status.');
				}
				const media = incoming.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
				// Status alone is insufficient: the media type and exact declared problem
				// type determine whether the peer fulfilled the imported contract.
				if (success) {
					const expected = response.mediaType(success)?.split(';', 1)[0]?.trim().toLowerCase();
					if (operation.method !== 'head' && expected !== undefined && media !== expected) {
						cancel(incoming);
						throw new ClientResponseError(incoming.status, 'Response media type differs from its declaration.');
					}
					if (success.mode === 'empty' || success.mode === 'redirect' || operation.method === 'head') {
						cancel(incoming);
						return { kind: 'success', definition: success, value: undefined, response: incoming } as OutcomeType<
							typeof operation,
							Definition
						>;
					}
					if (['stream', 'download', 'html'].includes(success.mode)) {
						return { kind: 'success', definition: success, value: incoming, response: incoming } as OutcomeType<
							typeof operation,
							Definition
						>;
					}
				}
				if (!success && media !== 'application/problem+json') {
					cancel(incoming);
					throw new ClientResponseError(incoming.status, 'Declared problem requires application/problem+json.');
				}
				let decoded: unknown;
				try {
					const bytes = await readBytes(incoming, responseMaximum, callOptions.signal);
					decoded = media === 'application/json' || media?.endsWith('+json')
						? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
						: media?.startsWith('text/')
						? new TextDecoder().decode(bytes)
						: bytes;
				} catch (cause) {
					if (callOptions.signal?.aborted) throw callOptions.signal.reason;
					throw new ClientResponseError(incoming.status, 'Response body is invalid or exceeds maximumResponseBytes.', {
						cause,
					});
				}
				if (!success) {
					if (!record.is(decoded)) throw new ClientResponseError(incoming.status, 'Invalid declared problem body.');
					const document = decoded;
					const problem = plan.problems.find((entry) =>
						entry.status === incoming.status && entry.type === document.type
					);
					if (
						!problem || decoded.status !== incoming.status || typeof decoded.title !== 'string' ||
						(decoded.detail !== undefined && typeof decoded.detail !== 'string') ||
						(decoded.instance !== undefined && typeof decoded.instance !== 'string')
					) throw new ClientResponseError(incoming.status, 'Unknown or invalid problem declaration.');
					if (problem.extensions) {
						await schema.parse(
							problem.extensions.schema,
							Object.fromEntries(
								Object.entries(decoded).filter(([key]) =>
									!['type', 'status', 'title', 'detail', 'instance'].includes(key)
								),
							),
						);
					}
					return { kind: 'problem', definition: problem, value: decoded, response: incoming } as OutcomeType<
						typeof operation,
						Definition
					>;
				}
				const enveloped = success.envelope === 'data' || success.timestamp || success.mode === 'page' ||
					record.is(decoded) && Object.hasOwn(decoded, 'meta');
				if (enveloped) {
					if (!record.is(decoded) || !Object.hasOwn(decoded, 'data')) {
						throw new ClientResponseError(
							incoming.status,
							'Missing success envelope.',
						);
					}
					decoded = decoded.data;
				}
				let value: unknown = decoded;
				if (success.mode === 'page') {
					if (!Array.isArray(decoded)) throw new ClientResponseError(incoming.status, 'Invalid page item array.');
					const items: unknown[] = [];
					for (const item of decoded) {
						items.push(success.schema === undefined ? item : await codec.read(success.schema, item));
					}
					value = Object.freeze(items);
				} else if (success.schema !== undefined) value = await codec.read(success.schema, decoded);
				return { kind: 'success', definition: success, value, response: incoming } as OutcomeType<
					typeof operation,
					Definition
				>;
			},
		} satisfies Client<Definition>,
	);
}

/** Flatten exact wire records without silently coercing objects, numbers or missing values. */
function pairs(value: unknown, append: (name: string, value: string) => void): void {
	record.assert(value, 'client wire record');
	for (
		const [name, field] of Object.entries(
			record.snapshot(value as Readonly<Record<string, unknown>>, 'client wire record'),
		)
	) {
		for (const item of Array.isArray(field) ? field : [field]) {
			if (typeof item !== 'string') {
				throw new TypeError('Client wire fields require strings or repeated strings.');
			}
			append(name, item);
		}
	}
}
/** Reject promptly while observing late cancellation; borrowed transport cleanup may outlive protocol failure. */
function cancel(value: Response): void {
	void value.body?.cancel('Client response rejected.').catch(() => {});
}

/** Inspect own data fields before transport serialization; accessors are not evaluated. */
function snapshot(value: unknown, label: string): Readonly<Record<string, unknown>> {
	record.assert(value, label);
	return record.snapshot(value, label);
}
