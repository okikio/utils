import { SchemaValidationError } from '@okikio/schema';
import * as json from '@okikio/collection/record/json';
import * as catalog from '@okikio/collection/catalog';
import * as fault from '@okikio/result/fault';

import * as endpoint from '@okikio/server/endpoint';
import * as effect from '@okikio/capability/effect';
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
import * as problem from '@okikio/http/problem';
import * as response from '@okikio/http/response';
import type { ResourceCollection, ResourceDefinition } from '@okikio/capability/resource';
import * as resource from '@okikio/capability/resource';
import * as requestWire from '@okikio/http/request';
import * as requirements from '@okikio/capability/requirement';

import { ServerProblems } from '../problems.ts';
import type {
	CompiledService,
	CreateServiceOptions,
	EffectiveServiceOperation,
	ServiceContextStore,
	ServiceExecutionContext,
	ServiceInputValues,
	ServiceObserverDefinition,
	ServiceObserverEvent,
	ServiceObserverEventKind,
	ServiceObserverHandler,
	ServiceRequestState,
	ServiceRequestStatePatch,
	ServiceRequestValues,
	ServiceRuntime,
	ServiceRuntimeAdapters,
	ServiceRuntimeRoute,
	ServiceStageResult,
} from './types.ts';

/** Framework-owned problems that a service runtime may produce independently of endpoint declarations. */
import * as telemetry from '@okikio/telemetry/instrument';
const FrameworkProblemDefinitions = Object.freeze(
	Object.values(ServerProblems) satisfies readonly problem.ProblemDefinition[],
);

/** Share immutable fallback configuration while every request retains its own requirement scope. @internal */
const DefaultRequirementRuntime = Object.freeze(
	{
		interpreters: Object.freeze({}),
		unknown: 'reject',
	} satisfies requirements.RequirementRuntime,
);

/** An absent adapter contributes no request values or failure; its immutable result has no request authority. */
const EmptyAdapterResult = Promise.resolve(Object.freeze({}));

/** Definition-only envelopes belong to one runtime; request authority is never cached here. @internal */
interface ResourceEnvelopesType {
	readonly operations: WeakMap<EffectiveServiceOperation, ReadonlySet<ResourceDefinition>>;
	readonly middleware: WeakMap<MiddlewareDefinition, ReadonlySet<ResourceDefinition>>;
}

/**
 * Snapshot the compiled resource graph once before acquiring service ownership.
 *
 * Exact object identity selects each envelope. Compilation fixes these declarations;
 * neither a string ID nor Object.freeze() on arbitrary caller input proves identity
 * or authority. Keeping the maps local to create() also prevents one runtime from
 * retaining another runtime's graph. Resolvers still borrow the current request ctx.
 *
 * @internal
 */
function prepareResourceEnvelopes(operations: readonly EffectiveServiceOperation[]): ResourceEnvelopesType {
	const result: ResourceEnvelopesType = { operations: new WeakMap(), middleware: new WeakMap() };
	for (const operation of operations) {
		result.operations.set(operation, new Set(operation.resources));
		for (const definitions of Object.values(operation.middleware)) {
			for (const definition of definitions) {
				if (!result.middleware.has(definition)) {
					result.middleware.set(definition, new Set(resourceClosure(definition.resources)));
				}
			}
		}
	}
	return result;
}

/** Error raised when a compiled service is missing a required runtime adapter. */
export class ServiceRuntimeConfigurationError extends Error {
	/** Explain a missing or incompatible host capability before accepting live requests. */
	constructor(message: string) {
		super(message);
		this.name = 'ServiceRuntimeConfigurationError';
	}
}

/**
 * Create a Fetch application from a checked service plan, without opening a port.
 *
 * Pass application-owned clients through `options.host`; the runtime borrows them.
 * Its Context owns cancellation and the lazy collection owns resources constructed
 * by declared factories. Consume or cancel response bodies, then await disposal
 * to join owned cleanup. An empty host is sufficient when no factory needs clients.
 */
