import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as catalog from '@okikio/catalog';
import * as fault from '@okikio/fault';

import * as endpoint from '@okikio/server/endpoint';
import * as http from '../http/mod.ts';
import * as context from '@okikio/context';
import type { Context, Owned } from '@okikio/context';
import type {
	MiddlewareContextDefinition,
	MiddlewareContextValue,
	MiddlewareDefinition,
	MiddlewareHandler,
	MiddlewareResourceResolver,
} from '@okikio/server/middleware';
import * as query from '@okikio/query';
import * as resilience from '@okikio/resilience';
import * as problem from '@okikio/http/problem';
import * as response from '@okikio/http/response';
import type { ResourceCollection, ResourceDefinition } from '@okikio/resource';
import * as resource from '@okikio/resource';
import * as requestWire from '@okikio/http/request';
import * as requirements from '@okikio/requirement';
import type { RequirementContext } from '@okikio/requirement';

import { ServerProblems } from '../problems.ts';
import type {
	CompiledService,
	CreateServiceOptions,
	EffectiveServiceOperation,
	ServiceConcernRuntimes,
	ServiceContextStore,
	ServiceRequestState,
	ServiceRequestStatePatch,
	ServiceInputValues,
	ServiceRuntime,
	ServiceRuntimeRoute,
	ServiceStageResult,
	ServiceConcernValues,
} from './types.ts';

/** Framework-owned problems that a service runtime may produce independently of endpoint declarations. */
const FrameworkProblemDefinitions: readonly problem.ProblemDefinition[] = Object.freeze(Object.values(ServerProblems));

/** Error raised when a compiled service is missing a required concern runtime. */
export class ServiceRuntimeConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ServiceRuntimeConfigurationError';
	}
}

/** Create a framework-neutral Fetch runtime from one fully compiled service. */
export function create<Host extends object, Concerns extends ServiceConcernValues = ServiceConcernValues>(
	compiled: CompiledService<import('./types.ts').ServiceDefinition, Host>,
	options: CreateServiceOptions<Host, Concerns>,
): ServiceRuntime {
	validateConcernRuntimes(compiled, options.concerns);
	const serviceContext = context.create({ id: `service:${compiled.definition.id}` });
	let resources: ResourceCollection;
	try {
		resources = resource.create(compiled.implementation.resources, {
			...(options.environment !== undefined ? { environment: options.environment } : {}),
			host: options.host,
			ctx: serviceContext,
			...(options.concerns?.requirements === undefined ? {} : { requirements: options.concerns.requirements }),
		});
	} catch (error) {
		void serviceContext[Symbol.asyncDispose]();
		throw error;
	}
	const middlewareByDefinition = new Map(
		compiled.implementation.middleware.map((handler) => [handler.definition, handler] as const),
	);
	let disposed = false;
	const routes = Object.freeze(compiled.operations.map((operation) => Object.freeze({
		method: operation.method.toUpperCase(),
		path: operation.path,
		handler(request: Request) {
			if (disposed) return new Response('Service runtime is disposed.', { status: 503 });
			return runOperation(operation, request, resources, serviceContext, middlewareByDefinition, options);
		},
	})).sort(compareServiceRoutes));
	const app = http.create({
		routes: routes.map((route) => http.route(route.method, route.path, route.handler)),
		notFound: (request) => http.problemResponse(problem.create(ServerProblems.NotFound, {
			instance: new URL(request.url).pathname,
		})),
	});

	return Object.freeze({
		routes,
		resources,
		fetch(request: Request) {
			if (disposed) return new Response('Service runtime is disposed.', { status: 503 });
			return app.fetch(request);
		},
		/**
		 * Releases owned state and waits for cleanup completion when used with `await using`.
		 *
		 * @internal
		 */
		async [Symbol.asyncDispose]() {
			if (disposed) return;
			disposed = true;
			try {
				await resources[Symbol.asyncDispose]();
			} finally {
				await serviceContext[Symbol.asyncDispose]();
			}
		},
	});
}

/** Order routes for adapters whose router resolves handlers by registration order. @internal */
function compareServiceRoutes(
	left: ServiceRuntimeRoute,
	right: ServiceRuntimeRoute,
): number {
	const path = http.compareRouteSpecificity(left.path, right.path);
	if (path !== 0) return -path;
	if (left.path === right.path) {
		if (left.method === 'HEAD' && right.method === 'GET') return -1;
		if (left.method === 'GET' && right.method === 'HEAD') return 1;
	}
	return 0;
}

/**
 * Execute one compiled service operation as a finite request.
 *
 * ```text
 * Request
 *   -> correlation + Context
 *   -> request middleware
 *   -> parse and validate input
 *   -> authentication and service concerns
 *   -> endpoint handler
 *   -> validate declared result
 *   -> response middleware
 *   -> Response
 *
 * any declared failure -> mapped HTTP problem
 * any unexpected fault -> runtime fault handling
 * ```
 *
 * The function uses only definitions and implementations selected by the
 * compiled service. Request-local state stays inside the request context.
 *
 * @internal
 */
