import type { CatalogEntryIdentity, DefinitionInput } from '@okikio/catalog';
import type {
	AnyEndpointHandlerBinding,
	EmptyEndpointHost,
	EndpointCompositionInput,
	EndpointDefinition,
	EndpointEntry,
	EndpointGroup,
	EndpointInputSlot,
	EndpointInputSource,
	EndpointMethod,
	EndpointOperation,
	EndpointRequestValues,
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
	ResourceCollection,
	ResourceDefinition,
	ResourceDocument,
	ResourceImplementationAny,
	ResourceImplementationSet,
	ResourceResolver,
} from '@okikio/resource';
import type { WorkflowDefinition } from '@okikio/workflow';
import type {
	RequirementContext,
	RequirementDefinition,
	RequirementDocument,
	RequirementInput,
	RequirementRuntime,
} from '@okikio/requirement';

/** Static cross-cutting values contributed by a service or service policy. */
export interface ServiceContributions {
	/** Declared middleware contributions or their compiled placement plan. */
	readonly middleware?: MiddlewareInput;
	/** Authentication contracts required by the selected operation; the host supplies their evaluator. */
	readonly authentication?: DefinitionInput<CatalogEntryIdentity>;
	/** Requirements owned directly by this service contributions; reachable dependency requirements remain separate. */
	readonly requirements?: RequirementInput;
	/** One-way consequences code in this service scope may announce. */
	readonly effects?: EffectDefinitions;
	/** Resource definitions or collection available to this service contributions. */
	readonly resources?: DefinitionInput<ResourceDefinition>;
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems?: DefinitionInput<ProblemDefinition>;
	/** Declared resilience policies; each policy retains a designated runtime owner. */
	readonly resiliency?: ResilienceInput;
}

/** Additive selector-based overlay for a subset of imported endpoints. */
export interface ServicePolicy extends CatalogEntryIdentity, ServiceContributions {
	/** Stable discriminant for this service policy value. */
	readonly kind: 'service-policy';
	/** Exact endpoint composition or selected bindings retained by this contract. */
	readonly endpoints: readonly EndpointEntry[];
}

/** Input accepted by `service.policy()`. */
export type ServicePolicyInput =
	& Readonly<{
		readonly id: string;
		readonly description?: string;
		readonly endpoints: EndpointCompositionInput;
	}>
	& ServiceContributions;

/** Service lifecycle events available to observational handlers. */
export type ServiceObserverEventKind = 'started' | 'response' | 'completed' | 'failed' | 'aborted';

/** Import-safe subscription to selected service request lifecycle events. */
export interface ServiceObserverDefinition extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'service-observer';
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Service lifecycle event kinds selected for observation; receiving headers and completing a body are separate events. */
	readonly events: readonly ServiceObserverEventKind[];
}

/** Credential-free service request metadata emitted by the framework-neutral runtime. Error text still requires host redaction before external export. */
export interface ServiceObserverEvent {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: ServiceObserverEventKind;
	/** Identity of the service selected for this route or observation. */
	readonly serviceId: string;
	/** Request correlation identity; it is diagnostic data rather than authorization. */
	readonly requestId?: string;
	/** Trace correlation identity retained for diagnostic propagation. */
	readonly traceId?: string;
	/** Span correlation identity for the current operation. */
	readonly spanId?: string;
	/** HTTP method selected for this operation or route. */
	readonly method: string;
	/** Declared route pathname or prefix; path parameters retain the endpoint grammar. */
	readonly path: string;
	/** Identity of the selected endpoint path contract. */
	readonly endpointId: string;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status?: number;
	/** Observed response-body bytes; response headers alone do not prove body completion. */
	readonly responseBytes?: number;
	/** Response-body terminal outcome and delivered byte count, distinct from receiving headers. */
	readonly completion?: Readonly<{ readonly outcome: 'completed' | 'cancelled' | 'errored'; readonly bytes: number }>;
	/** Diagnostic failure retained for this observation; it does not replace the authoritative operation result. */
	readonly error?: Readonly<{ readonly name: string; readonly message: string }>;
}

