# @okikio/meter contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                | Source                   | Reference       |
| --------------------- | ------------------------ | --------------- |
| `@okikio/meter`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/meter/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/meter`. [Source](./mod.ts).

Record a validated usage fact through the same authoritative effect owner as the operation. Incrementing an in-memory
counter cannot prove a billing or audit sink accepted the measurement.

Define a measurement once, record it with a stable idempotency key, then attach attributes for later aggregation. A real
owner may persist the occurrence to a ledger or outbox. The example owner accepts in memory only; it is not a billing
backend. Meter definitions describe units and aggregation, while application policy decides pricing and entitlement.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source               |
| ------------------------ | -------------------------------------- |
| `catalogCore`            | [catalog contracts](../catalog/API.md) |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md) |
| `EffectContext`          | [effect contracts](../effect/API.md)   |
| `EffectOccurrence`       | [effect contracts](../effect/API.md)   |
| `effects`                | [effect contracts](../effect/API.md)   |
| `MeterReadingSchema`     | [Source](schema.ts)                    |
| `MeterCatalog`           | [Source](types.ts)                     |
| `MeterDefinition`        | [Source](types.ts)                     |
| `MeterOptions`           | [Source](types.ts)                     |
| `MeterReadingType`       | [Source](types.ts)                     |
| `MeterRecordOptions`     | [Source](types.ts)                     |
| `MeterSelection`         | [Source](types.ts)                     |

### root: catalog

[Declaration source](mod.ts#L51)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, MeterDefinition>>>(namespace: Namespace, entries: Entries): MeterCatalog<Entries>
  Create a named immutable meter catalog.
```

### root: compose

[Declaration source](mod.ts#L70)

```text
function compose<Entry extends MeterDefinition>(...input: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[]
  Compose meter definitions, catalogs, selections, and nested arrays.
```

### root: define

[Declaration source](mod.ts#L40)

```text
function define(input: MeterOptions): MeterDefinition
  Define one immutable meter contract without starting a measurement sink.
```

### root: effect

[Declaration source](mod.ts#L77)

```text
function effect(definition: MeterDefinition): import("@okikio/effect").EffectDefinition
  Return the exact declared effect definition used to record this meter.
```

### root: record

[Declaration source](mod.ts#L89)

```text
async function record(ctx: EffectContext, definition: MeterDefinition, value: number, options: MeterRecordOptions): Promise<EffectOccurrence>
  Record one measurement as an effect announcement.

  The occurrence time comes from the execution context clock, not ambient
  `Date.now()`, so tests and replay-aware hosts can control time consistently.
  Resolution means the effect owner accepted responsibility for the fact.
```

### root: select

[Declaration source](mod.ts#L62)

```text
function select<Entries extends Readonly<Record<PropertyKey, MeterDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: MeterCatalog<Entries>, keys: Keys): MeterSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select a key-preserving meter catalog subset.
```

### root: MeterReadingSchema

[Declaration source](schema.ts#L35)

```text
const MeterReadingSchema
  Standard Schema contract for one accepted meter fact.

  The meter package only needs a small stable wire contract, so it does not
  pull a validator implementation into production. Applications remain free to
  use Zod, Valibot, ArkType, or any other Standard Schema implementation.
```

### root: MeterReadingType

[Declaration source](schema.ts#L3)

```text
interface MeterReadingType
  Runtime measurement validated before it enters an effect occurrence.

  readonly value: number
    Value carried by this contract; its schema and owner define the accepted shape.
  readonly at: string
    Observation instant supplied by the owning clock.
  readonly attributes?: Readonly<Record<string, string | number | boolean>>
    Additional caller-owned metadata carried beside the primary value.
```

### root: MeterCatalog

[Declaration source](mod.ts#L123)

```text
reference MeterCatalog: ./packages/meter/types.ts:43:1
```

### root: MeterDefinition

[Declaration source](mod.ts#L124)

```text
reference MeterDefinition: ./packages/meter/types.ts:21:1
```

### root: MeterDefinitions

[Declaration source](mod.ts#L125)

```text
reference MeterDefinitions: ./packages/meter/types.ts:55:1
```

### root: MeterOptions

[Declaration source](mod.ts#L126)

```text
reference MeterOptions: ./packages/meter/types.ts:9:1
```

### root: MeterRecordOptions

[Declaration source](mod.ts#L128)

```text
reference MeterRecordOptions: ./packages/meter/types.ts:35:1
```

### root: MeterSelection

[Declaration source](mod.ts#L129)

```text
reference MeterSelection: ./packages/meter/types.ts:49:1
```

## types

Import `@okikio/meter/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source               |
| ------------------------ | -------------------------------------- |
| `Catalog`                | [catalog contracts](../catalog/API.md) |
| `CatalogEntryIdentity`   | [catalog contracts](../catalog/API.md) |
| `CatalogSelection`       | [catalog contracts](../catalog/API.md) |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md) |
| `EffectDefinition`       | [effect contracts](../effect/API.md)   |

### types: MeterDefinition

[Declaration source](types.ts#L21)

```text
interface MeterDefinition extends CatalogEntryIdentity
  Immutable meter contract and its declared effect definition.

  readonly kind: "meter"
    Stable discriminant for this meter value.
  readonly description?: string
    Human-readable meter purpose used by documentation and diagnostics.
  readonly unit?: string
    Unit represented by each fact recorded for this meter.
  readonly aggregation?: string
    Suggested downstream aggregation meaning retained as static metadata.
  readonly effect: EffectDefinition
    Effect declared for runtimes that record one measurement.
```

### types: MeterOptions

[Declaration source](types.ts#L9)

```text
interface MeterOptions
  Options accepted by `meters.define()`.

  readonly id: string
    Stable measurement identity used by effect definitions and downstream metric consumers.
  readonly description?: string
    Human-readable meter purpose used by documentation and diagnostics.
  readonly unit?: string
    Unit represented by one recorded measurement value.
  readonly aggregation?: string
    Suggested aggregation meaning for downstream metric consumers.
```

### types: MeterRecordOptions

[Declaration source](types.ts#L35)

```text
interface MeterRecordOptions
  Input accepted by `meters.record()`.

  readonly key: string
    Caller-stable key used for deterministic identity or keyed coordination.
  readonly attributes?: Readonly<Record<string, string | number | boolean>>
    Additional bounded dimensions attached to the recorded meter fact.
```

### types: MeterCatalog

[Declaration source](types.ts#L43)

```text
type MeterCatalog<Entries extends Readonly<Record<PropertyKey, MeterDefinition>>> = Catalog<Entries[keyof Entries], Entries>
  Named meter catalog.
```

### types: MeterDefinitions

[Declaration source](types.ts#L55)

```text
type MeterDefinitions = CatalogDefinitionInput<MeterDefinition>
  Recursive input accepted where meter definitions are declared.
```

### types: MeterSelection

[Declaration source](types.ts#L49)

```text
type MeterSelection<Entry extends MeterDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>
  Key-preserving meter catalog selection.
```

### types: MeterReadingType

[Declaration source](types.ts#L57)

```text
reference MeterReadingType: ./packages/meter/schema.ts:3:1
```