async function runOperation<Host extends object, Concerns extends ServiceConcernValues>(
	operation: EffectiveServiceOperation,
	request: Request,
	resources: ResourceCollection,
	serviceContext: Context,
	middlewareByDefinition: ReadonlyMap<MiddlewareDefinition, MiddlewareHandler>,
	options: CreateServiceOptions<Host, Concerns>,
): Promise<Response> {
	let prepared: PreparedServiceRequestType;
	try {
		prepared = await prepareRequest(operation, request, serviceContext, options);
	} catch (error) {
		const setupError = error instanceof ServiceRequestSetupError
			? error
			: new ServiceRequestSetupError(normalizeError(error));
		const cause = setupError.cause instanceof Error ? setupError.cause : setupError;
		await reportError(options, cause);
		const result = http.problemResponse(problem.create(ServerProblems.Internal, {
			instance: new URL(request.url).pathname,
			cause,
		}));
		return setupError.requestId === undefined
			? result
			: http.withHeaders(result, { 'X-Request-ID': setupError.requestId });
	}
	const { requestId, requestContext, requestRequirements, values } = prepared;
	let activeRequest = request;
	let mutableState: MutableServiceRequestState<Host, Concerns> = {
		request: activeRequest,
		host: options.host,
		ctx: requestRequirements,
		input: Object.freeze({}),
		resources,
		values,
		operation,
		concerns: emptyConcernPatch<Concerns>(),
	};
	let disposed = false;
	const disposeRequest = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		await requestContext[Symbol.asyncDispose]();
		try { await requestWire.disposeMemo(activeRequest); } catch { /* cleanup remains best effort */ }
		if (activeRequest !== request) {
			try { await requestWire.disposeMemo(request); } catch { /* cleanup remains best effort */ }
		}
	};
	const finish = (httpResponse: Response): Response => {
		const completedResponse = http.withHeaders(httpResponse, { 'X-Request-ID': requestId });
		return response.onComplete(completedResponse, async (completion) => {
			await disposeRequest();
			try {
				await options.onResponseComplete?.(Object.freeze({
				requestId,
				operationId: operation.operation.id,
				method: operation.method,
				path: operation.path,
				status: completedResponse.status,
				completion,
			}));
			} catch {
				// Completion observers cannot change a response already in flight.
			}
		});
	};

	try {
		const bodyLimit = operation.resiliency.find((policy) => policy.type === 'body-limit');
		if (bodyLimit?.type === 'body-limit' && request.body !== null) {
			const bounded = await boundedRequest(request, bodyLimit.bytes);
			if (bounded === bodyTooLarge) {
				return finish(await toResponse(problem.create(ServerProblems.BodyTooLarge, {
					detail: `The request body exceeds ${bodyLimit.bytes} bytes.`,
					instance: new URL(request.url).pathname,
				}), activeRequest));
			}
			if (bounded === invalidBody) {
				return finish(await toResponse(problem.create(ServerProblems.InvalidRequest, {
					detail: 'The Content-Length header is invalid.',
					instance: new URL(request.url).pathname,
				}), activeRequest));
			}
			activeRequest = bounded;
			mutableState = { ...mutableState, request: activeRequest };
		}

		const pipeline = runMiddleware(
			operation.middleware.wholeRequest,
			mutableState,
			middlewareByDefinition,
			async () => await runMiddleware(
				operation.middleware.beforeValidation,
				mutableState,
				middlewareByDefinition,
				async () => await runAuthenticationAndValidation(),
			),
		);
		const result = await raceWithSignal(pipeline, requestContext.signal);
		return finish(await finalizeResult(operation, result, activeRequest));
	} catch (error) {
		if (request.signal.aborted) {
			await disposeRequest();
			throw request.signal.reason ?? new DOMException('Request aborted.', 'AbortError');
		}
		await reportError<Host, Concerns>(options, error, freezeState(mutableState));
		if (error instanceof context.ContextDeadlineExceededError) {
			return finish(await toResponse(problem.create(ServerProblems.DeadlineExceeded, {
				instance: new URL(request.url).pathname,
				cause: error,
			}), activeRequest));
		}
		return finish(await toResponse(problem.create(ServerProblems.Internal, {
			instance: new URL(request.url).pathname,
			cause: error,
		}), activeRequest));
	}

	/**
	 * Runs authentication and validation while preserving the module's cancellation and completion contract.
	 *
	 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
	 *
	 * @internal
	 */
	async function runAuthenticationAndValidation(): Promise<ServiceStageResult> {
		const authentication = await runConcern(
			options.concerns?.authenticate,
			operation.authentication,
			mutableState,
		);
		if (authentication.result !== undefined) return authentication.result;
		mutableState = applyPatch(mutableState, authentication.patch);

		const parsed = await parseInputs(operation, activeRequest, options.requestParsing);
		if (!parsed.success) {
			const unsupported = parsed.issues.some((issue) => issue.code === 'unsupported-content-type');
			return problem.create(unsupported ? ServerProblems.UnsupportedMediaType : ServerProblems.InvalidRequest, {
				detail: unsupported
					? 'The request Content-Type is not supported by this operation.'
					: 'One or more request values are invalid.',
				instance: new URL(request.url).pathname,
				extensions: { issues: parsed.issues },
			});
		}
		mutableState = { ...mutableState, input: parsed.input };

		return await runMiddleware(
			operation.middleware.afterValidation,
			mutableState,
			middlewareByDefinition,
			async () => {
				const enterOperation = async (): Promise<ServiceStageResult> => {
					let executionContext = mutableState.ctx;
					// Expose validated request state as one service-specific view. Permission
					// providers can inspect it without making @okikio/permission depend on HTTP.
					executionContext = context.view(executionContext, { service: freezeState(mutableState) }) as typeof executionContext;
					executionContext = requirements.bind(executionContext, operation.reachableRequirements);
					executionContext = options.context?.(executionContext, freezeState(mutableState), operation.reachableRequirements) ?? executionContext;
					await requirements.apply(executionContext, operation.requirements);
					mutableState = { ...mutableState, ctx: executionContext };

					const runAttempt = async (): Promise<ServiceStageResult> => await runMiddleware(
						operation.middleware.aroundOperation,
						mutableState,
						middlewareByDefinition,
						async () => await operation.handler.handle({
							request: activeRequest,
							host: options.host,
							input: mutableState.input,
							resources: createResourceResolver(resources, new Set(operation.resources), executionContext),
							ctx: executionContext,
							...mutableState.concerns,
						}),
					);
					return await runResilienceStage(operation, 'operation', mutableState, options, runAttempt);
				};

				return await runResilienceStage(operation, 'admission', mutableState, options, enterOperation);
			},
		);

	}
}

