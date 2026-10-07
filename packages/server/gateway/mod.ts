/**
 * Derive upstream route ownership from an imported service contract without copying route strings.
 *
 * Compilation does not start the upstream service or fetch the origin. Add credential, timeout and redirect policies explicitly before creating the gateway runtime. Service authorization remains with the service; an edge policy does not grant domain permissions.
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
 * import * as gateway from '@okikio/server/gateway';
 * const Edge = gateway.define({ id: 'edge', services: [gateway.mount(Api, { origin: 'https://upstream.invalid' })] });
 * const compiled = gateway.compile(Edge);
 * console.log(compiled.routes[0]?.path, compiled.routes[0]?.credentials.requestCookies);
 * ```
 *
 * @module
 */
export {
	compose,
	credentials,
	define,
	mount,
	noStore,
	observer,
	passThroughCache,
	policy,
	redirects,
	select,
} from './definition.ts';
export { compile, document, GatewayCompilationError, validate } from './compile.ts';
export { create, match, prepare } from './runtime.ts';
export { GatewayProblems } from './problems.ts';
export type {
	CompiledGateway,
	CompiledGatewayRoute,
	CompileGatewayOptions,
	CreateGatewayOptions,
	GatewayCachePolicy,
	GatewayCredentialPolicy,
	GatewayDefinition,
	GatewayDefinitionInput,
	GatewayManifest,
	GatewayMetadataHeaders,
	GatewayMount,
	GatewayObserverDefinition,
	GatewayObserverEvent,
	GatewayObserverEventKind,
	GatewayObserverHandler,
	GatewayOrigin,
	GatewayPolicy,
	GatewayPolicyInput,
	GatewayRedirectPolicy,
	GatewayRequestPatch,
	GatewayRequestState,
	GatewayRouteManifestEntry,
	GatewayRuntime,
	GatewayRuntimeAdapters,
	GatewaySelection,
	GatewayServiceArtifact,
	GatewayValidationIssue,
	GatewayValidationResult,
	GatewayValidationSubject,
} from './types.ts';
