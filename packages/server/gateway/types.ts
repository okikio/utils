import type { CatalogEntryIdentity, DefinitionInput } from '@okikio/catalog';
import type { RoutePlan } from '../http/types.ts';
import type { EndpointCompositionInput, EndpointDefinition, EndpointMethod } from '@okikio/server/endpoint/types';
import type { ProblemResult } from '@okikio/http/problem';
import type { RequestCorrelation } from '@okikio/http/request';
import type {
	CompiledService,
	ServiceDefinition,
	ServiceManifest,
	ServiceRoute,
	ServiceRouteManifestEntry,
	ServiceSelection,
} from '../service/types.ts';

/** Host-resolved origin for one independently deployed service. */
export type GatewayOrigin = string | URL;

/** One exact service or service selection mounted at an origin. */
export interface GatewayMount<
	Target extends ServiceDefinition | ServiceSelection = ServiceDefinition | ServiceSelection,
> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-mount';
	/** Exact imported service definition or selection mounted at this origin. */
	readonly target: Target;
	/** Host-resolved upstream service origin for this mount or route. */
	readonly origin: GatewayOrigin;
}

/** Gateway cache behavior. */
export type GatewayCachePolicy =
	| Readonly<{ readonly kind: 'gateway-cache'; readonly mode: 'no-store' }>
	| Readonly<{ readonly kind: 'gateway-cache'; readonly mode: 'pass-through' }>;

/** Explicit caller credential forwarding policy. */
export interface GatewayCredentialPolicy {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-credentials';
	/** Explicit policy for retaining or stripping inbound Cookie headers. */
	readonly requestCookies: 'preserve' | 'strip';
	/** Explicit policy for retaining or stripping inbound Authorization, including after authentication. */
	readonly requestAuthorization: 'preserve' | 'strip' | 'strip-after-authentication';
	/** Explicit policy for retaining or stripping upstream Set-Cookie headers. */
	readonly responseCookies: 'preserve' | 'strip';
}

/** Upstream Location handling policy for manual redirects. */
export interface GatewayRedirectPolicy {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-redirects';
	/** Selected materialization or forwarding behavior for this definition. */
	readonly mode: 'preserve' | 'rewrite-origin' | 'reject-cross-origin';
	/** Additional upstream redirect origins admitted by the selected redirect policy. */
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
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-observer';
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Gateway lifecycle event kinds selected for observation; response means headers, and completed means body EOF. */
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
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: GatewayObserverEventKind;
	/** Gateway identity retained for route and lifecycle correlation. */
	readonly gatewayId: string;
	/** Request correlation identity; it is diagnostic data rather than authorization. */
	readonly requestId: string;
	/** Trace correlation identity retained for diagnostic propagation. */
	readonly traceId: string;
	/** Span correlation identity for the current operation. */
	readonly spanId: string;
	/** HTTP method selected for this operation or route. */
	readonly method: string;
	/** Request pathname retained for redacted lifecycle observation. */
	readonly pathname: string;
	/** Identity of the selected compiled route, when routing has completed. */
	readonly routeId?: string;
	/** Identity of the service selected for this route or observation. */
	readonly serviceId?: string;
	/** Identity of the selected endpoint path contract. */
	readonly endpointId?: string;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId?: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status?: number;
	/** Observed request-body bytes at this transport boundary. */
	readonly requestBytes?: number;
	/** Observed response-body bytes; response headers alone do not prove body completion. */
	readonly responseBytes?: number;
	/** Response-body terminal outcome and delivered byte count, distinct from receiving headers. */
	readonly completion?: Readonly<{ readonly outcome: 'completed' | 'cancelled' | 'errored'; readonly bytes: number }>;
	/** Diagnostic failure retained for this observation; it does not replace the authoritative operation result. */
	readonly error?: Readonly<{ readonly name: string; readonly message: string }>;
}

/** Runtime handler bound to an exact observer definition. */
export interface GatewayObserverHandler<Definition extends GatewayObserverDefinition = GatewayObserverDefinition> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-observer-handler';
	/** Exact declaration involved in this binding, result or validation issue. */
	readonly definition: Definition;
	/** Observe a redacted gateway lifecycle event; this callback cannot settle the request. */
	readonly handle: (event: GatewayObserverEvent) => void | Promise<void>;
}