/**
 * Executes resilience stage as one finite phase of the module runtime.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
async function runResilienceStage<Host extends object, Concerns extends ServiceConcernValues>(
	operation: EffectiveServiceOperation,
	stage: import('@okikio/resilience').ResilienceStage,
	state: MutableServiceRequestState<Host, Concerns>,
	options: CreateServiceOptions<Host, Concerns>,
	next: () => Promise<ServiceStageResult>,
): Promise<ServiceStageResult> {
	const policies = Object.freeze(operation.resiliency.filter((policy) =>
		policy.type !== 'timeout' && policy.type !== 'body-limit' && resilience.stage(policy) === stage
	));
	if (policies.length === 0) return await next();
	return await options.concerns!.resilience!.run(policies, freezeState(state), next);
}



/**
 * Races request work with cancellation without detaching the losing operation from service-owned cleanup.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
async function raceWithSignal<Result>(promise: Promise<Result>, signal: AbortSignal): Promise<Result> {
	if (signal.aborted) throw cancellationReason(signal);
	return await new Promise<Result>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = (): void => finish(() => reject(cancellationReason(signal)));
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error)),
		);
	});
}

/**
 * Returns the cancellation reason carried by the current request context by the compiled service runtime.
 *
 * @internal
 */
function cancellationReason(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) return reason;
	return new context.ContextCancelledError(reason);
}

/** Request state prepared before the compiled middleware and handler pipeline starts. @internal */
interface PreparedServiceRequestType {
	readonly requestId: string;
	readonly requestContext: Owned;
	readonly requestRequirements: RequirementContext;
	readonly values: ServiceContextStore;
}

/** Setup error that preserves a request ID when correlation succeeded before setup failed. @internal */
class ServiceRequestSetupError extends Error {
	readonly requestId: string | undefined;

	constructor(cause: Error, requestId?: string) {
		super('Service request setup failed.', { cause });
		this.name = 'ServiceRequestSetupError';
		this.requestId = requestId;
	}
}

/** Prepare request-local context and requirements, releasing partial ownership if setup fails. @internal */
async function prepareRequest<Host extends object, Concerns extends ServiceConcernValues>(
	operation: EffectiveServiceOperation,
	request: Request,
	serviceContext: Context,
	options: CreateServiceOptions<Host, Concerns>,
): Promise<PreparedServiceRequestType> {
	let requestId: string | undefined;
	let requestContext: Owned | undefined;
	try {
		const timeout = operation.resiliency.find((policy) => policy.type === 'timeout');
		const correlation = await requestWire.correlation(
			request,
			options.requestId === undefined ? {} : { requestId: options.requestId },
		);
		requestId = correlation.requestId;
		const traceId = options.traceId?.(request) ?? correlation.traceId;
		const clock = serviceContext.clock;
		requestContext = context.child(serviceContext, {
			id: requestId,
			...(traceId !== undefined ? { traceId } : {}),
			signal: request.signal,
			...(timeout?.type === 'timeout' ? { deadline: clock.now().add(timeout.duration) } : {}),
		});
		const values = createContextStore();
		const requirementRuntime = options.concerns?.requirements ?? Object.freeze({
			interpreters: Object.freeze({}),
			unknown: 'reject' as const,
		});
		const requestRequirements = requirements.scope(requestContext, {
			interpreters: requirementRuntime.interpreters,
			unknown: requirementRuntime.unknown,
		});
		return Object.freeze({ requestId, requestContext, requestRequirements, values });
	} catch (error) {
		if (requestContext !== undefined) {
			try { await requestContext[Symbol.asyncDispose](); } catch { /* preserve the setup failure */ }
		}
		try { await requestWire.disposeMemo(request); } catch { /* cleanup remains best effort */ }
		throw new ServiceRequestSetupError(normalizeError(error), requestId);
	}
}

