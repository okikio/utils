# @okikio/catalog contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                  | Source                   | Reference       |
| ----------------------- | ------------------------ | --------------- |
| `@okikio/catalog`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/catalog/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/catalog`. [Source](./mod.ts).

Keep one canonical set of imported definitions and select subsets without losing exact object identity. A map keyed only
by strings can silently replace a permission or response with a different same-ID definition.

Use a named catalog for public contracts, select a deployment subset, then compose compatible catalogs. get() resolves a
stable ID while has() checks the exact imported object. Different objects with the same ID cause a conflict. The
immutable catalog does not own a runtime connection or globally register its definitions.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding           | Contract owner or source           |
| -------------------------- | ---------------------------------- |
| `fault`                    | [fault contracts](../fault/API.md) |
| `Catalog`                  | [Source](types.ts)                 |
| `CatalogDocument`          | [Source](types.ts)                 |
| `CatalogEntryDocument`     | [Source](types.ts)                 |
| `CatalogEntryIdentity`     | [Source](types.ts)                 |
| `CatalogIds`               | [Source](types.ts)                 |
| `CatalogLike`              | [Source](types.ts)                 |
| `CatalogMetadata`          | [Source](types.ts)                 |
| `CatalogSelection`         | [Source](types.ts)                 |
| `CatalogSelectionMetadata` | [Source](types.ts)                 |
| `CatalogValidationIssue`   | [Source](types.ts)                 |
| `CatalogValidationResult`  | [Source](types.ts)                 |
| `DefinitionInput`          | [Source](types.ts)                 |

### root: compose

[Declaration source](mod.ts#L267)

```text
function compose<Entry extends CatalogEntryIdentity>(...inputs: readonly DefinitionInput<Entry>[]): readonly Entry[]
  Compose definition inputs into a deterministic immutable entry list.
```

### root: create

[Declaration source](mod.ts#L80)

```text
function create<Namespace extends string, Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries>
  Create an immutable record-shaped catalog for a domain namespace.

  Domain packages normally wrap this helper behind APIs such as
  `problem.catalog()` or `resource.catalog()`.
```

### root: document

[Declaration source](mod.ts#L319)

```text
function document(input: DefinitionInput<CatalogEntryIdentity>): CatalogDocument
  Create a JSON-safe deterministic projection for documentation and manifests.
```

### root: get

[Declaration source](mod.ts#L190)

```text
function get<Entry extends CatalogEntryIdentity>(input: DefinitionInput<Entry>, id: string): Entry | undefined
  Resolve one stable identifier back to its exact trusted definition object.
```

### root: has

[Declaration source](mod.ts#L185)

```text
function has<Entry extends CatalogEntryIdentity>(source: CatalogLike<Entry>, entry: unknown): entry is Entry
  Return whether one exact definition object belongs to a catalog or selection.
```

### root: ids

[Declaration source](mod.ts#L199)

```text
function ids<Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>>(source: Catalog<Entries[keyof Entries], Entries>): CatalogIds<Entries>
  Project stable definition identifiers while preserving the source catalog keys.
```

[Declaration source](mod.ts#L203)

```text
function ids<Entry extends CatalogEntryIdentity, Entries extends Readonly<Record<PropertyKey, Entry>>>(source: CatalogSelection<Entry, Entries>): CatalogIds<Entries>
  Project stable definition identifiers from a key-preserving catalog selection.

  Build the immutable identifier projection after catalog-kind narrowing.
```

### root: is

[Declaration source](mod.ts#L127)

```text
function is(value: unknown): value is CatalogLike
  Return whether a value is a catalog or catalog selection.
```

### root: isRoot

[Declaration source](mod.ts#L132)

```text
function isRoot(value: unknown): value is Catalog
  Return whether a value is a named source catalog.
```

### root: isSelection

[Declaration source](mod.ts#L137)

```text
function isSelection(value: unknown): value is CatalogSelection
  Return whether a value is a catalog selection.
```

### root: metadata

[Declaration source](mod.ts#L142)

```text
function metadata<Entry extends CatalogEntryIdentity>(value: Catalog<Entry>): CatalogMetadata<Entry>
  Return hidden metadata for a named source catalog.
```

[Declaration source](mod.ts#L144)

```text
function metadata<Entry extends CatalogEntryIdentity>(value: CatalogSelection<Entry>): CatalogSelectionMetadata<Entry>
  Return hidden metadata for a catalog selection.