/** Additive edge behavior for exact imported endpoints. */
export interface GatewayPolicy extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-policy';
	/** Exact endpoint composition or selected bindings retained by this contract. */
	readonly endpoints: readonly EndpointDefinition[];
	/** Host-owned evaluation of the declared authentication contracts before forwarding or operation admission. */
	readonly authenticate?: DefinitionInput<CatalogEntryIdentity>;
	/** Additional host-owned assertions required for the selected endpoint. */
	readonly assertion?: DefinitionInput<CatalogEntryIdentity>;
	/** Request timeout retained as a duration, or serialized duration text in a manifest. */
	readonly timeout?: Temporal.Duration;
	/** Maximum request-body bytes admitted by this runtime policy. */
	readonly bodyLimit?: number;
	/** Explicit gateway cache behavior; this contract does not create an application cache. */
	readonly cache?: GatewayCachePolicy;
	/** Explicit policy for caller credential and upstream cookie forwarding. */
	readonly credentials?: GatewayCredentialPolicy;
	/** Explicit policy for preserving, rewriting or rejecting upstream Location fields. */
	readonly redirects?: GatewayRedirectPolicy;
}

/** Input accepted by `gateway.policy()`. */
export interface GatewayPolicyInput {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Exact endpoint composition or selected bindings retained by this contract. */
	readonly endpoints: EndpointCompositionInput;
	/** Host-owned evaluation of the declared authentication contracts before forwarding or operation admission. */
	readonly authenticate?: DefinitionInput<CatalogEntryIdentity>;
	/** Additional host-owned assertions required for the selected endpoint. */
	readonly assertion?: DefinitionInput<CatalogEntryIdentity>;
	/** Request timeout retained as a duration, or serialized duration text in a manifest. */
	readonly timeout?: Temporal.Duration | Temporal.DurationLike | string;
	/** Maximum request-body bytes admitted by this runtime policy. */
	readonly bodyLimit?: number;
	/** Explicit gateway cache behavior; this contract does not create an application cache. */
	readonly cache?: GatewayCachePolicy;
	/** Explicit policy for caller credential and upstream cookie forwarding. */
	readonly credentials?: GatewayCredentialPolicy;
	/** Explicit policy for preserving, rewriting or rejecting upstream Location fields. */
	readonly redirects?: GatewayRedirectPolicy;
}

/** Import-safe gateway definition. */
export interface GatewayDefinition<Id extends string = string> extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway';
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: Id;
	/** Mounted service declarations or their projected identities. */
	readonly services: readonly GatewayMount[];
	/** Additive policies that apply to exact declarations in this composition. */
	readonly policies: readonly GatewayPolicy[];
	/** Observer declarations or exact host-supplied handlers; observers remain outside result authority. */
	readonly observers: readonly GatewayObserverDefinition[];
}

/** Input accepted by `gateway.define()`. */
export interface GatewayDefinitionInput<Id extends string = string> {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: Id;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
	/** Mounted service declarations or their projected identities. */
	readonly services: readonly (GatewayMount | readonly GatewayMount[])[];
	/** Additive policies that apply to exact declarations in this composition. */
	readonly policies?: readonly GatewayPolicy[];
	/** Observer declarations or exact host-supplied handlers; observers remain outside result authority. */
	readonly observers?: readonly GatewayObserverDefinition[];
}