/**
 * Reports an unexpected service runtime error through the host error hook without changing the response contract.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
async function reportError<Host extends object, Concerns extends ServiceConcernValues>(
	options: CreateServiceOptions<Host, Concerns>,
	error: unknown,
	state?: ServiceRequestState<Host, Concerns>,
): Promise<void> {
	if (options.onError === undefined) return;
	try {
		await options.onError(normalizeError(error), state);
	} catch {
		// Error reporting is observational and must not replace the original
		// request failure or change its declared HTTP problem mapping.
	}
}

/**
 * Runs middleware while preserving the module's cancellation and completion contract.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
async function runMiddleware<Host extends object, Concerns extends ServiceConcernValues>(
	definitions: readonly MiddlewareDefinition[],
	state: MutableServiceRequestState<Host, Concerns>,
	handlers: ReadonlyMap<MiddlewareDefinition, MiddlewareHandler>,
	final: () => Promise<ServiceStageResult>,
): Promise<ServiceStageResult> {
	let index = -1;
	const dispatch = async (position: number): Promise<ServiceStageResult> => {
		if (position <= index) throw new TypeError('Middleware called next() more than once.');
		index = position;
		const definition = definitions[position];
		if (!definition) return await final();
		const handler = handlers.get(definition);
		if (!handler) throw new ServiceRuntimeConfigurationError(`Middleware ${definition.id} has no runtime handler.`);
		return await handler.handle({
			request: state.request,
			host: state.host,
			values: state.values,
			resources: createResourceResolver(state.resources, new Set(resourceClosure(definition.resources)), state.ctx),
			ctx: state.ctx,
		}, async () => await dispatch(position + 1)) as ServiceStageResult;
	};
	return await dispatch(0);
}

/**
 * Runs concern while preserving the module's cancellation and completion contract.
 *
 * @internal
 */
async function runConcern<Host extends object, Concerns extends ServiceConcernValues, Definition>(
	runtime: ((definitions: readonly Definition[], state: ServiceRequestState<Host, Concerns>) => Promise<ServiceRequestStatePatch<Concerns> | problem.ProblemResult | void>) | undefined,
	definitions: readonly Definition[],
	state: MutableServiceRequestState<Host, Concerns>,
	required = true,
): Promise<Readonly<{ readonly patch?: ServiceRequestStatePatch<Concerns>; readonly result?: problem.ProblemResult }>> {
	if (definitions.length === 0) return Object.freeze({});
	if (!runtime) {
		if (required) throw new ServiceRuntimeConfigurationError('A required service concern runtime was not supplied.');
		return Object.freeze({});
	}
	const result = await runtime(definitions, freezeState(state));
	if (problem.is(result)) return Object.freeze({ result });
	return result === undefined ? Object.freeze({}) : Object.freeze({ patch: result });
}

