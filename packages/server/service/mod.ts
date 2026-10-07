/**
 * Compile declared endpoints and concrete handlers before serving requests.
 *
 * Add resources, middleware, requirement interpreters and observers at the host boundary. Compilation rejects missing or conflicting contracts. The runtime owns request contexts and borrows the host; await its disposal to join owned resource cleanup.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as endpoint from '@okikio/server/endpoint';
 * import * as response from '@okikio/http/response';
 * import * as service from '@okikio/server/service';
 * import { z } from 'zod';
 * const Healthy = response.ok(z.object({ ok: z.boolean() }), { id: 'health.ok', description: 'Service health.' });
 * const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
 * const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
 * import * as resource from '@okikio/resource';
 * const live = service.implement(Api, { endpoints: [endpoint.handler(Health, () => response.create(Healthy, { ok: true }))], resources: resource.implementations() });
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
export { authenticated, compile, document, ServiceCompilationError, validate } from './compile.ts';
export { create, ServiceRuntimeConfigurationError } from './runtime.ts';
export { resilience, retry, RetryableOperationError } from './resilience.ts';
export type { ServiceRetryOptions } from './resilience.ts';
export { openapi } from './openapi.ts';
export type { ServiceOpenApiOptions } from './openapi.ts';
export type {
	CompiledService,
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
