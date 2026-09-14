import type { CatalogEntryIdentity, DefinitionInput } from '@okikio/catalog';
import type {
	AnyEndpointHandlerBinding,
	EndpointCompositionInput,
	EndpointDefinition,
	EndpointEntry,
	EndpointRequestValues,
	EmptyEndpointHost,
	EndpointGroup,
	EndpointMethod,
	EndpointOperation,
	EndpointInputSlot,
	EndpointInputSource,
	EndpointRuntimeInputValues,
} from '@okikio/server/endpoint/types';
import type { EnvironmentDefinition, EnvironmentManifest } from '@okikio/env';
import type { Context } from '@okikio/context';
import type { EffectContext, EffectDefinition, EffectDefinitions, EffectEmitter } from '@okikio/effect';
import type {
	MiddlewareContextDefinition,
	MiddlewareContextValue,
	MiddlewareHandler,
	MiddlewareInput,
	MiddlewarePlan,
} from '@okikio/server/middleware/types';
import type { ResilienceDocument, ResilienceInput, ResiliencePolicy } from '@okikio/resilience';
import type { ProblemDefinition, ProblemResult } from '@okikio/http/problem';
import type { ResponseDefinition, ResponseResult } from '@okikio/http/response';
import type { RequestParsingOptions } from '@okikio/http/request';
import type { RoutePlan } from '../http/types.ts';
import type {
	ResourceImplementationAny,
	ResourceCollection,
	ResourceDefinition,
	ResourceResolver,
	ResourceDocument,
	ResourceImplementationSet,
} from '@okikio/resource';
import type { WorkflowDefinition } from '@okikio/workflow';
import type { RequirementContext, RequirementDefinition, RequirementDocument, RequirementInput, RequirementRuntime } from '@okikio/requirement';

/** Static cross-cutting values contributed by a service or service policy. */
export interface ServiceContributions {
	readonly middleware?: MiddlewareInput;
	readonly authentication?: DefinitionInput<CatalogEntryIdentity>;
	/** Requirements owned directly by this service contributions; reachable dependency requirements remain separate. */
	readonly requirements?: RequirementInput;
	/** One-way consequences code in this service scope may announce. */
	readonly effects?: EffectDefinitions;
	/** Resource definitions or collection available to this service contributions. */
	readonly resources?: DefinitionInput<ResourceDefinition>;
	readonly problems?: DefinitionInput<ProblemDefinition>;
	readonly resiliency?: ResilienceInput;
}

/** Additive selector-based overlay for a subset of imported endpoints. */
export interface ServicePolicy extends CatalogEntryIdentity, ServiceContributions {
	/** Stable discriminant for this service policy value. */
	readonly kind: 'service-policy';
	readonly endpoints: readonly EndpointEntry[];
}

/** Input accepted by `service.policy()`. */
export type ServicePolicyInput = Readonly<{
	readonly id: string;
	readonly description?: string;
	readonly endpoints: EndpointCompositionInput;
}> & ServiceContributions;

/** Service lifecycle events available to observational handlers. */
export type ServiceObserverEventKind = 'started' | 'response' | 'completed' | 'failed' | 'aborted';

/** Import-safe subscription to selected service request lifecycle events. */
export interface ServiceObserverDefinition extends CatalogEntryIdentity {
	readonly kind: 'service-observer';
	readonly description: string;
	readonly events: readonly ServiceObserverEventKind[];
}

/** Credential-free service request metadata emitted by the framework-neutral runtime. Error text still requires host redaction before external export. */
export interface ServiceObserverEvent {
	readonly kind: ServiceObserverEventKind;
	readonly serviceId: string;
	readonly requestId?: string;
	readonly traceId?: string;
	readonly spanId?: string;
	readonly method: string;
	readonly path: string;
	readonly endpointId: string;
	readonly operationId: string;
	readonly status?: number;
	readonly responseBytes?: number;
	readonly completion?: Readonly<{ readonly outcome: 'completed' | 'cancelled' | 'errored'; readonly bytes: number }>;
	readonly error?: Readonly<{ readonly name: string; readonly message: string }>;
}

