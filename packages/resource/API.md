# @okikio/resource contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                   | Source                   | Reference       |
| ------------------------ | ------------------------ | --------------- |
| `@okikio/resource`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/resource/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/resource`. [Source](./mod.ts).

Create expensive dependencies once, borrow them through declared access and close them at their owner lifetime.
Hand-built dependency bags make missing implementations, cycles and cleanup ordering hard to detect.

Add dependency declarations when one resource needs another, validate implementation coverage before startup, and scope
access to the exact resources an activity may use. Collections own created values; callers borrow them and must not
close them individually. Acquisition requirements apply at creation, while actor-specific use requirements are checked
on public borrowing. Remote work must reconstruct its local resources rather than serialize live clients.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                | Contract owner or source                       |
| ------------------------------- | ---------------------------------------------- |
| `recordCore`                    | [record contracts](../record/API.md)           |
| `catalogCore`                   | [catalog contracts](../catalog/API.md)         |
| `Catalog`                       | [catalog contracts](../catalog/API.md)         |
| `CatalogEntryIdentity`          | [catalog contracts](../catalog/API.md)         |
| `CatalogSelection`              | [catalog contracts](../catalog/API.md)         |
| `CatalogDefinitionInput`        | [catalog contracts](../catalog/API.md)         |
| `context`                       | [context contracts](../context/API.md)         |
| `requirement`                   | [requirement contracts](../requirement/API.md) |
| `EnvironmentRequirement`        | [env contracts](../env/API.md)                 |
| `ResourceCollection`            | [Source](types.ts)                             |
| `ResourceCollectionOptions`     | [Source](types.ts)                             |
| `ResourceCreateArgumentsAny`    | [Source](types.ts)                             |
| `ResourceDefinition`            | [Source](types.ts)                             |
| `ResourceDependencies`          | [Source](types.ts)                             |
| `ResourceDocument`              | [Source](types.ts)                             |
| `ResourceImplementation`        | [Source](types.ts)                             |
| `ResourceImplementationAny`     | [Source](types.ts)                             |
| `ResourceImplementationOptions` | [Source](types.ts)                             |
| `ResourceImplementationSet`     | [Source](types.ts)                             |
| `ResourceOptions`               | [Source](types.ts)                             |
| `ResourceValidationIssue`       | [Source](types.ts)                             |
| `ResourceValidationResult`      | [Source](types.ts)                             |
| `ResourceValue`                 | [Source](types.ts)                             |

### root: catalog

[Declaration source](mod.ts#L186)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, ResourceDefinition>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create a named immutable resource catalog.
```

### root: compose

