import type {
	CatalogEntryIdentity,
	CatalogEntryValue,
	DefinitionInput as CatalogDefinitionInput,
	ValuedCatalogEntry,
} from '@okikio/catalog';
import type { Context, Owned, Resources } from '@okikio/context';
import type { RequirementContext, RequirementRuntime } from '@okikio/requirement';
import type { RequirementDefinition, RequirementInput, RequirementDocument } from '@okikio/requirement';
import type { EnvironmentFields, EnvironmentRequirement, InferEnvironmentFields } from '@okikio/env';

/** Private phantom key that preserves a resource definition's dependency type without runtime data. */
const resourceDependenciesType: unique symbol = Symbol('utils.resource.dependencies-type');
/** Private phantom key that preserves a resource definition's environment type without runtime data. */
const resourceEnvironmentType: unique symbol = Symbol('utils.resource.environment-type');

/** A keyed record of direct resource dependencies. */
export type ResourceDependencies = Readonly<Record<string, ResourceDefinition>>;

/** Optional health metadata included in generated resource documentation. */
export interface ResourceHealth {
	/** Human-readable resource health purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Maximum health-check duration suggested to hosts that interpret this metadata. */
	readonly timeoutMilliseconds?: number;
}

/** Optional external documentation for a resource definition. */
export interface ResourceDocumentation {
	/** Canonical external documentation URL for this resource contract. */
	readonly url?: string;
	/** Additional integration notes that do not affect resource behavior. */
	readonly notes?: string;
}

/** Static, import-safe provider-neutral resource contract. */
export interface ResourceDefinition<
	ResourceValue = unknown,
	Dependencies extends ResourceDependencies = ResourceDependencies,
	EnvironmentRequirement_ extends EnvironmentRequirement | undefined = EnvironmentRequirement | undefined,
> extends ValuedCatalogEntry<'resource', ResourceValue> {
	/** Human-readable resource purpose used by documentation and diagnostics. */
	readonly description: string;
	/** Keyed direct resource dependencies borrowed while creating this resource. */
	readonly dependencies: Dependencies;
	/** Optional environment requirement parsed before this resource is acquired. */
	readonly environment?: EnvironmentRequirement_;
	/** Requirements owned directly by this resource; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDefinition[];
	/** Expected failure definitions or data declared by this resource. */
	readonly failures?: CatalogDefinitionInput<CatalogEntryIdentity>;
	/** Optional health-check metadata exposed to hosts and generated documentation. */
	readonly health?: ResourceHealth;
	/** Optional external documentation metadata for this resource. */
	readonly documentation?: ResourceDocumentation;
	/** Type-only dependency marker. The symbol has no author-supplied runtime value. */
	readonly [resourceDependenciesType]: Dependencies;
	/** Type-only environment marker. The symbol has no author-supplied runtime value. */
	readonly [resourceEnvironmentType]: EnvironmentRequirement_;
}

/** Input accepted by {@link define}. */
export interface ResourceOptions<
	Dependencies extends ResourceDependencies = Readonly<Record<string, never>>,
	EnvironmentRequirement_ extends EnvironmentRequirement | undefined = undefined,
> {
	/** Stable capability identity used by dependency graphs, implementations, and documentation. */
	readonly id: string;
	/** Human-readable resource purpose used by documentation and diagnostics. */
	readonly description: string;
	/** Keyed direct dependencies required to create the resource. */
	readonly dependencies?: Dependencies;
	/** Optional environment requirement for resource acquisition. */
	readonly environment?: EnvironmentRequirement_;
	/** Requirements owned directly by this resource; reachable dependency requirements remain separate. */
	readonly requirements?: RequirementInput;
	/** Expected failure definitions or data declared by this resource. */
	readonly failures?: CatalogDefinitionInput<CatalogEntryIdentity>;
	/** Optional health metadata documented for the resource. */
	readonly health?: ResourceHealth;
	/** Optional external documentation associated with the resource. */
	readonly documentation?: ResourceDocumentation;
}

/** Concrete value carried by a resource definition. */
export type ResourceValue<Resource extends ResourceDefinition> = CatalogEntryValue<Resource>;

/** Direct dependency values supplied to a resource implementation. */
export type ResourceDependencyValues<Dependencies extends ResourceDependencies> = {
	readonly [Key in keyof Dependencies]: ResourceValue<Dependencies[Key]>;
};