/** Runtime handler bound to one exact import-safe service observer definition. */
export interface ServiceObserverHandler<Definition extends ServiceObserverDefinition = ServiceObserverDefinition> {
	readonly kind: 'service-observer-handler';
	readonly definition: Definition;
	readonly handle: (event: ServiceObserverEvent) => void | Promise<void>;
}

/** Import-safe service definition. */
export interface ServiceDefinition<
	Id extends string = string,
	Path extends string = string,
> extends CatalogEntryIdentity, ServiceContributions {
	/** Stable discriminant for this service value. */
	readonly kind: 'service';
	/** Stable service identity used for correlation, lookup, or durable records. */
	readonly id: Id;
	/** Deterministic or canonical path associated with this service. */
	readonly path: Path;
	readonly environment?: EnvironmentDefinition;
	readonly endpoints: readonly EndpointEntry[];
	readonly workflows: readonly WorkflowDefinition[];
	readonly policies: readonly ServicePolicy[];
	readonly observers: readonly ServiceObserverDefinition[];
}

/** Input accepted by `service.define()`. */
export type ServiceDefinitionInput<
	Id extends string = string,
	Path extends string = string,
> = Readonly<{
	readonly id: Id;
	readonly path: Path;
	readonly description?: string;
	readonly environment?: EnvironmentDefinition;
	readonly endpoints: EndpointCompositionInput;
	readonly workflows?: DefinitionInput<WorkflowDefinition>;
	readonly policies?: readonly ServicePolicy[];
	readonly observers?: readonly ServiceObserverDefinition[];
}> & ServiceContributions;

/** Exact named subset of a service's imported endpoint graph. */
export interface ServiceSelection<
	Service extends ServiceDefinition = ServiceDefinition,
> extends CatalogEntryIdentity {
	/** Stable discriminant for this service selection value. */
	readonly kind: 'service-selection';
	readonly service: Service;
	readonly endpoints: readonly EndpointDefinition[];
}

/** Runtime implementation supplied separately from a service definition. */
export interface ServiceImplementation<
	Definition extends ServiceDefinition = ServiceDefinition,
	Host extends object = EmptyEndpointHost,
> {
	/** Stable discriminant for this service implementation value. */
	readonly kind: 'service-implementation';
	/** Exact import-safe definition bound to this service implementation. */
	readonly definition: Definition;
	readonly endpoints: readonly AnyEndpointHandlerBinding[];
	readonly middleware: readonly MiddlewareHandler[];
	/** Resource definitions or collection available to this service implementation. */
	readonly resources: ResourceImplementationSet;
	readonly hostType?: Host;
}

/** Input accepted by `service.implement()`. */
export interface ServiceImplementationInput<Host extends object = EmptyEndpointHost> {
	readonly endpoints?: readonly (AnyEndpointHandlerBinding | readonly AnyEndpointHandlerBinding[])[];
	readonly middleware?: readonly MiddlewareHandler[];
	/** Resource definitions or collection available to this service implementation. */
	readonly resources?: ResourceImplementationSet;
	readonly hostType?: Host;
}

/** One service route with full import provenance. */
export interface ServiceRoute {
	/** Stable service route identity used for correlation, lookup, or durable records. */
	readonly id: string;
	readonly service: ServiceDefinition;
	readonly endpoint: EndpointDefinition;
	/** Child operation coordinated by this service route. */
	readonly operation: EndpointOperation;
	readonly groups: readonly EndpointGroup[];
	readonly method: EndpointMethod;
	/** Deterministic or canonical path associated with this service route. */
	readonly path: string;
}


/** One request input selected during service compilation. */
export interface ServiceExecutionInput {
	readonly source: EndpointInputSource;
	readonly slot: EndpointInputSlot;
}

/**
 * Request-time work selected once during service compilation.
 *
 * This plan removes repeated discovery from the hot path. It never suppresses
 * declared validation, authentication, requirements, middleware, or resilience.
 */