/** Runtime handler bound to one exact import-safe service observer definition. */
export interface ServiceObserverHandler<Definition extends ServiceObserverDefinition = ServiceObserverDefinition> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'service-observer-handler';
	/** Exact declaration involved in this binding, result or validation issue. */
	readonly definition: Definition;
	/** Observe a redacted service lifecycle event; this callback cannot settle the request. */
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
	/** Declared environment contract or explicit host inputs; importing it does not read ambient values. */
	readonly environment?: EnvironmentDefinition;
	/** Exact endpoint composition or selected bindings retained by this contract. */
	readonly endpoints: readonly EndpointEntry[];
	/** Workflow declarations, or their IDs in manifests, contributed by this service. */
	readonly workflows: readonly WorkflowDefinition[];
	/** Additive policies that apply to exact declarations in this composition. */
	readonly policies: readonly ServicePolicy[];
	/** Observer declarations or exact host-supplied handlers; observers remain outside result authority. */
	readonly observers: readonly ServiceObserverDefinition[];
}

/** Input accepted by `service.define()`. */
export type ServiceDefinitionInput<
	Id extends string = string,
	Path extends string = string,
> =
	& Readonly<{
		readonly id: Id;
		readonly path: Path;
		readonly description?: string;
		readonly environment?: EnvironmentDefinition;
		readonly endpoints: EndpointCompositionInput;
		readonly workflows?: DefinitionInput<WorkflowDefinition>;
		readonly policies?: readonly ServicePolicy[];
		readonly observers?: readonly ServiceObserverDefinition[];
	}>
	& ServiceContributions;

/** Exact named subset of a service's imported endpoint graph. */
export interface ServiceSelection<
	Service extends ServiceDefinition = ServiceDefinition,
> extends CatalogEntryIdentity {
	/** Stable discriminant for this service selection value. */
	readonly kind: 'service-selection';
	/** Original exact service declaration from which the endpoint selection was made. */
	readonly service: Service;
	/** Exact endpoint composition or selected bindings retained by this contract. */
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
	/** Exact endpoint handler bindings supplied for this service. */
	readonly endpoints: readonly AnyEndpointHandlerBinding[];
	/** Exact middleware handler bindings supplied for this service. */
	readonly middleware: readonly MiddlewareHandler[];
	/** Resource definitions or collection available to this service implementation. */
	readonly resources: ResourceImplementationSet;
	/** Compile-time host inference slot; it is not a runtime provider instance. */
	readonly hostType?: Host;
}

/** Input accepted by `service.implement()`. */
export interface ServiceImplementationInput<Host extends object = EmptyEndpointHost> {
	/** Exact endpoint handler bindings supplied for this service. */
	readonly endpoints?: readonly (AnyEndpointHandlerBinding | readonly AnyEndpointHandlerBinding[])[];
	/** Exact middleware handler bindings supplied for this service. */
	readonly middleware?: readonly MiddlewareHandler[];
	/** Resource definitions or collection available to this service implementation. */
	readonly resources?: ResourceImplementationSet;
	/** Compile-time host inference slot; it is not a runtime provider instance. */
	readonly hostType?: Host;
}

/** One service route with full import provenance. */
export interface ServiceRoute {
	/** Stable service route identity used for correlation, lookup, or durable records. */
	readonly id: string;
	/** Exact service contract retained by this binding or selection. */
	readonly service: ServiceDefinition;
	/** Exact endpoint path contract to which this binding belongs. */
	readonly endpoint: EndpointDefinition;
	/** Child operation coordinated by this service route. */
	readonly operation: EndpointOperation;
	/** Enclosing endpoint groups retained in route order. */
	readonly groups: readonly EndpointGroup[];
	/** HTTP method selected for this operation or route. */
	readonly method: EndpointMethod;
	/** Deterministic or canonical path associated with this service route. */
	readonly path: string;
}

/** One request input selected during service compilation. */
export interface ServiceExecutionInput {
	/** Request location from which this compiled validation step reads wire values. */
	readonly source: EndpointInputSource;
	/** Schema or input declaration compiled for this particular request source. */
	readonly slot: EndpointInputSlot;
}

/**
 * Request-time work selected once during service compilation.
 *
 * This plan removes repeated discovery from the hot path. It never suppresses
 * declared validation, authentication, requirements, middleware, or resilience.
 */
