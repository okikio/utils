import type { CatalogEntryIdentity, DefinitionInput } from '@okikio/catalog';
import type {
	AnyEndpointHandlerBinding,
	EndpointCompositionInput,
	EndpointDefinition,
	EndpointEntry,
	EndpointConcernValues,
	EmptyEndpointHost,
	EndpointGroup,
	EndpointMethod,
	EndpointOperation,
	EndpointRuntimeInputValues,
} from '@okikio/server/endpoint';
import type { EnvironmentDefinition, EnvironmentManifest } from '@okikio/env';
import type { Context } from '@okikio/context';
import type {
	MiddlewareContextDefinition,
	MiddlewareContextValue,
	MiddlewareHandler,
	MiddlewareInput,
	MiddlewarePlan,
} from '@okikio/server/middleware';
import type { ResilienceInput, ResiliencePolicy } from '@okikio/resilience';
import type { ProblemDefinition, ProblemResult } from '@okikio/http/problem';
import type { ResponseCompletion, ResponseDefinition, ResponseResult } from '@okikio/http/response';
import type { RequestParsingOptions } from '@okikio/http/request';
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

/** Fully resolved static contract for one operation. */
export interface EffectiveServiceOperation extends ServiceRoute {
	readonly middleware: MiddlewarePlan;
	readonly authentication: readonly CatalogEntryIdentity[];
	/** Requirements active for every execution of this operation. */
	readonly requirements: readonly RequirementDefinition[];
	/** Requirements reachable through declared resources and other selected definitions. */
	readonly reachableRequirements: readonly RequirementDefinition[];
	/** Resource definitions or collection available to this effect ive service operation. */
	readonly resources: readonly ResourceDefinition[];
	readonly problems: readonly ProblemDefinition[];
	readonly responses: readonly ResponseDefinition[];
	readonly resiliency: readonly ResiliencePolicy[];
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
	/** Resource definitions or collection available to this service route manifest. */
	readonly resources: readonly string[];
	readonly problems: readonly string[];
	readonly responses: readonly string[];
	readonly middleware: Readonly<Record<string, readonly string[]>>;
	readonly resiliency: readonly string[];
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
	readonly problems: readonly string[];
	readonly responses: readonly string[];
	readonly middleware: readonly string[];
	readonly resiliency: readonly string[];
	readonly workflows: readonly string[];
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
 * Exact application concern values propagated through one request.
 *
 * Identity and requirement-family packages specialize this interface with
 * their provider-neutral domain types. `utils/server` only coordinates the
 * stages and never imports permission, entitlement, meter, quota, or provider packages.
 */
export type ServiceConcernValues = EndpointConcernValues;

/** Validated values grouped by HTTP request location. */
export type ServiceInputValues = EndpointRuntimeInputValues;

/**
 * Request values exposed to service concern runtimes.
 *
 * The service utility owns the fixed request/runtime fields. Domain concern
 * packages contribute provider-neutral request values through the generic
 * `Concerns` object. Concern values remain partial while ordered request stages
 * accumulate them, and framework-owned fields cannot be replaced by concerns.
 */
type ServiceRequestCore<Host extends object> = Readonly<{
	/** Request payload carried by this service request state. */
	readonly request: Request;
	readonly host: Host;
	/** Borrowed parent execution context for this service request state. */
	readonly ctx: RequirementContext<Context>;
	/** Input carried by this service request state. */
	readonly input: ServiceInputValues;
	/** Context-bound resolver for resources reachable by this operation. */
	readonly resources: ResourceResolver;
	readonly values: ServiceContextStore;
	/** Child operation coordinated by this service request state. */
	readonly operation: EffectiveServiceOperation;
}>;

/**
 * Request values exposed to service concern runtimes.
 *
 * The service utility owns the fixed request/runtime fields. Domain concern
 * packages contribute provider-neutral request values through the generic
 * `Concerns` object. Concern values remain partial while ordered request stages
 * accumulate them, and framework-owned fields cannot be replaced by concerns.
 */
export type ServiceConcernPatch<Concerns extends ServiceConcernValues = ServiceConcernValues> = Readonly<{
	readonly [Key in keyof Concerns]?: Exclude<Concerns[Key], undefined>;
}>;

/** Immutable request state composed without allowing concern patches to replace framework-owned core fields. */
export type ServiceRequestState<
	Host extends object = EmptyEndpointHost,
	Concerns extends ServiceConcernValues = ServiceConcernValues,
> = Readonly<ServiceRequestCore<Host> & Omit<ServiceConcernPatch<Concerns>, keyof ServiceRequestCore<Host>>>;

/** Patch returned by a concern runtime after successful evaluation. Present keys always carry concrete values. */
export type ServiceRequestStatePatch<Concerns extends ServiceConcernValues = ServiceConcernValues> = ServiceConcernPatch<Concerns>;

/**
 * Host adapter for resilience policies not implemented by the generic server.
 *
 * Timeout and body limits are native. Admission/idempotency/retry/circuit and
 * bulkhead semantics require an explicit durable or distributed host adapter.
 */
export interface ServiceResilienceHost<Host extends object = EmptyEndpointHost, Concerns extends ServiceConcernValues = ServiceConcernValues> {
	/** Return whether this host implements the exact declared resilience policy. */
	supports(policy: ResiliencePolicy): boolean;
	/** Run one concrete unit of service resilience host behavior. */
	run(
		policies: readonly ResiliencePolicy[],
		state: ServiceRequestState<Host, Concerns>,
		next: () => Promise<ServiceStageResult>,
	): Promise<ServiceStageResult>;
}

/** Provider/domain concern runtimes supplied by a composition root. */
export interface ServiceConcernRuntimes<Host extends object = EmptyEndpointHost, Concerns extends ServiceConcernValues = ServiceConcernValues> {
	readonly authenticate?: (
		requirements: readonly CatalogEntryIdentity[],
		state: ServiceRequestState<Host, Concerns>,
	) => Promise<ServiceRequestStatePatch<Concerns> | ProblemResult | void>;
	/** Active requirement interpreters. Unknown families reject unless this runtime explicitly selects `ignore`. */
	readonly requirements?: RequirementRuntime;
	/** Static resilience policies applied at the service concern runtimes lifecycle. */
	readonly resilience?: ServiceResilienceHost<Host, Concerns>;
}

/** Direct-identity context store used by middleware and concern adapters. */
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
export interface CreateServiceOptions<Host extends object = EmptyEndpointHost, Concerns extends ServiceConcernValues = ServiceConcernValues> {
	readonly environment?: Readonly<Record<string, unknown>>;
	readonly host: Host;
	readonly concerns?: ServiceConcernRuntimes<Host, Concerns>;
	/** Add domain-specific runtime views after validation and active admission requirements. */
	readonly context?: (ctx: RequirementContext, state: ServiceRequestState<Host, Concerns>, reachable: readonly RequirementDefinition[]) => RequirementContext;
	readonly requestParsing?: RequestParsingOptions;
	readonly onError?: (error: Error, state?: ServiceRequestState<Host, Concerns>) => void | Promise<void>;
	readonly onResponseComplete?: (event: Readonly<{
		/** Stable request identity carried by this create service. */
		readonly requestId: string;
		/** Stable operation identity carried by this create service. */
		readonly operationId: string;
		readonly method: string;
		/** Deterministic or canonical path associated with this create service. */
		readonly path: string;
		readonly status: number;
		/** Recorded terminal completion returned during workflow replay. */
		readonly completion: ResponseCompletion;
	}>) => void | Promise<void>;
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

/** Live service runtime owned by one host. */
export interface ServiceRuntime extends AsyncDisposable {
	/** Exact compiled routes in canonical adapter-registration order. */
	readonly routes: readonly ServiceRuntimeRoute[];
	/** Framework-neutral Fetch entry point for the compiled service. */
	readonly fetch: (request: Request) => Response | Promise<Response>;
	/** Resource definitions or collection available to this service. */
	readonly resources: ResourceCollection;
}

/** Result returned by a middleware or concern stage. */
export type ServiceStageResult =
	| ResponseResult
	| ProblemResult
	| Response
	| void;
