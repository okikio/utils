# @okikio/schema contracts

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
| `@okikio/schema`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/schema/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/schema`. [Source](./mod.ts).

Use one Standard Schema validation call across validator libraries. Reading a validator-specific result shape in every
utility otherwise forces consumers to use the same schema engine.

Start with parse() when invalid input should throw, then use result-oriented validation where a caller needs structured
issues. Keep coercion in the schema that owns the meaning. JSON Schema projection is a separate capability and can fail
for values that have no faithful wire representation. Import a validator adapter explicitly; the generic validation core
does not silently choose one.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                      |
| ------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1` | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `Failure`          | [Source](types.ts)                                            |
| `Schema`           | [Source](types.ts)                                            |
| `Success`          | [Source](types.ts)                                            |
| `ValidationResult` | [Source](types.ts)                                            |

### root: assert

[Declaration source](mod.ts#L70)

```text
function assert(value: unknown, name: string): asserts value is Schema
  Assert that a value implements Standard Schema V1.
```

### root: is

[Declaration source](mod.ts#L39)

```text
function is(value: unknown): value is Schema
  Return whether a value implements Standard Schema V1.
```

### root: parse

[Declaration source](mod.ts#L60)

```text
async function parse<Input, Output>(definition: Schema<Input, Output>, value: unknown): Promise<Output>
  Validate an unknown value or throw {@link SchemaValidationError}.
```

### root: prefixIssues

[Declaration source](mod.ts#L75)

```text
function prefixIssues(issues: readonly StandardSchemaV1.Issue[], ...path: readonly PropertyKey[]): readonly StandardSchemaV1.Issue[]
  Prefix validation issue paths while preserving vendor-specific issue fields.
```

### root: validate

[Declaration source](mod.ts#L49)

```text
async function validate<Input, Output>(definition: Schema<Input, Output>, value: unknown): Promise<ValidationResult<Output>>
  Validate an unknown value and normalize the Standard Schema result.
```

### root: SchemaValidationError

[Declaration source](mod.ts#L20)

```text
class SchemaValidationError extends TypeError
  Error raised when a value does not satisfy a Standard Schema contract.

  constructor(issues: readonly StandardSchemaV1.Issue[], message?: string)
    Create this SchemaValidationError from the explicit contract values supplied by its caller.
  readonly issues: readonly StandardSchemaV1.Issue[]
    Structured rejection details; branch on their codes or paths rather than explanation wording.
```

### root: Failure

[Declaration source](mod.ts#L105)

```text
reference Failure: ./packages/schema/types.ts:15:1
```

### root: Input

[Declaration source](mod.ts#L105)

```text
reference Input: ./packages/schema/types.ts:6:1
```

### root: Output

[Declaration source](mod.ts#L105)

```text
reference Output: ./packages/schema/types.ts:9:1
```

### root: Schema

[Declaration source](mod.ts#L105)

```text
reference Schema: ./packages/schema/types.ts:3:1
```

### root: Success

[Declaration source](mod.ts#L105)

```text
reference Success: ./packages/schema/types.ts:12:1
```

### root: ValidationResult

[Declaration source](mod.ts#L105)

```text
reference ValidationResult: ./packages/schema/types.ts:18:1
```

## types

Import `@okikio/schema/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                      |
| ------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1` | External declaration: `@standard-schema/spec/dist/index.d.ts` |

### types: Failure

[Declaration source](types.ts#L15)

```text
type Failure = Readonly<{ readonly issues: readonly StandardSchemaV1.Issue[]; }>
  Failed Standard Schema validation result.
```

### types: Input

[Declaration source](types.ts#L6)

```text
type Input<Definition extends Schema> = StandardSchemaV1.InferInput<Definition>
  Input type accepted by a Standard Schema contract.
```

### types: Output

[Declaration source](types.ts#L9)

```text
type Output<Definition extends Schema> = StandardSchemaV1.InferOutput<Definition>
  Validated output type produced by a Standard Schema contract.
```

### types: Schema

[Declaration source](types.ts#L3)

```text
type Schema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>
  Standard Schema contract accepted by reusable utility packages.
```

### types: Success

[Declaration source](types.ts#L12)

```text
type Success<Value> = Readonly<{ readonly value: Value; readonly issues?: undefined; }>
  Successful Standard Schema validation result.
```

### types: ValidationResult

[Declaration source](types.ts#L18)

```text
type ValidationResult<Value> = Success<Value> | Failure
  Validation result normalized by this package.
```