export function create<Host extends object, Values extends ServiceRequestValues = ServiceRequestValues>(
	compiled: CompiledService<import('./types.ts').ServiceDefinition, Host>,
	options: CreateServiceOptions<Host, Values>,
): ServiceRuntime {
	validateRuntimeAdapters(compiled, options.adapters);
	const observers = observerIndex(compiled.definition.observers, options.observers ?? []);
	const resourceEnvelopes = prepareResourceEnvelopes(compiled.operations);
	const serviceContext = context.create({
		id: `service:${compiled.definition.id}`,
		...(options.instrument === undefined ? {} : { instrument: options.instrument }),
	});
	let resources: ResourceCollection;
	try {
		resources = resource.create(compiled.implementation.resources, {
			...(options.environment !== undefined ? { environment: options.environment } : {}),
			...(options.source !== undefined ? { source: options.source } : {}),
			host: options.host,
			ctx: serviceContext,
			...(options.adapters?.requirements === undefined ? {} : { requirements: options.adapters.requirements }),
		});
	} catch (error) {
		void serviceContext[Symbol.asyncDispose]();
		throw error;
	}
	const middlewareByDefinition = new Map(
		compiled.implementation.middleware.map((handler) => [handler.definition, handler] as const),
	);
	let disposed = false;
	const routes = Object.freeze(
		compiled.operations.map((operation) =>
			Object.freeze({
				method: operation.method.toUpperCase(),
				path: operation.path,
				handler(request: Request) {
					if (disposed) return new Response('Service runtime is disposed.', { status: 503 });
					return observeOperation(
						operation,
						request,
						resources,
						serviceContext,
						middlewareByDefinition,
						resourceEnvelopes,
						observers,
						options,
					);
				},
			})
		).sort(compareServiceRoutes),
	);
	const app = http.create({
		routes: routes.map((route) => http.route(route.method, route.path, route.handler)),
		notFound: (request) =>
			http.problemResponse(problem.create(ServerProblems.NotFound, {
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
 *   -> authentication
 *   -> parse and validate input
 *   -> after-validation middleware + admission policies
 *   -> requirements + operation policies
 *   -> endpoint handler
 *   -> validate declared result
 *   -> response middleware
 *   -> Response headers available
 *   -> body EOF / cancellation / error
 *   -> request-context disposal + completion observation
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
async function serveOperation<Host extends object, Values extends ServiceRequestValues>(
	operation: EffectiveServiceOperation,
	request: Request,
	resources: ResourceCollection,
	serviceContext: Context,
	middlewareByDefinition: ReadonlyMap<MiddlewareDefinition, MiddlewareHandler>,
	resourceEnvelopes: ResourceEnvelopesType,
	observers: ReadonlyMap<ServiceObserverDefinition, ServiceObserverHandler>,
	options: CreateServiceOptions<Host, Values>,
): Promise<Response> {
	// An empty observer declaration needs no event snapshot or async emission.
	// Response completion still owns request cleanup whether observation exists or not.
	const observed = operation.service.observers.length > 0;
	let prepared: PreparedServiceRequestType;
	try {
		prepared = await prepareRequest(operation, request, serviceContext, options);
	} catch (error) {
		const setupError = error instanceof ServiceRequestSetupError
			? error
			: new ServiceRequestSetupError(normalizeError(error));
		const cause = setupError.cause instanceof Error ? setupError.cause : setupError;
		if (observed) {
			await emitObservers(
				operation.service.observers,
				observers,
				serviceEvent(
					'failed',
					operation,
					request,
					setupError.correlation,
					{ error: cause },
				),
			);
		}
		const result = http.problemResponse(problem.create(ServerProblems.Internal, {
			instance: new URL(request.url).pathname,
			cause,
		}));
		return setupError.requestId === undefined
			? result
			: http.withHeaders(result, { 'X-Request-ID': setupError.requestId });
	}
	const { requestId, requestContext, requestRequirements, values } = prepared;
	if (observed) {
		await emitObservers(operation.service.observers, observers, serviceEvent('started', operation, request, prepared));
	}
	let activeRequest = request;
	let mutableState: MutableServiceRequestState<Host, Values> = {
		request: activeRequest,
		host: options.host,
		ctx: requestRequirements,
		input: Object.freeze({}),
		resources,
		resourceEnvelopes,
		values,
		operation,
		requestValues: emptyValuePatch<Values>(),
	};
	let disposed = false;
	/** Release request authority once; response completion, rather than header creation, owns normal disposal. */
	const disposeRequest = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		await requestContext[Symbol.asyncDispose]();
		try {
			await requestWire.disposeMemo(activeRequest);
		} catch { /* cleanup remains best effort */ }
		if (activeRequest !== request) {
			try {
				await requestWire.disposeMemo(request);
			} catch { /* cleanup remains best effort */ }
		}
	};
	/** Attach correlation now and defer request teardown until the response body reaches a terminal outcome. */
	const finish = async (httpResponse: Response): Promise<Response> => {
		const completedResponse = http.withHeaders(httpResponse, { 'X-Request-ID': requestId });
		if (observed) {
			await emitObservers(
				operation.service.observers,
				observers,
				serviceEvent(
					'response',
					operation,
					activeRequest,
					prepared,
					{ status: completedResponse.status },
				),
			);
		}
		return response.onComplete(completedResponse, async (completion) => {
			await disposeRequest();
			const kind: ServiceObserverEventKind = completion.outcome === 'completed'
				? 'completed'
				: completion.outcome === 'cancelled'
				? 'aborted'
				: 'failed';
			if (observed) {
				await emitObservers(
					operation.service.observers,
					observers,
					serviceEvent(
						kind,
						operation,
						activeRequest,
						prepared,
						{
							status: completedResponse.status,
							responseBytes: completion.bytes,
							completion: Object.freeze({ outcome: completion.outcome, bytes: completion.bytes }),
							...(completion.reason === undefined ? {} : { error: completion.reason }),
						},
					),
				);
			}
		});
	};

	try {
		// Readers and middleware share the earliest owned deadline, including stalled bodies.
		// Supplying the borrowed stream explicitly retains its cancellation owner on every host.
		const originalBody = request.body;
		const scopedInit: RequestInit & { readonly duplex: 'half' } = {
			// Fetch forbids an explicit stream body in no-cors mode, even for an existing byte body.
			...(request.mode === 'no-cors' ? {} : { body: originalBody }),
			signal: requestContext.signal,
			duplex: 'half',
		};
		activeRequest = new Request(request, scopedInit);
		if (originalBody !== null && originalBody !== activeRequest.body && !originalBody.locked) {
			// Some hosts tee an inherited body instead of transferring it. Own the unused branch too.
			const cancelOriginal = (): void => {
				if (!originalBody.locked) {
					// The active reader records source cleanup failure without replacing its primary result.
					void originalBody.cancel(requestContext.signal.reason).catch(() => {});
				}
			};
			if (requestContext.signal.aborted) cancelOriginal();
			else {
				requestContext.signal.addEventListener('abort', cancelOriginal, { once: true });
				requestContext.defer(() => requestContext.signal.removeEventListener('abort', cancelOriginal));
			}
		}
		mutableState = { ...mutableState, request: activeRequest };
		context.check(requestContext);
		const bodyLimit = operation.execution.bodyLimit;
		if (bodyLimit !== undefined && request.body !== null) {
			const bounded = await boundedRequest(activeRequest, bodyLimit);
			if (bounded === bodyTooLarge) {
				return await finish(
					await toResponse(
						problem.create(ServerProblems.BodyTooLarge, {
							detail: `The request body exceeds ${bodyLimit} bytes.`,
							instance: new URL(request.url).pathname,
						}),
						activeRequest,
					),
				);
			}
			if (bounded === invalidBody) {
				return await finish(
					await toResponse(
						problem.create(ServerProblems.InvalidRequest, {
							detail: 'The Content-Length header is invalid.',
							instance: new URL(request.url).pathname,
						}),
						activeRequest,
					),
				);
			}
			activeRequest = bounded;
			mutableState = { ...mutableState, request: activeRequest };
		}

		const pipeline = runMiddleware(
			operation.middleware.wholeRequest,
			mutableState,
			middlewareByDefinition,
			async () =>
				await runMiddleware(
					operation.middleware.beforeValidation,
					mutableState,
					middlewareByDefinition,
					async () => await authenticateAndValidate(),
				),
		);
		const result = await raceWithSignal(pipeline, requestContext.signal);
		return await finish(await finalizeResult(operation, result, activeRequest));
	} catch (error) {
		if (request.signal.aborted) {
			if (observed) {
				await emitObservers(
					operation.service.observers,
					observers,
					serviceEvent(
						'aborted',
						operation,
						activeRequest,
						prepared,
						{ error: request.signal.reason ?? error },
					),
				);
			}
			await disposeRequest();
			throw request.signal.reason ?? new DOMException('Request aborted.', 'AbortError');
		}
		if (observed) {
			await emitObservers(
				operation.service.observers,
				observers,
				serviceEvent(
					'failed',
					operation,
					activeRequest,
					prepared,
					{ error },
				),
			);
		}
		if (error instanceof context.ContextDeadlineExceededError) {
			return await finish(
				await toResponse(
					problem.create(ServerProblems.DeadlineExceeded, {
						instance: new URL(request.url).pathname,
						cause: error,
					}),
					activeRequest,
				),
			);
		}
		return await finish(
			await toResponse(
				problem.create(
					error instanceof resource.UnavailableError ? ServerProblems.RuntimeUnavailable : ServerProblems.Internal,
					{
						instance: new URL(request.url).pathname,
						cause: error,
					},
				),
				activeRequest,
			),
		);
	}

	/**
	 * Authenticate before parsing endpoint input, then enter after-validation middleware.
	 * Admission policies wrap requirement enforcement; operation policies wrap each handler attempt.
	 * A retry repeats around-operation middleware and the handler, not authentication or input parsing.
	 *
	 * @internal
	 */
	async function authenticateAndValidate(): Promise<ServiceStageResult> {
		const authentication = await runAdapter(
			options.adapters?.authenticate,
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
				/** Bind validated request state and requirements before admitting any retryable handler attempt. */
				const enterOperation = async (): Promise<ServiceStageResult> => {
					let executionContext = mutableState.ctx;
					// Expose validated request state as one service-specific view. Permission
					// providers can inspect it without making @okikio/authz/permission depend on HTTP.
					executionContext = context.view(executionContext, {
						service: freezeState(mutableState),
					}) as typeof executionContext;
					executionContext = requirements.bind(executionContext, operation.reachableRequirements);
					executionContext = options.requirementContext?.(
						executionContext,
						freezeState(mutableState),
						operation.reachableRequirements,
					) ?? executionContext;
					await requirements.apply(executionContext, operation.requirements);
					mutableState = { ...mutableState, ctx: executionContext };

					/** Each retry reenters only around-operation middleware and the exact endpoint handler. */
					const runAttempt = async (): Promise<ServiceStageResult> =>
						await runMiddleware(
							operation.middleware.aroundOperation,
							mutableState,
							middlewareByDefinition,
							async () =>
								await operation.handler.handle({
									request: activeRequest,
									host: options.host,
									input: mutableState.input,
									resources: createResourceResolver(
										resources,
										resourceEnvelopes.operations.get(operation)!,
										executionContext,
									),
									ctx: executionContext,
									...mutableState.requestValues,
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
 * Apply the compiled policies for admission or an operation attempt.
 * Empty stages forward the downstream promise. Active policies receive a frozen
 * request-state view and may retry or replace the result through the configured
 * adapter. Synchronous adapter failures remain rejections of this stage.
 *
 * @internal
 */
function runResilienceStage<Host extends object, Values extends ServiceRequestValues>(
	operation: EffectiveServiceOperation,
	stage: 'admission' | 'operation',
	state: MutableServiceRequestState<Host, Values>,
	options: CreateServiceOptions<Host, Values>,
	next: () => Promise<ServiceStageResult>,
): Promise<ServiceStageResult> {
	try {
		const policies = stage === 'admission' ? operation.execution.admission : operation.execution.operation;
		// An absent stage cannot inspect or replace its downstream result.
		return policies.length === 0
			? next()
			: Promise.resolve(options.adapters!.resilience!.run(policies, freezeState(state), next));
	} catch (error) {
		return Promise.reject(error);
	}
}

/**
 * Stop waiting when cancellation wins while observing both eventual outcomes of the work Promise.
 * This race does not stop or join arbitrary handler work; cooperative work must use the request context.
 *
 * @internal
 */
async function raceWithSignal<Result>(promise: Promise<Result>, signal: AbortSignal): Promise<Result> {
	return await new Promise<Result>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = (): void => finish(() => reject(cancellationReason(signal)));
		// Observe work even when cancellation was visible before the race began.
		promise.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error)),
		);
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Preserve Error cancellation identity; wrap other JavaScript reasons in the Context cancellation error.
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
	readonly traceId: string;
	readonly spanId: string;
	readonly requestContext: Owned;
	readonly requestRequirements: ServiceExecutionContext;
	readonly values: ServiceContextStore;
}

/** Setup error that preserves a request ID when correlation succeeded before setup failed. @internal */
class ServiceRequestSetupError extends Error {
	readonly correlation: Readonly<{ readonly requestId?: string; readonly traceId?: string; readonly spanId?: string }>;

	/** Keep correlation fields already established before setup failed, while retaining the original cause. */
	constructor(
		cause: Error,
		correlation: Readonly<{ readonly requestId?: string; readonly traceId?: string; readonly spanId?: string }> = Object
			.freeze({}),
	) {
		super('Service request setup failed.', { cause });
		this.name = 'ServiceRequestSetupError';
		this.correlation = Object.freeze({ ...correlation });
	}

	/** Supply the known request ID to error reporting even though no complete request context was created. */
	get requestId(): string | undefined {
		return this.correlation.requestId;
	}
}

/** Prepare request-local context and requirements, releasing partial ownership if setup fails. @internal */
async function prepareRequest<Host extends object, Values extends ServiceRequestValues>(
	operation: EffectiveServiceOperation,
	request: Request,
	serviceContext: Context,
	options: CreateServiceOptions<Host, Values>,
): Promise<PreparedServiceRequestType> {
	let requestId: string | undefined;
	let traceId: string | undefined;
	let spanId: string | undefined;
	let requestContext: Owned | undefined;
	try {
		const timeout = operation.execution.timeout;
		const correlation = await requestWire.correlation(
			request,
			options.requestId === undefined ? {} : { requestId: options.requestId },
		);
		requestId = correlation.requestId;
		traceId = options.traceId?.(request) ?? correlation.traceId;
		spanId = correlation.spanId;
		const clock = serviceContext.clock;
		requestContext = context.child(serviceContext, {
			id: requestId,
			...(traceId !== undefined ? { traceId } : {}),
			signal: request.signal,
			...(timeout === undefined ? {} : { deadline: clock.now().add(timeout) }),
		});
		const values = createContextStore();
		const requirementRuntime = options.adapters?.requirements ?? DefaultRequirementRuntime;
		const requestEffects = effect.scope(requestContext, {
			effects: operation.effects,
			...(options.adapters?.effect === undefined ? {} : { emitter: options.adapters.effect }),
		});
		const requestRequirements = requirements.scope(requestEffects, {
			interpreters: requirementRuntime.interpreters,
			unknown: requirementRuntime.unknown,
		});
		return Object.freeze({ requestId, traceId, spanId, requestContext, requestRequirements, values });
	} catch (error) {
		if (requestContext !== undefined) {
			try {
				await requestContext[Symbol.asyncDispose]();
			} catch { /* preserve the setup failure */ }
		}
		try {
			await requestWire.disposeMemo(request);
		} catch { /* cleanup remains best effort */ }
		throw new ServiceRequestSetupError(normalizeError(error), { requestId, traceId, spanId });
	}
}

/** Index exact observer handlers and reject definitions that cannot be observed at runtime. @internal */
function observerIndex(
	definitions: readonly ServiceObserverDefinition[],
	handlers: readonly ServiceObserverHandler[],
): ReadonlyMap<ServiceObserverDefinition, ServiceObserverHandler> {
	const expected = new Set(definitions);
	const result = new Map<ServiceObserverDefinition, ServiceObserverHandler>();
	for (const handler of handlers) {
		if (!expected.has(handler.definition)) {
			throw new ServiceRuntimeConfigurationError(
				`Observer ${JSON.stringify(handler.definition.id)} is not imported by this service.`,
			);
		}
		if (result.has(handler.definition)) {
			throw new ServiceRuntimeConfigurationError(
				`Observer ${JSON.stringify(handler.definition.id)} has more than one runtime handler.`,
			);
		}
		result.set(handler.definition, handler);
	}
	for (const definition of definitions) {
		if (!result.has(definition)) {
			throw new ServiceRuntimeConfigurationError(
				`Observer ${JSON.stringify(definition.id)} has no runtime handler.`,
			);
		}
	}
	return result;
}

/** Await selected observers in declaration order and contain their failures; observers must bound their own latency. @internal */
async function emitObservers(
	definitions: readonly ServiceObserverDefinition[],
	handlers: ReadonlyMap<ServiceObserverDefinition, ServiceObserverHandler>,
	value: ServiceObserverEvent,
): Promise<void> {
	for (const definition of definitions) {
		if (!definition.events.includes(value.kind)) continue;
		const handler = handlers.get(definition);
		if (!handler) continue;
		try {
			await handler.handle(value);
		} catch {
			// Diagnostics are observational. A broken observer must not change the
			// service response, cancellation, or cleanup contract.
		}
	}
}

/** Project route/correlation metadata without headers or bodies. Error names/messages remain sensitive caller diagnostics. @internal */
function serviceEvent(
	kind: ServiceObserverEventKind,
	operation: EffectiveServiceOperation,
	request: Request,
	correlation:
		| Readonly<{ readonly requestId?: string; readonly traceId?: string; readonly spanId?: string }>
		| undefined,
	details: Readonly<{
		readonly status?: number;
		readonly responseBytes?: number;
		readonly completion?: Readonly<{ readonly outcome: 'completed' | 'cancelled' | 'errored'; readonly bytes: number }>;
		readonly error?: unknown;
	}> = Object.freeze({}),
): ServiceObserverEvent {
	const normalized = details.error === undefined ? undefined : normalizeError(details.error);
	return Object.freeze({
		kind,
		serviceId: operation.service.id,
		...(correlation?.requestId === undefined ? {} : { requestId: correlation.requestId }),
		...(correlation?.traceId === undefined ? {} : { traceId: correlation.traceId }),
		...(correlation?.spanId === undefined ? {} : { spanId: correlation.spanId }),
		method: request.method.toUpperCase(),
		path: operation.path,
		endpointId: operation.endpoint.id,
		operationId: operation.operation.operationId,
		...(details.status === undefined ? {} : { status: details.status }),
		...(details.responseBytes === undefined ? {} : { responseBytes: details.responseBytes }),
		...(details.completion === undefined ? {} : { completion: details.completion }),
		...(normalized === undefined
			? {}
			: { error: Object.freeze({ name: normalized.name, message: normalized.message }) }),
	});
}

/**
 * Run one compiled middleware stage with a request-local continuation guard.
 * Empty stages forward the final promise. Each declared middleware resolves by
 * exact definition identity and borrows only its prepared resource envelope.
 * Calling a continuation twice rejects before downstream work repeats.
 *
 * @internal
 */
function runMiddleware<Host extends object, Values extends ServiceRequestValues>(
	definitions: readonly MiddlewareDefinition[],
	state: MutableServiceRequestState<Host, Values>,
	handlers: ReadonlyMap<MiddlewareDefinition, MiddlewareHandler>,
	final: () => Promise<ServiceStageResult>,
): Promise<ServiceStageResult> {
	if (definitions.length === 0) {
		try {
			context.check(state.ctx);
			return final();
		} catch (error) {
			return Promise.reject(error);
		}
	}
	let index = -1;
	/** Advance one monotonic continuation index before entering user code to reject reentrant duplicate next calls. */
	const dispatch = async (position: number): Promise<ServiceStageResult> => {
		context.check(state.ctx);
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
			resources: createResourceResolver(
				state.resources,
				state.resourceEnvelopes.middleware.get(definition)!,
				state.ctx,
			),
			ctx: state.ctx,
		}, async () => await dispatch(position + 1)) as ServiceStageResult;
	};
	return dispatch(0);
}

/**
 * Apply declared runtime capabilities to a frozen request-state view.
 * An empty declaration shares a frozen empty result that contains no request
 * authority. Active adapters may return a value patch or a problem; their
 * synchronous failures become rejections without changing failure identity.
 *
 * @internal
 */
function runAdapter<Host extends object, Values extends ServiceRequestValues, Definition>(
	runtime:
		| ((
			definitions: readonly Definition[],
			state: ServiceRequestState<Host, Values>,
		) => Promise<ServiceRequestStatePatch<Values> | problem.ProblemResult | void>)
		| undefined,
	definitions: readonly Definition[],
	state: MutableServiceRequestState<Host, Values>,
	required = true,
): Promise<Readonly<{ readonly patch?: ServiceRequestStatePatch<Values>; readonly result?: problem.ProblemResult }>> {
	if (definitions.length === 0) return EmptyAdapterResult;
	if (!runtime) {
		if (required) {
			return Promise.reject(
				new ServiceRuntimeConfigurationError('A required service runtime adapter was not supplied.'),
			);
		}
		return EmptyAdapterResult;
	}
	try {
		return Promise.resolve(runtime(definitions, freezeState(state))).then((result) => {
			if (problem.is(result)) return Object.freeze({ result });
			return result === undefined ? EmptyAdapterResult : Object.freeze({ patch: result });
		});
	} catch (error) {
		return Promise.reject(error);
	}
}

/**
 * Read each compiled input slot under transport policy, then validate it once with its endpoint schema.
 * Typed transport/schema failures become client issues; unexpected reader defects propagate as runtime faults.
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
	const maximumBodyBytes = operation.execution.bodyLimit ?? parsing?.maximumBodyBytes;
	for (const { source, slot } of operation.execution.inputs) {
		let raw: unknown;
		try {
			const inputParsing = endpoint.isInput(slot) ? slot.parsing : undefined;
			raw = await rawInput(source, request, operation.path, {
				...(parsing ?? {}),
				...(inputParsing ?? {}),
				...(maximumBodyBytes === undefined ? {} : { maximumBodyBytes }),
			});
		} catch (error) {
			// Only typed wire failures are safe client validation issues. An arbitrary
			// reader or configuration failure may contain private provider diagnostics;
			// let the operation's Internal response retain its cause outside the body.
			if (!(error instanceof requestWire.RequestTransportError)) throw error;
			issues.push(...requestWire.validationDetails(source, error.issues));
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
 * Select the declared request source. JSON/form use bounded memoized parsers; raw forwards the Request itself.
 * Raw consumers own body reading policy unless a compiled body-limit policy already collected it.
 *
 * @internal
 */
async function rawInput(
	source: 'param' | 'query' | 'header' | 'cookie' | 'json' | 'form' | 'raw',
	request: Request,
	routePath: string,
	options: requestWire.RequestParsingOptions,
): Promise<unknown> {
	switch (source) {
		case 'param':
			return requestWire.parseParameters(routePath, new URL(request.url).pathname, options);
		case 'query':
			return requestWire.parseQuery(new URL(request.url).search, options);
		case 'header':
			return requestWire.parseHeaders(request.headers, options);
		case 'cookie':
			return requestWire.parseCookies(request.headers.get('cookie'), options);
		case 'json':
			return await requestWire.parseJson(request, options);
		case 'form':
			return await requestWire.parseForm(request, options);
		case 'raw':
			return request;
	}
}

/**
 * Accept exact declared response/problem definitions and validate their values before materialization.
 * A raw Response requires explicit rawResponse; undeclared output becomes a framework problem.
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
		return await toResponse(
			problem.create(ServerProblems.UndeclaredResult, {
				instance: new URL(request.url).pathname,
				cause: new TypeError('Raw Response values require rawResponse: true on the operation.'),
			}),
			request,
		);
	}
	if (response.is(result)) {
		const definition = response.definitionOf(result);
		if (!operation.responses.includes(definition)) {
			return await toResponse(
				problem.create(ServerProblems.UndeclaredResult, {
					instance: new URL(request.url).pathname,
					cause: new TypeError(`Undeclared response ${definition.id}.`),
				}),
				request,
			);
		}
		let prepared: response.ResponseResult;
		try {
			prepared = await response.prepare(result);
		} catch (error) {
			if (!(error instanceof SchemaValidationError) && !(error instanceof TypeError)) throw error;
			return await toResponse(
				problem.create(ServerProblems.UndeclaredResult, {
					instance: new URL(request.url).pathname,
					cause: error,
				}),
				request,
			);
		}
		const notModified = operation.responses.find((candidate) => candidate.status === 304 && candidate.mode === 'empty');
		if (notModified !== undefined && response.isNotModified(request, result[2])) {
			return await toResponse(
				response.create(notModified, undefined, {
					headers: response.conditionalHeaders(result[2]),
				}),
				request,
				operation,
			);
		}
		return await toResponse(prepared, request, operation);
	}
	if (problem.is(result)) {
		const definition = problem.definitionOf(result);
		if (!operation.problems.includes(definition) && !FrameworkProblemDefinitions.includes(definition)) {
			return await toResponse(
				problem.create(ServerProblems.UndeclaredResult, {
					instance: new URL(request.url).pathname,
					cause: new TypeError(`Undeclared problem ${definition.id}.`),
				}),
				request,
			);
		}
		return await toResponse(result, request);
	}
	return await toResponse(
		problem.create(ServerProblems.UndeclaredResult, {
			instance: new URL(request.url).pathname,
			cause: new TypeError('Endpoint handler returned neither a declared tuple nor a Response.'),
		}),
		request,
	);
}

/**
 * Materialize a prepared response or problem, attach media/pagination headers, and negotiate Accept.
 * JSON uses bounded inert copying; streaming values retain their own pull and cancellation behavior.
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
	if (isAsyncIterable(body)) body = streamFromAsync(body);
	const contentType = responseContentType(result, headers);
	if (contentType !== undefined && !hasHeader(headers, 'Content-Type')) {
		headers = response.mergeHeaders(headers, { 'Content-Type': contentType });
	}
	if (negotiate && response.is(result) && contentType !== undefined && body !== null && body !== undefined) {
		headers = response.mergeHeaders(headers, {
			Vary: response.mergeVary(response.headerValues(headers, 'Vary')[0], 'Accept'),
		});
		try {
			requestWire.negotiateContent(request.headers.get('accept'), [contentType.split(';', 1)[0]!]);
		} catch (error) {
			if (
				error instanceof requestWire.RequestTransportError &&
				error.issues.some((issue) => issue.code === 'not-acceptable')
			) {
				return await toResponse(
					problem.create(ServerProblems.NotAcceptable, {
						detail: `This operation produces ${contentType.split(';', 1)[0]}.`,
						instance: new URL(request.url).pathname,
						extensions: { supported: [contentType.split(';', 1)[0]] },
						headers: { Vary: 'Accept' },
					}),
					request,
					undefined,
					false,
				);
			}
			throw error;
		}
	}
	let bodyInit: BodyInit | null;
	const mode = response.is(result) ? response.definitionOf(result).mode : 'body';
	if (response.isContentlessStatus(resolved.status) || mode === 'empty' || mode === 'redirect') bodyInit = null;
	else if (
		mode !== 'stream' && mode !== 'download' && mode !== 'html' && contentType !== undefined &&
		/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)
	) {
		// JSON values are validated before serialization so getters, toJSON, Dates and undefined cannot silently change the wire contract.
		bodyInit = JSON.stringify(json.copy(body));
	} else if (body === null || body === undefined) bodyInit = null;
	else if (
		typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) ||
		body instanceof ReadableStream
	) {
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
 * Prefer an explicit Content-Type, then use the declared response media type or problem JSON default.
 *
 * @internal
 */
function responseContentType(
	result: response.ResponseResult | problem.ProblemResult,
	headers: response.ResponseHeaders,
): string | undefined {
	const explicit = response.headerValues(headers, 'Content-Type')[0];
	if (explicit !== undefined) return explicit;
	if (problem.is(result)) return 'application/problem+json; charset=utf-8';
	return response.mediaType(response.definitionOf(result));
}

/**
 * Read link parameter names from the operation's declared Query input rather than inventing default spellings.
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
 * Recognize the async-iterator property used by the response adapter; consumption still invokes the source.
 *
 * @internal
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<string | Uint8Array> {
	return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

/**
 * Pull one iterator value per response demand and UTF-8 encode string chunks.
 * Response cancellation requests iterator.return; it cannot interrupt an iterator next that ignores cancellation.
 *
 * @internal
 */
function streamFromAsync(iterable: AsyncIterable<string | Uint8Array>): ReadableStream<Uint8Array> {
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
		async cancel(reason) {
			await iterator.return?.(reason);
		},
	});
}

/**
 * Check header names case-insensitively before adding a default media type.
 *
 * @internal
 */
function hasHeader(headers: response.ResponseHeaders, name: string): boolean {
	const lower = name.toLowerCase();
	return Object.keys(headers).some((candidate) => candidate.toLowerCase() === lower);
}

/**
 * Keep request-local middleware values under exact definition-object keys.
 *
 * Each request gets a fresh map. Equal IDs on independently authored definitions
 * do not share a value; a read before its producer runs fails explicitly.
 *
 * @internal
 */
function createContextStore(): ServiceContextStore {
	const values = new Map<MiddlewareContextDefinition, unknown>();
	return Object.freeze({
		/**
		 * Test whether this exact middleware context definition has a value in this request.
		 *
		 * @internal
		 */
		has<Definition extends MiddlewareContextDefinition>(definition: Definition): boolean {
			return values.has(definition);
		},
		/**
		 * Read a value only after its producer ran; an equal ID on another definition cannot supply it.
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
		 * Publish the value under its exact middleware context definition for later stages of this request.
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
 * Require a concrete dependency-bearing resource definition before checking request acquisition authority.
 *
 * @internal
 */
function requireConcreteResource(
	definition: endpoint.EndpointResourceDefinition,
): ResourceDefinition {
	if (!isConcreteResource(definition)) {
		throw new ServiceRuntimeConfigurationError(
			`Resource reference ${JSON.stringify(definition.id)} is not a concrete @okikio/resource definition.`,
		);
	}
	return definition;
}

/**
 * Recognize a concrete Resource declaration; a catalog ID without dependency metadata cannot be resolved here.
 *
 * @internal
 */
function isConcreteResource(
	definition: endpoint.EndpointResourceDefinition,
): definition is ResourceDefinition {
	return definition.kind === 'resource' &&
		'dependencies' in definition &&
		typeof (definition as { readonly dependencies?: unknown }).dependencies === 'object' &&
		(definition as { readonly dependencies?: unknown }).dependencies !== null;
}

/**
 * Restrict resource access to the effective operation envelope.
 *
 * The collection owns lazy acquisition and cleanup. This request-local view
 * borrows that collection but rejects definitions outside the compiled allow set
 * before it can acquire a provider.
 *
 * @internal
 */
function createResourceResolver(
	collection: ResourceCollection,
	allowed: ReadonlySet<ResourceDefinition>,
	ctx: ServiceExecutionContext,
): endpoint.EndpointResourceResolver & MiddlewareResourceResolver {
	return Object.freeze({
		/**
		 * Test declared resource coverage inside this request envelope without acquiring the provider.
		 *
		 * @internal
		 */
		has<Definition extends endpoint.EndpointResourceDefinition>(definition: Definition): boolean {
			return isConcreteResource(definition) && allowed.has(definition) && collection.has(definition);
		},
		/**
		 * Reject out-of-envelope definitions before asking the collection to acquire under this request context.
		 *
		 * @internal
		 */
		async get<Definition extends endpoint.EndpointResourceDefinition>(
			definition: Definition,
		): Promise<endpoint.EndpointResourceValue<Definition>> {
			const concrete = requireConcreteResource(definition);
			if (!allowed.has(concrete)) {
				throw new TypeError(`Resource ${JSON.stringify(concrete.id)} is outside the effective operation envelope.`);
			}
			return await collection.get(ctx, concrete) as endpoint.EndpointResourceValue<Definition>;
		},
	});
}

/**
 * Build the compiled middleware's dependency envelope once using exact definitions, dependencies first.
 * Compilation has already rejected resource cycles and conflicting identity.
 *
 * @internal
 */
function resourceClosure(input: MiddlewareDefinition['resources']): ResourceDefinition[] {
	if (input === undefined) return [];
	const roots = catalog.values(input).map(requireConcreteResource);
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
 * Expose a shallow request-state view and an operation-limited resource resolver.
 * Borrowed Request, host, values, and context keep their owners; Object.freeze does not freeze those resources.
 *
 * @internal
 */
function freezeState<Host extends object, Values extends ServiceRequestValues>(
	state: MutableServiceRequestState<Host, Values>,
): ServiceRequestState<Host, Values> {
	const { requestValues, resources, resourceEnvelopes, ...base } = state;
	return Object.freeze({
		...requestValues,
		...base,
		resources: createResourceResolver(resources, resourceEnvelopes.operations.get(state.operation)!, state.ctx),
	});
}

/**
 * Merge adapter-contributed request values while preserving the runtime-owned context, Request, and resource envelopes.
 *
 * @internal
 */
function applyPatch<Host extends object, Values extends ServiceRequestValues>(
	state: MutableServiceRequestState<Host, Values>,
	patch: ServiceRequestStatePatch<Values> | undefined,
): MutableServiceRequestState<Host, Values> {
	if (patch === undefined) return state;
	return {
		...state,
		requestValues: {
			...state.requestValues,
			...patch,
		},
	};
}

/**
 * Reject missing authentication, requirement-family, or resilience capabilities before serving traffic.
 * Timeout and body-limit policies run inside this runtime and need no external adapter.
 *
 * @internal
 */
function validateRuntimeAdapters<Host extends object, Values extends ServiceRequestValues>(
	compiled: CompiledService,
	adapters: ServiceRuntimeAdapters<Host, Values> | undefined,
): void {
	const required = [
		[
			'authentication',
			compiled.operations.some((operation) => operation.authentication.length > 0),
			adapters?.authenticate,
		],
	] as const;
	for (const [name, needed, runtime] of required) {
		if (needed && runtime === undefined) {
			throw new ServiceRuntimeConfigurationError(`Service requires a ${name} runtime.`);
		}
	}

	const activeFamilies = [
		...new Set(compiled.operations.flatMap((operation) => operation.requirements.map((entry) => entry.family))),
	];
	const requirementRuntime = adapters?.requirements;
	if (activeFamilies.length > 0 && requirementRuntime === undefined) {
		throw new ServiceRuntimeConfigurationError(
			`Service requires requirement interpreters for: ${activeFamilies.join(', ')}.`,
		);
	}
	if (requirementRuntime?.unknown !== 'ignore') {
		for (const family of activeFamilies) {
			if (requirementRuntime?.interpreters[family] === undefined) {
				throw new ServiceRuntimeConfigurationError(
					`Service has no interpreter for active requirement family ${JSON.stringify(family)}.`,
				);
			}
		}
	}
	const adapterPolicies = [
		...new Set(
			compiled.operations.flatMap((operation) =>
				operation.resiliency.filter((policy) => policy.type !== 'timeout' && policy.type !== 'body-limit')
			),
		),
	];
	if (adapterPolicies.length === 0) return;
	const runtime = adapters?.resilience;
	if (runtime === undefined) {
		throw new ServiceRuntimeConfigurationError(
			`Service requires a resilience adapter for: ${
				[...new Set(adapterPolicies.map((policy) => policy.type))].join(', ')
			}.`,
		);
	}
	for (const policy of adapterPolicies) {
		if (!runtime.supports(policy)) {
			throw new ServiceRuntimeConfigurationError(`The resilience adapter does not support ${policy.type}.`);
		}
	}
}

/** Private sentinel that distinguishes the body-limit rejection from arbitrary handler errors. */
const bodyTooLarge = Symbol('service-body-too-large');
const invalidBody = Symbol('service-invalid-body');

/**
 * Collect the actual body under the declared byte bound before middleware, then replay accepted bytes in a new Request.
 * Typed length/size failures become private sentinels; other transport failures still reject.
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
 * Creates the empty request-value patch used before an adapter contributes values.
 *
 * TypeScript cannot prove that an empty object satisfies an optional mapped
 * type over an unresolved generic key set. The assertion is isolated here;
 * runtime construction contains no keys, so it cannot violate the request-value
 * contract.
 *
 * @internal
 */
function emptyValuePatch<Values extends ServiceRequestValues>(): ServiceRequestStatePatch<Values> {
	return Object.freeze({}) as ServiceRequestStatePatch<Values>;
}

/** Internal mutable request state used while ordered adapters add validated request values. */
interface MutableServiceRequestState<
	Host extends object,
	Values extends ServiceRequestValues,
> {
	request: Request;
	readonly host: Host;
	ctx: ServiceExecutionContext;
	readonly resources: ResourceCollection;
	readonly resourceEnvelopes: ResourceEnvelopesType;
	readonly values: ServiceContextStore;
	readonly operation: EffectiveServiceOperation;
	input: ServiceInputValues;
	requestValues: ServiceRequestStatePatch<Values>;
}

/** Normalize JavaScript's unrestricted thrown values before exposing them to host callbacks. */
function normalizeError(reason: unknown): Error {
	return reason instanceof Error ? reason : new Error(fault.message(reason), { cause: reason });
}

/** Measure response availability. Body streaming and request cleanup retain their existing owners. */
async function observeOperation<Host extends object, Values extends ServiceRequestValues>(
	operation: EffectiveServiceOperation,
	request: Request,
	resources: ResourceCollection,
	serviceContext: Context,
	middlewareByDefinition: ReadonlyMap<MiddlewareDefinition, MiddlewareHandler>,
	resourceEnvelopes: ResourceEnvelopesType,
	observers: ReadonlyMap<ServiceObserverDefinition, ServiceObserverHandler>,
	options: CreateServiceOptions<Host, Values>,
): Promise<Response> {
	return await telemetry.get(serviceContext).span('server.request', { method: request.method }, async (observation) => {
		const result = await serveOperation(
			operation,
			request,
			resources,
			serviceContext,
			middlewareByDefinition,
			resourceEnvelopes,
			observers,
			options,
		);
		if (result.status >= 500) observation.fail(new Error(`Server response failed with status ${result.status}.`));
		return result;
	});
}