export interface ServiceExecutionPlan {
	readonly inputs: readonly ServiceExecutionInput[];
	readonly bodyLimit?: number;
	readonly timeout?: Temporal.Duration;
	readonly admission: readonly ResiliencePolicy[];
	readonly operation: readonly ResiliencePolicy[];
}

/** Fully resolved static contract for one operation. */
export interface EffectiveServiceOperation extends ServiceRoute {
	readonly middleware: MiddlewarePlan;
	readonly authentication: readonly CatalogEntryIdentity[];
	/** Requirements active for every execution of this operation. */
	readonly requirements: readonly RequirementDefinition[];
	/** Requirements reachable through declared resources and other selected definitions. */
	readonly reachableRequirements: readonly RequirementDefinition[];
	/** Required one-way consequences code in this operation may announce. */
	readonly effects: readonly EffectDefinition[];
	/** Resource definitions or collection available to this effective service operation. */
	readonly resources: readonly ResourceDefinition[];
	readonly problems: readonly ProblemDefinition[];
	readonly responses: readonly ResponseDefinition[];
	readonly resiliency: readonly ResiliencePolicy[];
	readonly execution: ServiceExecutionPlan;
	readonly handler: AnyEndpointHandlerBinding;
}

/** JSON-safe route manifest used by gateways, tests, and deployments. */
export interface ServiceRouteManifestEntry {
	/** Stable service route manifest identity used for correlation, lookup, or durable records. */
	readonly id: string;
	readonly method: Uppercase<EndpointMethod>;
	/** Deterministic or canonical path associated with this service route manifest. */
	readonly path: string;
	/** Stable operation identity carried by this service route manifest. */
	readonly operationId: string;
	/** Stable endpoint identity carried by this service route manifest. */
	readonly endpointId: string;
	readonly authentication: readonly string[];
	/** Requirements owned directly by this service route manifest; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDocument[];
	/** Requirements that can become active through this compiled route and its dependencies. */
	readonly reachableRequirements: readonly RequirementDocument[];
	/** Effect IDs code in this compiled route may announce. */
	readonly effects: readonly string[];
	/** Resource definitions or collection available to this service route manifest. */
	readonly resources: readonly string[];
	readonly problems: readonly string[];
	readonly responses: readonly string[];
	readonly middleware: Readonly<Record<string, readonly string[]>>;
	/** Effective resilience policies with their runtime owner and lifecycle stage. */
	readonly resiliency: readonly ResilienceDocument[];
	readonly execution: Readonly<{ readonly inputs: readonly EndpointInputSource[]; readonly bodyLimit?: number; readonly timeout?: string }>;
}

/** Deterministic compiled service manifest. */
export interface ServiceManifest {
	/** Stable service manifest identity used for correlation, lookup, or durable records. */
	readonly id: string;
	/** Deterministic or canonical path associated with this service manifest. */
	readonly path: string;
	/** Human-readable service manifest purpose used by documentation and diagnostics. */
	readonly description?: string;
	readonly routes: readonly ServiceRouteManifestEntry[];
	readonly environment?: EnvironmentManifest;
	/** Resource definitions or collection available to this service manifest. */
	readonly resources: readonly string[];
	readonly resourceGraph: readonly ResourceDocument[];
	/** Requirements owned directly by this service manifest; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDocument[];
	/** Complete requirements reachable anywhere in this compiled service. */
	readonly reachableRequirements: readonly RequirementDocument[];
	/** Distinct effect IDs reachable from compiled service operations. */
	readonly effects: readonly string[];
	readonly problems: readonly string[];
	readonly responses: readonly string[];
	readonly middleware: readonly string[];
	/** Distinct resilience policy kinds used anywhere in this service. */
	readonly resiliency: readonly string[];
	readonly workflows: readonly string[];
	readonly observers: readonly string[];
}

/** Compiled service ready for runtime creation and artifact generation. */
export interface CompiledService<
	Definition extends ServiceDefinition = ServiceDefinition,
	Host extends object = EmptyEndpointHost,
