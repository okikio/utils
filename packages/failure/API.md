# @okikio/failure contracts

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
| `@okikio/failure`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/failure/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/failure`. [Source](./mod.ts).

Give expected rejection a stable identity and validated data that can cross a process or storage boundary. Catching
every Error by message makes a renamed sentence change application behavior.

Use failures for expected domain outcomes such as missing input or a declined request. Encode at a transport boundary
and decode against trusted definitions on the receiving side. Unknown identities reject instead of manufacturing
authority from input. Unexpected exceptions belong to fault diagnostics; HTTP presentation belongs to problem
definitions. Do not put secrets in durable failure data.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source               |
| ------------------ | -------------------------------------- |
| `catalogCore`      | [catalog contracts](../catalog/API.md) |
| `DefinitionInput`  | [catalog contracts](../catalog/API.md) |
| `schema`           | [schema contracts](../schema/API.md)   |
| `Data`             | [Source](types.ts)                     |
| `Definition`       | [Source](types.ts)                     |
| `Encoded`          | [Source](types.ts)                     |
| `FailureCatalog`   | [Source](types.ts)                     |
| `FailureSelection` | [Source](types.ts)                     |
| `Occurrence`       | [Source](types.ts)                     |

### root: catalog

[Declaration source](mod.ts#L75)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, Definition>>>(namespace: Namespace, entries: Entries): FailureCatalog<Entries>
  Create a named immutable failure catalog.
```

### root: compose