export interface ServiceExecutionPlan {
	/** Declared request input slots or their compiled validation steps. */
	readonly inputs: readonly ServiceExecutionInput[];
	/** Maximum request-body bytes admitted by this runtime policy. */
	readonly bodyLimit?: number;
	/** Request timeout retained as a duration, or serialized duration text in a manifest. */
	readonly timeout?: Temporal.Duration;
	/** Prepared resilience policies applied at the request admission stage. */
	readonly admission: readonly ResiliencePolicy[];
	/** Resilience policies applied around the selected endpoint operation. */
	readonly operation: readonly ResiliencePolicy[];
}

/** Fully resolved static contract for one operation. */
export interface EffectiveServiceOperation extends ServiceRoute {
	/** Declared middleware contributions or their compiled placement plan. */
	readonly middleware: MiddlewarePlan;
	/** Authentication contracts required by the selected operation; the host supplies their evaluator. */
	readonly authentication: readonly CatalogEntryIdentity[];
	/** Requirements active for every execution of this operation. */
	readonly requirements: readonly RequirementDefinition[];
	/** Requirements reachable through declared resources and other selected definitions. */
	readonly reachableRequirements: readonly RequirementDefinition[];
	/** Required one-way consequences code in this operation may announce. */
	readonly effects: readonly EffectDefinition[];
	/** Resource definitions or collection available to this effective service operation. */
	readonly resources: readonly ResourceDefinition[];
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems: readonly ProblemDefinition[];
	/** Declared successful response contracts or their projected IDs. */
	readonly responses: readonly ResponseDefinition[];
	/** Declared resilience policies; each policy retains a designated runtime owner. */
	readonly resiliency: readonly ResiliencePolicy[];
	/** Prepared request validation and policy work for this operation. */
	readonly execution: ServiceExecutionPlan;
	/** Exact endpoint handler selected during compilation. */
	readonly handler: AnyEndpointHandlerBinding;
}

/** JSON-safe route manifest used by gateways, tests, and deployments. */
export interface ServiceRouteManifestEntry {
	/** Stable service route manifest identity used for correlation, lookup, or durable records. */
	readonly id: string;
	/** HTTP method selected for this operation or route. */
	readonly method: Uppercase<EndpointMethod>;
	/** Deterministic or canonical path associated with this service route manifest. */
	readonly path: string;
	/** Stable operation identity carried by this service route manifest. */
	readonly operationId: string;
	/** Stable endpoint identity carried by this service route manifest. */
	readonly endpointId: string;
	/** Authentication contracts required by the selected operation; the host supplies their evaluator. */
	readonly authentication: readonly string[];
	/** Requirements owned directly by this service route manifest; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDocument[];
	/** Requirements that can become active through this compiled route and its dependencies. */
	readonly reachableRequirements: readonly RequirementDocument[];
	/** Effect IDs code in this compiled route may announce. */
	readonly effects: readonly string[];
	/** Resource definitions or collection available to this service route manifest. */
	readonly resources: readonly string[];
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems: readonly string[];
	/** Declared successful response contracts or their projected IDs. */
	readonly responses: readonly string[];
	/** Declared middleware contributions or their compiled placement plan. */
	readonly middleware: Readonly<Record<string, readonly string[]>>;
	/** Effective resilience policies with their runtime owner and lifecycle stage. */
	readonly resiliency: readonly ResilienceDocument[];
	/** JSON-safe prepared input locations and body/time limits for this route. */
	readonly execution: Readonly<
		{ readonly inputs: readonly EndpointInputSource[]; readonly bodyLimit?: number; readonly timeout?: string }
	>;
}

