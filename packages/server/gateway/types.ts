import type { CatalogEntryIdentity, DefinitionInput } from '@okikio/catalog';
import type { EndpointCompositionInput, EndpointDefinition, EndpointMethod } from '@okikio/server/endpoint';
import type { ProblemResult } from '@okikio/http/problem';
import type { ResponseCompletion } from '@okikio/http/response';
import type { RequestCorrelation } from '@okikio/http/request';
import type { CompiledService, ServiceDefinition, ServiceManifest, ServiceRoute, ServiceRouteManifestEntry, ServiceSelection } from '../service/types.ts';

/** Host-resolved origin for one independently deployed service. */
export type GatewayOrigin = string | URL;

/** One exact service or service selection mounted at an origin. */
export interface GatewayMount<
	Target extends ServiceDefinition | ServiceSelection = ServiceDefinition | ServiceSelection,
> {
	readonly kind: 'gateway-mount';
	readonly target: Target;
	readonly origin: GatewayOrigin;
}

/** Gateway cache behavior. */
export type GatewayCachePolicy =
	| Readonly<{ readonly kind: 'gateway-cache'; readonly mode: 'no-store' }>
	| Readonly<{ readonly kind: 'gateway-cache'; readonly mode: 'pass-through' }>;

/** Explicit caller credential forwarding policy. */
export interface GatewayCredentialPolicy {
	readonly kind: 'gateway-credentials';
	readonly requestCookies: 'preserve' | 'strip';
	readonly requestAuthorization: 'preserve' | 'strip' | 'strip-after-authentication';
	readonly responseCookies: 'preserve' | 'strip';
}

/** Upstream Location handling policy for manual redirects. */
export interface GatewayRedirectPolicy {
	readonly kind: 'gateway-redirects';
	readonly mode: 'preserve' | 'rewrite-origin' | 'reject-cross-origin';
	readonly allowedOrigins: readonly string[];
}

/** Gateway lifecycle events available to redacted observers. */
export type GatewayObserverEventKind = 'denied' | 'forwarding' | 'response' | 'completed' | 'failed' | 'aborted';

/**
 * Import-safe subscription to redacted gateway lifecycle events.
 *
 * An observer is optional and observational: it cannot choose a route, mutate
 * credentials, or replace the response. Importing a definition makes its
 * telemetry/audit requirement visible to compilation; the host supplies the
 * matching handler separately.
 */
export interface GatewayObserverDefinition extends CatalogEntryIdentity {
	readonly kind: 'gateway-observer';
	readonly description: string;
	readonly events: readonly GatewayObserverEventKind[];
}

/**
 * Redacted gateway lifecycle event.
 *
 * `response` means upstream headers arrived. `completed`, `aborted`, and
 * `failed` describe the later response-body lifetime. Keeping those events
 * distinct is necessary for streamed downloads and proxy responses whose body
 * may continue long after the status code is known.
 */
export interface GatewayObserverEvent {
	readonly kind: GatewayObserverEventKind;
	readonly gatewayId: string;
	readonly requestId: string;
	readonly traceId: string;
	readonly spanId: string;
	readonly method: string;
	readonly pathname: string;
	readonly routeId?: string;
	readonly serviceId?: string;
	readonly endpointId?: string;
	readonly operationId?: string;
	readonly status?: number;
	readonly requestBytes?: number;
	readonly responseBytes?: number;
	readonly completion?: ResponseCompletion;
	readonly error?: Readonly<{ readonly name: string; readonly message: string }>;
}

/** Runtime handler bound to an exact observer definition. */
export interface GatewayObserverHandler<Definition extends GatewayObserverDefinition = GatewayObserverDefinition> {
	readonly kind: 'gateway-observer-handler';
	readonly definition: Definition;
	readonly handle: (event: GatewayObserverEvent) => void | Promise<void>;
}

/** Additive edge behavior for exact imported endpoints. */
export interface GatewayPolicy extends CatalogEntryIdentity {
	readonly kind: 'gateway-policy';
	readonly endpoints: readonly EndpointDefinition[];
	readonly authenticate?: DefinitionInput<CatalogEntryIdentity>;
	readonly assertion?: DefinitionInput<CatalogEntryIdentity>;
	readonly timeout?: Temporal.Duration;
	readonly bodyLimit?: number;
	readonly cache?: GatewayCachePolicy;
	readonly credentials?: GatewayCredentialPolicy;
	readonly redirects?: GatewayRedirectPolicy;
}