/**
 * Parses inputs into the validated internal model used by later phases.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
async function parseInputs(
	operation: EffectiveServiceOperation,
	request: Request,
	parsing: requestWire.RequestParsingOptions | undefined,
): Promise<
	| Readonly<{ readonly success: true; readonly input: ServiceInputValues }>
	| Readonly<{ readonly success: false; readonly issues: readonly requestWire.RequestValidationDetail[] }>
> {
	const input: Partial<Record<endpoint.EndpointInputSource, unknown>> = Object.create(null);
	const issues: requestWire.RequestValidationDetail[] = [];
	const bodyLimit = operation.resiliency.find((policy) => policy.type === 'body-limit');
	const maximumBodyBytes = bodyLimit?.type === 'body-limit' ? bodyLimit.bytes : parsing?.maximumBodyBytes;
	for (const source of ['param', 'query', 'header', 'cookie', 'json', 'form', 'raw'] as const) {
		const slot = operation.operation.inputs[source] ?? operation.endpoint.inputs[source];
		if (!slot) continue;
		let raw: unknown;
		try {
			const inputParsing = endpoint.isInput(slot) ? slot.parsing : undefined;
			raw = await rawInput(source, request, operation.path, {
				...(parsing ?? {}),
				...(inputParsing ?? {}),
				...(maximumBodyBytes === undefined ? {} : { maximumBodyBytes }),
			});
		} catch (error) {
			const sourceIssues = error instanceof requestWire.RequestTransportError
				? requestWire.validationDetails(source, error.issues)
				: [requestWire.validationDetail(source, {
					message: error instanceof Error ? error.message : fault.message(error),
				})];
			issues.push(...sourceIssues);
			continue;
		}
		const result = await endpoint.match(endpoint.schemaOf(slot), raw);
		if (!result.success) {
			issues.push(...requestWire.validationDetails(source, result.issues));
			continue;
		}
		input[source] = result.value;
	}
	return issues.length === 0
		? Object.freeze({ success: true, input: Object.freeze(input) })
		: Object.freeze({ success: false, issues: Object.freeze(issues) });
}

/**
 * Reads a request body as bounded raw bytes for endpoint operations that explicitly declare raw input.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
async function rawInput(
	source: 'param' | 'query' | 'header' | 'cookie' | 'json' | 'form' | 'raw',
	request: Request,
	routePath: string,
	options: requestWire.RequestParsingOptions,
): Promise<unknown> {
	const url = new URL(request.url);
	switch (source) {
		case 'param': return requestWire.parseParameters(routePath, url.pathname, options);
		case 'query': return requestWire.parseQuery(url.search, options);
		case 'header': return requestWire.parseHeaders(request.headers, options);
		case 'cookie': return requestWire.parseCookies(request.headers.get('cookie'), options);
		case 'json': return await requestWire.parseJson(request.clone(), options);
		case 'form': return await requestWire.parseForm(request.clone(), options);
		case 'raw': return request;
	}
}

/**
 * Builds or retrieves the finalize result returned by the compiled service runtime.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
async function finalizeResult(
	operation: EffectiveServiceOperation,
	result: ServiceStageResult,
	request: Request,
): Promise<Response> {
	if (result instanceof Response) {
		if (operation.operation.rawResponse) return result;
		return await toResponse(problem.create(ServerProblems.UndeclaredResult, {
			instance: new URL(request.url).pathname,
			cause: new TypeError('Raw Response values require rawResponse: true on the operation.'),
		}), request);
	}
	if (response.is(result)) {
		const definition = response.definitionOf(result);
		if (!operation.responses.includes(definition)) {
			return await toResponse(problem.create(ServerProblems.UndeclaredResult, {
				instance: new URL(request.url).pathname,
				cause: new TypeError(`Undeclared response ${definition.id}.`),
			}), request);
		}
		const validationIssues = await validateResponseBody(definition, result[0]);
		if (validationIssues.length > 0) return await toResponse(problem.create(ServerProblems.UndeclaredResult, {
			instance: new URL(request.url).pathname,
			cause: new TypeError(`Response ${definition.id} does not satisfy its schema: ${validationIssues.map((issue) => issue.message).join('; ')}`),
		}), request);
		const notModified = operation.responses.find((candidate) => candidate.status === 304 && candidate.mode === 'empty');
		if (notModified !== undefined && response.isNotModified(request, result[2])) {
			return await toResponse(response.create(notModified, undefined, {
				headers: response.conditionalHeaders(result[2]),
			}), request, operation);
		}
		return await toResponse(result, request, operation);
	}
	if (problem.is(result)) {
		const definition = problem.definitionOf(result);
		if (!operation.problems.includes(definition) && !FrameworkProblemDefinitions.includes(definition)) {
			return await toResponse(problem.create(ServerProblems.UndeclaredResult, {
				instance: new URL(request.url).pathname,
				cause: new TypeError(`Undeclared problem ${definition.id}.`),
			}), request);
		}
		return await toResponse(result, request);
	}
	return await toResponse(problem.create(ServerProblems.UndeclaredResult, {
		instance: new URL(request.url).pathname,
		cause: new TypeError('Endpoint handler returned neither a declared tuple nor a Response.'),
	}), request);
}

/**
 * Converts the source value to response expected by the compiled service runtime.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
async function toResponse(
	result: response.ResponseResult | problem.ProblemResult,
	request: Request,
	operation?: EffectiveServiceOperation,
	negotiate = true,
): Promise<Response> {
	const resolved = response.is(result)
		? response.finalize(result, {
			url: request.url,
			...(operation === undefined ? {} : { pagination: paginationParameters(operation, result[0]) }),
		})
		: { body: result[0], status: result[1], headers: result[2] };
	let body = resolved.body;
	let headers = resolved.headers;
	if (isAsyncIterable(body)) body = streamFromAsyncIterable(body);
	const contentType = responseContentType(result, body, headers);
	if (contentType !== undefined && !hasHeader(headers, 'Content-Type')) {
		headers = response.mergeHeaders(headers, { 'Content-Type': contentType });
	}
	if (negotiate && response.is(result) && contentType !== undefined && body !== null && body !== undefined) {
		try {
			requestWire.negotiateContent(request.headers.get('accept'), [contentType.split(';', 1)[0]!]);
		} catch (error) {
			if (error instanceof requestWire.RequestTransportError && error.issues.some((issue) => issue.code === 'not-acceptable')) {
				return await toResponse(problem.create(ServerProblems.NotAcceptable, {
					detail: `This operation produces ${contentType.split(';', 1)[0]}.`,
					instance: new URL(request.url).pathname,
					extensions: { supported: [contentType.split(';', 1)[0]] },
				}), request, undefined, false);
			}
			throw error;
		}
	}
	let bodyInit: BodyInit | null;
	if (body === null || body === undefined) bodyInit = null;
	else if (typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof ReadableStream) {
		bodyInit = body as BodyInit;
	} else {
		bodyInit = JSON.stringify(body);
	}
	return new Response(bodyInit, {
		status: resolved.status,
		headers: response.toHeaders(headers),
	});
}

/**
 * Selects the declared response media type that matches the finalized logical response body.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function responseContentType(
	result: response.ResponseResult | problem.ProblemResult,
	body: unknown,
	headers: response.ResponseHeaders,
): string | undefined {
	const explicit = response.headerValues(headers, 'Content-Type')[0];
	if (explicit !== undefined) return explicit;
	if (problem.is(result)) return 'application/problem+json; charset=utf-8';
	const definition = response.definitionOf(result);
	if (definition.contentType !== undefined) return definition.contentType;
	if (body === null || body === undefined) return undefined;
	if (definition.mode === 'html') return 'text/html; charset=utf-8';
	if (typeof body === 'string') return 'text/plain; charset=utf-8';
	if (body instanceof Blob && body.type.length > 0) return body.type;
	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof ReadableStream || definition.mode === 'stream' || definition.mode === 'download') {
		return 'application/octet-stream';
	}
	return 'application/json; charset=utf-8';
}

/**
 * Derives the pagination parameters from the query contract used by the compiled service runtime.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function paginationParameters(
	operation: EffectiveServiceOperation,
	body: unknown,
): Partial<response.PaginationParameters> {
	const slot = operation.operation.inputs.query ?? operation.endpoint.inputs.query;
	if (!slot) return Object.freeze({});
	const schema = endpoint.schemaOf(slot);
	if (!query.is(schema)) return Object.freeze({});
	const pageKind = typeof body === 'object' && body !== null && 'kind' in body
		? (body as { readonly kind?: unknown }).kind
		: undefined;
	if (pageKind !== 'cursor' && pageKind !== 'offset') return Object.freeze({});
	return query.paginationParameters(schema, pageKind) ?? Object.freeze({});
}

/**
 * Checks whether async iterable satisfies the condition required by the compiled service runtime.
 *
 * @internal
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<string | Uint8Array> {
	return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

/**
 * Reads a ReadableStream produced from an async iterable under the module's cancellation and ownership rules.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
function streamFromAsyncIterable(iterable: AsyncIterable<string | Uint8Array>): ReadableStream<Uint8Array> {
	const iterator = iterable[Symbol.asyncIterator]();
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		/**
		 * Pulls the next value only when the compiled service runtime is ready to accept it.
		 *
		 * @internal
		 */
		async pull(controller) {
			const { done, value } = await iterator.next();
			if (done) controller.close();
			else controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value);
		},
		/**
		 * Closes the source iterator when the response stream is cancelled by the compiled service runtime.
		 *
		 * @internal
		 */
		async cancel(reason) { await iterator.return?.(reason); },
	});
}

