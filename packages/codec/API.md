# @okikio/codec contracts

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
| `@okikio/codec`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/codec/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/codec`. [Source](./mod.ts).

Describe both directions of a transport conversion together. Independent encoder and decoder functions easily drift when
an API changes its timestamp format.

Use a codec for an HTTP field, queue payload or stored result, then expose it through schema-compatible consumers. Both
directions validate their own output. Round-trip fidelity depends on your transformations: converting an offset
timestamp to Date intentionally normalizes its spelling. A codec does not serialize resources or make arbitrary objects
durable.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding    | Contract owner or source                                      |
| ------------------- | ------------------------------------------------------------- |
| `StandardSchemaV1`  | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `recordCore`        | [record contracts](../record/API.md)                          |
| `schema`            | [schema contracts](../schema/API.md)                          |
| `Codec`             | [Source](types.ts)                                            |
| `CodecShape`        | [Source](types.ts)                                            |
| `ObjectDecoded`     | [Source](types.ts)                                            |
| `ObjectDecodeInput` | [Source](types.ts)                                            |
| `ObjectEncoded`     | [Source](types.ts)                                            |
| `ObjectEncodeInput` | [Source](types.ts)                                            |

### root: array

[Declaration source](mod.ts#L108)

```text
function array<DecodeInput_, Application, EncodeInput_, EncodedValue>(definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>): Codec<readonly DecodeInput_[], readonly Application[], readonly EncodeInput_[], readonly EncodedValue[]>
  Compose a codec for arrays of another codec.
```

### root: assert

[Declaration source](mod.ts#L119)

```text
function assert(value: unknown, name: string): asserts value is Codec
  Assert that a value is a codec definition.
```

### root: decode

[Declaration source](mod.ts#L51)

```text
async function decode<DecodeInput_, Application, EncodeInput_, EncodedValue>(definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>, value: unknown): Promise<Application>
  Decode and validate an external value.
```

### root: define

[Declaration source](mod.ts#L26)

```text
function define<DecodeInput, Application, EncodeInput = Application, EncodedValue = DecodeInput>(input: Readonly<{ readonly decode: StandardSchemaV1<DecodeInput, Application>; readonly encode: StandardSchemaV1<EncodeInput, EncodedValue>; }>): Codec<DecodeInput, Application, EncodeInput, EncodedValue>
  Define a codec from explicit decode and encode Standard Schemas.
```

### root: encode

[Declaration source](mod.ts#L60)

```text
async function encode<DecodeInput_, Application, EncodeInput_, EncodedValue>(definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>, value: unknown): Promise<EncodedValue>
  Encode and validate an application value.
```

### root: is

[Declaration source](mod.ts#L43)

```text
function is(value: unknown): value is Codec
  Return whether a value is a codec definition.
```

### root: nullable

[Declaration source](mod.ts#L97)

```text
function nullable<DecodeInput_, Application, EncodeInput_, EncodedValue>(definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>): Codec<DecodeInput_ | null, Application | null, EncodeInput_ | null, EncodedValue | null>
  Allow a codec value to be `null` in both directions.
```

### root: object

[Declaration source](mod.ts#L69)

```text
function object<Shape extends CodecShape>(shape: Shape): Codec<ObjectDecodeInput<Shape>, ObjectDecoded<Shape>, ObjectEncodeInput<Shape>, ObjectEncoded<Shape>>
  Compose named codecs into one structurally validated object codec.
```

### root: optional

[Declaration source](mod.ts#L86)

```text
function optional<DecodeInput_, Application, EncodeInput_, EncodedValue>(definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>): Codec<DecodeInput_ | undefined, Application | undefined, EncodeInput_ | undefined, EncodedValue | undefined>
  Allow a codec value to be omitted as `undefined` in both directions.