/** Named gateway subset that preserves exact mount references. */
export interface GatewaySelection<Gateway extends GatewayDefinition = GatewayDefinition> extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-selection';
	/** Exact gateway declaration retained by this route or selection. */
	readonly gateway: Gateway;
	/** Exact service mounts retained by this gateway selection. */
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
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Exact gateway declaration retained by this route or selection. */
	readonly gateway: GatewayDefinition;
	/** Identity of the service selected for this route or observation. */
	readonly serviceId: string;
	/** Route identity defined by the mounted service before gateway compilation. */
	readonly serviceRouteId: string;
	/** Identity of the selected endpoint path contract. */
	readonly endpointId: string;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId: string;
	/** HTTP method selected for this operation or route. */
	readonly method: Uppercase<EndpointMethod>;
	/** Declared route pathname or prefix; path parameters retain the endpoint grammar. */
	readonly path: string;
	/** Host-resolved upstream service origin for this mount or route. */
	readonly origin: string;
	/** Host-owned evaluation of the declared authentication contracts before forwarding or operation admission. */
	readonly authenticate: readonly CatalogEntryIdentity[];
	/** Compiled assertion contracts or their manifest IDs, evaluated by an explicit host adapter. */
	readonly assertions: readonly CatalogEntryIdentity[];
	/** Request timeout retained as a duration, or serialized duration text in a manifest. */
	readonly timeout?: Temporal.Duration;
	/** Maximum request-body bytes admitted by this runtime policy. */
	readonly bodyLimit?: number;
	/** Explicit gateway cache behavior; this contract does not create an application cache. */
	readonly cache: GatewayCachePolicy;
	/** Explicit policy for caller credential and upstream cookie forwarding. */
	readonly credentials: GatewayCredentialPolicy;
	/** Explicit policy for preserving, rewriting or rejecting upstream Location fields. */
	readonly redirects: GatewayRedirectPolicy;
	/** Observer declarations or exact host-supplied handlers; observers remain outside result authority. */
	readonly observers: readonly GatewayObserverDefinition[];
}

/** JSON-safe gateway route manifest. */
export interface GatewayRouteManifestEntry {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Identity of the service selected for this route or observation. */
	readonly serviceId: string;
	/** Route identity defined by the mounted service before gateway compilation. */
	readonly serviceRouteId: string;
	/** Identity of the selected endpoint path contract. */
	readonly endpointId: string;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId: string;
	/** HTTP method selected for this operation or route. */
	readonly method: Uppercase<EndpointMethod>;
	/** Declared route pathname or prefix; path parameters retain the endpoint grammar. */
	readonly path: string;
	/** Host-resolved upstream service origin for this mount or route. */
	readonly origin: string;
	/** Authentication contracts required by the selected operation; the host supplies their evaluator. */
	readonly authentication: readonly string[];
	/** Compiled assertion contracts or their manifest IDs, evaluated by an explicit host adapter. */
	readonly assertions: readonly string[];
	/** Request timeout retained as a duration, or serialized duration text in a manifest. */
	readonly timeout?: string;
	/** Maximum request-body bytes admitted by this runtime policy. */
	readonly bodyLimit?: number;
	/** Explicit gateway cache behavior; this contract does not create an application cache. */
	readonly cache: GatewayCachePolicy['mode'];
	/** Explicit policy for caller credential and upstream cookie forwarding. */
	readonly credentials: Readonly<
		{
			readonly requestCookies: GatewayCredentialPolicy['requestCookies'];
			readonly requestAuthorization: GatewayCredentialPolicy['requestAuthorization'];
			readonly responseCookies: GatewayCredentialPolicy['responseCookies'];
		}
	>;
	/** Explicit policy for preserving, rewriting or rejecting upstream Location fields. */
	readonly redirects: GatewayRedirectPolicy['mode'];
	/** Observer declarations or exact host-supplied handlers; observers remain outside result authority. */
	readonly observers: readonly string[];
}

/** Deterministic compiled gateway manifest. */
export interface GatewayManifest {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Authored or compiled route entries retained by this application or manifest. */
	readonly routes: readonly GatewayRouteManifestEntry[];
	/** Mounted service declarations or their projected identities. */
	readonly services: readonly string[];
}

/** Compiled gateway ready for a host runtime. */
export interface CompiledGateway<Definition extends GatewayDefinition = GatewayDefinition> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'compiled-gateway';
	/** Exact declaration involved in this binding, result or validation issue. */
	readonly definition: Definition;
	/** Authored or compiled route entries retained by this application or manifest. */
	readonly routes: readonly CompiledGatewayRoute[];
	/** Prepared handler-free route metadata bound to the corresponding runtime handlers. */
	readonly routePlan: RoutePlan;
	/** Deterministic data projection for inspection, deployment and drift checks. */
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
	/** Stable failure code; callers should branch on this instead of matching explanation text. */
	readonly code:
		| 'invalid-definition'
		| 'duplicate-mount'
		| 'policy-target-outside-gateway'
		| 'route-conflict'
		| 'invalid-origin'
		| 'conflicting-policy';
	/** Human-readable diagnostic explanation; it is not a stable program discriminator. */
	readonly message: string;
	/** Declaration or supplied service artifact associated with this compiler issue. */
	readonly definition?: GatewayValidationSubject;
}

