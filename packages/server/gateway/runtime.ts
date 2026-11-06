import * as streamReader from '@okikio/streams/reader';
import type { CatalogEntryIdentity } from '@okikio/collection/catalog';
import * as durationCore from '@okikio/duration';
import { joinPath } from '@okikio/server/endpoint/path';
import * as response from '@okikio/http/response';
import * as problem from '@okikio/http/problem';
import * as requestWire from '@okikio/http/request';
import { forward as forwardHeaders } from '@okikio/http/headers';
import { GatewayProblems } from './problems.ts';
import * as fault from '@okikio/result/fault';
import * as http from '../http/mod.ts';
import type {
	CompiledGateway,
	CompiledGatewayRoute,
	CreateGatewayOptions,
	GatewayObserverDefinition,
	GatewayObserverEvent,
	GatewayObserverEventKind,
	GatewayObserverHandler,
	GatewayRequestPatch,
	GatewayRequestState,
	GatewayRuntime,
	PreparedGatewayRequest,
	PrepareGatewayRequestOptions,
} from './types.ts';

const removedRequestHeaders = Object.freeze(
	new Set([
		'connection',
		'proxy-connection',
		'keep-alive',
		'proxy-authenticate',
		'proxy-authorization',
		'te',
		'trailer',
		'transfer-encoding',
		'upgrade',
		'host',
		'x-real-ip',
		'x-request-id',
		'traceparent',
		'tracestate',
	]),
);

const routeIndexCache = new WeakMap<CompiledGateway, ReadonlyMap<string, CompiledGatewayRoute>>();

/** Match one request against the compiler-prepared public route table. */
export function match(
	compiled: CompiledGateway,
	request: Pick<Request, 'method' | 'url'>,
): CompiledGatewayRoute | undefined {
	const pathname = new URL(request.url).pathname;
	const key = http.matchRoute(compiled.routePlan, request.method, pathname);
	return key === undefined ? undefined : routeIndex(compiled).get(key);
}

/**
 * Prepare one request for a trusted downstream hop using the gateway's generic transport rules.
 *
 * This is the same trust normalization used by compiled service forwarding: caller-owned
 * forwarding and reserved trust headers are removed, correlation is reconstructed, and
 * forwarding metadata is derived only from the host-trusted client address. It intentionally
 * does not choose a route or apply service credential policy, so application composition can
 * use it for provider proxy paths and unmatched frontend continuation without duplicating the
 * security-sensitive header mechanics.
 */
export async function prepare(
	request: Request,
	options: PrepareGatewayRequestOptions = {},
): Promise<PreparedGatewayRequest> {
	const correlation = await requestWire.correlation(
		request,
		options.requestId === undefined ? {} : { requestId: options.requestId },
	);
	const headers = sanitizedForwardHeaders(request.headers, options);
	for (const [name, value] of requestWire.propagationHeaders(correlation)) headers.set(name, value);
	applyForwardingHeaders(headers, request, options.clientIp?.(request));
	if (options.metadataHeaders?.requestId !== undefined) {
		headers.set(options.metadataHeaders.requestId, correlation.requestId);
	}
	return Object.freeze({
		request: new Request(request, { headers }),
		requestId: correlation.requestId,
		correlation,
	});
}

/** Create a fetch-compatible runtime from one compiled gateway. */
export function create(compiled: CompiledGateway, options: CreateGatewayOptions = {}): GatewayRuntime {
	validateRuntimeAdapters(compiled, options);
	const fetcher = options.fetch ?? globalThis.fetch;
	const observers = observerIndex(options.observers ?? []);
	return Object.freeze({
		fetch: async (request: Request) => {
			const correlation = await requestWire.correlation(
				request,
				options.requestId === undefined ? {} : { requestId: options.requestId },
			);
			const route = match(compiled, request);
			if (!route) {
				if (observed(compiled.definition.observers, 'denied')) {
					await emit(
						compiled.definition.observers,
						observers,
						event('denied', compiled.definition.id, correlation, request),
					);
				}
				return correlated(
					problemResponse(problem.create(GatewayProblems.NotFound, { instance: new URL(request.url).pathname })),
					correlation.requestId,
					options,
				);
			}
			return await forward(compiled, route, request, correlation, fetcher, options, observers);
		},
	});
}