/** Parsed direct environment values supplied to a resource implementation. */
export type ResourceEnvironment<Requirement extends EnvironmentRequirement | undefined> =
	Requirement extends EnvironmentRequirement<infer Fields extends EnvironmentFields>
		? InferEnvironmentFields<Fields>
		: Readonly<Record<string, never>>;

/** Exact environment requirement retained by one resource definition generic. */
export type ResourceEnvironmentRequirement<Resource extends ResourceDefinition> =
	Resource extends ResourceDefinition<infer _Value, infer _Dependencies, infer Requirement> ? Requirement : undefined;

/** Borrowed execution scope supplied while creating one concrete resource value. */
export interface ResourceCreateContext extends RequirementContext<Context>, Resources {}

/** Arguments supplied while creating one concrete resource value. */
export interface ResourceCreateArguments<Resource extends ResourceDefinition, Host> {
	/** Exact import-safe definition bound to this resource create arguments. */
	readonly definition: Resource;
	/** Already-acquired direct dependency values borrowed by this resource creation. */
	readonly dependencies: ResourceDependencyValues<Resource['dependencies']>;
	/** Parsed environment values owned by the declared environment requirement. */
	readonly environment: ResourceEnvironment<ResourceEnvironmentRequirement<Resource>>;
	/** Host-specific borrowed value supplied by the composition root. */
	readonly host: Host;
	/** Borrowed parent execution context for this resource create arguments. */
	readonly ctx: ResourceCreateContext;
}

/** Host-specific implementation for one exact resource definition. */
export interface ResourceImplementation<
	Resource extends ResourceDefinition = ResourceDefinition,
	Value = ResourceValue<Resource>,
	Host = unknown,
> {
	/** Exact import-safe definition bound to this resource implementation. */
	readonly definition: Resource;
	/** Infrastructure requirements applied once for each concrete acquisition. */
	readonly requirements: readonly RequirementDefinition[];
	/** Acquire the concrete resource value inside the resource-owned cleanup scope. */
	readonly create: (args: ResourceCreateArguments<Resource, Host>) => Value | Promise<Value>;
}

/** Input accepted by {@link implement}. */
export interface ResourceImplementationOptions<Resource extends ResourceDefinition, Value, Host> {
	/** Infrastructure requirements for this implementation, separate from per-use definition requirements. */
	readonly requirements?: RequirementInput;
	/** Acquire one concrete value for the exact resource definition. */
	readonly create: (args: ResourceCreateArguments<Resource, Host>) => Value | Promise<Value>;
}

/** Runtime arguments shared by heterogeneous resource implementations. */
export interface ResourceCreateArgumentsAny {
	/** Exact import-safe definition bound to this resource create arguments any. */
	readonly definition: ResourceDefinition;
	/** Runtime-erased direct dependency values for heterogeneous resource creation. */
	readonly dependencies: Readonly<Record<string, unknown>>;
	/** Runtime-erased parsed environment values for heterogeneous resource creation. */
	readonly environment: Readonly<Record<string, unknown>>;
	/** Runtime-erased host value supplied by the composition root. */
	readonly host: unknown;
	/** Borrowed parent execution context for this resource create arguments any. */
	readonly ctx: ResourceCreateContext;
}

/** Runtime-erased resource constructor retained in an explicit implementation set. */
export type ResourceFactoryAny = {
	bivarianceHack(args: ResourceCreateArgumentsAny): unknown | Promise<unknown>;
}['bivarianceHack'];

/** Runtime-erased resource implementation stored in heterogeneous collections. */
export interface ResourceImplementationAny {
	/** Exact import-safe definition bound to this resource implementation any. */
	readonly definition: ResourceDefinition;
	/** Requirements owned directly by this resource implementation any; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDefinition[];
	/** Runtime-erased resource factory retained by an explicit implementation set. */
	readonly create: ResourceFactoryAny;
}

/** Import-safe explicit universe of resource implementations. */
export interface ResourceImplementationSet<
	Implementations extends readonly ResourceImplementationAny[] = readonly ResourceImplementationAny[],
