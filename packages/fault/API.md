# @okikio/fault contracts

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
| `@okikio/fault`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/fault/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/fault`. [Source](./mod.ts).

Project unexpected errors into bounded diagnostics without retaining the live object or invoking user getters.
JSON.stringify(Error) usually drops the message; arbitrary coercion can execute application code.

Use encode() for Worker fault frames or structured telemetry, and message() for a bounded display string. Choose
explicit depth, entry and string limits for untrusted objects. Native inherited error names survive projection;
accessor-backed properties become markers. Stack inclusion defaults to true and can be disabled and custom stack
formatting is excluded. Bounded output still needs application-specific redaction.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source             |
| ---------------- | ------------------------------------ |
| `record`         | [record contracts](../record/API.md) |
| `FaultValue`     | [Source](types.ts)                   |
| `Options`        | [Source](types.ts)                   |

### root: encode

[Declaration source](mod.ts#L30)

```text
function encode(value: unknown, options: Options): FaultValue
  Convert arbitrary runtime fault data to a bounded JSON-safe diagnostic value.
```

### root: isRecord

[Declaration source](mod.ts#L51)

```text
function isRecord(value: FaultValue): value is import("./types.ts").FaultRecord
  Return whether a projected diagnostic value is a record rather than an array or primitive.
```

### root: message

[Declaration source](mod.ts#L36)

```text
function message(value: unknown, options: Options): string
  Return one bounded human-readable message without invoking caller-defined object coercion.
```

### root: FaultArray

[Declaration source](mod.ts#L211)

```text
reference FaultArray: ./packages/fault/types.ts:1:1
```

### root: FaultRecord

[Declaration source](mod.ts#L211)

```text
reference FaultRecord: ./packages/fault/types.ts:4:1
```

### root: FaultValue

[Declaration source](mod.ts#L211)

```text
reference FaultValue: ./packages/fault/types.ts:10:1
```

### root: Options

[Declaration source](mod.ts#L211)

```text
reference Options: ./packages/fault/types.ts:13:1
```

## types

Import `@okikio/fault/types`. [Source](./types.ts).

### types: FaultArray

[Declaration source](types.ts#L1)

```text
interface FaultArray extends ReadonlyArray<FaultValue>
  Readonly diagnostic array produced by fault projection.
```

### types: FaultRecord

[Declaration source](types.ts#L4)

```text
interface FaultRecord
  Readonly diagnostic record produced by fault projection.

  readonly [key: string]: FaultValue
```

### types: Options

[Declaration source](types.ts#L13)

```text
interface Options
  Limits applied while projecting arbitrary runtime faults into diagnostic data.

  readonly maximumDepth?: number
    Maximum nested object/array depth inspected before a marker is emitted. @default 6
  readonly maximumEntries?: number
    Maximum own array items or object fields retained at each level. @default 32
  readonly maximumStringLength?: number
    Maximum UTF-16 string length retained for one string field. @default 4096
  readonly includeStack?: boolean
    Include an own string `stack` field from Error objects when available. @default true
```

### types: FaultValue

[Declaration source](types.ts#L10)

```text
type FaultValue = null | string | number | boolean | FaultArray | FaultRecord
  JSON-safe diagnostic value produced from an arbitrary runtime fault.
```