/**
 * Forward one matched route under the caller signal and an optional gateway deadline. The response
 * body retains that deadline until completion; receiving headers alone does not finish the request.
 */
async function forward(
	compiled: CompiledGateway,
	route: CompiledGatewayRoute,
	request: Request,
	correlation: requestWire.RequestCorrelation,
	fetcher: typeof fetch,
	options: CreateGatewayOptions,
	observers: ReadonlyMap<GatewayObserverDefinition, GatewayObserverHandler>,
): Promise<Response> {
	// A controller is needed only for the gateway-owned deadline. The incoming
	// signal already owns caller cancellation when no deadline is configured.
	let signal = request.signal;
	let timer: ReturnType<typeof setTimeout> | undefined;
	if (route.timeout !== undefined) {
		const controller = new AbortController();
		signal = AbortSignal.any([request.signal, controller.signal]);
		timer = setTimeout(
			() => controller.abort(new DOMException('Gateway deadline exceeded.', 'TimeoutError')),
			timerMilliseconds(route.timeout),
		);
	}
	const requestId = correlation.requestId;
	const state = Object.freeze({ request, route, requestId, correlation, signal } satisfies GatewayRequestState);
	const base = (kind: GatewayObserverEventKind): GatewayObserverEvent =>
		event(kind, compiled.definition.id, correlation, request, route);
	const finish = (httpResponse: Response, forwarded = false): Response => {
		// Generated problems get correlation only. Upstream responses additionally
		// apply credentials and cache policy in the same sanitized header copy.
		const prepared = forwarded
			? forwardedResponse(httpResponse, route, requestId, options)
			: correlated(httpResponse, requestId, options);
		const abortable = abortableResponse(prepared, signal);
		// Completion tracking owns the deadline and declared terminal events only.
		// Caller cancellation still owns the abortable body when neither needs tracking.
		if (
			timer === undefined && !observed(route.observers, 'completed') &&
			!observed(route.observers, 'failed') && !observed(route.observers, 'aborted')
		) return abortable;
		return response.onComplete(abortable, async (completion) => {
			if (timer !== undefined) clearTimeout(timer);
			let kind: GatewayObserverEventKind = 'failed';
			if (completion.outcome === 'completed') kind = 'completed';
			else if (signal.aborted) kind = 'aborted';
			if (observed(route.observers, kind)) {
				await emit(
					route.observers,
					observers,
					Object.freeze({
						...base(kind),
						status: httpResponse.status,
						responseBytes: completion.bytes,
						completion: Object.freeze({ outcome: completion.outcome, bytes: completion.bytes }),
					}),
				);
			}
		});
	};
	const finishProblem = (value: problem.ProblemResult): Response => finish(problemResponse(value));
	try {
		signal.throwIfAborted();
		const headers = sanitizedHeaders(request.headers, route, options);
		for (const [name, value] of requestWire.propagationHeaders(correlation)) headers.set(name, value);
		applyForwardingHeaders(headers, request, options.clientIp?.(request));
		const authentication = await runAdapter(options.adapters?.authenticate, route.authenticate, state);
		if (problem.is(authentication)) return finishProblem(authentication);
		applyHeaders(headers, authentication?.headers);
		const assertion = await runAdapter(options.adapters?.assert, route.assertions, state);
		if (problem.is(assertion)) return finishProblem(assertion);
		applyHeaders(headers, assertion?.headers);
		applyMetadataHeaders(headers, route, requestId, options.metadataHeaders);

		const body = await boundedBody(request, route.bodyLimit, signal);
		if (body === tooLarge) {
			return finishProblem(problem.create(GatewayProblems.BodyTooLarge, {
				detail: `The request body exceeds ${route.bodyLimit} bytes.`,
				instance: new URL(request.url).pathname,
			}));
		}
		if (body === invalidBody) {
			return finishProblem(problem.create(GatewayProblems.InvalidRequest, {
				detail: 'The Content-Length header is invalid.',
				instance: new URL(request.url).pathname,
			}));
		}

		const source = new URL(request.url);
		const target = new URL(route.origin);
		target.pathname = joinPath(target.pathname, source.pathname);
		target.search = source.search;
		const upstreamBody = body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : body;
		const upstreamInit: RequestInit & { duplex?: 'half' } = {
			method: request.method,
			headers,
			...(upstreamBody !== undefined ? { body: upstreamBody, duplex: 'half' as const } : {}),
			redirect: 'manual',
			signal,
		};
		const upstream = new Request(target, upstreamInit);
		if (observed(route.observers, 'forwarding')) {
			await emit(
				route.observers,
				observers,
				Object.freeze({
					...base('forwarding'),
					...(body instanceof Uint8Array ? { requestBytes: body.byteLength } : contentLength(request)),
				}),
			);
		}
		const upstreamResponse = await fetcher(upstream);
		// A custom Fetch adapter can resolve after cancellation. Start retiring
		// its late body, but do not let a stalled cancel hook delay refusal or
		// replace the authoritative abort reason. discard observes cleanup errors.
		if (signal.aborted) {
			void response.discard(upstreamResponse, signal.reason);
			signal.throwIfAborted();
		}
		if (observed(route.observers, 'response')) {
			await emit(route.observers, observers, Object.freeze({ ...base('response'), status: upstreamResponse.status }));
		}
		const redirected = applyRedirectPolicy(upstreamResponse, route, source);
		if (problem.is(redirected)) {
			await response.discard(upstreamResponse, redirected);
			return finishProblem(redirected);
		}
		return finish(redirected, true);
	} catch (error) {
		if (request.signal.aborted) {
			if (timer !== undefined) clearTimeout(timer);
			if (observed(route.observers, 'aborted')) {
				await emit(
					route.observers,
					observers,
					Object.freeze({
						...base('aborted'),
						error: safeError(error),
					}),
				);
			}
			throw request.signal.reason;
		}
		await safeOnError(options, error, state);
		const aborted = signal.aborted;
		const kind = aborted ? 'aborted' : 'failed';
		if (observed(route.observers, kind)) {
			await emit(
				route.observers,
				observers,
				Object.freeze({ ...base(kind), error: safeError(error) }),
			);
		}
		if (aborted) {
			return finishProblem(problem.create(GatewayProblems.DeadlineExceeded, {
				instance: new URL(request.url).pathname,
				cause: error,
			}));
		}
		return finishProblem(problem.create(GatewayProblems.Unavailable, {
			instance: new URL(request.url).pathname,
			cause: error,
		}));
	}
}

