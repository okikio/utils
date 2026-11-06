/**
 * Compile declared endpoints and concrete handlers before serving requests.
 *
 * Add resources, middleware, requirement interpreters and observers at the host boundary. Compilation rejects missing or conflicting contracts. The runtime owns request contexts and borrows the host; await its disposal to join owned resource cleanup.
 *
 * @example
 * ```ts
 * import * as endpoint from '@okikio/server/endpoint';
 * import * as response from '@okikio/http/response';
 * import * as service from '@okikio/server/service';
 * import * as schema from '@okikio/schema';
 * const Healthy = response.ok(schema.object({ ok: schema.boolean() }), { id: 'health.ok', description: 'Service health.' });
 * const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
 * const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
 * // The endpoint has no dependencies; implement() supplies the empty resource collection.
 * const live = service.implement(Api, {
 *   endpoints: [endpoint.handler(Health, () => response.create(Healthy, { ok: true }))],
 * });
 * await using runtime = service.create(service.compile(live), { host: {} });
 * const result = await runtime.fetch(new Request('https://service.invalid/api/health'));
 * console.log(result.status, (await result.json()).ok);
 * ```
 *
 * @module
 */
export { compose, define, leafEndpoints, observer, policy, select } from './definition.ts';
export { joinPath } from '@okikio/server/endpoint/path';
export { implement } from './implementation.ts';
export { authenticated, compile, compileDefinition, document, ServiceCompilationError, validate } from './compile.ts';
export { create, ServiceRuntimeConfigurationError } from './runtime.ts';
export { resilience, retry, RetryableOperationError } from './resilience.ts';
export type { ServiceRetryOptions } from './resilience.ts';
export { openapi } from './openapi.ts';
export type { ServiceOpenApiOptions, ServiceOpenApiSecurity } from './openapi.ts';
export type {
	CompiledService,
	CompiledServiceDefinition,
	CreateServiceOptions,
	EffectiveServiceOperation,
	ServiceContextStore,
	ServiceContributions,
	ServiceDefinition,
	ServiceDefinitionInput,
	ServiceImplementation,
	ServiceImplementationInput,
	ServiceInputValues,
	ServiceManifest,
	ServiceObserverDefinition,
	ServiceObserverEvent,
	ServiceObserverEventKind,
	ServiceObserverHandler,
	ServiceOperationContract,
	ServicePolicy,
	ServicePolicyInput,
	ServiceRequestState,
	ServiceRequestStatePatch,
	ServiceRequestValues,
	ServiceResilienceAdapter,
	ServiceRoute,
	ServiceRouteManifestEntry,
	ServiceRuntime,
	ServiceRuntimeAdapters,
	ServiceRuntimeRoute,
	ServiceSelection,
	ServiceStageResult,
	ServiceValidationIssue,
	ServiceValidationResult,
	ServiceValidationSubject,
	ServiceValuePatch,
} from './types.ts';

export { route, routePath, routes } from './route.ts';
export type { ServiceRouteParam, ServiceRouteParams } from './route.ts';