/**
 * Checks whether header is present for the compiled service runtime.
 *
 * @internal
 */
function hasHeader(headers: response.ResponseHeaders, name: string): boolean {
	const lower = name.toLowerCase();
	return Object.keys(headers).some((candidate) => candidate.toLowerCase() === lower);
}

/**
 * Creates context store while preserving the module's ownership rules.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
function createContextStore(): ServiceContextStore {
	const values = new Map<MiddlewareContextDefinition, unknown>();
	return Object.freeze({
		/**
		 * Checks whether the required state is present for the compiled service runtime.
		 *
		 * @internal
		 */
		has<Definition extends MiddlewareContextDefinition>(definition: Definition): boolean {
			return values.has(definition);
		},
		/**
		 * Gets state from the compiled service runtime after its ownership and validation rules have been established.
		 *
		 * @internal
		 */
		get<Definition extends MiddlewareContextDefinition>(definition: Definition): MiddlewareContextValue<Definition> {
			if (!values.has(definition)) {
				throw new TypeError(`Middleware context ${JSON.stringify(definition.id)} is unavailable.`);
			}
			return values.get(definition) as MiddlewareContextValue<Definition>;
		},
		/**
		 * Sets state on the internal builder or record used by the compiled service runtime.
		 *
		 * @internal
		 */
		set<Definition extends MiddlewareContextDefinition>(
			definition: Definition,
			value: MiddlewareContextValue<Definition>,
		): void {
			values.set(definition, value);
		},
	});
}


/**
 * Requires concrete resource definition before the compiled service runtime continues.
 *
 * @internal
 */