/**
 * Invoke the host adapter only when this route declares requirements. The adapter owns the
 * authorization decision and must cooperate with state.signal; this call does not forcibly interrupt
 * host work.
 */
async function runAdapter(
	runtime:
		| ((
			requirements: readonly CatalogEntryIdentity[],
			state: GatewayRequestState,
		) =>
			| GatewayRequestPatch
			| problem.ProblemResult
			| void
			| Promise<GatewayRequestPatch | problem.ProblemResult | void>)
		| undefined,
	requirements: readonly CatalogEntryIdentity[],
	state: GatewayRequestState,
): Promise<GatewayRequestPatch | problem.ProblemResult | void> {
	if (requirements.length === 0) return undefined;
	if (!runtime) throw new TypeError('A required gateway runtime adapter was not supplied.');
	return await runtime(requirements, state);
}

/**
 * Checks required gateway runtime adapters before traffic starts.
 *
 * @internal
 */
function validateRuntimeAdapters(compiled: CompiledGateway, options: CreateGatewayOptions): void {
	if (compiled.routes.some((route) => route.authenticate.length > 0) && !options.adapters?.authenticate) {
		throw new TypeError('Compiled gateway requires an authentication runtime.');
	}
	if (compiled.routes.some((route) => route.assertions.length > 0) && !options.adapters?.assert) {
		throw new TypeError('Compiled gateway requires an assertion runtime.');
	}
	const handlers = new Map((options.observers ?? []).map((handler) => [handler.definition, handler] as const));
	for (const definition of compiled.definition.observers) {
		if (!handlers.has(definition)) {
			throw new TypeError(`Gateway observer ${JSON.stringify(definition.id)} has no runtime handler.`);
		}
	}
	for (const handler of options.observers ?? []) {
		if (!compiled.definition.observers.includes(handler.definition)) {
			throw new TypeError(
				`Gateway observer handler ${JSON.stringify(handler.definition.id)} is outside the compiled gateway.`,
			);
		}
	}
}