```

[Declaration source](mod.ts#L148)

```text
function metadata<Entry extends CatalogEntryIdentity>(value: CatalogLike<Entry>): CatalogMetadata<Entry> | CatalogSelectionMetadata<Entry>
  Return hidden metadata when the precise catalog kind is not statically known.

  Read hidden metadata after runtime narrowing of a catalog or selection.
```

### root: select

[Declaration source](mod.ts#L224)

```text
function select<Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>, Keys extends readonly (keyof Entries & string)[]>(source: Catalog<Entries[keyof Entries], Entries>, keys: Keys): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select an immutable key-preserving subset from a source catalog.
```

### root: validate

[Declaration source](mod.ts#L274)

```text
function validate(input: unknown): CatalogValidationResult
  Validate a definition input without throwing.
```

### root: values

[Declaration source](mod.ts#L164)

```text
function values<Entry extends CatalogEntryIdentity>(input: DefinitionInput<Entry>): readonly Entry[]
  Flatten direct values, nested arrays, catalogs, and selections.

  The exact same object is deduplicated. Different objects sharing an ID are
  rejected because stable IDs represent identity rather than semantic equality.
```

### root: CatalogConflictError

[Declaration source](mod.ts#L40)

```text
class CatalogConflictError extends Error
  Error raised when different definitions reuse one stable catalog identifier.

  constructor(id: string, first: CatalogEntryIdentity, second: CatalogEntryIdentity)
    Create this CatalogConflictError from the explicit contract values supplied by its caller.
  readonly id: string
    Stable identity used to correlate this contract or occurrence.
  readonly first: CatalogEntryIdentity
    First operand or observation retained in this ordered pair.
  readonly second: CatalogEntryIdentity
    Second operand or observation retained in this ordered pair.
```

### root: CatalogSelectionError

[Declaration source](mod.ts#L59)

```text
class CatalogSelectionError extends Error
  Error raised when a selection references a key that does not exist.

  constructor(namespace: string, key: PropertyKey)
    Create this CatalogSelectionError from the explicit contract values supplied by its caller.
  readonly namespace: string
    Catalog namespace that groups these exact entries.
  readonly key: PropertyKey
    Stable lookup or correlation key within the owning contract.
```

### root: Catalog

[Declaration source](mod.ts#L615)

```text
reference Catalog: ./packages/catalog/types.ts:73:1
```

### root: CatalogDocument

[Declaration source](mod.ts#L616)

```text
reference CatalogDocument: ./packages/catalog/types.ts:126:1
```

### root: CatalogEntryDocument

[Declaration source](mod.ts#L617)

```text
reference CatalogEntryDocument: ./packages/catalog/types.ts:114:1
```

### root: CatalogEntryIdentity

[Declaration source](mod.ts#L618)

```text
reference CatalogEntryIdentity: ./packages/catalog/types.ts:1:1
```

### root: CatalogEntryValue

[Declaration source](mod.ts#L619)

```text
reference CatalogEntryValue: ./packages/catalog/types.ts:31:1
```

### root: CatalogIds

[Declaration source](mod.ts#L620)

```text
reference CatalogIds: ./packages/catalog/types.ts:90:1
```

### root: CatalogLike

[Declaration source](mod.ts#L621)

```text
reference CatalogLike: ./packages/catalog/types.ts:85:1
```

### root: CatalogMetadata

[Declaration source](mod.ts#L622)

```text
reference CatalogMetadata: ./packages/catalog/types.ts:36:1
```

### root: CatalogSelection

[Declaration source](mod.ts#L623)

```text
reference CatalogSelection: ./packages/catalog/types.ts:79:1
```

### root: CatalogSelectionMetadata

[Declaration source](mod.ts#L624)

```text
reference CatalogSelectionMetadata: ./packages/catalog/types.ts:52:1
```

### root: CatalogValidationIssue

[Declaration source](mod.ts#L625)

```text
reference CatalogValidationIssue: ./packages/catalog/types.ts:136:1
```

### root: CatalogValidationResult

[Declaration source](mod.ts#L626)

```text
reference CatalogValidationResult: ./packages/catalog/types.ts:150:1
```

### root: DefinitionEntry

[Declaration source](mod.ts#L627)

```text
reference DefinitionEntry: ./packages/catalog/types.ts:103:1
```

### root: DefinitionInput

[Declaration source](mod.ts#L628)

```text
reference DefinitionInput: ./packages/catalog/types.ts:97:1
```

### root: ValuedCatalogEntry

[Declaration source](mod.ts#L629)

```text
reference ValuedCatalogEntry: ./packages/catalog/types.ts:20:1
```

## types

Import `@okikio/catalog/types`. [Source](./types.ts).

[Declaration source](types.ts#L69)

```text
private const catalogBrand: unique symbol
```

### types: catalogEntryValue

[Declaration source](types.ts#L11)

```text
const catalogEntryValue: unique symbol
  Phantom symbol used to retain the value represented by a static definition.