function requireConcreteResourceDefinition(
	definition: endpoint.EndpointResourceDefinition,
): ResourceDefinition {
	if (!isConcreteResourceDefinition(definition)) {
		throw new ServiceRuntimeConfigurationError(
			`Resource reference ${JSON.stringify(definition.id)} is not a concrete @okikio/resource definition.`,
		);
	}
	return definition;
}

/**
 * Checks whether concrete resource definition satisfies the condition required by the compiled service runtime.
 *
 * @internal
 */
function isConcreteResourceDefinition(
	definition: endpoint.EndpointResourceDefinition,
): definition is ResourceDefinition {
	return definition.kind === 'resource' &&
		'dependencies' in definition &&
		typeof (definition as { readonly dependencies?: unknown }).dependencies === 'object' &&
		(definition as { readonly dependencies?: unknown }).dependencies !== null;
}

/**
 * Creates resource resolver while preserving the module's ownership rules.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
function createResourceResolver(
	collection: ResourceCollection,
	allowed: ReadonlySet<ResourceDefinition>,
	ctx: RequirementContext,
): endpoint.EndpointResourceResolver & MiddlewareResourceResolver {
	return Object.freeze({
		/**
		 * Checks whether the required state is present for the compiled service runtime.
		 *
		 * @internal
		 */
		has<Definition extends endpoint.EndpointResourceDefinition>(definition: Definition): boolean {
			return isConcreteResourceDefinition(definition) && allowed.has(definition) && collection.has(definition);
		},
		/**
		 * Gets state from the compiled service runtime after its ownership and validation rules have been established.
		 *
		 * @internal
		 */
		async get<Definition extends endpoint.EndpointResourceDefinition>(
			definition: Definition,
		): Promise<endpoint.EndpointResourceValue<Definition>> {
			const concrete = requireConcreteResourceDefinition(definition);
			if (!allowed.has(concrete)) {
				throw new TypeError(`Resource ${JSON.stringify(concrete.id)} is outside the effective operation envelope.`);
			}
			return await collection.get(ctx, concrete) as endpoint.EndpointResourceValue<Definition>;
		},
	});
}

/**
 * Derives the exact resource-definition closure that one effective service operation may acquire.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
function resourceClosure(input: MiddlewareDefinition['resources']): ResourceDefinition[] {
	if (input === undefined) return [];
	const roots = catalog.values(input).map(requireConcreteResourceDefinition);
	const result: ResourceDefinition[] = [];
	const seen = new Set<ResourceDefinition>();
	const visit = (definition: ResourceDefinition): void => {
		if (seen.has(definition)) return;
		seen.add(definition);
		for (const dependency of Object.values(definition.dependencies)) visit(dependency);
		result.push(definition);
	};
	for (const root of roots) visit(root);
	return result;
}

/**
 * Snapshots state so later compilation cannot observe caller mutation.
 *
 * @internal
 */
function freezeState<Host extends object, Concerns extends ServiceConcernValues>(state: MutableServiceRequestState<Host, Concerns>): ServiceRequestState<Host, Concerns> {
	const { concerns, resources, ...base } = state;
	return Object.freeze({
		...concerns,
		...base,
		resources: createResourceResolver(resources, new Set(state.operation.resources), state.ctx),
	});
}

/**
 * Applies patch at the phase that owns its side effects.
 *
 * @internal
 */
function applyPatch<Host extends object, Concerns extends ServiceConcernValues>(
	state: MutableServiceRequestState<Host, Concerns>,
	patch: ServiceRequestStatePatch<Concerns> | undefined,
): MutableServiceRequestState<Host, Concerns> {
	if (patch === undefined) return state;
	const previousRequirements = state.concerns.requirements;
	const requirements = patch.requirements === undefined
		? previousRequirements
		: Object.freeze({ ...(previousRequirements ?? {}), ...patch.requirements }) as Concerns['requirements'];
	return {
		...state,
		concerns: {
			...state.concerns,
			...patch,
			...(requirements === undefined ? {} : { requirements }),
		},
	};
}