/**
 * Index host handlers by exact observer definition identity. Runtime validation rejects missing or
 * unrelated declarations before requests arrive.
 */
function observerIndex(
	handlers: readonly GatewayObserverHandler[],
): ReadonlyMap<GatewayObserverDefinition, GatewayObserverHandler> {
	return new Map(handlers.map((handler) => [handler.definition, handler] as const));
}

/** Avoid allocating diagnostic records when no declared observer accepts the event. */
function observed(definitions: readonly GatewayObserverDefinition[], kind: GatewayObserverEventKind): boolean {
	return definitions.some((definition) => definition.events.includes(kind));
}

/**
 * Await selected observers in declaration order and suppress their failures. A slow handler can still
 * delay forwarding or completion; observational means it cannot replace the routing result, not that
 * it runs in the background.
 */
async function emit(
	definitions: readonly GatewayObserverDefinition[],
	handlers: ReadonlyMap<GatewayObserverDefinition, GatewayObserverHandler>,
	value: GatewayObserverEvent,
): Promise<void> {
	for (const definition of definitions) {
		if (!definition.events.includes(value.kind)) continue;
		try {
			await handlers.get(definition)?.handle(value);
		} catch { /* observational handlers cannot alter routing */ }
	}
}

/**
 * Project routing identities and the URL pathname into immutable telemetry. Omit query strings, bodies
 * and credentials rather than copying the request into diagnostics.
 */
function event(
	kind: GatewayObserverEventKind,
	gatewayId: string,
	correlation: requestWire.RequestCorrelation,
	request: Request,
	route?: CompiledGatewayRoute,
): GatewayObserverEvent {
	const url = new URL(request.url);
	return Object.freeze({
		kind,
		gatewayId,
		requestId: correlation.requestId,
		traceId: correlation.traceId,
		spanId: correlation.spanId,
		method: request.method,
		pathname: url.pathname,
		...(route === undefined ? {} : {
			routeId: route.id,
			serviceId: route.serviceId,
			endpointId: route.endpointId,
			operationId: route.operationId,
		}),
	});
}

/** Bind compiler route identities to concrete gateway routes once per compiled gateway. */
function routeIndex(compiled: CompiledGateway): ReadonlyMap<string, CompiledGatewayRoute> {
	const existing = routeIndexCache.get(compiled);
	if (existing) return existing;
	const value = new Map<string, CompiledGatewayRoute>();
	for (const route of compiled.routes) {
		value.set(http.routeKey({ kind: 'route', method: route.method, path: route.path }), route);
	}
	routeIndexCache.set(compiled, value);
	return value;
}

/** Construct forwarding metadata only from gateway-owned request state. */
function applyForwardingHeaders(headers: Headers, request: Pick<Request, 'url'>, clientIp: string | undefined): void {
	const url = new URL(request.url);
	headers.set('x-forwarded-host', url.host);
	headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
	if (clientIp?.trim()) headers.set('x-forwarded-for', clientIp.trim());
}

/** Attach generic and host-selected request correlation headers to one gateway response. */
function correlated(value: Response, requestId: string, options: CreateGatewayOptions): Response {
	const headers = copyResponseHeaders(value.headers, true);
	applyCorrelationHeaders(headers, requestId, options);
	return new Response(value.body, { status: value.status, statusText: value.statusText, headers });
}

/** Apply trusted correlation after connection-nominated fields have been removed. */
function applyCorrelationHeaders(headers: Headers, requestId: string, options: CreateGatewayOptions): void {
	headers.set('x-request-id', requestId);
	if (options.metadataHeaders?.requestId !== undefined) headers.set(options.metadataHeaders.requestId, requestId);
}

