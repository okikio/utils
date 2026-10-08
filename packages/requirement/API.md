# @okikio/requirement contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                           | Source                             | Reference                 |
| -------------------------------- | ---------------------------------- | ------------------------- |
| `@okikio/requirement`            | [./mod.ts](./mod.ts)               | [root](#root)             |
| `@okikio/requirement/definition` | [./definition.ts](./definition.ts) | [definition](#definition) |
| `@okikio/requirement/types`      | [./types.ts](./types.ts)           | [types](#types)           |

## root

Import `@okikio/requirement`. [Source](./mod.ts).

Keep declarations of required capabilities separate from the host that interprets them. Hard-coding a billing or
permission SDK into each resource makes definitions impossible to inspect without starting that SDK.

Attach requirements to definitions, inspect the reachable graph for deployment planning, and apply only the requirements
active on the current execution path. Each semantic family owns its interpreter and failures. The example interpreter
records admission in memory; replace it with real policy before using it for access control. Missing interpreters reject
by default. Scope views borrow their owner context.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding          | Contract owner or source               |
| ------------------------- | -------------------------------------- |
| `compose`                 | [Source](definition.ts)                |
| `context`                 | [context contracts](../context/API.md) |
| `RequirementContext`      | [Source](types.ts)                     |
| `RequirementDefinition`   | [Source](types.ts)                     |
| `RequirementInput`        | [Source](types.ts)                     |
| `RequirementRuntime`      | [Source](types.ts)                     |
| `RequirementScopeOptions` | [Source](types.ts)                     |

### root: apply

[Declaration source](mod.ts#L94)

```text
async function apply(ctx: import("@okikio/context").Context, input: RequirementInput): Promise<void>
  Apply requirements that are active at the current execution point.

  Families are grouped once, then each configured interpreter receives its
  authored order. An unknown family follows the scope's explicit policy.
```

### root: bind

[Declaration source](mod.ts#L76)

```text
function bind<Base extends import("@okikio/context").Context>(ctx: Base, input: RequirementInput): Base
  Attach runtime views supplied by configured requirement-family interpreters.

  Reachable requirements are declaration evidence only. `bind()` never applies
  them. It lets families such as permissions expose runtime operations for
  later dynamic checks while `apply()` remains the only activation operation.
```

### root: scope

[Declaration source](mod.ts#L58)

```text
function scope<Base extends import("@okikio/context").Context>(ctx: Base, options: RequirementScopeOptions): RequirementContext<Base>
  Create a borrowed requirement-aware view of an existing execution context.

  Unknown active families reject by default. A test or intentionally permissive
  host must opt in to `unknown: 'ignore'`; omission never silently disables a
  production requirement family.
```

### root: UnsupportedRequirementError

[Declaration source](mod.ts#L36)

```text
class UnsupportedRequirementError extends Error
  Error raised when active work reaches a requirement family without an interpreter.

  constructor(family: string, requirements: readonly RequirementDefinition[])
    Create one fail-closed error for an active family with no configured policy.
  readonly family: string
    Stable requirement family that the current host cannot interpret.
  readonly requirements: readonly RequirementDefinition[]
    Active requirements that require an explicit interpreter or ignore policy.
```

### root: RequirementCatalog

[Declaration source](mod.ts#L148)

```text
reference RequirementCatalog: ./packages/requirement/types.ts:31:1
```

### root: RequirementCatalogOptions

[Declaration source](mod.ts#L149)

```text
reference RequirementCatalogOptions: ./packages/requirement/types.ts:41:1
```

### root: RequirementContext

[Declaration source](mod.ts#L150)

```text
reference RequirementContext: ./packages/requirement/types.ts:120:1
```

### root: RequirementDefinition

[Declaration source](mod.ts#L151)

```text
reference RequirementDefinition: ./packages/requirement/types.ts:4:1
```

### root: RequirementDocument

[Declaration source](mod.ts#L152)

```text
reference RequirementDocument: ./packages/requirement/types.ts:70:1
```

### root: RequirementInput

[Declaration source](mod.ts#L153)

```text
reference RequirementInput: ./packages/requirement/types.ts:49:1
```

### root: RequirementInterpreter

[Declaration source](mod.ts#L154)

```text
reference RequirementInterpreter: ./packages/requirement/types.ts:101:1
```

### root: RequirementOptions

[Declaration source](mod.ts#L155)

```text
reference RequirementOptions: ./packages/requirement/types.ts:54:1
```

### root: RequirementPathType

[Declaration source](mod.ts#L156)

```text
reference RequirementPathType: ./packages/requirement/types.ts:91:1
```

### root: RequirementRuntime

[Declaration source](mod.ts#L157)

```text
reference RequirementRuntime: ./packages/requirement/types.ts:112:1
```

### root: RequirementScopeOptions

[Declaration source](mod.ts#L158)

```text
reference RequirementScopeOptions: ./packages/requirement/types.ts:125:1
```

### root: UnknownRequirementPolicyType

[Declaration source](mod.ts#L159)

```text
reference UnknownRequirementPolicyType: ./packages/requirement/types.ts:109:1
```

### root: catalog

[Declaration source](mod.ts#L25)

```text
reference catalog: ./packages/requirement/definition.ts:56:1
```

### root: compose

[Declaration source](mod.ts#L25)

```text
reference compose: ./packages/requirement/definition.ts:92:1
```

### root: define

[Declaration source](mod.ts#L25)

```text
reference define: ./packages/requirement/definition.ts:16:1
```

### root: document

[Declaration source](mod.ts#L25)

```text
reference document: ./packages/requirement/definition.ts:119:1
```

### root: family

[Declaration source](mod.ts#L25)

```text
reference family: ./packages/requirement/definition.ts:99:1
```

### root: is

[Declaration source](mod.ts#L25)

```text
reference is: ./packages/requirement/definition.ts:110:1
```

## definition

Import `@okikio/requirement/definition`. [Source](./definition.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source               |
| --------------------------- | -------------------------------------- |
| `catalogCore`               | [catalog contracts](../catalog/API.md) |
| `Catalog`                   | [catalog contracts](../catalog/API.md) |
| `CatalogEntryIdentity`      | [catalog contracts](../catalog/API.md) |
| `CatalogLike`               | [catalog contracts](../catalog/API.md) |
| `CatalogSelection`          | [catalog contracts](../catalog/API.md) |
| `RequirementCatalog`        | [Source](types.ts)                     |
| `RequirementCatalogOptions` | [Source](types.ts)                     |
| `RequirementDefinition`     | [Source](types.ts)                     |
| `RequirementDocument`       | [Source](types.ts)                     |
| `RequirementInput`          | [Source](types.ts)                     |
| `RequirementOptions`        | [Source](types.ts)                     |

### definition: catalog

[Declaration source](definition.ts#L56)

```text
function catalog<Family extends string, Action extends string, Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>>(source: Catalog<Entries[keyof Entries], Entries>, options: RequirementCatalogOptions<Family, Action>): RequirementCatalog<Family, Action, Entries>
  Project one canonical definition catalog into key-preserving requirements.

  The source definition objects remain authoritative. This helper only derives
  the generic requirement declarations interpreted by the owning family.
```

[Declaration source](definition.ts#L65)

```text
function catalog<Family extends string, Action extends string, SourceEntry extends CatalogEntryIdentity, Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>>(source: CatalogSelection<SourceEntry, Entries>, options: RequirementCatalogOptions<Family, Action>): RequirementCatalog<Family, Action, Entries>
  Project a key-preserving catalog selection into requirements.

  Build the requirement projection after the source catalog shape is statically captured.
```

### definition: compose

[Declaration source](definition.ts#L92)

```text
function compose<Entry extends RequirementDefinition>(...input: readonly RequirementInput<Entry>[]): readonly Entry[]
  Compose direct requirements, catalogs, selections, and nested arrays.
```

### definition: define

[Declaration source](definition.ts#L16)

```text
function define<Family extends string, Action extends string, Entry extends CatalogEntryIdentity>(input: RequirementOptions<Family, Action, Entry>): RequirementDefinition<Family, Action, Entry>
  Define one immutable requirement without implementing its domain semantics.
```

### definition: document

[Declaration source](definition.ts#L119)

```text
function document(input: RequirementInput): readonly RequirementDocument[]
  Create deterministic JSON-safe documentation for requirement definitions.
```

### definition: family

[Declaration source](definition.ts#L99)

```text
function family<Family extends string, Entry extends RequirementDefinition>(input: RequirementInput<Entry>, familyName: Family): readonly Extract<Entry, RequirementDefinition<Family, string, CatalogEntryIdentity>>[]
  Return requirements owned by one semantic family.
```

### definition: is

[Declaration source](definition.ts#L110)

```text
function is(value: unknown): value is RequirementDefinition
  Return whether a value has the generic requirement protocol.
```

## types

Import `@okikio/requirement/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source               |
| ------------------------ | -------------------------------------- |
| `Catalog`                | [catalog contracts](../catalog/API.md) |
| `CatalogEntryIdentity`   | [catalog contracts](../catalog/API.md) |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md) |
| `BaseContext`            | [context contracts](../context/API.md) |

### types: RequirementCatalogOptions

[Declaration source](types.ts#L41)

```text
interface RequirementCatalogOptions<Family extends string, Action extends string>
  Options used to project one definition catalog into requirement declarations.

  readonly family: Family
    Stable requirement family that owns interpretation.
  readonly action: Action
    Family-specific requirement action.
```

### types: RequirementDefinition

[Declaration source](types.ts#L4)

```text
interface RequirementDefinition<Family extends string = string, Action extends string = string, Entry extends CatalogEntryIdentity = CatalogEntryIdentity> extends CatalogEntryIdentity
  One immutable contract contribution attached to another definition.

  readonly kind: "requirement"
    Stable discriminant for this requirement value.
  readonly family: Family
    Domain that owns the semantics, such as `permission` or `entitlement`.
  readonly action: Action
    Operation interpreted by that domain, such as `require`.
  readonly definition: Entry
    Exact domain definition referenced by this requirement.
```

### types: RequirementDocument

[Declaration source](types.ts#L70)

```text
interface RequirementDocument
  JSON-safe projection of one requirement.

  readonly id: string
    Stable requirement identity derived from family, action, and exact definition ID.
  readonly family: string
    Stable requirement family safe to expose in generated documentation.
  readonly action: string
    Family-specific action safe to expose in generated documentation.
  readonly definition: string
    Exact import-safe definition bound to this requirement.
  readonly definitionKind: string
    Catalog definition kind attached to the documented requirement target.
  readonly description?: string
    Human-readable requirement purpose used by documentation and diagnostics.
```

### types: RequirementInterpreter

[Declaration source](types.ts#L101)

```text
interface RequirementInterpreter<Entry extends RequirementDefinition = RequirementDefinition>
  Host behavior for one exact requirement family.

  scope?(ctx: BaseContext, requirements: readonly Entry[]): BaseContext
    Attach family-specific runtime views from statically reachable declarations without activating them.
  apply(ctx: BaseContext, requirements: readonly Entry[]): Promise<void>
    Interpret requirements that became active on the current execution path.
```

### types: RequirementOptions

[Declaration source](types.ts#L54)

```text
interface RequirementOptions<Family extends string, Action extends string, Entry extends CatalogEntryIdentity>
  Options accepted by `requirements.define()`.

  readonly family: Family
    Stable interpreter family that owns runtime meaning for this requirement.
  readonly action: Action
    Family-specific operation requested by this requirement contribution.
  readonly definition: Entry
    Exact import-safe definition bound to this requirement.
  readonly description?: string
    Human-readable requirement purpose used by documentation and diagnostics.
```

### types: RequirementPathType

[Declaration source](types.ts#L91)

```text
interface RequirementPathType
  Provenance for one statically reachable requirement.

  Runtime admission does not automatically apply this value. The path exists
  for inspection, deployment planning, security review, and documentation.

  readonly requirement: RequirementDefinition
    Exact reachable requirement found along this dependency path.
  readonly owner: CatalogEntryIdentity
    Temporary owner identity used while this requirement path is claimed.
  readonly path: readonly CatalogEntryIdentity[]
    Deterministic or canonical path associated with this requirement path.
```

### types: RequirementRuntime

[Declaration source](types.ts#L112)

```text
interface RequirementRuntime
  Runtime requirement interpreters attached to one execution context.

  readonly interpreters: Readonly<Record<string, RequirementInterpreter | undefined>>
    Configured family interpreters keyed by stable requirement family.
  readonly unknown: UnknownRequirementPolicyType
    Explicit policy used when active work reaches an unconfigured requirement family.
```

### types: RequirementScopeOptions

[Declaration source](types.ts#L125)

```text
interface RequirementScopeOptions
  Options accepted by `requirements.scope()`.

  readonly interpreters?: Readonly<Record<string, RequirementInterpreter | undefined>>
    Family interpreters available to the newly created requirement scope.
  readonly unknown?: UnknownRequirementPolicyType
    Unknown families reject by default. Tests must opt in when they intentionally ignore policy.
```

### types: RequirementCatalog

[Declaration source](types.ts#L31)

```text
type RequirementCatalog<Family extends string, Action extends string, Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>> = Catalog<RequirementDefinition<Family, Action, Entries[keyof Entries]>, RequirementCatalogEntries<Family, Action, Entries>>
  Named requirement catalog projected from one canonical definition catalog.
```

### types: RequirementCatalogEntries

[Declaration source](types.ts#L20)

```text
type RequirementCatalogEntries<Family extends string, Action extends string, Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>> = Readonly<readonly [Key in keyof Entries]: RequirementDefinition<Family, Action, Entries[Key]>>
  Key-preserving requirement entries projected from one definition catalog.
```

### types: RequirementContext

[Declaration source](types.ts#L120)

```text
type RequirementContext<Base extends BaseContext = BaseContext> = Base & Readonly<{ readonly requirements: RequirementRuntime; }>
  Execution context view that can apply active requirements.
```

### types: RequirementInput

[Declaration source](types.ts#L49)

```text
type RequirementInput<Entry extends RequirementDefinition = RequirementDefinition> = CatalogDefinitionInput<Entry>
  Recursive input accepted by requirement-consuming definitions.
```

### types: UnknownRequirementPolicyType

[Declaration source](types.ts#L109)

```text
type UnknownRequirementPolicyType = "reject" | "ignore"
  Policy used when active work reaches an unconfigured requirement family.
```