```

[Declaration source](types.ts#L70)

```text
private const catalogSelectionBrand: unique symbol
```

### types: CatalogBrand

[Declaration source](types.ts#L155)

```text
interface CatalogBrand<Entry extends CatalogEntryIdentity>
  Compile-time brand carried by catalog values.

  readonly [catalogBrand]: Entry
    Hidden compile-time catalog identity; it is not an acquired resource value.
```

### types: CatalogDocument

[Declaration source](types.ts#L126)

```text
interface CatalogDocument
  JSON-safe projection of a catalog or selection.

  readonly type: "catalog" | "selection" | "composition"
    Protocol or representation variant selected by this value.
  readonly namespace?: string
    Catalog namespace that groups these exact entries.
  readonly entries: readonly CatalogEntryDocument[]
    Exact entry objects in the order of the retained catalog keys.
```

### types: CatalogEntryDocument

[Declaration source](types.ts#L114)

```text
interface CatalogEntryDocument
  JSON-safe description of one catalog entry.

  readonly key: string
    Stable lookup or correlation key within the owning contract.
  readonly id: string
    Stable identity used to correlate this contract or occurrence.
  readonly kind: string
    Stable discriminant that selects the documented variant.
  readonly description?: string
    Caller-authored purpose used in documentation and diagnostics.
```

### types: CatalogEntryIdentity

[Declaration source](types.ts#L1)

```text
interface CatalogEntryIdentity
  Stable identity required by values that participate in catalogs.

  readonly id: string
    Globally unique stable identifier for the definition.
  readonly kind: string
    Domain discriminator such as `problem`, `resource`, or `permission`.
  readonly description?: string
    Human-readable explanation used by generated documentation.
```

### types: CatalogMetadata

[Declaration source](types.ts#L36)

```text
interface CatalogMetadata<Entry extends CatalogEntryIdentity = CatalogEntryIdentity>
  Metadata retained for an immutable named catalog.

  readonly type: "catalog"
    Protocol or representation variant selected by this value.
  readonly namespace: string
    Catalog namespace that groups these exact entries.
  readonly keys: readonly string[]
    Catalog keys in their stable authored order.
  readonly entries: readonly Entry[]
    Exact entry objects in the order of the retained catalog keys.
  readonly keyByEntry: ReadonlyMap<Entry, string>
    Reverse lookup from an exact catalog entry object to its authored key.
  readonly entryById: ReadonlyMap<string, Entry>
    Lookup from a stable ID to the exact registered catalog entry.
```

### types: CatalogSelectionBrand

[Declaration source](types.ts#L161)

```text
interface CatalogSelectionBrand<Entry extends CatalogEntryIdentity>
  Compile-time brand carried by catalog selections.

  readonly [catalogSelectionBrand]: Entry
    Hidden compile-time selection identity preserving exact catalog entry inference.
```

### types: CatalogSelectionMetadata

[Declaration source](types.ts#L52)

```text
interface CatalogSelectionMetadata<Entry extends CatalogEntryIdentity = CatalogEntryIdentity>
  Metadata retained for an immutable selection from a source catalog.

  readonly type: "selection"
    Protocol or representation variant selected by this value.
  readonly namespace: string
    Catalog namespace that groups these exact entries.
  readonly source: Catalog<Entry>
    Source representation or provenance retained alongside the interpreted value.
  readonly keys: readonly string[]
    Catalog keys in their stable authored order.
  readonly entries: readonly Entry[]
    Exact entry objects in the order of the retained catalog keys.
  readonly keyByEntry: ReadonlyMap<Entry, string>
    Reverse lookup from an exact catalog entry object to its authored key.
  readonly entryById: ReadonlyMap<string, Entry>
    Lookup from a stable ID to the exact registered catalog entry.
