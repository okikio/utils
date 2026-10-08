# @okikio/env contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                 | Source                         | Reference             |
| ---------------------- | ------------------------------ | --------------------- |
| `@okikio/env`          | [./mod.ts](./mod.ts)           | [root](#root)         |
| `@okikio/env/standard` | [./standard.ts](./standard.ts) | [standard](#standard) |
| `@okikio/env/types`    | [./types.ts](./types.ts)       | [types](#types)       |
| `@okikio/env/valibot`  | [./valibot.ts](./valibot.ts)   | [valibot](#valibot)   |
| `@okikio/env/zod`      | [./zod.ts](./zod.ts)           | [zod](#zod)           |

## root

Import `@okikio/env`. [Source](./mod.ts).

Parse configuration once into typed values and keep secret values out of diagnostics. Reading process.env throughout an
application spreads defaults, coercion and validation across unrelated code.

Start with a record source for reproducible tests, then merge an explicit runtime source and overrides at the executable
root. Use secret() for credentials so documentation and diagnostics redact them. Zod, Valibot and Standard Schema
adapters are optional imports; the generic configuration core does not choose a validator or read environment variables
until a source is used.

### root: blank

[Declaration source](value.ts#L1)

```text
function blank(value: unknown): unknown
  Normalize one environment value by treating blank strings as missing.
```

### root: compose

[Declaration source](definition.ts#L310)

```text
function compose<Definitions extends readonly EnvironmentDefinition[]>(...definitions: Definitions): EnvironmentDefinition<ComposeEnvironmentFields<Definitions>>
  Compose definitions through canonical field identity.

  The same field object may be imported through several definitions and is
  deduplicated. Different field objects using the same key are rejected because
  choosing one would silently discard validation or deployment metadata.
```

### root: define

[Declaration source](definition.ts#L301)

```text
function define<Fields extends EnvironmentFields>(fields: Fields): EnvironmentDefinition<Fields>
  Descriptive alias for `environment()` when the call reads better as a verb.
```

### root: environment

[Declaration source](definition.ts#L254)

````text
function environment<Fields extends EnvironmentFields>(fields: Fields): EnvironmentDefinition<Fields>
  Create an import-safe definition from canonical environment fields.

  The definition describes and validates values; it does not decide where raw
  strings come from. A host supplies `env.env`, `env.record(...)`, or
  `env.merge(...)` when it starts.

  @example
      Standard Schema definition

      ```ts
      import * as env from '@okikio/env/standard';

      const ServiceEnvironment = env.environment({
        PORT: env.variable(PortSchema, { description: 'HTTP listener port.' }),
      });
      ```
````

### root: example

[Declaration source](projection.ts#L34)

```text
function example(definition: EnvironmentDefinition): string
  Render a safe `.env.example` template from a definition.

  Ordinary variables may include a safe example. Secrets always use the
  literal `<secret>` placeholder and never project schema metadata as a value.
```

### root: isSource

[Declaration source](source.ts#L14)

```text
function isSource(value: EnvironmentSourceInput): value is EnvironmentSource
  Return whether a value already implements the pull-based source contract.
```

### root: manifest

[Declaration source](projection.ts#L14)

```text
function manifest(definition: EnvironmentDefinition): EnvironmentManifest
  Project a definition into deterministic variable and secret collections.

  Projection is explicit so the runtime definition can retain concrete schemas
  without pretending that schemas themselves are deployment manifests.
```

### root: merge

[Declaration source](source.ts#L71)

````text
function merge(...sources: readonly EnvironmentSourceInput[]): EnvironmentSource
  Merge sparse sources from lowest to highest precedence.

  Later sources override earlier sources only when they provide a concrete
  string. Returning `undefined` allows lookup to continue into lower layers.
  This mirrors how a host can apply explicit overrides without copying the
  entire ambient environment.

  @example
      Runtime values with explicit overrides

      ```ts
      const source = env.merge(env.env, { PORT: '4321' });
      ```

  @example
      Sparse override

      ```ts
      const source = env.merge({ HOST: 'localhost', PORT: '8787' }, { PORT: '4321' });
      source.get('HOST'); // 'localhost'
      source.get('PORT'); // '4321'
      ```
````

### root: record

[Declaration source](source.ts#L36)

````text
function record(values: EnvironmentRecord): EnvironmentSource
  Capture raw values as a deterministic environment source.

  The snapshot uses `Map` because environment keys are external strings. Keys
  such as `__proto__`, `constructor`, and `toString` therefore remain ordinary
  data instead of interacting with an object's prototype.

  @example
      Test override

      ```ts
      const test = env.record({ PORT: '4321' });
      test.get('PORT'); // '4321'
      ```
````

### root: requirement

[Declaration source](definition.ts#L350)

```text
function requirement<Fields extends EnvironmentFields, Reasons extends Readonly<Partial<Record<Extract<keyof Fields, string>, string>>>>(id: string, definition: EnvironmentDefinition<Fields>, reasons: Reasons): EnvironmentRequirement<Fields>
  Attach operator-facing reasons to selected canonical fields.

  The returned value stores the actual field references rather than only their
  string keys. Requirement reports can therefore distinguish unrelated
  definitions that happen to use the same external name.
```

### root: requirementReport

[Declaration source](projection.ts#L61)

```text
function requirementReport(definition: EnvironmentDefinition, requirements: readonly EnvironmentRequirement[]): readonly EnvironmentRequirementReportField[]
  Combine field metadata with requirements that reference the same field.

  Both the key and canonical object identity must match. This prevents a
  requirement from another service from being attached merely because it uses
  a common key such as `DATABASE_URL`.
```

### root: secret

[Declaration source](definition.ts#L116)

```text
function secret<Schema extends StandardSchemaV1>(schema: Schema, metadata: EnvironmentFieldMetadata): EnvironmentField<Schema, "secret">
  Define protected secret material with an explicit Standard Schema contract.
```

### root: select

[Declaration source](source.ts#L129)

```text
function select(source: EnvironmentSourceInput, keys: readonly string[]): EnvironmentRecord
  Read a bounded set of raw values without defining a validation schema.

  This is useful for deployment adapters and opaque pass-through settings that
  need source selection but do not own the value's domain contract.
```

### root: variable

[Declaration source](definition.ts#L108)

```text
function variable<Schema extends StandardSchemaV1>(schema: Schema, metadata: EnvironmentFieldMetadata): EnvironmentField<Schema, "variable">
  Define an ordinary deployment variable with an explicit Standard Schema contract.
```

### root: env

[Declaration source](source.ts#L112)

```text
const env: EnvironmentSource
  Lazy ambient environment source for Deno and supported Node.js runtimes.

  Importing this value performs no environment read. Each call to `get()` reads
  only the requested key, which preserves narrow Deno permissions. Node-compatible runtimes are read through the ambient `process.env` object, so
  browser module resolution never encounters a static `node:` import.

  Browser and edge runtimes that expose neither ambient API behave as an empty
  source; their composition root should pass deployment bindings explicitly.
```

### root: EnvironmentError

[Declaration source](error.ts#L9)

```text
class EnvironmentError extends Error
  Error raised when environment composition or validation fails.

  The message includes one line per issue for logs and startup diagnostics.
  `issues` retains the same failures as structured data so callers do not need
  to parse that message when presenting or classifying configuration errors.

  constructor(message: string, issues: readonly EnvironmentIssue[])
    Create this EnvironmentError from the explicit contract values supplied by its caller.
  override readonly name: string
    Stable native error name for environment-validation failures.
  readonly issues: readonly EnvironmentIssue[]
    Normalized field and composition failures associated with this error.
```

### root: ComposeEnvironmentFields

[Declaration source](definition.ts#L23)

```text
type ComposeEnvironmentFields<Definitions extends readonly EnvironmentDefinition[]> = Definitions extends readonly [infer Head extends EnvironmentDefinition, ...infer Tail extends readonly EnvironmentDefinition[]] ? Head["fields"] & ComposeEnvironmentFields<Tail> : Record<never, never>
  Fields carried by a tuple of composed environment definitions.
```

### root: EnvironmentDefinition

[Declaration source](mod.ts#L36)

```text
reference EnvironmentDefinition: ./packages/env/types.ts:116:1
```

### root: EnvironmentField

[Declaration source](mod.ts#L37)

```text
reference EnvironmentField: ./packages/env/types.ts:52:1
```

### root: EnvironmentFieldKind

[Declaration source](mod.ts#L38)

```text
reference EnvironmentFieldKind: ./packages/env/types.ts:9:1
```

### root: EnvironmentFieldMetadata

[Declaration source](mod.ts#L39)

```text
reference EnvironmentFieldMetadata: ./packages/env/types.ts:19:1
```

### root: EnvironmentFieldMetadataInput

[Declaration source](mod.ts#L40)

```text
reference EnvironmentFieldMetadataInput: ./packages/env/types.ts:43:1
```

### root: EnvironmentFields

[Declaration source](mod.ts#L41)

```text
reference EnvironmentFields: ./packages/env/types.ts:65:1
```

### root: EnvironmentIssue

[Declaration source](mod.ts#L42)

```text
reference EnvironmentIssue: ./packages/env/types.ts:93:1
```

### root: EnvironmentManifest

[Declaration source](mod.ts#L43)

```text
reference EnvironmentManifest: ./packages/env/types.ts:178:1
```

### root: EnvironmentManifestField

[Declaration source](mod.ts#L44)

```text
reference EnvironmentManifestField: ./packages/env/types.ts:170:1
```

### root: EnvironmentParseResult

[Declaration source](mod.ts#L45)

```text
reference EnvironmentParseResult: ./packages/env/types.ts:105:1
```

### root: EnvironmentRecord

[Declaration source](mod.ts#L46)

```text
reference EnvironmentRecord: ./packages/env/types.ts:87:1
```

### root: EnvironmentRequirement

[Declaration source](mod.ts#L47)

```text
reference EnvironmentRequirement: ./packages/env/types.ts:160:1
```

### root: EnvironmentRequirementField

[Declaration source](mod.ts#L48)

```text
reference EnvironmentRequirementField: ./packages/env/types.ts:144:1
```

### root: EnvironmentRequirementReason

[Declaration source](mod.ts#L49)

```text
reference EnvironmentRequirementReason: ./packages/env/types.ts:188:1
```

### root: EnvironmentRequirementReportField

[Declaration source](mod.ts#L50)

```text
reference EnvironmentRequirementReportField: ./packages/env/types.ts:196:1
```

### root: EnvironmentSource

[Declaration source](mod.ts#L51)

```text
reference EnvironmentSource: ./packages/env/types.ts:81:1
```

### root: EnvironmentSourceInput

[Declaration source](mod.ts#L52)

```text
reference EnvironmentSourceInput: ./packages/env/types.ts:90:1
```

### root: InferEnvironment

[Declaration source](mod.ts#L53)

```text
reference InferEnvironment: ./packages/env/types.ts:140:1
```

### root: InferEnvironmentField

[Declaration source](mod.ts#L54)

```text
reference InferEnvironmentField: ./packages/env/types.ts:68:1
```

### root: InferEnvironmentFields

[Declaration source](mod.ts#L55)

```text
reference InferEnvironmentFields: ./packages/env/types.ts:71:1
```

## standard

Import `@okikio/env/standard`. [Source](./standard.ts).

### standard: ComposeEnvironmentFields

[Declaration source](standard.ts#L1)

```text
reference ComposeEnvironmentFields: ./packages/env/definition.ts:23:1
```

### standard: EnvironmentDefinition

[Declaration source](standard.ts#L7)

```text
reference EnvironmentDefinition: ./packages/env/types.ts:116:1
```

### standard: EnvironmentError

[Declaration source](standard.ts#L2)

```text
reference EnvironmentError: ./packages/env/error.ts:9:1
```

### standard: EnvironmentField

[Declaration source](standard.ts#L8)

```text
reference EnvironmentField: ./packages/env/types.ts:52:1
```

### standard: EnvironmentFieldKind

[Declaration source](standard.ts#L9)

```text
reference EnvironmentFieldKind: ./packages/env/types.ts:9:1
```

### standard: EnvironmentFieldMetadata

[Declaration source](standard.ts#L10)

```text
reference EnvironmentFieldMetadata: ./packages/env/types.ts:19:1
```

### standard: EnvironmentFieldMetadataInput

[Declaration source](standard.ts#L11)

```text
reference EnvironmentFieldMetadataInput: ./packages/env/types.ts:43:1
```

### standard: EnvironmentFields

[Declaration source](standard.ts#L12)

```text
reference EnvironmentFields: ./packages/env/types.ts:65:1
```

### standard: EnvironmentIssue

[Declaration source](standard.ts#L13)

```text
reference EnvironmentIssue: ./packages/env/types.ts:93:1
```

### standard: EnvironmentManifest

[Declaration source](standard.ts#L14)

```text
reference EnvironmentManifest: ./packages/env/types.ts:178:1
```

### standard: EnvironmentManifestField

[Declaration source](standard.ts#L15)

```text
reference EnvironmentManifestField: ./packages/env/types.ts:170:1
```

### standard: EnvironmentParseResult

[Declaration source](standard.ts#L16)

```text
reference EnvironmentParseResult: ./packages/env/types.ts:105:1
```

### standard: EnvironmentRecord

[Declaration source](standard.ts#L17)

```text
reference EnvironmentRecord: ./packages/env/types.ts:87:1
```

### standard: EnvironmentRequirement

[Declaration source](standard.ts#L18)

```text
reference EnvironmentRequirement: ./packages/env/types.ts:160:1
```

### standard: EnvironmentRequirementField

[Declaration source](standard.ts#L19)

```text
reference EnvironmentRequirementField: ./packages/env/types.ts:144:1
```

### standard: EnvironmentRequirementReason

[Declaration source](standard.ts#L20)

```text
reference EnvironmentRequirementReason: ./packages/env/types.ts:188:1
```

### standard: EnvironmentRequirementReportField

[Declaration source](standard.ts#L21)

```text
reference EnvironmentRequirementReportField: ./packages/env/types.ts:196:1
```

### standard: EnvironmentSource

[Declaration source](standard.ts#L22)

```text
reference EnvironmentSource: ./packages/env/types.ts:81:1
```

### standard: EnvironmentSourceInput

[Declaration source](standard.ts#L23)

```text
reference EnvironmentSourceInput: ./packages/env/types.ts:90:1
```

### standard: InferEnvironment

[Declaration source](standard.ts#L24)

```text
reference InferEnvironment: ./packages/env/types.ts:140:1
```

### standard: InferEnvironmentField

[Declaration source](standard.ts#L25)

```text
reference InferEnvironmentField: ./packages/env/types.ts:68:1
```

### standard: InferEnvironmentFields

[Declaration source](standard.ts#L26)

```text
reference InferEnvironmentFields: ./packages/env/types.ts:71:1
```

### standard: blank

[Declaration source](standard.ts#L4)

```text
reference blank: ./packages/env/value.ts:1:1
```

### standard: compose

[Declaration source](standard.ts#L0)

```text
reference compose: ./packages/env/definition.ts:310:1
```

### standard: define

[Declaration source](standard.ts#L0)

```text
reference define: ./packages/env/definition.ts:301:14
```

### standard: env

[Declaration source](standard.ts#L5)

```text
reference env: ./packages/env/source.ts:112:14
```

### standard: environment

[Declaration source](standard.ts#L0)

```text
reference environment: ./packages/env/definition.ts:254:1
```

### standard: example

[Declaration source](standard.ts#L3)

```text
reference example: ./packages/env/projection.ts:34:1
```

### standard: isSource

[Declaration source](standard.ts#L5)

```text
reference isSource: ./packages/env/source.ts:14:1
```

### standard: manifest

[Declaration source](standard.ts#L3)

```text
reference manifest: ./packages/env/projection.ts:14:1
```

### standard: merge

[Declaration source](standard.ts#L5)

```text
reference merge: ./packages/env/source.ts:71:1
```

### standard: record

[Declaration source](standard.ts#L5)

```text
reference record: ./packages/env/source.ts:36:1
```

### standard: requirement

[Declaration source](standard.ts#L0)

```text
reference requirement: ./packages/env/definition.ts:350:1
```

### standard: requirementReport

[Declaration source](standard.ts#L3)

```text
reference requirementReport: ./packages/env/projection.ts:61:1
```

### standard: secret

[Declaration source](standard.ts#L0)

```text
reference secret: ./packages/env/definition.ts:116:1
```

### standard: select

[Declaration source](standard.ts#L5)

```text
reference select: ./packages/env/source.ts:129:1
```

### standard: variable

[Declaration source](standard.ts#L0)

```text
reference variable: ./packages/env/definition.ts:108:1
```

## types

Import `@okikio/env/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                      |
| ------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1` | External declaration: `@standard-schema/spec/dist/index.d.ts` |

### types: EnvironmentDefinition

[Declaration source](types.ts#L116)

```text
interface EnvironmentDefinition<Fields extends EnvironmentFields = EnvironmentFields>
  Import-safe contract that validates raw environment values.

  Definitions do not read ambient state when they are created. A service or
  application composition root selects a source and passes it to one of the
  parse methods when startup actually occurs.

  readonly fields: Fields
    Canonical fields keyed by the external environment variable name.
  readonly keys: readonly string[]
    Stable declaration order used by parsing and deterministic projections.

    The runtime list is intentionally widened to `string[]`. Literal field names
    remain available through `fields`; coupling this iteration list to
    `keyof Fields` makes otherwise compatible definitions invariant in
    TypeScript and prevents projection and composition helpers from accepting
    concrete Zod, Valibot, or Standard Schema definitions.
  parse(source: EnvironmentSourceInput): Promise<InferEnvironmentFields<Fields>>
    Validate all fields, including schemas with asynchronous refinements.
  parseSync(source: EnvironmentSourceInput): InferEnvironmentFields<Fields>
    Validate all fields synchronously and reject asynchronous validators.
  safeParse(source: EnvironmentSourceInput): Promise<EnvironmentParseResult<InferEnvironmentFields<Fields>>>
    Validate asynchronously without throwing for ordinary schema issues.
  safeParseSync(source: EnvironmentSourceInput): EnvironmentParseResult<InferEnvironmentFields<Fields>>
    Validate synchronously without throwing for ordinary schema issues.
```

### types: EnvironmentField

[Declaration source](types.ts#L52)

```text
interface EnvironmentField<Schema extends StandardSchemaV1 = StandardSchemaV1, Kind extends EnvironmentFieldKind = EnvironmentFieldKind>
  Canonical schema-backed environment field.

  Field object identity is significant. Reusing the same field in several
  definitions is treated as intentional deduplication; independently creating
  two fields for the same key is rejected during composition.

  readonly kind: Kind
    Deployment classification for this value.
  readonly schema: Schema
    Original caller-owned validation schema.
  readonly metadata: EnvironmentFieldMetadata
    Normalized metadata used by documentation and deployment projections.
```

### types: EnvironmentFieldMetadata

[Declaration source](types.ts#L19)

```text
interface EnvironmentFieldMetadata
  Metadata that belongs to the environment binding rather than its validator.

  Schema-specific entrypoints can obtain these values from Zod or Valibot
  metadata. Explicit values supplied to `env.variable` or `env.secret` take
  precedence because one reusable schema can have a more specific meaning in a
  particular service.

  readonly title?: string
    Short name suitable for generated tables and deployment interfaces.
  readonly description: string
    Operator-facing explanation of what the value controls and why it exists.
  readonly example?: string
    Safe example used by `.env.example` projections for ordinary variables.
  readonly documentationUrl?: string
    External reference that explains how to obtain or configure the value.
  readonly availability?: readonly string[]
    Named deployment environments where the value is meaningful.
  readonly deprecated?: boolean
    Whether new deployments should stop defining this field.
  readonly replacement?: string
    Canonical replacement key when this field is deprecated.
```

### types: EnvironmentIssue

[Declaration source](types.ts#L93)

```text
interface EnvironmentIssue
  Normalized validation or composition issue.

  readonly key: string
    Environment key responsible for the failure.
  readonly message: string
    Human-readable explanation supplied by the schema or composition check.
  readonly path?: readonly PropertyKey[]
    Optional schema-relative path for structured values or transforms.
  readonly source: "missing" | "invalid" | "conflict"
    High-level failure category used by hosts and tests.
```

### types: EnvironmentManifest

[Declaration source](types.ts#L178)

```text
interface EnvironmentManifest
  Deterministic deployment and documentation projection.

  readonly version: 1
    Manifest format version.
  readonly variables: readonly EnvironmentManifestField[]
    Ordinary host variables ordered by key.
  readonly secrets: readonly EnvironmentManifestField[]
    Protected host secrets ordered by key.
```

### types: EnvironmentManifestField

[Declaration source](types.ts#L170)

```text
interface EnvironmentManifestField extends EnvironmentFieldMetadata
  One field in a generated environment manifest.

  readonly key: string
    External environment variable name.
  readonly kind: EnvironmentFieldKind
    Deployment classification used by the target host.
```

### types: EnvironmentRequirement

[Declaration source](types.ts#L160)

```text
interface EnvironmentRequirement<Fields extends EnvironmentFields = EnvironmentFields>
  Resource- or host-specific reasons for requiring environment fields.

  Requirements retain canonical field references. A report therefore cannot
  accidentally attach a reason from another definition that happens to reuse
  the same string key.

  readonly id: string
    Stable identifier for the resource, host, or deployment requirement.
  readonly environment: EnvironmentDefinition<Fields>
    Definition from which the selected fields originated.
  readonly fields: readonly EnvironmentRequirementField<Fields[keyof Fields]>[]
    Canonical selected fields and their operator-facing reasons.
```

### types: EnvironmentRequirementField

[Declaration source](types.ts#L144)

```text
interface EnvironmentRequirementField<Field extends EnvironmentField = EnvironmentField>
  One canonical field selected by a resource or host requirement.

  readonly key: string
    External environment key used by the selected definition.
  readonly field: Field
    Canonical field reference used to prevent string-only cross-definition joins.
  readonly reason: string
    Operator-facing explanation of why the resource needs this value.
```

### types: EnvironmentRequirementReason

[Declaration source](types.ts#L188)

```text
interface EnvironmentRequirementReason
  One reason attached to a field by a resource requirement.

  readonly requirementId: string
    Stable requirement identifier.
  readonly reason: string
    Explanation of why the requirement selects the field.
```

### types: EnvironmentRequirementReportField

[Declaration source](types.ts#L196)

```text
interface EnvironmentRequirementReportField extends EnvironmentManifestField
  Field metadata plus every imported requirement that depends on it.

  readonly requiredBy: readonly EnvironmentRequirementReason[]
    Requirements that reference this exact canonical field.
```

### types: EnvironmentSource

[Declaration source](types.ts#L81)

```text
interface EnvironmentSource
  Pull-based access to raw environment strings.

  The getter shape lets Deno retain per-key environment permissions and lets
  browser-compatible packages avoid importing a Node-only module.

  readonly get: (key: string) => string | undefined
    Return the raw value for `key`, or `undefined` when no source provides it.
```

### types: EnvironmentFieldKind

[Declaration source](types.ts#L9)

```text
type EnvironmentFieldKind = "variable" | "secret"
  Controls how a host must store and expose one environment value.

  A `variable` may be projected into ordinary deployment configuration. A
  `secret` must use the host's protected secret facility and is never emitted
  with an example value.
```

### types: EnvironmentFieldMetadataInput

[Declaration source](types.ts#L43)

```text
type EnvironmentFieldMetadataInput = Readonly<Partial<EnvironmentFieldMetadata>>
  Optional metadata accepted by schema-specific authoring helpers.

  Zod and Valibot may already provide some or all of these values. The adapter
  combines native schema metadata with this explicit override before creating
  the canonical field definition.
```

### types: EnvironmentFields

[Declaration source](types.ts#L65)

```text
type EnvironmentFields = Readonly<Record<string, EnvironmentField>>
  Named canonical fields accepted by a generic environment definition.
```

### types: EnvironmentParseResult

[Declaration source](types.ts#L105)

```text
type EnvironmentParseResult<Value> = Readonly<{ readonly success: true; readonly value: Value; }> | Readonly<{ readonly success: false; readonly issues: readonly EnvironmentIssue[]; }>
  Result returned by non-throwing parsing functions.
```

### types: EnvironmentRecord

[Declaration source](types.ts#L87)

```text
type EnvironmentRecord = Readonly<Record<string, string | undefined>>
  Plain-record input accepted wherever an environment source is accepted.
```

### types: EnvironmentSourceInput

[Declaration source](types.ts#L90)

```text
type EnvironmentSourceInput = EnvironmentSource | EnvironmentRecord
  Runtime input accepted by parsing and source-composition operations.
```

### types: InferEnvironment

[Declaration source](types.ts#L140)

```text
type InferEnvironment<Definition extends EnvironmentDefinition> = Definition extends EnvironmentDefinition<infer Fields> ? InferEnvironmentFields<Fields> : never
  Parsed output inferred from an environment definition.
```

### types: InferEnvironmentField

[Declaration source](types.ts#L68)

```text
type InferEnvironmentField<Field extends EnvironmentField> = StandardSchemaV1.InferOutput<Field["schema"]>
  Parsed output inferred from one field's Standard Schema implementation.
```

### types: InferEnvironmentFields

[Declaration source](types.ts#L71)

```text
type InferEnvironmentFields<Fields extends EnvironmentFields> = readonly [Key in keyof Fields]: InferEnvironmentField<Fields[Key]>
  Parsed output inferred from a complete field collection.
```

## valibot

Import `@okikio/env/valibot`. [Source](./valibot.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                    | Contract owner or source                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| `StandardSchemaV1`                  | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `blank`                             | [Source](value.ts)                                            |
| `GenericSchema`                     | External declaration: `valibot/dist/index.d.mts`              |
| `GenericSchemaAsync`                | External declaration: `valibot/dist/index.d.mts`              |
| `getDescription`                    | External declaration: `valibot/dist/index.d.mts`              |
| `getExamples`                       | External declaration: `valibot/dist/index.d.mts`              |
| `getValibotMetadata`                | External declaration: `valibot/dist/index.d.mts`              |
| `getTitle`                          | External declaration: `valibot/dist/index.d.mts`              |
| `composeStandard`                   | [Source](definition.ts)                                       |
| `defineEnvironmentField`            | [Source](definition.ts)                                       |
| `environmentStandard`               | [Source](definition.ts)                                       |
| `requirement`                       | [Source](definition.ts)                                       |
| `EnvironmentError`                  | [Source](error.ts)                                            |
| `resolveMetadata`                   | [Source](metadata.ts)                                         |
| `example`                           | [Source](projection.ts)                                       |
| `manifest`                          | [Source](projection.ts)                                       |
| `requirementReport`                 | [Source](projection.ts)                                       |
| `recordCore`                        | [record contracts](../record/API.md)                          |
| `env`                               | [Source](source.ts)                                           |
| `isSource`                          | [Source](source.ts)                                           |
| `merge`                             | [Source](source.ts)                                           |
| `record`                            | [Source](source.ts)                                           |
| `select`                            | [Source](source.ts)                                           |
| `EnvironmentDefinition`             | [Source](types.ts)                                            |
| `EnvironmentField`                  | [Source](types.ts)                                            |
| `EnvironmentFieldKind`              | [Source](types.ts)                                            |
| `EnvironmentFieldMetadata`          | [Source](types.ts)                                            |
| `EnvironmentFieldMetadataInput`     | [Source](types.ts)                                            |
| `EnvironmentFields`                 | [Source](types.ts)                                            |
| `EnvironmentIssue`                  | [Source](types.ts)                                            |
| `EnvironmentManifest`               | [Source](types.ts)                                            |
| `EnvironmentManifestField`          | [Source](types.ts)                                            |
| `EnvironmentParseResult`            | [Source](types.ts)                                            |
| `EnvironmentRecord`                 | [Source](types.ts)                                            |
| `EnvironmentRequirement`            | [Source](types.ts)                                            |
| `EnvironmentRequirementField`       | [Source](types.ts)                                            |
| `EnvironmentRequirementReason`      | [Source](types.ts)                                            |
| `EnvironmentRequirementReportField` | [Source](types.ts)                                            |
| `EnvironmentSource`                 | [Source](types.ts)                                            |
| `EnvironmentSourceInput`            | [Source](types.ts)                                            |
| `InferEnvironment`                  | [Source](types.ts)                                            |
| `InferEnvironmentField`             | [Source](types.ts)                                            |
| `InferEnvironmentFields`            | [Source](types.ts)                                            |

### valibot: define

[Declaration source](valibot.ts#L173)

```text
function define<Inputs extends ValibotEnvironmentFieldInputs>(inputs: Inputs): EnvironmentDefinition<InferValibotEnvironmentFields<Inputs>>
  Descriptive alias for `environment()` in Valibot authoring code.
```

### valibot: environment

[Declaration source](valibot.ts#L162)

````text
function environment<Inputs extends ValibotEnvironmentFieldInputs>(inputs: Inputs): EnvironmentDefinition<InferValibotEnvironmentFields<Inputs>>
  Define a Valibot-backed environment while preserving each concrete schema.

  Bare schemas become ordinary variables. The adapter reads Valibot's public
  `title`, `description`, `metadata`, and `examples` pipeline annotations.

  @example
      Pure Valibot metadata

      ```ts
      import * as env from '@okikio/env/valibot';
      import * as v from 'valibot';

      const Port = v.pipe(
        v.string(),
        v.title('HTTP port'),
        v.description('Port used by the service listener.'),
        v.examples(['8787']),
      );
      const ServiceEnvironment = env.define({ PORT: Port });
      ```

  @example
      Explicit secret classification

      ```ts
      const DatabaseUrl = v.pipe(v.string(), v.description('PostgreSQL connection string.'));
      const ServiceEnvironment = env.define({ DATABASE_URL: env.secret(DatabaseUrl) });
      ```
````

### valibot: secret

[Declaration source](valibot.ts#L188)

```text
function secret<Schema extends ValibotEnvironmentSchema>(schema: Schema, metadataOverride?: EnvironmentFieldMetadataInput): EnvironmentField<Schema, "secret">
  Define Valibot-backed secret material without projecting schema examples.
```

### valibot: variable

[Declaration source](valibot.ts#L176)

```text
function variable<Schema extends ValibotEnvironmentSchema>(schema: Schema, metadataOverride?: EnvironmentFieldMetadataInput): EnvironmentField<Schema, "variable">
  Define an ordinary Valibot-backed deployment variable.
```

### valibot: compose

[Declaration source](valibot.ts#L200)

```text
const compose
  Compose Valibot-authored definitions through the shared canonical field protocol.
```

### valibot: InferValibotEnvironmentFields

[Declaration source](valibot.ts#L59)

```text
type InferValibotEnvironmentFields<Inputs extends ValibotEnvironmentFieldInputs> = readonly [Key in keyof Inputs]: Inputs[Key] extends EnvironmentField<infer Schema> ? EnvironmentField<Schema> : Inputs[Key] extends ValibotEnvironmentSchema ? EnvironmentField<Inputs[Key], "variable"> : never
  Canonical fields inferred from Valibot authoring inputs.
```

### valibot: ValibotEnvironmentFieldInput

[Declaration source](valibot.ts#L51)

```text
type ValibotEnvironmentFieldInput<Schema extends ValibotEnvironmentSchema = ValibotEnvironmentSchema> = Schema | EnvironmentField<Schema>
  A Valibot schema or an explicitly classified environment field.
```

### valibot: ValibotEnvironmentFieldInputs

[Declaration source](valibot.ts#L56)

```text
type ValibotEnvironmentFieldInputs = Readonly<Record<string, ValibotEnvironmentFieldInput>>
  Named inputs accepted by `env.define()` in the Valibot entrypoint.
```

### valibot: ValibotEnvironmentSchema

[Declaration source](valibot.ts#L46)

```text
type ValibotEnvironmentSchema<Input = unknown, Output = Input> = (GenericSchema<Input, Output> & StandardSchemaV1<Input, Output>) | (GenericSchemaAsync<Input, Output> & StandardSchemaV1<Input, Output>)
  Valibot schema accepted by the environment adapter.

  The concrete Valibot contract is retained because this entrypoint reads
  Valibot metadata. The Standard Schema intersection is the validation contract
  shared with the environment core.
```

### valibot: ComposeEnvironmentFields

[Declaration source](valibot.ts#L215)

```text
reference ComposeEnvironmentFields: ./packages/env/definition.ts:23:1
```

### valibot: EnvironmentDefinition

[Declaration source](valibot.ts#L217)

```text
reference EnvironmentDefinition: ./packages/env/types.ts:116:1
```

### valibot: EnvironmentError

[Declaration source](valibot.ts#L205)

```text
reference EnvironmentError: ./packages/env/error.ts:9:1
```

### valibot: EnvironmentField

[Declaration source](valibot.ts#L218)

```text
reference EnvironmentField: ./packages/env/types.ts:52:1
```

### valibot: EnvironmentFieldKind

[Declaration source](valibot.ts#L219)

```text
reference EnvironmentFieldKind: ./packages/env/types.ts:9:1
```

### valibot: EnvironmentFieldMetadata

[Declaration source](valibot.ts#L220)

```text
reference EnvironmentFieldMetadata: ./packages/env/types.ts:19:1
```

### valibot: EnvironmentFieldMetadataInput

[Declaration source](valibot.ts#L221)

```text
reference EnvironmentFieldMetadataInput: ./packages/env/types.ts:43:1
```

### valibot: EnvironmentFields

[Declaration source](valibot.ts#L222)

```text
reference EnvironmentFields: ./packages/env/types.ts:65:1
```

### valibot: EnvironmentIssue

[Declaration source](valibot.ts#L223)

```text
reference EnvironmentIssue: ./packages/env/types.ts:93:1
```

### valibot: EnvironmentManifest

[Declaration source](valibot.ts#L224)

```text
reference EnvironmentManifest: ./packages/env/types.ts:178:1
```

### valibot: EnvironmentManifestField

[Declaration source](valibot.ts#L225)

```text
reference EnvironmentManifestField: ./packages/env/types.ts:170:1
```

### valibot: EnvironmentParseResult

[Declaration source](valibot.ts#L226)

```text
reference EnvironmentParseResult: ./packages/env/types.ts:105:1
```

### valibot: EnvironmentRecord

[Declaration source](valibot.ts#L227)

```text
reference EnvironmentRecord: ./packages/env/types.ts:87:1
```

### valibot: EnvironmentRequirement

[Declaration source](valibot.ts#L228)

```text
reference EnvironmentRequirement: ./packages/env/types.ts:160:1
```

### valibot: EnvironmentRequirementField

[Declaration source](valibot.ts#L229)

```text
reference EnvironmentRequirementField: ./packages/env/types.ts:144:1
```

### valibot: EnvironmentRequirementReason

[Declaration source](valibot.ts#L230)

```text
reference EnvironmentRequirementReason: ./packages/env/types.ts:188:1
```

### valibot: EnvironmentRequirementReportField

[Declaration source](valibot.ts#L231)

```text
reference EnvironmentRequirementReportField: ./packages/env/types.ts:196:1
```

### valibot: EnvironmentSource

[Declaration source](valibot.ts#L232)

```text
reference EnvironmentSource: ./packages/env/types.ts:81:1
```

### valibot: EnvironmentSourceInput

[Declaration source](valibot.ts#L233)

```text
reference EnvironmentSourceInput: ./packages/env/types.ts:90:1
```

### valibot: InferEnvironment

[Declaration source](valibot.ts#L234)

```text
reference InferEnvironment: ./packages/env/types.ts:140:1
```

### valibot: InferEnvironmentField

[Declaration source](valibot.ts#L235)

```text
reference InferEnvironmentField: ./packages/env/types.ts:68:1
```

### valibot: InferEnvironmentFields

[Declaration source](valibot.ts#L236)

```text
reference InferEnvironmentFields: ./packages/env/types.ts:71:1
```

### valibot: blank

[Declaration source](valibot.ts#L203)

```text
reference blank: ./packages/env/value.ts:1:1
```

### valibot: env

[Declaration source](valibot.ts#L204)

```text
reference env: ./packages/env/source.ts:112:14
```

### valibot: example

[Declaration source](valibot.ts#L206)

```text
reference example: ./packages/env/projection.ts:34:1
```

### valibot: isSource

[Declaration source](valibot.ts#L207)

```text
reference isSource: ./packages/env/source.ts:14:1
```

### valibot: manifest

[Declaration source](valibot.ts#L208)

```text
reference manifest: ./packages/env/projection.ts:14:1
```

### valibot: merge

[Declaration source](valibot.ts#L209)

```text
reference merge: ./packages/env/source.ts:71:1
```

### valibot: record

[Declaration source](valibot.ts#L210)

```text
reference record: ./packages/env/source.ts:36:1
```

### valibot: requirement

[Declaration source](valibot.ts#L211)

```text
reference requirement: ./packages/env/definition.ts:350:1
```

### valibot: requirementReport

[Declaration source](valibot.ts#L212)

```text
reference requirementReport: ./packages/env/projection.ts:61:1
```

### valibot: select

[Declaration source](valibot.ts#L213)

```text
reference select: ./packages/env/source.ts:129:1
```

## zod

Import `@okikio/env/zod`. [Source](./zod.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                    | Contract owner or source                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| `StandardSchemaV1`                  | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `blank`                             | [Source](value.ts)                                            |
| `composeStandard`                   | [Source](definition.ts)                                       |
| `defineEnvironmentField`            | [Source](definition.ts)                                       |
| `environmentStandard`               | [Source](definition.ts)                                       |
| `requirement`                       | [Source](definition.ts)                                       |
| `EnvironmentError`                  | [Source](error.ts)                                            |
| `resolveMetadata`                   | [Source](metadata.ts)                                         |
| `example`                           | [Source](projection.ts)                                       |
| `manifest`                          | [Source](projection.ts)                                       |
| `requirementReport`                 | [Source](projection.ts)                                       |
| `recordCore`                        | [record contracts](../record/API.md)                          |
| `env`                               | [Source](source.ts)                                           |
| `isSource`                          | [Source](source.ts)                                           |
| `merge`                             | [Source](source.ts)                                           |
| `record`                            | [Source](source.ts)                                           |
| `select`                            | [Source](source.ts)                                           |
| `EnvironmentDefinition`             | [Source](types.ts)                                            |
| `EnvironmentField`                  | [Source](types.ts)                                            |
| `EnvironmentFieldKind`              | [Source](types.ts)                                            |
| `EnvironmentFieldMetadata`          | [Source](types.ts)                                            |
| `EnvironmentFieldMetadataInput`     | [Source](types.ts)                                            |
| `EnvironmentFields`                 | [Source](types.ts)                                            |
| `EnvironmentIssue`                  | [Source](types.ts)                                            |
| `EnvironmentManifest`               | [Source](types.ts)                                            |
| `EnvironmentManifestField`          | [Source](types.ts)                                            |
| `EnvironmentParseResult`            | [Source](types.ts)                                            |
| `EnvironmentRecord`                 | [Source](types.ts)                                            |
| `EnvironmentRequirement`            | [Source](types.ts)                                            |
| `EnvironmentRequirementField`       | [Source](types.ts)                                            |
| `EnvironmentRequirementReason`      | [Source](types.ts)                                            |
| `EnvironmentRequirementReportField` | [Source](types.ts)                                            |
| `EnvironmentSource`                 | [Source](types.ts)                                            |
| `EnvironmentSourceInput`            | [Source](types.ts)                                            |
| `InferEnvironment`                  | [Source](types.ts)                                            |
| `InferEnvironmentField`             | [Source](types.ts)                                            |
| `InferEnvironmentFields`            | [Source](types.ts)                                            |

### zod: define

[Declaration source](zod.ts#L158)

```text
function define<Inputs extends ZodEnvironmentFieldInputs>(inputs: Inputs): EnvironmentDefinition<InferZodEnvironmentFields<Inputs>>
  Descriptive alias for `environment()` in Zod authoring code.
```

### zod: environment

[Declaration source](zod.ts#L147)

````text
function environment<Inputs extends ZodEnvironmentFieldInputs>(inputs: Inputs): EnvironmentDefinition<InferZodEnvironmentFields<Inputs>>
  Define a Zod-backed environment while preserving each concrete schema.

  Bare schemas become ordinary variables and obtain metadata through Zod's
  public `.meta()`/`.describe()` API. Wrap a schema with `env.secret()` when the
  host must protect the raw value.

  @example
      Pure Zod metadata

      ```ts
      import * as env from '@okikio/env/zod';
      import { z } from 'zod';

      const ServiceEnvironment = env.define({
        PORT: z.coerce.number().int().positive().default(8787).meta({
          title: 'HTTP port',
          description: 'Port used by the service listener.',
          examples: ['8787'],
        }),
      });
      ```

  @example
      Explicit secret classification

      ```ts
      const ServiceEnvironment = env.define({
        DATABASE_URL: env.secret(z.string().min(1).describe('PostgreSQL connection string.')),
      });
      ```
````

### zod: secret

[Declaration source](zod.ts#L173)

```text
function secret<Schema extends ZodEnvironmentSchema>(schema: Schema, metadataOverride?: EnvironmentFieldMetadataInput): EnvironmentField<Schema, "secret">
  Define Zod-backed secret material without projecting schema examples.
```

### zod: variable

[Declaration source](zod.ts#L161)

```text
function variable<Schema extends ZodEnvironmentSchema>(schema: Schema, metadataOverride?: EnvironmentFieldMetadataInput): EnvironmentField<Schema, "variable">
  Define an ordinary Zod-backed deployment variable.
```

### zod: compose

[Declaration source](zod.ts#L185)

```text
const compose
  Compose Zod-authored definitions through the shared canonical field protocol.
```

### zod: ZodEnvironmentSchema

[Declaration source](zod.ts#L38)

```text
interface ZodEnvironmentSchema<Input = unknown, Output = Input> extends StandardSchemaV1<Input, Output>
  Zod 4 schema surface used by the environment metadata adapter.

  meta(): unknown
    Return metadata registered on this exact Zod schema instance.
```

### zod: InferZodEnvironmentFields

[Declaration source](zod.ts#L52)

```text
type InferZodEnvironmentFields<Inputs extends ZodEnvironmentFieldInputs> = readonly [Key in keyof Inputs]: Inputs[Key] extends EnvironmentField<infer Schema> ? EnvironmentField<Schema> : Inputs[Key] extends ZodEnvironmentSchema ? EnvironmentField<Inputs[Key], "variable"> : never
  Canonical fields inferred from Zod authoring inputs.
```

### zod: ZodEnvironmentFieldInput

[Declaration source](zod.ts#L44)

```text
type ZodEnvironmentFieldInput<Schema extends ZodEnvironmentSchema = ZodEnvironmentSchema> = Schema | EnvironmentField<Schema>
  A Zod schema or an explicitly classified environment field.
```

### zod: ZodEnvironmentFieldInputs

[Declaration source](zod.ts#L49)

```text
type ZodEnvironmentFieldInputs = Readonly<Record<string, ZodEnvironmentFieldInput>>
  Named inputs accepted by `env.define()` in the Zod entrypoint.
```

### zod: ComposeEnvironmentFields

[Declaration source](zod.ts#L200)

```text
reference ComposeEnvironmentFields: ./packages/env/definition.ts:23:1
```

### zod: EnvironmentDefinition

[Declaration source](zod.ts#L202)

```text
reference EnvironmentDefinition: ./packages/env/types.ts:116:1
```

### zod: EnvironmentError

[Declaration source](zod.ts#L190)

```text
reference EnvironmentError: ./packages/env/error.ts:9:1
```

### zod: EnvironmentField

[Declaration source](zod.ts#L203)

```text
reference EnvironmentField: ./packages/env/types.ts:52:1
```

### zod: EnvironmentFieldKind

[Declaration source](zod.ts#L204)

```text
reference EnvironmentFieldKind: ./packages/env/types.ts:9:1
```

### zod: EnvironmentFieldMetadata

[Declaration source](zod.ts#L205)

```text
reference EnvironmentFieldMetadata: ./packages/env/types.ts:19:1
```

### zod: EnvironmentFieldMetadataInput

[Declaration source](zod.ts#L206)

```text
reference EnvironmentFieldMetadataInput: ./packages/env/types.ts:43:1
```

### zod: EnvironmentFields

[Declaration source](zod.ts#L207)

```text
reference EnvironmentFields: ./packages/env/types.ts:65:1
```

### zod: EnvironmentIssue

[Declaration source](zod.ts#L208)

```text
reference EnvironmentIssue: ./packages/env/types.ts:93:1
```

### zod: EnvironmentManifest

[Declaration source](zod.ts#L209)

```text
reference EnvironmentManifest: ./packages/env/types.ts:178:1
```

### zod: EnvironmentManifestField

[Declaration source](zod.ts#L210)

```text
reference EnvironmentManifestField: ./packages/env/types.ts:170:1
```

### zod: EnvironmentParseResult

[Declaration source](zod.ts#L211)

```text
reference EnvironmentParseResult: ./packages/env/types.ts:105:1
```

### zod: EnvironmentRecord

[Declaration source](zod.ts#L212)

```text
reference EnvironmentRecord: ./packages/env/types.ts:87:1
```

### zod: EnvironmentRequirement

[Declaration source](zod.ts#L213)

```text
reference EnvironmentRequirement: ./packages/env/types.ts:160:1
```

### zod: EnvironmentRequirementField

[Declaration source](zod.ts#L214)

```text
reference EnvironmentRequirementField: ./packages/env/types.ts:144:1
```

### zod: EnvironmentRequirementReason

[Declaration source](zod.ts#L215)

```text
reference EnvironmentRequirementReason: ./packages/env/types.ts:188:1
```

### zod: EnvironmentRequirementReportField

[Declaration source](zod.ts#L216)

```text
reference EnvironmentRequirementReportField: ./packages/env/types.ts:196:1
```

### zod: EnvironmentSource

[Declaration source](zod.ts#L217)

```text
reference EnvironmentSource: ./packages/env/types.ts:81:1
```

### zod: EnvironmentSourceInput

[Declaration source](zod.ts#L218)

```text
reference EnvironmentSourceInput: ./packages/env/types.ts:90:1
```

### zod: InferEnvironment

[Declaration source](zod.ts#L219)

```text
reference InferEnvironment: ./packages/env/types.ts:140:1
```

### zod: InferEnvironmentField

[Declaration source](zod.ts#L220)

```text
reference InferEnvironmentField: ./packages/env/types.ts:68:1
```

### zod: InferEnvironmentFields

[Declaration source](zod.ts#L221)

```text
reference InferEnvironmentFields: ./packages/env/types.ts:71:1
```

### zod: blank

[Declaration source](zod.ts#L188)

```text
reference blank: ./packages/env/value.ts:1:1
```

### zod: env

[Declaration source](zod.ts#L189)

```text
reference env: ./packages/env/source.ts:112:14
```

### zod: example

[Declaration source](zod.ts#L191)

```text
reference example: ./packages/env/projection.ts:34:1
```

### zod: isSource

[Declaration source](zod.ts#L192)

```text
reference isSource: ./packages/env/source.ts:14:1
```

### zod: manifest

[Declaration source](zod.ts#L193)

```text
reference manifest: ./packages/env/projection.ts:14:1
```

### zod: merge

[Declaration source](zod.ts#L194)

```text
reference merge: ./packages/env/source.ts:71:1
```

### zod: record

[Declaration source](zod.ts#L195)

```text
reference record: ./packages/env/source.ts:36:1
```

### zod: requirement

[Declaration source](zod.ts#L196)

```text
reference requirement: ./packages/env/definition.ts:350:1
```

### zod: requirementReport

[Declaration source](zod.ts#L197)

```text
reference requirementReport: ./packages/env/projection.ts:61:1
```

### zod: select

[Declaration source](zod.ts#L198)

```text
reference select: ./packages/env/source.ts:129:1
```