/** Apply routing metadata only after client headers and adapter patches have been sanitized. */
function applyMetadataHeaders(
	headers: Headers,
	route: CompiledGatewayRoute,
	requestId: string,
	names: CreateGatewayOptions['metadataHeaders'],
): void {
	if (names?.requestId !== undefined) headers.set(names.requestId, requestId);
	if (names?.serviceId !== undefined) headers.set(names.serviceId, route.serviceId);
	if (names?.routeId !== undefined) headers.set(names.routeId, route.id);
}

const tooLarge = Symbol('gateway-body-too-large');
const invalidBody = Symbol('gateway-invalid-body');

/**
 * Validate transport length metadata, then buffer only routes with an explicit byte limit. Unbounded
 * routes retain the original stream and its backpressure instead of materializing the upload.
 */
async function boundedBody(
	request: Request,
	limit: number | undefined,
	signal: AbortSignal,
): Promise<ReadableStream<Uint8Array> | Uint8Array | undefined | typeof tooLarge | typeof invalidBody> {
	try {
		requestWire.parseContentLength(request.headers.get('content-length'));
	} catch (error) {
		if (
			error instanceof requestWire.RequestTransportError &&
			error.issues.some((issue) => issue.code === 'invalid-content-length')
		) return invalidBody;
		throw error;
	}
	if (request.body === null || request.method === 'GET' || request.method === 'HEAD') return undefined;
	// Preserve byte-for-byte streaming unless a policy explicitly requires a
	// bounded read. Raw webhooks and large uploads must not be collected by the
	// gateway merely because they pass through it.
	if (limit === undefined) return request.body;
	try {
		// Keep the current upload explicit when adding the gateway deadline.
		// An implicit Request-to-Request body transfer can reject the wrapper's
		// read on abort without forwarding cancellation to its original source.
		// readBody still owns prompt reader release and eventual source cleanup.
		const init: RequestInit & { duplex: 'half' } = { body: request.body, signal, duplex: 'half' };
		const bounded = new Request(request, init);
		return await requestWire.readBody(bounded, { maximumBodyBytes: limit });
	} catch (error) {
		if (!(error instanceof requestWire.RequestTransportError)) throw error;
		if (error.issues.some((issue) => issue.code === 'body-too-large')) return tooLarge;
		if (error.issues.some((issue) => issue.code === 'invalid-content-length')) return invalidBody;
		throw error;
	}
}

/**
 * Copy permitted forwarding fields, then apply the route's credential policy.
 * Request cookies and Authorization are stripped unless their policy allows them.
 * Gateway-owned trust metadata is removed before it can be reconstructed.
 *
 * @internal
 */
function sanitizedHeaders(input: Headers, route: CompiledGatewayRoute, options: CreateGatewayOptions): Headers {
	const output = sanitizedForwardHeaders(input, options);
	if (route.credentials.requestCookies === 'strip') output.delete('cookie');
	if (route.credentials.requestAuthorization !== 'preserve') output.delete('authorization');
	return output;
}

/** Remove caller-controlled transport and trust headers before a downstream hop is constructed. @internal */
function sanitizedForwardHeaders(input: Headers, options: PrepareGatewayRequestOptions): Headers {
	const output = forwardHeaders(input);
	// Headers iterators are live. Snapshot names so deletion cannot skip adjacent
	// reserved fields and allow a second client-controlled trust value through.
	for (const key of [...output.keys()]) {
		const normalized = key.toLowerCase();
		if (
			removedRequestHeaders.has(normalized) || trustedHeader(normalized, options) ||
			normalized === 'forwarded' || normalized.startsWith('x-forwarded-')
		) output.delete(key);
	}
	return output;
}

/** Return whether a client header is reserved for trusted gateway-owned adapter output. @internal */
function trustedHeader(name: string, options: PrepareGatewayRequestOptions): boolean {
	if (options.trustedRequestHeaders?.some((value) => value.toLowerCase() === name)) return true;
	if (options.trustedRequestHeaderPrefixes?.some((value) => name.startsWith(value.toLowerCase()))) return true;
	const metadata = options.metadataHeaders;
	return metadata?.requestId?.toLowerCase() === name;
}

