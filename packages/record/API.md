# @okikio/record contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                 | Source                   | Reference       |
| ---------------------- | ------------------------ | --------------- |
| `@okikio/record`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/record/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/record`. [Source](./mod.ts).

Inspect plain data records without accidentally invoking hidden getters or trusting inherited configuration. Object.keys
plus direct reads can execute accessors and silently ignore properties that validation never saw.

Validate authored options before snapshotting them, then use typed keys and entries to retain exact key/value
relationships. Use the ordinary Web or JavaScript API when data is already trusted and the stronger record contract adds
no value. Record inspection does not recursively validate application values or make external objects immutable.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source |
| ---------------- | ------------------------ |
| `Entry`          | [Source](types.ts)       |

### root: assert

[Declaration source](mod.ts#L30)

```text
function assert<Value>(value: Value, name: string): asserts value is Value & Readonly<Record<string, unknown>>
  Reject values whose type-visible properties cannot be preserved by ordinary record enumeration.
```

### root: entries

[Declaration source](mod.ts#L59)

```text
function entries<RecordType extends Readonly<Record<string, unknown>>>(value: RecordType, name: string): readonly Entry<RecordType>[]
  Return exact own string entries after validating the authoring record shape.
```

### root: is

[Declaration source](mod.ts#L19)

```text
function is(value: unknown): value is Readonly<Record<string, unknown>>
  Return whether a value is a plain object or null-prototype record containing only own enumerable string data properties.
```

### root: keys

[Declaration source](mod.ts#L50)

```text
function keys<RecordType extends Readonly<Record<string, unknown>>>(value: RecordType, name: string): readonly Extract<keyof RecordType, string>[]
  Return exact own string keys after validating that no type-visible key can be omitted.
```

### root: snapshot

[Declaration source](mod.ts#L69)

```text
function snapshot<RecordType extends Readonly<Record<string, unknown>>>(value: RecordType, name: string): RecordType
  Create a frozen null-prototype snapshot without dropping any validated record property.
```

### root: Entry

[Declaration source](mod.ts#L81)

```text
reference Entry: ./packages/record/types.ts:1:1
```

## types

Import `@okikio/record/types`. [Source](./types.ts).

### types: Entry

[Declaration source](types.ts#L1)

```text
type Entry<RecordType extends Readonly<Record<string, unknown>>> = readonly [Key in Extract<keyof RecordType, string>]: readonly [Key, RecordType[Key]][Extract<keyof RecordType, string>]
  One exact string-keyed entry from a validated data record.
```