```

### types: CatalogValidationIssue

[Declaration source](types.ts#L136)

```text
interface CatalogValidationIssue
  Validation issue produced while inspecting a definition input.

  readonly code: "invalid-entry" | "duplicate-id" | "empty-id" | "empty-kind"
    Stable machine-readable reason that callers can inspect without matching message text.
  readonly message: string
    Human-readable explanation; use the stable code or discriminant for program decisions.
  readonly id?: string
    Stable identity used to correlate this contract or occurrence.
  readonly first?: CatalogEntryIdentity
    First operand or observation retained in this ordered pair.
  readonly second?: CatalogEntryIdentity
    Second operand or observation retained in this ordered pair.
```

### types: ValuedCatalogEntry

[Declaration source](types.ts#L20)

```text
interface ValuedCatalogEntry<Kind extends string = string, Value = unknown> extends CatalogEntryIdentity
  Generic catalog entry whose static definition represents a concrete runtime value.

  The property is type-only; definition objects do not gain an enumerable runtime
  field. Domain packages such as resources use this protocol so portable
  contracts can retain value inference without importing a runtime adapter.

  readonly kind: Kind
    Stable discriminant that selects the documented variant.
  readonly [catalogEntryValue]: Value
    Compile-time value inference carried by this catalog entry; it is not an acquired resource.
```

### types: Catalog

[Declaration source](types.ts#L73)

```text
type Catalog<Entry extends CatalogEntryIdentity = CatalogEntryIdentity, Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>> = Readonly<Record<string, Entry>>> = Readonly<Entries> & CatalogBrand<Entry>
  Record-shaped immutable catalog with hidden compile-time identity.
```

### types: CatalogEntryValue

[Declaration source](types.ts#L31)

```text
type CatalogEntryValue<Entry extends ValuedCatalogEntry> = Entry extends ValuedCatalogEntry<string, infer Value> ? Value : never
  Concrete runtime value represented by a valued catalog entry.
```

### types: CatalogIds

[Declaration source](types.ts#L90)

```text
type CatalogIds<Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>> = Readonly<readonly [Key in keyof Entries]: Entries[Key]["id"]>
  Key-preserving stable identifiers projected from one catalog or selection.
```

### types: CatalogLike

[Declaration source](types.ts#L85)

```text
type CatalogLike<Entry extends CatalogEntryIdentity = CatalogEntryIdentity> = CatalogBrand<Entry> | CatalogSelectionBrand<Entry>
  Any catalog-like value accepted by generic catalog helpers.
```

### types: CatalogSelection

[Declaration source](types.ts#L79)

```text
type CatalogSelection<Entry extends CatalogEntryIdentity = CatalogEntryIdentity, Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>> = Readonly<Record<string, Entry>>> = Readonly<Entries> & CatalogSelectionBrand<Entry>
  Record-shaped immutable catalog selection with hidden compile-time identity.
```

### types: CatalogValidationResult

[Declaration source](types.ts#L150)

```text
type CatalogValidationResult = { readonly valid: true; readonly entries: readonly CatalogEntryIdentity[]; } | { readonly valid: false; readonly issues: readonly CatalogValidationIssue[]; }
  Deterministic validation result for a catalog input.
```

### types: DefinitionEntry

[Declaration source](types.ts#L103)

```text
type DefinitionEntry<Input, Depth extends readonly unknown[] = readonly []> = Depth["length"] extends 8 ? Extract<Input, CatalogEntryIdentity> : Input extends readonly (infer Item)[] ? DefinitionEntry<Item, readonly [...Depth, unknown]> : Input extends CatalogBrand<infer Entry> ? Entry : Input extends CatalogSelectionBrand<infer Entry> ? Entry : Input extends CatalogEntryIdentity ? Input : never
  Entry union represented by one direct, nested, catalog, or selection input.
```

### types: DefinitionInput

[Declaration source](types.ts#L97)

```text
type DefinitionInput<Entry extends CatalogEntryIdentity> = Entry | CatalogLike<Entry> | readonly DefinitionInput<Entry>[]
  Recursive input accepted by definition-consuming fields.
```