/** Input accepted by `gateway.policy()`. */
export interface GatewayPolicyInput {
	readonly id: string;
	readonly description?: string;
	readonly endpoints: EndpointCompositionInput;
	readonly authenticate?: DefinitionInput<CatalogEntryIdentity>;
	readonly assertion?: DefinitionInput<CatalogEntryIdentity>;
	readonly timeout?: Temporal.Duration | Temporal.DurationLike | string;
	readonly bodyLimit?: number;
	readonly cache?: GatewayCachePolicy;
	readonly credentials?: GatewayCredentialPolicy;
	readonly redirects?: GatewayRedirectPolicy;
}

/** Import-safe gateway definition. */
export interface GatewayDefinition<Id extends string = string> extends CatalogEntryIdentity {
	readonly kind: 'gateway';
	readonly id: Id;
	readonly services: readonly GatewayMount[];
	readonly policies: readonly GatewayPolicy[];
	readonly observers: readonly GatewayObserverDefinition[];
}

/** Input accepted by `gateway.define()`. */
export interface GatewayDefinitionInput<Id extends string = string> {
	readonly id: Id;
	readonly description?: string;
	readonly services: readonly (GatewayMount | readonly GatewayMount[])[];
	readonly policies?: readonly GatewayPolicy[];
	readonly observers?: readonly GatewayObserverDefinition[];
}

/** Named gateway subset that preserves exact mount references. */
export interface GatewaySelection<Gateway extends GatewayDefinition = GatewayDefinition> extends CatalogEntryIdentity {
	readonly kind: 'gateway-selection';
	readonly gateway: Gateway;
	readonly mounts: readonly GatewayMount[];
}

/** One concrete service artifact supplied to gateway compilation. */
export type GatewayServiceArtifact = CompiledService | ServiceManifest;

/** Options supplied to `gateway.compile()`. */
export interface CompileGatewayOptions {
	/** Optional compiled manifests used only to detect definition/runtime drift. */
	readonly services?: readonly GatewayServiceArtifact[];
}

/** Fully resolved edge route. */
export interface CompiledGatewayRoute {
	readonly id: string;
	readonly gateway: GatewayDefinition;
	readonly serviceId: string;
	/** Route identity defined by the mounted service before gateway compilation. */
	readonly serviceRouteId: string;
	readonly endpointId: string;
	readonly operationId: string;
	readonly method: Uppercase<EndpointMethod>;
	readonly path: string;
	readonly origin: string;
	readonly authenticate: readonly CatalogEntryIdentity[];
	readonly assertions: readonly CatalogEntryIdentity[];
	readonly timeout?: Temporal.Duration;
	readonly bodyLimit?: number;
	readonly cache: GatewayCachePolicy;
	readonly credentials: GatewayCredentialPolicy;
	readonly redirects: GatewayRedirectPolicy;
	readonly observers: readonly GatewayObserverDefinition[];
}

/** JSON-safe gateway route manifest. */
export interface GatewayRouteManifestEntry {
	readonly id: string;
	readonly serviceId: string;
	/** Route identity defined by the mounted service before gateway compilation. */
	readonly serviceRouteId: string;
	readonly endpointId: string;
	readonly operationId: string;
	readonly method: Uppercase<EndpointMethod>;
	readonly path: string;
	readonly origin: string;
	readonly authentication: readonly string[];
	readonly assertions: readonly string[];
	readonly timeout?: string;
	readonly bodyLimit?: number;
	readonly cache: GatewayCachePolicy['mode'];
	readonly credentials: Readonly<{ readonly requestCookies: GatewayCredentialPolicy['requestCookies']; readonly requestAuthorization: GatewayCredentialPolicy['requestAuthorization']; readonly responseCookies: GatewayCredentialPolicy['responseCookies'] }>;
	readonly redirects: GatewayRedirectPolicy['mode'];
	readonly observers: readonly string[];
}

/** Deterministic compiled gateway manifest. */
export interface GatewayManifest {
	readonly id: string;
	readonly routes: readonly GatewayRouteManifestEntry[];
	readonly services: readonly string[];
}