> {
	/** Stable discriminant for this compiled service value. */
	readonly kind: 'compiled-service';
	/** Exact import-safe definition bound to this compiled service. */
	readonly definition: Definition;
	readonly implementation: ServiceImplementation<Definition, Host>;
	/** Keyed child operations coordinated by this compiled service. */
	readonly operations: readonly EffectiveServiceOperation[];
	readonly routePlan: RoutePlan;
	readonly manifest: ServiceManifest;
}


/** Definition or implementation value that may be attached to a compiler issue. */
export type ServiceValidationSubject =
	| CatalogEntryIdentity
	| ServiceRoute
	| AnyEndpointHandlerBinding
	| MiddlewareHandler
	| ResourceImplementationAny
	| ResiliencePolicy;

/** One compiler validation issue. */
export interface ServiceValidationIssue {
	readonly code:
		| 'invalid-definition'
		| 'invalid-endpoint'
		| 'policy-target-outside-service'
		| 'route-conflict'
		| 'operation-id-conflict'
		| 'missing-endpoint-handler'
		| 'extraneous-endpoint-handler'
		| 'missing-middleware-handler'
		| 'extraneous-middleware-handler'
		| 'missing-resource-implementation'
		| 'resource-conflict'
		| 'invalid-resiliency'
		| 'missing-environment'
		| 'environment-conflict';
	readonly message: string;
	/** Exact import-safe definition bound to this service validation issue. */
	readonly definition?: ServiceValidationSubject;
}

/** Validation result for a definition or implementation. */
export type ServiceValidationResult =
	| Readonly<{ readonly valid: true; readonly routes: readonly ServiceRoute[] }>
	| Readonly<{ readonly valid: false; readonly issues: readonly ServiceValidationIssue[] }>;


/**
 * Empty base contract for application-owned values added during one service request.
 *
 * Applications extend this type with exact provider-neutral fields. The generic
 * server reserves no authentication, actor, organization, or policy-state keys.
 */
export type ServiceRequestValues = EndpointRequestValues;

/** Execution context used by service handlers after effect and requirement scopes are attached. */
export type ServiceExecutionContext = RequirementContext<EffectContext<Context>>;

/** Validated values grouped by HTTP request location. */
export type ServiceInputValues = EndpointRuntimeInputValues;

/**
 * Fixed request state plus provider-neutral values contributed by runtime adapters.
 *
 * Request values remain partial while ordered adapters add them. Adapters cannot
 * replace framework-owned fields such as the Request, host, inputs, resources,
 * execution context, or compiled operation.
 */
type ServiceRequestCore<Host extends object> = Readonly<{
	/** Request payload carried by this service request state. */
	readonly request: Request;
	readonly host: Host;
	/** Borrowed parent execution context for this service request state. */
	readonly ctx: ServiceExecutionContext;
	/** Input carried by this service request state. */
	readonly input: ServiceInputValues;
	/** Context-bound resolver for resources reachable by this operation. */
	readonly resources: ResourceResolver;
	readonly values: ServiceContextStore;
	/** Child operation coordinated by this service request state. */
	readonly operation: EffectiveServiceOperation;
}>;

/**
 * Fixed request state plus provider-neutral values contributed by runtime adapters.
 *
 * Request values remain partial while ordered adapters add them. Adapters cannot
 * replace framework-owned fields such as the Request, host, inputs, resources,
 * execution context, or compiled operation.
 */
export type ServiceValuePatch<Values extends ServiceRequestValues = ServiceRequestValues> = Readonly<{
	readonly [Key in keyof Values]?: Exclude<Values[Key], undefined>;
}>;

/** Immutable request state that prevents adapter patches from replacing framework-owned fields. */
export type ServiceRequestState<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
> = Readonly<ServiceRequestCore<Host> & Omit<ServiceValuePatch<Values>, keyof ServiceRequestCore<Host>>>;

/** Request-value patch returned by a runtime adapter after successful evaluation. */
export type ServiceRequestStatePatch<Values extends ServiceRequestValues = ServiceRequestValues> = ServiceValuePatch<Values>;