/**
 * Checks concern runtimes and preserves the deterministic issues needed by callers.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
function validateConcernRuntimes<Host extends object, Concerns extends ServiceConcernValues>(
	compiled: CompiledService,
	concerns: ServiceConcernRuntimes<Host, Concerns> | undefined,
): void {
	const required = [
		['authentication', compiled.operations.some((operation) => operation.authentication.length > 0), concerns?.authenticate],
	] as const;
	for (const [name, needed, runtime] of required) {
		if (needed && runtime === undefined) throw new ServiceRuntimeConfigurationError(`Service requires a ${name} runtime.`);
	}

	const activeFamilies = [...new Set(compiled.operations.flatMap((operation) => operation.requirements.map((entry) => entry.family)))];
	const requirementRuntime = concerns?.requirements;
	if (activeFamilies.length > 0 && requirementRuntime === undefined) {
		throw new ServiceRuntimeConfigurationError(`Service requires requirement interpreters for: ${activeFamilies.join(', ')}.`);
	}
	if (requirementRuntime?.unknown !== 'ignore') {
		for (const family of activeFamilies) {
			if (requirementRuntime?.interpreters[family] === undefined) {
				throw new ServiceRuntimeConfigurationError(`Service has no interpreter for active requirement family ${JSON.stringify(family)}.`);
			}
		}
	}
	const delegated = [...new Set(compiled.operations.flatMap((operation) =>
		operation.resiliency.filter((policy) => policy.type !== 'timeout' && policy.type !== 'body-limit')
	))];
	if (delegated.length === 0) return;
	const runtime = concerns?.resilience;
	if (runtime === undefined) {
		throw new ServiceRuntimeConfigurationError(
			`Service requires a resilience runtime for: ${[...new Set(delegated.map((policy) => policy.type))].join(', ')}.`,
		);
	}
	for (const policy of delegated) {
		if (!runtime.supports(policy)) {
			throw new ServiceRuntimeConfigurationError(`The resilience runtime does not support ${policy.type}.`);
		}
	}
}

/** Private sentinel that distinguishes the body-limit rejection from arbitrary handler errors. */
const bodyTooLarge = Symbol('service-body-too-large');
const invalidBody = Symbol('service-invalid-body');

/**
 * Applies the bounded request limit before the compiled service runtime accepts unbounded work or data.
 *
 * Service internals link exact endpoint and middleware definitions to implementations before traffic and preserve request-stage ownership at runtime.
 *
 * @internal
 */
async function boundedRequest(
	request: Request,
	limit: number,
): Promise<Request | typeof bodyTooLarge | typeof invalidBody> {
	let bytes: Uint8Array;
	try {
		bytes = await requestWire.readBody(request, { maximumBodyBytes: limit });
	} catch (error) {
		if (!(error instanceof requestWire.RequestTransportError)) throw error;
		if (error.issues.some((issue) => issue.code === 'body-too-large')) return bodyTooLarge;
		if (error.issues.some((issue) => issue.code === 'invalid-content-length')) return invalidBody;
		throw error;
	}
	const init: RequestInit & { readonly duplex: 'half' } = {
		method: request.method,
		headers: request.headers,
		body: new Uint8Array(bytes),
		redirect: request.redirect,
		signal: request.signal,
		duplex: 'half',
	};
	return new Request(request.url, init);
}

/**
 * Checks response body and preserves the deterministic issues needed by callers.
 *
 * It links service definitions to exact implementations before traffic and keeps request-stage ownership visible at runtime.
 *
 * @internal
 */
async function validateResponseBody(
	definition: response.ResponseDefinition,
	body: unknown,
): Promise<readonly StandardSchemaV1.Issue[]> {
	if (definition.schema === undefined || definition.mode === 'empty' || definition.mode === 'redirect') return Object.freeze([]);
	if (definition.mode !== 'page') {
		const result = await definition.schema['~standard'].validate(body);
		return Object.freeze(result.issues ? [...result.issues] : []);
	}
	if (typeof body !== 'object' || body === null || !Array.isArray((body as { readonly items?: unknown }).items)) {
		return Object.freeze([{ message: 'Paginated responses require a PageWindow body.', path: ['items'] }]);
	}
	const issues: StandardSchemaV1.Issue[] = [];
	const items = (body as { readonly items: readonly unknown[] }).items;
	for (let index = 0; index < items.length; index += 1) {
		const result = await definition.schema['~standard'].validate(items[index]);
		for (const issue of result.issues ?? []) issues.push({
			...issue,
			path: ['items', index, ...(issue.path ?? [])],
		});
	}
	return Object.freeze(issues);
}



/**
 * Creates the empty generic concern patch used before any concern runtime has
 * contributed values.
 *
 * TypeScript cannot prove that an empty object satisfies an optional mapped
 * type over an unresolved generic key set. The assertion is isolated here;
 * runtime construction contains no keys, so it cannot violate a concern value
 * contract.
 *
 * @internal
 */
function emptyConcernPatch<Concerns extends ServiceConcernValues>(): ServiceRequestStatePatch<Concerns> {
	return Object.freeze({}) as ServiceRequestStatePatch<Concerns>;
}

/** Internal mutable request state used while ordered concern stages progressively add validated values. */
interface MutableServiceRequestState<
	Host extends object,
	Concerns extends ServiceConcernValues,
> {
	request: Request;
	readonly host: Host;
	ctx: RequirementContext<Context>;
	readonly resources: ResourceCollection;
	readonly values: ServiceContextStore;
	readonly operation: EffectiveServiceOperation;
	input: ServiceInputValues;
	concerns: ServiceRequestStatePatch<Concerns>;
}

/** Normalize JavaScript's unrestricted thrown values before exposing them to host callbacks. */
function normalizeError(reason: unknown): Error {
	return reason instanceof Error ? reason : new Error(fault.message(reason), { cause: reason });
}