/** Deterministic gateway validation result. */
export type GatewayValidationResult =
	| Readonly<{ readonly valid: true }>
	| Readonly<{ readonly valid: false; readonly issues: readonly GatewayValidationIssue[] }>;

/** Request state visible to gateway authentication and assertion adapters. */
export interface GatewayRequestState {
	/** Web Request borrowed for this operation; body ownership follows the enclosing transport contract. */
	readonly request: Request;
	/** Compiled gateway route selected before host adapters evaluate the request. */
	readonly route: CompiledGatewayRoute;
	/** Request correlation identity; it is diagnostic data rather than authorization. */
	readonly requestId: string;
	/** Owned request correlation projected for the downstream hop. */
	readonly correlation: RequestCorrelation;
	/** Cancellation signal for the transport request lifetime. */
	readonly signal: AbortSignal;
}

/** Patch produced by one gateway edge adapter. */
export interface GatewayRequestPatch {
	/** Explicit transport headers retained for this boundary; credential forwarding uses its separate policy. */
	readonly headers?: Readonly<Record<string, string>>;
}

/** Host-specific gateway runtime adapters. */
export interface GatewayRuntimeAdapters {
	/** Host-owned evaluation of the declared authentication contracts before forwarding or operation admission. */
	readonly authenticate?: (
		requirements: readonly CatalogEntryIdentity[],
		state: GatewayRequestState,
	) => GatewayRequestPatch | ProblemResult | void | Promise<GatewayRequestPatch | ProblemResult | void>;
	/** Evaluate host-owned assertions and return an allowed request patch or a declared problem. */
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
	/** Host-supplied request identity provider; caller headers are not automatically trusted. */
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
	/** Web Request borrowed for this operation; body ownership follows the enclosing transport contract. */
	readonly request: Request;
	/** Request correlation identity; it is diagnostic data rather than authorization. */
	readonly requestId: string;
	/** Owned request correlation projected for the downstream hop. */
	readonly correlation: RequestCorrelation;
}

/** Runtime options for one compiled gateway. */
export interface CreateGatewayOptions extends PrepareGatewayRequestOptions {
	/**
	 * Upstream Fetch adapter; defaults to native Fetch. Single gzip and br response
	 * bodies must contain decoded bytes. The gateway removes their encoded length
	 * and encoding headers, while bodyless responses retain representation metadata.
	 * For other codings, normalize these headers in the adapter if it decodes bytes;
	 * runtime support differs. An adapter that returns raw gzip/br bytes must decode
	 * them before returning the response.
	 */
	readonly fetch?: typeof fetch;
	/** Host-supplied authentication, requirement or transport capabilities; no provider is chosen implicitly. */
	readonly adapters?: GatewayRuntimeAdapters;
	/** Optional product/host header names for trusted routing metadata. No product prefix is chosen by default. */
	readonly metadataHeaders?: GatewayMetadataHeaders;
	/** Observe an unexpected runtime failure; the runtime retains response and cleanup authority. */
	readonly onError?: (error: Error, state?: GatewayRequestState) => void | Promise<void>;
	/** Observer declarations or exact host-supplied handlers; observers remain outside result authority. */
	readonly observers?: readonly GatewayObserverHandler[];
}

/**
 * Live gateway request handler owned by a transport host.
 *
 * Mounting service definitions compiles route metadata only. The gateway does
 * not start service runtimes, open sockets, or own an HTTP listener. A host
 * such as `deno serve`, a framework adapter, or an edge runtime owns transport
 * startup and shutdown around this Fetch-compatible handler.
 */
export interface GatewayRuntime {
	/** Fetch-compatible request entry; its host owns listeners and transport shutdown. */
	readonly fetch: (request: Request) => Promise<Response>;
}
