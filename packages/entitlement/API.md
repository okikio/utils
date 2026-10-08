# @okikio/entitlement contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                      | Source                   | Reference       |
| --------------------------- | ------------------------ | --------------- |
| `@okikio/entitlement`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/entitlement/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/entitlement`. [Source](./mod.ts).

Declare which paid or enabled feature an operation requires without coupling its definition to a billing provider.
Scattered plan-name comparisons otherwise make the same feature mean different things in different services.

Attach the requirement to a resource, activity or endpoint, then configure an entitlement interpreter at the application
root. The definition documents a required capability; it does not itself allow access. Unknown requirement families
reject unless the owner explicitly chooses another policy. Use exact imported definitions so billing policy and runtime
admission describe the same feature.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source                       |
| ------------------------ | ---------------------------------------------- |
| `catalogCore`            | [catalog contracts](../catalog/API.md)         |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md)         |
| `requirement`            | [requirement contracts](../requirement/API.md) |
| `EntitlementCatalog`     | [Source](types.ts)                             |
| `EntitlementDefinition`  | [Source](types.ts)                             |
| `EntitlementOptions`     | [Source](types.ts)                             |
| `EntitlementRequirement` | [Source](types.ts)                             |
| `EntitlementSelection`   | [Source](types.ts)                             |

### root: catalog

[Declaration source](mod.ts#L33)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>>(namespace: Namespace, entries: Entries): EntitlementCatalog<Entries>
  Create a named immutable entitlement catalog.
```

### root: compose

[Declaration source](mod.ts#L55)

```text
function compose<Entry extends EntitlementDefinition>(...input: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[]
  Compose entitlement definitions, catalogs, selections, and nested arrays.
```

### root: define

[Declaration source](mod.ts#L27)

```text
function define(input: EntitlementOptions): EntitlementDefinition
  Define one immutable entitlement contract.
```

### root: require

[Declaration source](mod.ts#L62)

```text
function require(definition: EntitlementDefinition): EntitlementRequirement
  Contribute the `require` requirement for one entitlement definition.
```

### root: select

[Declaration source](mod.ts#L44)

```text
function select<Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: EntitlementCatalog<Entries>, keys: Keys): EntitlementSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select a key-preserving entitlement catalog subset.
```

### root: EntitlementCatalog

[Declaration source](mod.ts#L71)

```text
reference EntitlementCatalog: ./packages/entitlement/types.ts:26:1
```

### root: EntitlementDefinition

[Declaration source](mod.ts#L72)

```text
reference EntitlementDefinition: ./packages/entitlement/types.ts:17:1
```

### root: EntitlementDefinitions

[Declaration source](mod.ts#L73)

```text
reference EntitlementDefinitions: ./packages/entitlement/types.ts:38:1
```

### root: EntitlementOptions

[Declaration source](mod.ts#L74)

```text
reference EntitlementOptions: ./packages/entitlement/types.ts:9:1
```

### root: EntitlementRequirement

[Declaration source](mod.ts#L75)

```text
reference EntitlementRequirement: ./packages/entitlement/types.ts:23:1
```

### root: EntitlementSelection

[Declaration source](mod.ts#L76)

```text
reference EntitlementSelection: ./packages/entitlement/types.ts:32:1
```

## types

Import `@okikio/entitlement/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source                       |
| ------------------------ | ---------------------------------------------- |
| `Catalog`                | [catalog contracts](../catalog/API.md)         |
| `CatalogEntryIdentity`   | [catalog contracts](../catalog/API.md)         |
| `CatalogSelection`       | [catalog contracts](../catalog/API.md)         |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md)         |
| `RequirementDefinition`  | [requirement contracts](../requirement/API.md) |

### types: EntitlementDefinition

[Declaration source](types.ts#L17)

```text
interface EntitlementDefinition extends CatalogEntryIdentity
  Immutable entitlement definition.

  readonly kind: "entitlement"
    Stable discriminant for this entitlement value.
```

### types: EntitlementOptions

[Declaration source](types.ts#L9)

```text
interface EntitlementOptions
  EntitlementDefinitions accepted by `define()`.

  readonly id: string
    Stable entitlement identity used for correlation, lookup, or durable records.
  readonly description?: string
    Human-readable entitlement purpose used by documentation and diagnostics.
```

### types: EntitlementCatalog

[Declaration source](types.ts#L26)

```text
type EntitlementCatalog<Entries extends Readonly<Record<PropertyKey, EntitlementDefinition>>> = Catalog<Entries[keyof Entries], Entries>
  Named entitlement catalog.
```

### types: EntitlementDefinitions

[Declaration source](types.ts#L38)

```text
type EntitlementDefinitions = CatalogDefinitionInput<EntitlementDefinition>
  Recursive entitlement definition input.
```

### types: EntitlementRequirement

[Declaration source](types.ts#L23)

```text
type EntitlementRequirement = RequirementDefinition<"entitlement", "require", EntitlementDefinition>
  Entitlement requirement contributed to another definition.
```

### types: EntitlementSelection

[Declaration source](types.ts#L32)

```text
type EntitlementSelection<Entry extends EntitlementDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>
  Key-preserving entitlement catalog selection.
```