[Declaration source](mod.ts#L205)

```text
function compose<Entry extends ResourceDefinition>(...inputs: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[]
  Compose resource definitions, catalogs, selections, and nested arrays.
```

### root: create

[Declaration source](mod.ts#L377)

```text
function create<Host>(implementationSet: ResourceImplementationSet, options: ResourceCollectionOptions<Host>): ResourceCollection
  Create one independently owned, lazy resource collection.
```

### root: define

[Declaration source](mod.ts#L133)

```text
function define<Dependencies extends ResourceDependencies = Readonly<Record<string, never>>, ResourceEnvironment extends EnvironmentRequirement | undefined = undefined>(input: ResourceOptions<Dependencies, ResourceEnvironment>): ResourceDefinition<unknown, Dependencies, ResourceEnvironment>
  Define a provider-neutral resource when only static metadata is needed.

  Use the curried overload, `resource.define<ResourceValue>()({...})`, when dependent
  implementations need the concrete resource value type.
```

[Declaration source](mod.ts#L140)

```text
function define<ResourceValue>(): (input: ResourceOptions<Dependencies, ResourceEnvironment>) => ResourceDefinition<ResourceValue, Dependencies, ResourceEnvironment>
  Define a resource with an explicit concrete value contract.

  Create the direct or curried resource-definition authoring function.
```

### root: document

[Declaration source](mod.ts#L301)

```text
function document(input: CatalogDefinitionInput<ResourceDefinition>, implementationSet?: ResourceImplementationSet): readonly ResourceDocument[]
  Create deterministic, JSON-safe documentation for a resource graph.
```

### root: implement

[Declaration source](mod.ts#L212)

```text
function implement<Resource extends ResourceDefinition, Value extends ResourceValue<Resource>, Host = unknown>(definition: Resource, input: ResourceImplementationOptions<Resource, Value, Host>): ResourceImplementation<Resource, Value, Host>
  Bind one host-specific constructor to one exact resource definition.
```

### root: implementations

[Declaration source](mod.ts#L231)

```text
function implementations<Implementations extends readonly ResourceImplementationAny[]>(...input: Implementations): ResourceImplementationSet<Implementations>
  Assemble an explicit, import-safe universe of resource implementations.

  Repeating the same implementation object is harmless. A different
  implementation for the same exact definition is rejected.
```

### root: manifest

[Declaration source](mod.ts#L337)

```text
function manifest(input: CatalogDefinitionInput<ResourceDefinition>, implementationSet?: ResourceImplementationSet): readonly ResourceDocument[]
  Alias for `resource.document()` when generating deployment or operator manifests.
```

### root: reachable

[Declaration source](mod.ts#L340)

```text
function reachable(input: CatalogDefinitionInput<ResourceDefinition>): readonly import("@okikio/requirement").RequirementDefinition[]
  Collect every statically reachable requirement from a resource graph.
```

### root: scope

[Declaration source](mod.ts#L355)

```text
function scope<Allowed extends ResourceDefinition>(collection: ResourceCollection, ctx: import("@okikio/context").Context, allowed?: CatalogDefinitionInput<Allowed>): import("./types.ts").ResourceResolver<Allowed>
  Bind one resource collection to the current execution context.

  Every `get()` applies the exact resource definition's direct requirements
  before borrowing the collection-owned value. This keeps actor authority at
  use time even when the underlying value is cached and shared.
```

### root: select

[Declaration source](mod.ts#L194)

```text
function select<Entries extends Readonly<Record<PropertyKey, ResourceDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: Catalog<Entries[keyof Entries], Entries>, keys: Keys): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select an immutable key-preserving resource subset.
```

### root: validate

[Declaration source](mod.ts#L262)

```text
function validate(input: CatalogDefinitionInput<ResourceDefinition> | ResourceImplementationSet): ResourceValidationResult
  Validate a definition graph and, when supplied, implementation coverage.
```

### root: CollectionDisposedError

[Declaration source](mod.ts#L120)

```text
class CollectionDisposedError extends Error
  Error raised when a disposing or disposed collection is used.

  constructor()
```

### root: DefinitionConflictError

[Declaration source](mod.ts#L56)

```text
class DefinitionConflictError extends Error
  Error raised when two distinct definitions reuse one stable resource ID.

  constructor(id: string, first: ResourceDefinition, second: ResourceDefinition)
    Create this DefinitionConflictError from the explicit contract values supplied by its caller.
  readonly id: string
    Stable identity used to correlate this contract or occurrence.
  readonly first: ResourceDefinition
    First operand or observation retained in this ordered pair.
  readonly second: ResourceDefinition
    Second operand or observation retained in this ordered pair.
```

### root: DependencyCycleError

[Declaration source](mod.ts#L107)

```text
class DependencyCycleError extends Error
  Error raised for a cycle in the static resource dependency graph.

  constructor(path: readonly ResourceDefinition[])
    Create this DependencyCycleError from the explicit contract values supplied by its caller.
  readonly path: readonly ResourceDefinition[]
    Source, route or expression path used to locate this value.
```

### root: ImplementationConflictError

[Declaration source](mod.ts#L75)

```text
class ImplementationConflictError extends Error
  Error raised when a collection receives two implementations for one definition.

  constructor(definition: ResourceDefinition)
    Create this ImplementationConflictError from the explicit contract values supplied by its caller.
  readonly definition: ResourceDefinition
    Exact declared contract object; an independently authored same-name object is not the same declaration.
```

### root: MissingImplementationError

[Declaration source](mod.ts#L88)

```text
class MissingImplementationError extends Error
  Error raised when a reachable resource definition has no implementation.

  constructor(definition: ResourceDefinition, requiredBy: readonly ResourceDefinition[])
    Create this MissingImplementationError from the explicit contract values supplied by its caller.
  readonly definition: ResourceDefinition
    Exact declared contract object; an independently authored same-name object is not the same declaration.
  readonly requiredBy: readonly ResourceDefinition[]
    Definitions that require the missing resource, used to explain the dependency path.
```

### root: ResourceCollection

[Declaration source](mod.ts#L809)

```text
reference ResourceCollection: ./packages/resource/types.ts:205:1
```

### root: ResourceCollectionOptions

[Declaration source](mod.ts#L810)

```text
reference ResourceCollectionOptions: ./packages/resource/types.ts:185:1
```

### root: ResourceCreateArguments

[Declaration source](mod.ts#L811)

```text
reference ResourceCreateArguments: ./packages/resource/types.ts:105:1
```

### root: ResourceCreateArgumentsAny

[Declaration source](mod.ts#L812)

```text
reference ResourceCreateArgumentsAny: ./packages/resource/types.ts:141:1
```

### root: ResourceCreateContext

[Declaration source](mod.ts#L813)

```text
reference ResourceCreateContext: ./packages/resource/types.ts:102:1
```

### root: ResourceDefinition

[Declaration source](mod.ts#L814)

```text
reference ResourceDefinition: ./packages/resource/types.ts:36:1
```

### root: ResourceDependencies

[Declaration source](mod.ts#L815)

```text
reference ResourceDependencies: ./packages/resource/types.ts:17:1
```

### root: ResourceDependencyValues

[Declaration source](mod.ts#L816)

```text
reference ResourceDependencyValues: ./packages/resource/types.ts:88:1
```

### root: ResourceDocument

[Declaration source](mod.ts#L817)

```text
reference ResourceDocument: ./packages/resource/types.ts:254:1
```

### root: ResourceDocumentation

[Declaration source](mod.ts#L818)

```text
reference ResourceDocumentation: ./packages/resource/types.ts:28:1
```

### root: ResourceEnvironment

[Declaration source](mod.ts#L819)

```text
reference ResourceEnvironment: ./packages/resource/types.ts:93:1
```

### root: ResourceHealth

[Declaration source](mod.ts#L820)

```text
reference ResourceHealth: ./packages/resource/types.ts:20:1
```

### root: ResourceImplementation

[Declaration source](mod.ts#L821)

```text
reference ResourceImplementation: ./packages/resource/types.ts:119:1
```

### root: ResourceImplementationAny

[Declaration source](mod.ts#L822)

```text
reference ResourceImplementationAny: ./packages/resource/types.ts:160:1
```

### root: ResourceImplementationOptions

[Declaration source](mod.ts#L823)

```text
reference ResourceImplementationOptions: ./packages/resource/types.ts:133:1
```

### root: ResourceImplementationSet

[Declaration source](mod.ts#L824)

```text
reference ResourceImplementationSet: ./packages/resource/types.ts:170:1
```

### root: ResourceOptions

[Declaration source](mod.ts#L825)

```text
reference ResourceOptions: ./packages/resource/types.ts:62:1
```

### root: ResourceResolver

[Declaration source](mod.ts#L826)

```text
reference ResourceResolver: ./packages/resource/types.ts:197:1
```

### root: ResourceValidationIssue

[Declaration source](mod.ts#L827)

```text
reference ResourceValidationIssue: ./packages/resource/types.ts:213:1
```

### root: ResourceValidationResult

[Declaration source](mod.ts#L828)

```text
reference ResourceValidationResult: ./packages/resource/types.ts:239:1
```

### root: ResourceValue

[Declaration source](mod.ts#L829)

```text
reference ResourceValue: ./packages/resource/types.ts:85:1
```

## types

Import `@okikio/resource/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                   | Contract owner or source                       |
| ---------------------------------- | ---------------------------------------------- |
| `CatalogEntryIdentity`             | [catalog contracts](../catalog/API.md)         |
| `CatalogEntryValue`                | [catalog contracts](../catalog/API.md)         |
| `CatalogDefinitionInput`           | [catalog contracts](../catalog/API.md)         |
| `ValuedCatalogEntry`               | [catalog contracts](../catalog/API.md)         |
| `Context`                          | [context contracts](../context/API.md)         |
| `Owned`                            | [context contracts](../context/API.md)         |
| `Resources`                        | [context contracts](../context/API.md)         |
| `RequirementContext`               | [requirement contracts](../requirement/API.md) |
| `RequirementRuntime`               | [requirement contracts](../requirement/API.md) |
| `RequirementDefinition`            | [requirement contracts](../requirement/API.md) |
| `RequirementDocument`              | [requirement contracts](../requirement/API.md) |
| `RequirementInput`                 | [requirement contracts](../requirement/API.md) |
| `EnvironmentFields`                | [env contracts](../env/API.md)                 |
| `EnvironmentRequirement`           | [env contracts](../env/API.md)                 |
| `InferEnvironmentFields`           | [env contracts](../env/API.md)                 |
| [Declaration source](types.ts#L12) |                                                |

```text
private const resourceDependenciesType: unique symbol
  Private phantom key that preserves a resource definition's dependency type without runtime data.
```

[Declaration source](types.ts#L14)

```text
private const resourceEnvironmentType: unique symbol
  Private phantom key that preserves a resource definition's environment type without runtime data.
```

### types: ResourceCollection

[Declaration source](types.ts#L205)

```text
interface ResourceCollection extends AsyncDisposable
  Live resource owner. Every public borrow supplies the current execution context.

  has(definition: Resource): boolean
    Return whether an exact resource definition has a configured implementation.
  get(ctx: Context, definition: Resource): Promise<ResourceValue<Resource>>
    Apply per-use requirements, then return the lazily acquired value for the exact definition.
```

### types: ResourceCollectionOptions

[Declaration source](types.ts#L185)

```text
interface ResourceCollectionOptions<Host>
  Options used to create one independently owned resource collection.

  readonly environment?: Readonly<Record<string, unknown>>
    Raw environment values used to satisfy declared resource environment requirements.
  readonly host: Host
    Host-specific borrowed value exposed to resource implementations.
  readonly ctx: Owned
    Borrowed parent execution context for this resource collection.
  readonly requirements?: RequirementRuntime
    Host interpreters used only for implementation-acquisition requirements.
```

### types: ResourceCreateArguments

[Declaration source](types.ts#L105)

```text
interface ResourceCreateArguments<Resource extends ResourceDefinition, Host>
  Arguments supplied while creating one concrete resource value.

  readonly definition: Resource
    Exact import-safe definition bound to this resource create arguments.
  readonly dependencies: ResourceDependencyValues<Resource["dependencies"]>
    Already-acquired direct dependency values borrowed by this resource creation.
  readonly environment: ResourceEnvironment<ResourceEnvironmentRequirement<Resource>>
    Parsed environment values owned by the declared environment requirement.
  readonly host: Host
    Host-specific borrowed value supplied by the composition root.
  readonly ctx: ResourceCreateContext
    Borrowed parent execution context for this resource create arguments.
```

### types: ResourceCreateArgumentsAny

[Declaration source](types.ts#L141)

```text
interface ResourceCreateArgumentsAny
  Runtime arguments shared by heterogeneous resource implementations.

  readonly definition: ResourceDefinition
    Exact import-safe definition bound to this resource create arguments any.
  readonly dependencies: Readonly<Record<string, unknown>>
    Runtime-erased direct dependency values for heterogeneous resource creation.
  readonly environment: Readonly<Record<string, unknown>>
    Runtime-erased parsed environment values for heterogeneous resource creation.
  readonly host: unknown
    Runtime-erased host value supplied by the composition root.
  readonly ctx: ResourceCreateContext
    Borrowed parent execution context for this resource create arguments any.
```

### types: ResourceCreateContext

[Declaration source](types.ts#L102)

```text
interface ResourceCreateContext extends RequirementContext<Context>, Resources
  Borrowed execution scope supplied while creating one concrete resource value.
```

### types: ResourceDefinition

[Declaration source](types.ts#L36)

```text
interface ResourceDefinition<ResourceValue = unknown, Dependencies extends ResourceDependencies = ResourceDependencies, EnvironmentRequirement_ extends EnvironmentRequirement | undefined = EnvironmentRequirement | undefined> extends ValuedCatalogEntry<"resource", ResourceValue>
  Static, import-safe provider-neutral resource contract.

  readonly description: string
    Human-readable resource purpose used by documentation and diagnostics.
  readonly dependencies: Dependencies
    Keyed direct resource dependencies borrowed while creating this resource.
  readonly environment?: EnvironmentRequirement_
    Optional environment requirement parsed before this resource is acquired.
  readonly requirements: readonly RequirementDefinition[]
    Requirements owned directly by this resource; reachable dependency requirements remain separate.
  readonly failures?: CatalogDefinitionInput<CatalogEntryIdentity>
    Expected failure definitions or data declared by this resource.
  readonly health?: ResourceHealth
    Optional health-check metadata exposed to hosts and generated documentation.
  readonly documentation?: ResourceDocumentation
    Optional external documentation metadata for this resource.
  readonly [resourceDependenciesType]: Dependencies
    Type-only dependency marker. The symbol has no author-supplied runtime value.
  readonly [resourceEnvironmentType]: EnvironmentRequirement_
    Type-only environment marker. The symbol has no author-supplied runtime value.
```

### types: ResourceDocument

[Declaration source](types.ts#L254)

```text
interface ResourceDocument
  JSON-safe projection of one resource definition.

  readonly id: string
    Stable capability identity used by dependency graphs, implementations, and documentation.
  readonly description: string
    Human-readable resource purpose used by documentation and diagnostics.
  readonly dependencies: readonly string[]
    Stable IDs of resources required directly by this definition.
  readonly transitiveDependencies: readonly string[]
    Stable IDs reachable through the complete resource dependency graph.
  readonly environment: readonly ResourceEnvironmentDocumentType[]
    Environment fields required directly by this resource and their owning requirement.
  readonly requirements: readonly RequirementDocument[]
    Requirements owned directly by this resource; reachable dependency requirements remain separate.
  readonly reachableRequirements: readonly RequirementDocument[]
    Requirements reachable through this resource and its dependency graph with provenance.
  readonly failures: readonly string[]
    Expected failure definitions or data declared by this resource.
  readonly implementationAvailable?: boolean
    Whether the inspected implementation set can acquire this resource definition.
  readonly health?: ResourceHealth
    Optional health metadata copied into deterministic documentation.
  readonly documentation?: ResourceDocumentation
    Optional external documentation metadata copied into deterministic documentation.
```

### types: ResourceDocumentation

[Declaration source](types.ts#L28)

```text
interface ResourceDocumentation
  Optional external documentation for a resource definition.

  readonly url?: string
    Canonical external documentation URL for this resource contract.
  readonly notes?: string
    Additional integration notes that do not affect resource behavior.
```

### types: ResourceEnvironmentDocumentType

[Declaration source](types.ts#L244)

```text
interface ResourceEnvironmentDocumentType
  JSON-safe explanation of one environment field required by a resource.

  readonly key: string
    Environment field key expected by the owning resource requirement.
  readonly reason: string
    Human-readable reason the resource needs this environment field.
  readonly requirementId: string
    Stable environment-requirement ID that owns this field.
```

### types: ResourceHealth

[Declaration source](types.ts#L20)

```text
interface ResourceHealth
  Optional health metadata included in generated resource documentation.

  readonly description?: string
    Human-readable resource health purpose used by documentation and diagnostics.
  readonly timeoutMilliseconds?: number
    Maximum health-check duration suggested to hosts that interpret this metadata.
```

### types: ResourceImplementation

[Declaration source](types.ts#L119)

```text
interface ResourceImplementation<Resource extends ResourceDefinition = ResourceDefinition, Value = ResourceValue<Resource>, Host = unknown>
  Host-specific implementation for one exact resource definition.

  readonly definition: Resource
    Exact import-safe definition bound to this resource implementation.
  readonly requirements: readonly RequirementDefinition[]
    Infrastructure requirements applied once for each concrete acquisition.
  readonly create: (args: ResourceCreateArguments<Resource, Host>) => Value | Promise<Value>
    Acquire the concrete resource value inside the resource-owned cleanup scope.
```

### types: ResourceImplementationAny

[Declaration source](types.ts#L160)

```text
interface ResourceImplementationAny
  Runtime-erased resource implementation stored in heterogeneous collections.

  readonly definition: ResourceDefinition
    Exact import-safe definition bound to this resource implementation any.
  readonly requirements: readonly RequirementDefinition[]
    Requirements owned directly by this resource implementation any; reachable dependency requirements remain separate.
  readonly create: ResourceFactoryAny
    Runtime-erased resource factory retained by an explicit implementation set.
```

### types: ResourceImplementationOptions

[Declaration source](types.ts#L133)

```text
interface ResourceImplementationOptions<Resource extends ResourceDefinition, Value, Host>
  Input accepted by {@link implement}.

  readonly requirements?: RequirementInput
    Infrastructure requirements for this implementation, separate from per-use definition requirements.
  readonly create: (args: ResourceCreateArguments<Resource, Host>) => Value | Promise<Value>
    Acquire one concrete value for the exact resource definition.
```

### types: ResourceImplementationSet

[Declaration source](types.ts#L170)

```text
interface ResourceImplementationSet<Implementations extends readonly ResourceImplementationAny[] = readonly ResourceImplementationAny[]>
  Import-safe explicit universe of resource implementations.

  readonly implementations: readonly Implementations[number][]
    Explicit immutable implementations available to this collection.

    The element union remains precise, but this is intentionally not the exact
    input tuple. `resource.implementations()` deduplicates repeated references,
    so promising the input tuple length would make indexes appear to exist when
    the runtime set contains fewer entries.
```

### types: ResourceOptions

[Declaration source](types.ts#L62)

```text
interface ResourceOptions<Dependencies extends ResourceDependencies = Readonly<Record<string, never>>, EnvironmentRequirement_ extends EnvironmentRequirement | undefined = undefined>
  Input accepted by {@link define}.

  readonly id: string
    Stable capability identity used by dependency graphs, implementations, and documentation.
  readonly description: string
    Human-readable resource purpose used by documentation and diagnostics.
  readonly dependencies?: Dependencies
    Keyed direct dependencies required to create the resource.
  readonly environment?: EnvironmentRequirement_
    Optional environment requirement for resource acquisition.
  readonly requirements?: RequirementInput
    Requirements owned directly by this resource; reachable dependency requirements remain separate.
  readonly failures?: CatalogDefinitionInput<CatalogEntryIdentity>
    Expected failure definitions or data declared by this resource.
  readonly health?: ResourceHealth
    Optional health metadata documented for the resource.
  readonly documentation?: ResourceDocumentation
    Optional external documentation associated with the resource.
```

### types: ResourceResolver

[Declaration source](types.ts#L197)

```text
interface ResourceResolver<Allowed extends ResourceDefinition = ResourceDefinition>
  Resource resolver narrowed to one current execution context and allowed definition union.

  has(definition: Resource): boolean
    Return whether the supplied exact definition has an implementation.
  get(definition: Resource): Promise<ResourceValue<Resource>>
    Apply per-use requirements, then lazily acquire or borrow the value.
```

### types: ResourceDependencies

[Declaration source](types.ts#L17)

```text
type ResourceDependencies = Readonly<Record<string, ResourceDefinition>>
  A keyed record of direct resource dependencies.
```

### types: ResourceDependencyValues

[Declaration source](types.ts#L88)

```text
type ResourceDependencyValues<Dependencies extends ResourceDependencies> = readonly [Key in keyof Dependencies]: ResourceValue<Dependencies[Key]>
  Direct dependency values supplied to a resource implementation.
```

### types: ResourceEnvironment

[Declaration source](types.ts#L93)

```text
type ResourceEnvironment<Requirement extends EnvironmentRequirement | undefined> = Requirement extends EnvironmentRequirement<infer Fields extends EnvironmentFields> ? InferEnvironmentFields<Fields> : Readonly<Record<string, never>>
  Parsed direct environment values supplied to a resource implementation.
```

### types: ResourceEnvironmentRequirement

[Declaration source](types.ts#L98)

```text
type ResourceEnvironmentRequirement<Resource extends ResourceDefinition> = Resource extends ResourceDefinition<infer _Value, infer _Dependencies, infer Requirement> ? Requirement : undefined
  Exact environment requirement retained by one resource definition generic.
```

### types: ResourceFactoryAny

[Declaration source](types.ts#L155)

```text
type ResourceFactoryAny = { bivarianceHack(args: ResourceCreateArgumentsAny): unknown | Promise<unknown>; }["bivarianceHack"]
  Runtime-erased resource constructor retained in an explicit implementation set.
```

### types: ResourceValidationIssue

[Declaration source](types.ts#L213)

```text
type ResourceValidationIssue = Readonly<{ readonly code: "duplicate-definition-id"; readonly message: string; readonly id: string; readonly first: ResourceDefinition; readonly second: ResourceDefinition; }> | Readonly<{ readonly code: "duplicate-implementation"; readonly message: string; readonly definition: ResourceDefinition; }> | Readonly<{ readonly code: "missing-implementation"; readonly message: string; readonly definition: ResourceDefinition; readonly requiredBy: readonly ResourceDefinition[]; }> | Readonly<{ readonly code: "dependency-cycle"; readonly message: string; readonly path: readonly ResourceDefinition[]; }>
  Resource graph validation issue.
```

### types: ResourceValidationResult

[Declaration source](types.ts#L239)

```text
type ResourceValidationResult = Readonly<{ readonly valid: true; readonly definitions: readonly ResourceDefinition[]; }> | Readonly<{ readonly valid: false; readonly issues: readonly ResourceValidationIssue[]; }>
  Deterministic validation result for a resource graph.
```

### types: ResourceValue

[Declaration source](types.ts#L85)

```text
type ResourceValue<Resource extends ResourceDefinition> = CatalogEntryValue<Resource>
  Concrete value carried by a resource definition.
```