```

### root: Codec

[Declaration source](mod.ts#L272)

```text
reference Codec: ./packages/codec/types.ts:3:1
```

### root: CodecShape

[Declaration source](mod.ts#L273)

```text
reference CodecShape: ./packages/codec/types.ts:30:1
```

### root: DecodeInput

[Declaration source](mod.ts#L275)

```text
reference DecodeInput: ./packages/codec/types.ts:18:1
```

### root: Decoded

[Declaration source](mod.ts#L274)

```text
reference Decoded: ./packages/codec/types.ts:21:1
```

### root: EncodeInput

[Declaration source](mod.ts#L277)

```text
reference EncodeInput: ./packages/codec/types.ts:24:1
```

### root: Encoded

[Declaration source](mod.ts#L276)

```text
reference Encoded: ./packages/codec/types.ts:27:1
```

### root: ObjectDecodeInput

[Declaration source](mod.ts#L279)

```text
reference ObjectDecodeInput: ./packages/codec/types.ts:33:1
```

### root: ObjectDecoded

[Declaration source](mod.ts#L278)

```text
reference ObjectDecoded: ./packages/codec/types.ts:38:1
```

### root: ObjectEncodeInput

[Declaration source](mod.ts#L281)

```text
reference ObjectEncodeInput: ./packages/codec/types.ts:43:1
```

### root: ObjectEncoded

[Declaration source](mod.ts#L280)

```text
reference ObjectEncoded: ./packages/codec/types.ts:48:1
```

## types

Import `@okikio/codec/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                      |
| ------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1` | External declaration: `@standard-schema/spec/dist/index.d.ts` |

### types: Codec

[Declaration source](types.ts#L3)

```text
interface Codec<EncodedInput = unknown, Application = unknown, ApplicationInput = Application, Encoded = EncodedInput>
  Explicit bidirectional contract composed from two independent Standard Schemas.

  readonly kind: "codec"
    Stable discriminant that selects the documented variant.
  readonly decode: StandardSchemaV1<EncodedInput, Application>
    Decode the external representation according to this contract.
  readonly encode: StandardSchemaV1<ApplicationInput, Encoded>
    Encode the contract value into its external representation.
```

### types: CodecShape

[Declaration source](types.ts#L30)

```text
type CodecShape = Readonly<Record<string, Codec>>
  Record of named codecs accepted by {@link object}.
```

### types: DecodeInput

[Declaration source](types.ts#L18)

```text
type DecodeInput<Definition extends Codec> = StandardSchemaV1.InferInput<Definition["decode"]>
  Encoded input accepted by a codec.
```

### types: Decoded

[Declaration source](types.ts#L21)

```text
type Decoded<Definition extends Codec> = StandardSchemaV1.InferOutput<Definition["decode"]>
  Application value produced by a codec.
```

### types: EncodeInput

[Declaration source](types.ts#L24)

```text
type EncodeInput<Definition extends Codec> = StandardSchemaV1.InferInput<Definition["encode"]>
  Application input accepted for encoding.
```

### types: Encoded

[Declaration source](types.ts#L27)

```text
type Encoded<Definition extends Codec> = StandardSchemaV1.InferOutput<Definition["encode"]>
  Encoded value produced by a codec.
```

### types: ObjectDecodeInput

[Declaration source](types.ts#L33)

```text
type ObjectDecodeInput<Shape extends CodecShape> = readonly [Key in keyof Shape]: DecodeInput<Shape[Key]>
  Decoded object input represented by a codec shape.
```

### types: ObjectDecoded

[Declaration source](types.ts#L38)

```text
type ObjectDecoded<Shape extends CodecShape> = readonly [Key in keyof Shape]: Decoded<Shape[Key]>
  Decoded application object represented by a codec shape.
```

### types: ObjectEncodeInput

[Declaration source](types.ts#L43)

```text
type ObjectEncodeInput<Shape extends CodecShape> = readonly [Key in keyof Shape]: EncodeInput<Shape[Key]>
  Application object accepted by a codec shape's encoder.
```

### types: ObjectEncoded

[Declaration source](types.ts#L48)

```text
type ObjectEncoded<Shape extends CodecShape> = readonly [Key in keyof Shape]: Encoded<Shape[Key]>
  Encoded object represented by a codec shape.
```