/**
 * Apply trusted host adapter patches while rejecting hop-by-hop and forwarding metadata overrides.
 * Ordinary actor headers remain host authority, not caller input.
 */
function applyHeaders(headers: Headers, patch: Readonly<Record<string, string>> | undefined): void {
	if (!patch) return;
	for (const [key, value] of response.headerEntries(patch)) {
		const lower = key.toLowerCase();
		if (removedRequestHeaders.has(lower) || lower === 'forwarded' || lower.startsWith('x-forwarded-')) {
			throw new TypeError(`Trusted gateway patch cannot set ${JSON.stringify(key)}.`);
		}
		headers.set(key, value);
	}
}

/**
 * Apply upstream credential, cache and correlation policy with one header copy.
 *
 * Strip connection-nominated fields before adding gateway-owned policy values;
 * preserve separate cookies only when the route allows them. Generated problems
 * use correlation alone and must not inherit this upstream response policy.
 */
function forwardedResponse(
	value: Response,
	route: CompiledGatewayRoute,
	requestId: string,
	options: CreateGatewayOptions,
): Response {
	const headers = copyResponseHeaders(
		value.headers,
		route.credentials.responseCookies === 'preserve',
		value.body !== null,
	);
	if (route.cache.mode === 'no-store') {
		headers.set('Cache-Control', 'no-store');
		headers.set('Pragma', 'no-cache');
	}
	applyCorrelationHeaders(headers, requestId, options);
	return new Response(value.body, { status: value.status, statusText: value.statusText, headers });
}

/**
 * Inspect manual redirect responses without following them. Resolve relative locations against the
 * mounted origin, reject disallowed origins when configured, or replace a private origin with the
 * public request origin.
 */
function applyRedirectPolicy(
	value: Response,
	route: CompiledGatewayRoute,
	incoming: URL,
): Response | problem.ProblemResult {
	const location = value.headers.get('location');
	if (location === null || value.status < 300 || value.status > 399) return value;
	const resolved = new URL(location, route.origin);
	const allowed = new Set(route.redirects.allowedOrigins);
	if (
		route.redirects.mode === 'reject-cross-origin' && resolved.origin !== incoming.origin &&
		!allowed.has(resolved.origin)
	) {
		return problem.create(GatewayProblems.InvalidRedirect, {
			detail: 'The upstream redirect targets an unapproved origin.',
			instance: incoming.pathname,
		});
	}
	if (route.redirects.mode !== 'rewrite-origin' || resolved.origin !== new URL(route.origin).origin) return value;
	const rewritten = new URL(resolved.pathname + resolved.search + resolved.hash, incoming.origin);
	const headers = copyResponseHeaders(value.headers, true, value.body !== null);
	headers.set('Location', rewritten.href);
	return new Response(value.body, { status: value.status, statusText: value.statusText, headers });
}

/**
 * Remove hop-by-hop fields before applying response-cookie policy. Normalize gzip/br wire metadata for
 * native Fetch-decoded bodies; adapters for other encodings own their metadata contract.
 */
function copyResponseHeaders(input: Headers, includeCookies: boolean, upstreamBody = false): Headers {
	// Strip connection-nominated fields before credential policy; cookie preservation must not restore a removed hop field.
	const output = forwardHeaders(input);
	// Native Fetch in both supported runtimes decodes single gzip/br bodies while
	// retaining wire headers. Other codings differ between engines, so their
	// adapters must normalize metadata themselves. HEAD and empty wire bodies
	// retain representation metadata. Inspect before Connection can remove it.
	const encoding = input.get('content-encoding')?.trim().toLowerCase();
	if (upstreamBody && input.get('content-length')?.trim() !== '0' && (encoding === 'gzip' || encoding === 'br')) {
		output.delete('content-encoding');
		output.delete('content-length');
	}
	if (!includeCookies) output.delete('set-cookie');
	return output;
}

/**
 * Give response reads prompt cancellation while the reader owner retains late
 * source cleanup separately. The abort reason stays authoritative even when
 * the upstream cancel hook fails or never settles. Gateway currently exposes
 * no public API for callers to join that late cleanup outcome.
 */