/**
 * Runtime adapter for resilience policies not implemented by the generic server.
 *
 * The server owns timeout and body-limit behavior. Idempotency, rate limiting,
 * bulkheads, retries, and circuit breakers require an explicit runtime adapter.
 */
export interface ServiceResilienceAdapter<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues> {
	/** Return whether this adapter implements the exact declared resilience policy. */
	supports(policy: ResiliencePolicy): boolean;
	/** Run the adapter-owned policies for one lifecycle stage. */
	run(
		policies: readonly ResiliencePolicy[],
		state: ServiceRequestState<Host, Values>,
		next: () => Promise<ServiceStageResult>,
	): Promise<ServiceStageResult>;
}

/** Runtime adapters supplied by the application composition root. */
export interface ServiceRuntimeAdapters<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues> {
	readonly authenticate?: (
		requirements: readonly CatalogEntryIdentity[],
		state: ServiceRequestState<Host, Values>,
	) => Promise<ServiceRequestStatePatch<Values> | ProblemResult | void>;
	/** Active requirement interpreters. Unknown families reject unless this runtime explicitly selects `ignore`. */
	readonly requirements?: RequirementRuntime;
	/** Optional emitter used only when runtime code announces a declared effect. */
	readonly effect?: EffectEmitter;
	/** Adapter for resilience policies that the generic server cannot execute itself. */
	readonly resilience?: ServiceResilienceAdapter<Host, Values>;
}

/** Direct-identity context store used by middleware and runtime adapters. */
export interface ServiceContextStore {
	has<Definition extends MiddlewareContextDefinition>(definition: Definition): boolean;
	/** Get one addressable value under this service context store contract. */
	get<Definition extends MiddlewareContextDefinition>(definition: Definition): MiddlewareContextValue<Definition>;
	set<Definition extends MiddlewareContextDefinition>(
		definition: Definition,
		value: MiddlewareContextValue<Definition>,
	): void;
}

/** Options used to create a live framework-neutral service runtime. */
export interface CreateServiceOptions<Host extends object = EmptyEndpointHost, Values extends ServiceRequestValues = ServiceRequestValues> {
	readonly environment?: Readonly<Record<string, unknown>>;
	readonly host: Host;
	readonly adapters?: ServiceRuntimeAdapters<Host, Values>;
	/** Add domain-specific runtime views after validation and active admission requirements. */
	readonly requirementContext?: (ctx: ServiceExecutionContext, state: ServiceRequestState<Host, Values>, reachable: readonly RequirementDefinition[]) => ServiceExecutionContext;
	readonly requestParsing?: RequestParsingOptions;
	/** Exact observer handlers required by observer definitions imported by this service. */
	readonly observers?: readonly ServiceObserverHandler[];
	/** Stable request identity carried by this create service. */
	readonly requestId?: (request: Request) => string;
	/** Stable trace identity carried by this create service. */
	readonly traceId?: (request: Request) => string | undefined;
}

/** Route exposed by one live compiled service runtime. */
export interface ServiceRuntimeRoute {
	/** HTTP method registered for this exact compiled operation. */
	readonly method: string;
	/** Canonical route template registered for this exact compiled operation. */
	readonly path: string;
	/** Execute this exact operation without asking another router to resolve it again. */
	readonly handler: (request: Request) => Response | Promise<Response>;
}

/**
 * Live service runtime owned by one transport host.
 *
 * The runtime owns service resources and request contexts, not the network
 * listener. Hosts expose `fetch` through Deno, Node, an edge adapter, or
 * another HTTP transport and dispose this runtime when that host shuts down.
 */
export interface ServiceRuntime extends AsyncDisposable {
	/** Exact compiled routes in canonical adapter-registration order. */
	readonly routes: readonly ServiceRuntimeRoute[];
	/** Framework-neutral Fetch entry point for the compiled service. */
	readonly fetch: (request: Request) => Response | Promise<Response>;
	/** Resource definitions or collection available to this service. */
	readonly resources: ResourceCollection;
}

/** Result returned by a middleware or runtime-adapter stage. */
export type ServiceStageResult =
	| ResponseResult
	| ProblemResult
	| Response
	| void;