/** Deterministic compiled service manifest. */
export interface ServiceManifest {
	/** Stable service manifest identity used for correlation, lookup, or durable records. */
	readonly id: string;
	/** Deterministic or canonical path associated with this service manifest. */
	readonly path: string;
	/** Human-readable service manifest purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Authored or compiled route entries retained by this application or manifest. */
	readonly routes: readonly ServiceRouteManifestEntry[];
	/** Declared environment contract or explicit host inputs; importing it does not read ambient values. */
	readonly environment?: EnvironmentManifest;
	/** Resource definitions or collection available to this service manifest. */
	readonly resources: readonly string[];
	/** Inspectable resource dependency graph; it contains no acquired resource values. */
	readonly resourceGraph: readonly ResourceDocument[];
	/** Requirements owned directly by this service manifest; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDocument[];
	/** Complete requirements reachable anywhere in this compiled service. */
	readonly reachableRequirements: readonly RequirementDocument[];
	/** Distinct effect IDs reachable from compiled service operations. */
	readonly effects: readonly string[];
	/** Declared HTTP problem contracts or their projected IDs. */
	readonly problems: readonly string[];
	/** Declared successful response contracts or their projected IDs. */
	readonly responses: readonly string[];
	/** Declared middleware contributions or their compiled placement plan. */
	readonly middleware: readonly string[];
	/** Distinct resilience policy kinds used anywhere in this service. */
	readonly resiliency: readonly string[];
	/** Workflow declarations, or their IDs in manifests, contributed by this service. */
	readonly workflows: readonly string[];
	/** Observer declarations or exact host-supplied handlers; observers remain outside result authority. */
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
	/** Exact live behavior set bound to this compiled service. */
	readonly implementation: ServiceImplementation<Definition, Host>;
	/** Keyed child operations coordinated by this compiled service. */
	readonly operations: readonly EffectiveServiceOperation[];
	/** Prepared handler-free route metadata bound to the corresponding runtime handlers. */
	readonly routePlan: RoutePlan;
	/** Deterministic data projection for inspection, deployment and drift checks. */
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
	/** Stable failure code; callers should branch on this instead of matching explanation text. */
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
	/** Human-readable diagnostic explanation; it is not a stable program discriminator. */
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
export type ServiceValuePatch<Values extends ServiceRequestValues = ServiceRequestValues> = Readonly<
	{
		readonly [Key in keyof Values]?: Exclude<Values[Key], undefined>;
	}
>;

/** Immutable request state that prevents adapter patches from replacing framework-owned fields. */
export type ServiceRequestState<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
> = Readonly<ServiceRequestCore<Host> & Omit<ServiceValuePatch<Values>, keyof ServiceRequestCore<Host>>>;

/** Request-value patch returned by a runtime adapter after successful evaluation. */
export type ServiceRequestStatePatch<Values extends ServiceRequestValues = ServiceRequestValues> = ServiceValuePatch<
	Values
>;

/**
 * Runtime adapter for resilience policies not implemented by the generic server.
 *
 * The server owns timeout and body-limit behavior. Idempotency, rate limiting,
 * bulkheads, retries, and circuit breakers require an explicit runtime adapter.
 */
export interface ServiceResilienceAdapter<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
> {
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
export interface ServiceRuntimeAdapters<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
> {
	/** Host-owned evaluation of the declared authentication contracts before forwarding or operation admission. */
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
	/** Test whether this exact context definition has a stored request value. */
	has<Definition extends MiddlewareContextDefinition>(definition: Definition): boolean;
	/** Get one addressable value under this service context store contract. */
	get<Definition extends MiddlewareContextDefinition>(definition: Definition): MiddlewareContextValue<Definition>;
	/** Store a value under the exact context definition so later declared middleware can retrieve it. */
	set<Definition extends MiddlewareContextDefinition>(
		definition: Definition,
		value: MiddlewareContextValue<Definition>,
	): void;
}

/** Options used to create a live framework-neutral service runtime. */
export interface CreateServiceOptions<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
> {
	/** Declared environment contract or explicit host inputs; importing it does not read ambient values. */
	readonly environment?: Readonly<Record<string, unknown>>;
	/** Application-owned host values supplied by the composition root. */
	readonly host: Host;
	/** Host-supplied authentication, requirement or transport capabilities; no provider is chosen implicitly. */
	readonly adapters?: ServiceRuntimeAdapters<Host, Values>;
	/** Add domain-specific runtime views after validation and active admission requirements. */
	readonly requirementContext?: (
		ctx: ServiceExecutionContext,
		state: ServiceRequestState<Host, Values>,
		reachable: readonly RequirementDefinition[],
	) => ServiceExecutionContext;
	/** Bounded wire parsing policy and limit overrides for this runtime. */
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