function abortableResponse(value: Response, signal: AbortSignal): Response {
	if (value.body === null) return value;
	// Subscribe below rather than passing signal to open(): an already-expired
	// deadline still returns a 504 Response, with an aborted body, to the host.
	const owner = streamReader.open(value.body);
	let stopped = false;
	let controller: ReadableStreamDefaultController<Uint8Array>;
	const release = (): void => signal.removeEventListener('abort', abort);
	const abort = (): void => {
		if (stopped) return;
		stopped = true;
		release();
		// close releases the lock now. Its non-rejecting cleanup promise keeps
		// a late failure as data; do not await the source before rejecting reads.
		void owner.close(signal.reason);
		controller.error(signal.reason);
	};
	const body = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
		},
		async pull(value) {
			try {
				const next = await owner.read();
				if (stopped) return;
				if (!next.done) value.enqueue(next.value);
				else {
					stopped = true;
					release();
					value.close();
				}
			} catch (error) {
				if (stopped) return;
				stopped = true;
				release();
				value.error(error);
			}
		},
		async cancel(reason) {
			stopped = true;
			release();
			// An explicit consumer cancel joins cleanup; signal abort above does
			// not. Both paths still share the reader owner's single cancellation.
			const outcome = await owner.close(reason);
			if (outcome.status === 'failed') throw outcome.error;
		},
	}, { highWaterMark: 0 });
	return new Response(body, { status: value.status, statusText: value.statusText, headers: value.headers });
}

/**
 * Serialize an already-selected gateway ProblemResult into the problem+json transport representation.
 * This does not classify arbitrary exceptions.
 */
function problemResponse(result: problem.ProblemResult): Response {
	const [body, status, headers] = result;
	const normalized = response.toHeaders(
		response.mergeHeaders(headers, { 'Content-Type': 'application/problem+json; charset=utf-8' }),
	);
	return new Response(JSON.stringify(body), { status, headers: normalized });
}

/**
 * Await the optional host error observer without allowing its rejection to replace the transport
 * failure. A handler that never settles can still delay the response.
 */
async function safeOnError(options: CreateGatewayOptions, error: unknown, state: GatewayRequestState): Promise<void> {
	try {
		await options.onError?.(normalizeError(error), state);
	} catch { /* observers cannot replace original failure */ }
}

/**
 * Bound diagnostic depth and text, then mask common authorization and query-token patterns. This is a
 * limited diagnostic projection, not a general secret-redaction guarantee.
 */
function safeError(value: unknown): Readonly<{ readonly name: string; readonly message: string }> {
	const diagnostic = fault.encode(value, {
		maximumDepth: 2,
		maximumEntries: 8,
		maximumStringLength: 1_024,
		includeStack: false,
	});
	const name = fault.isRecord(diagnostic) && typeof diagnostic.name === 'string' ? diagnostic.name : 'UnknownError';
	const raw = fault.message(value, { maximumDepth: 2, maximumEntries: 8, maximumStringLength: 1_024 });
	const message = raw
		.replace(/(bearer|basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
		.replace(/([?&](?:token|api[_-]?key|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
		.slice(0, 1_024);
	return Object.freeze({ name, message });
}

/**
 * Report the declared request size when available. For streaming uploads this is transport metadata,
 * not a count of bytes already forwarded.
 */
function contentLength(request: Request): Readonly<{ readonly requestBytes: number }> | Record<never, never> {
	const value = requestWire.parseContentLength(request.headers.get('content-length'));
	return value === undefined ? Object.freeze({}) : Object.freeze({ requestBytes: value });
}

/**
 * Clamp an elapsed duration to the native timer range. Values beyond 2,147,483,647 milliseconds fire
 * at that cap; this implementation does not schedule successive slices for longer deadlines.
 */
function timerMilliseconds(value: Temporal.Duration): number {
	return Math.max(1, Math.min(2_147_483_647, durationCore.elapsed(value)));
}

/** Normalize JavaScript's unrestricted thrown values before exposing them to host callbacks. */
function normalizeError(reason: unknown): Error {
	return reason instanceof Error ? reason : new Error(fault.message(reason), { cause: reason });
}