> {
	/**
	 * Explicit immutable implementations available to this collection.
	 *
	 * The element union remains precise, but this is intentionally not the exact
	 * input tuple. `resource.implementations()` deduplicates repeated references,
	 * so promising the input tuple length would make indexes appear to exist when
	 * the runtime set contains fewer entries.
	 */
	readonly implementations: readonly Implementations[number][];
}

/** Options used to create one independently owned resource collection. */
export interface ResourceCollectionOptions<Host> {
	/** Raw environment values used to satisfy declared resource environment requirements. */
	readonly environment?: Readonly<Record<string, unknown>>;
	/** Host-specific borrowed value exposed to resource implementations. */
	readonly host: Host;
	/** Borrowed parent execution context for this resource collection. */
	readonly ctx: Owned;
	/** Host interpreters used only for implementation-acquisition requirements. */
	readonly requirements?: RequirementRuntime;
}

/** Resource resolver narrowed to one current execution context and allowed definition union. */
export interface ResourceResolver<Allowed extends ResourceDefinition = ResourceDefinition> {
	/** Return whether the supplied exact definition has an implementation. */
	has<Resource extends Allowed>(definition: Resource): boolean;
	/** Apply per-use requirements, then lazily acquire or borrow the value. */
	get<Resource extends Allowed>(definition: Resource): Promise<ResourceValue<Resource>>;
}

/** Live resource owner. Every public borrow supplies the current execution context. */
export interface ResourceCollection extends AsyncDisposable {
	/** Return whether an exact resource definition has a configured implementation. */
	has<Resource extends ResourceDefinition>(definition: Resource): boolean;
	/** Apply per-use requirements, then return the lazily acquired value for the exact definition. */
	get<Resource extends ResourceDefinition>(ctx: Context, definition: Resource): Promise<ResourceValue<Resource>>;
}

/** Resource graph validation issue. */
export type ResourceValidationIssue =
	| Readonly<{ readonly code: 'duplicate-definition-id'; readonly message: string; readonly id: string; readonly first: ResourceDefinition; readonly second: ResourceDefinition }>
	| Readonly<{ readonly code: 'duplicate-implementation'; readonly message: string; readonly definition: ResourceDefinition }>
	| Readonly<{ readonly code: 'missing-implementation'; readonly message: string; readonly definition: ResourceDefinition; readonly requiredBy: readonly ResourceDefinition[] }>
	| Readonly<{ readonly code: 'dependency-cycle'; readonly message: string; readonly path: readonly ResourceDefinition[] }>;

/** Deterministic validation result for a resource graph. */
export type ResourceValidationResult =
	| Readonly<{ readonly valid: true; readonly definitions: readonly ResourceDefinition[] }>
	| Readonly<{ readonly valid: false; readonly issues: readonly ResourceValidationIssue[] }>;

/** JSON-safe explanation of one environment field required by a resource. */
export interface ResourceEnvironmentDocumentType {
	/** Environment field key expected by the owning resource requirement. */
	readonly key: string;
	/** Human-readable reason the resource needs this environment field. */
	readonly reason: string;
	/** Stable environment-requirement ID that owns this field. */
	readonly requirementId: string;
}

/** JSON-safe projection of one resource definition. */
export interface ResourceDocument {
	/** Stable capability identity used by dependency graphs, implementations, and documentation. */
	readonly id: string;
	/** Human-readable resource purpose used by documentation and diagnostics. */
	readonly description: string;
	/** Stable IDs of resources required directly by this definition. */
	readonly dependencies: readonly string[];
	/** Stable IDs reachable through the complete resource dependency graph. */
	readonly transitiveDependencies: readonly string[];
	/** Environment fields required directly by this resource and their owning requirement. */
	readonly environment: readonly ResourceEnvironmentDocumentType[];
	/** Requirements owned directly by this resource; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDocument[];
	/** Requirements reachable through this resource and its dependency graph with provenance. */
	readonly reachableRequirements: readonly RequirementDocument[];
	/** Expected failure definitions or data declared by this resource. */
	readonly failures: readonly string[];
	/** Whether the inspected implementation set can acquire this resource definition. */
	readonly implementationAvailable?: boolean;
	/** Optional health metadata copied into deterministic documentation. */
	readonly health?: ResourceHealth;
	/** Optional external documentation metadata copied into deterministic documentation. */
	readonly documentation?: ResourceDocumentation;
}