[Declaration source](mod.ts#L94)

```text
function compose<Entry extends Definition>(...inputs: readonly DefinitionInput<Entry>[]): readonly Entry[]
  Compose direct failure definitions, catalogs, selections, and nested arrays.
```

### root: create

[Declaration source](mod.ts#L99)

```text
async function create<FailureDefinition extends Definition>(definition: FailureDefinition, input: Readonly<{ readonly data: unknown; readonly message?: string; readonly cause?: unknown; }>): Promise<Occurrence<FailureDefinition>>
  Create one schema-validated failure occurrence.
```

### root: decode

[Declaration source](mod.ts#L148)

```text
async function decode<Entry extends Definition>(value: unknown, trusted: DefinitionInput<Entry>): Promise<Occurrence<Entry>>
  Decode and validate a durable occurrence through a trusted failure catalog.
```

### root: define

[Declaration source](mod.ts#L61)

```text
function define<Id extends string, Output>(input: Readonly<{ readonly id: Id; readonly description: string; readonly data: import("@standard-schema/spec").StandardSchemaV1<unknown, Output>; }>): Definition<Id, Output>
  Define one immutable expected failure contract.
```

### root: encode

[Declaration source](mod.ts#L142)

```text
async function encode(value: Occurrence): Promise<Encoded>
  Encode an occurrence after revalidating its durable data. Causes are deliberately omitted.
```

### root: is

[Declaration source](mod.ts#L122)

```text
function is<FailureDefinition extends Definition>(value: unknown, definition: FailureDefinition): value is Occurrence<FailureDefinition>
  Return whether a value is an occurrence of one exact failure definition.
```

### root: isEncoded

[Declaration source](mod.ts#L167)

```text
function isEncoded(value: unknown): value is Encoded
  Return whether a durable failure record has safe own data properties.

  The guard inspects property descriptors instead of reading candidate fields.
  This prevents accessor-backed transport objects from running caller code while
  the decoder is only trying to classify input.

  @internal
```

### root: isOccurrence

[Declaration source](mod.ts#L117)

```text
function isOccurrence(value: unknown): value is Occurrence
  Return whether a value is a failure occurrence created by this module instance.
```

### root: match

[Declaration source](mod.ts#L130)

```text
function match<Value>(value: Occurrence, cases: Readonly<Record<string, (value: Occurrence) => Value>>, otherwise?: (value: Occurrence) => Value): Value
  Match a failure occurrence by stable definition ID.
```

### root: select

[Declaration source](mod.ts#L83)

```text
function select<Entries extends Readonly<Record<PropertyKey, Definition>>, Keys extends readonly (keyof Entries & string)[]>(source: FailureCatalog<Entries>, keys: Keys): FailureSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select a key-preserving failure catalog subset.
```

### root: UnknownFailureDefinitionError

[Declaration source](mod.ts#L28)

```text
class UnknownFailureDefinitionError extends TypeError
  Error raised when durable failure data references an unknown definition.

  constructor(id: string)
    Create this UnknownFailureDefinitionError from the explicit contract values supplied by its caller.
  readonly id: string
    Stable identity used to correlate this contract or occurrence.
```

### root: Data

[Declaration source](mod.ts#L196)

```text
reference Data: ./packages/failure/types.ts:22:1
```

### root: Definition

[Declaration source](mod.ts#L196)

```text
reference Definition: ./packages/failure/types.ts:10:1
```

### root: Encoded

[Declaration source](mod.ts#L196)

```text
reference Encoded: ./packages/failure/types.ts:45:1
```

### root: FailureCatalog

[Declaration source](mod.ts#L196)

```text
reference FailureCatalog: ./packages/failure/types.ts:55:1
```

### root: FailureSelection

[Declaration source](mod.ts#L196)

```text
reference FailureSelection: ./packages/failure/types.ts:61:1
```

### root: Occurrence

[Declaration source](mod.ts#L196)

```text
reference Occurrence: ./packages/failure/types.ts:30:1
```

## types

Import `@okikio/failure/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                      |
| ------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1` | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `Catalog`          | [catalog contracts](../catalog/API.md)                        |
| `CatalogSelection` | [catalog contracts](../catalog/API.md)                        |

### types: Definition

[Declaration source](types.ts#L10)

```text
interface Definition<Id extends string = string, Data = unknown>
  Frozen declaration of one expected failure family.

  A definition gives an expected failure a stable durable identity and a
  Standard Schema data contract. It does not choose an HTTP status, CLI exit
  code, retry policy, or result container.

  readonly kind: "failure"
    Stable discriminant that selects the documented variant.
  readonly id: Id
    Stable identity used to correlate this contract or occurrence.
  readonly description: string
    Caller-authored purpose used in documentation and diagnostics.
  readonly data: StandardSchemaV1<unknown, Data>
    Data payload carried by this representation.
```

### types: Encoded

[Declaration source](types.ts#L45)

```text
interface Encoded
  Durable representation of an expected failure occurrence.

  The stable `id` lets a receiving process resolve the original definition and
  revalidate `data` before it reconstructs the occurrence.

  readonly id: string
    Stable identity used to correlate this contract or occurrence.
  readonly data: unknown
    Data payload carried by this representation.
  readonly message: string
    Human-readable explanation; use the stable code or discriminant for program decisions.
```

### types: Occurrence

[Declaration source](types.ts#L30)

```text
interface Occurrence<FailureDefinition extends Definition = Definition> extends Error
  In-process frozen occurrence of one exact expected failure definition.

  `cause` is diagnostic process-local data. Encoding deliberately omits it so
  durable failure records contain only stable definition data and the message.

  readonly definition: FailureDefinition
    Exact declared contract object; an independently authored same-name object is not the same declaration.
  readonly data: Data<FailureDefinition>
    Data payload carried by this representation.
  readonly cause?: unknown
    Original failure that caused this diagnostic or cancellation result.
```

### types: Data

[Declaration source](types.ts#L22)

```text
type Data<FailureDefinition extends Definition> = StandardSchemaV1.InferOutput<FailureDefinition["data"]>
  Data output represented by a failure definition.
```

### types: FailureCatalog

[Declaration source](types.ts#L55)

```text
type FailureCatalog<Entries extends Readonly<Record<PropertyKey, Definition>>> = Catalog<Entries[keyof Entries], Entries>
  Named failure catalog.
```

### types: FailureSelection

[Declaration source](types.ts#L61)

```text
type FailureSelection<Entry extends Definition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>
  Key-preserving failure catalog selection.
```