/** Compiled gateway ready for a host runtime. */
export interface CompiledGateway<Definition extends GatewayDefinition = GatewayDefinition> {
	readonly kind: 'compiled-gateway';
	readonly definition: Definition;
	readonly routes: readonly CompiledGatewayRoute[];
	readonly manifest: GatewayManifest;
}


/** Definition value that may be attached to one gateway compiler issue. */
export type GatewayValidationSubject =
	| CatalogEntryIdentity
	| GatewayMount
	| GatewayServiceArtifact
	| ServiceRoute
	| ServiceRouteManifestEntry
	| CompiledGatewayRoute;

/** One validation issue emitted by the gateway compiler. */
export interface GatewayValidationIssue {
	readonly code:
		| 'invalid-definition'
		| 'duplicate-mount'
		| 'policy-target-outside-gateway'
		| 'route-conflict'
		| 'invalid-origin'
		| 'conflicting-policy';
	readonly message: string;
	readonly definition?: GatewayValidationSubject;
}

/** Deterministic gateway validation result. */
export type GatewayValidationResult =
	| Readonly<{ readonly valid: true }>
	| Readonly<{ readonly valid: false; readonly issues: readonly GatewayValidationIssue[] }>;

/** Request state visible to gateway authentication and assertion adapters. */
export interface GatewayRequestState {
	readonly request: Request;
	readonly route: CompiledGatewayRoute;
	readonly requestId: string;
	readonly correlation: RequestCorrelation;
	readonly signal: AbortSignal;
}

/** Patch produced by one gateway edge adapter. */
export interface GatewayRequestPatch {
	readonly headers?: Readonly<Record<string, string>>;
}

/** Host-specific gateway concern runtimes. */
export interface GatewayConcernRuntimes {
	readonly authenticate?: (
		requirements: readonly CatalogEntryIdentity[],
		state: GatewayRequestState,
	) => GatewayRequestPatch | ProblemResult | void | Promise<GatewayRequestPatch | ProblemResult | void>;
	readonly assert?: (
		assertions: readonly CatalogEntryIdentity[],
		state: GatewayRequestState,
	) => GatewayRequestPatch | ProblemResult | void | Promise<GatewayRequestPatch | ProblemResult | void>;
}

/** Optional host-selected header names for trusted gateway routing metadata. */
export interface GatewayMetadataHeaders {
	/** Correlation ID reconstructed by the gateway. */
	readonly requestId?: string;
	/** Mounted service ID selected by the compiled route. */
	readonly serviceId?: string;
	/** Compiled gateway route ID selected for the request. */
	readonly routeId?: string;
}

/** Request-preparation options shared by compiled routes and host-owned continuation routes. */
export interface PrepareGatewayRequestOptions {
	readonly requestId?: (request: Request) => string;
	/** Host-trusted connected client address used to reconstruct forwarding metadata. */
	readonly clientIp?: (request: Request) => string | undefined;
	/** Optional product/host correlation header. Service and route IDs are unavailable before route selection. */
	readonly metadataHeaders?: Pick<GatewayMetadataHeaders, 'requestId'>;
	/** Exact caller headers reserved for trusted gateway-owned values. */
	readonly trustedRequestHeaders?: readonly string[];
	/** Caller header prefixes reserved for trusted gateway-owned values. */
	readonly trustedRequestHeaderPrefixes?: readonly string[];
}

/** One request prepared for a trusted downstream hop by generic gateway transport policy. */
export interface PreparedGatewayRequest {
	readonly request: Request;
	readonly requestId: string;
	readonly correlation: RequestCorrelation;
}

/** Runtime options for one compiled gateway. */
export interface CreateGatewayOptions extends PrepareGatewayRequestOptions {
	readonly fetch?: typeof fetch;
	readonly concerns?: GatewayConcernRuntimes;
	/** Optional product/host header names for trusted routing metadata. No product prefix is chosen by default. */
	readonly metadataHeaders?: GatewayMetadataHeaders;
	readonly onError?: (error: Error, state?: GatewayRequestState) => void | Promise<void>;
	readonly observers?: readonly GatewayObserverHandler[];
}

/** Live gateway request handler. */
export interface GatewayRuntime {
	readonly fetch: (request: Request) => Promise<Response>;
}
