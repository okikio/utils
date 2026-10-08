# @okikio/capacity contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                      | Source                         | Reference             |
| --------------------------- | ------------------------------ | --------------------- |
| `@okikio/capacity`          | [./mod.ts](./mod.ts)           | [root](#root)         |
| `@okikio/capacity/standard` | [./standard.ts](./standard.ts) | [standard](#standard) |
| `@okikio/capacity/types`    | [./types.ts](./types.ts)       | [types](#types)       |

## root

Import `@okikio/capacity`. [Source](./mod.ts).

Reserve several scarce resources together. Separate counters can admit half of a request and leave work holding a
browser while it waits forever for an upload slot.

Use admission for local concurrency, then add units and constraints to describe relationships such as threads per core.
Reservations are atomic and waiting requests keep FIFO fairness. An impossible request fails before queueing. The caller
must release each lease and cancel waits when it no longer needs work. These counters govern one process; a cluster
needs an authoritative distributed adapter.

### root: acquire

[Declaration source](admission.ts#L67)

```text
async function acquire(admission: Admission, request: AdmissionRequest, cancellation?: AdmissionCancellation): Promise<AdmissionLease>
  Reserve every requested unit atomically or wait at the FIFO head until the full request fits.

  The third argument accepts either an `AbortSignal` or any operation object with
  a `signal`, including `@okikio/context` Context values.
```

### root: available

[Declaration source](admission.ts#L44)

```text
function available(admission: Admission): AdmissionLimits
  Return the currently unreserved units for every configured capacity name.
```

### root: create

[Declaration source](admission.ts#L29)

```text
function create(limits: AdmissionLimits, options: Readonly<{ readonly now?: () => number; }>): Admission
  Create one atomic FIFO admission pool from named non-negative integer limits.
```

### root: snapshot

[Declaration source](admission.ts#L50)

```text
function snapshot(admission: Admission): AdmissionSnapshot
  Return current limits, availability, and FIFO wait pressure.
```

### root: Admission

[Declaration source](mod.ts#L23)

```text
reference Admission: ./packages/capacity/types.ts:98:1
```

### root: AdmissionCancellation

[Declaration source](mod.ts#L24)

```text
reference AdmissionCancellation: ./packages/capacity/types.ts:104:1
```

### root: AdmissionLease

[Declaration source](mod.ts#L25)

```text
reference AdmissionLease: ./packages/capacity/types.ts:119:1
```

### root: AdmissionLimits

[Declaration source](mod.ts#L26)

```text
reference AdmissionLimits: ./packages/capacity/types.ts:92:1
```

### root: AdmissionRequest

[Declaration source](mod.ts#L27)

```text
reference AdmissionRequest: ./packages/capacity/types.ts:95:1
```

### root: AdmissionSnapshot

[Declaration source](mod.ts#L28)

```text
reference AdmissionSnapshot: ./packages/capacity/types.ts:107:1
```

### root: CapacityConstraint

[Declaration source](mod.ts#L29)

```text
reference CapacityConstraint: ./packages/capacity/types.ts:34:1
```

### root: CapacityDefinition

[Declaration source](mod.ts#L30)

```text
reference CapacityDefinition: ./packages/capacity/types.ts:51:1
```

### root: CapacityExceededError

[Declaration source](mod.ts#L21)

```text
reference CapacityExceededError: ./packages/capacity/standard.ts:23:1
```

### root: CapacityField

[Declaration source](mod.ts#L31)

```text
reference CapacityField: ./packages/capacity/types.ts:13:1
```

### root: CapacityFields

[Declaration source](mod.ts#L32)

```text
reference CapacityFields: ./packages/capacity/types.ts:26:1
```

### root: CapacityStatusType

[Declaration source](mod.ts#L33)

```text
reference CapacityStatusType: ./packages/capacity/types.ts:61:1
```

### root: CapacityUnit

[Declaration source](mod.ts#L34)

```text
reference CapacityUnit: ./packages/capacity/types.ts:3:1
```

### root: CapacityValues

[Declaration source](mod.ts#L35)

```text
reference CapacityValues: ./packages/capacity/types.ts:29:1
```

### root: CheckResult

[Declaration source](mod.ts#L36)

```text
reference CheckResult: ./packages/capacity/types.ts:82:1
```

### root: ConstraintResult

[Declaration source](mod.ts#L37)

```text
reference ConstraintResult: ./packages/capacity/types.ts:64:1
```

### root: MergeFields

[Declaration source](mod.ts#L38)

```text
reference MergeFields: ./packages/capacity/standard.ts:17:1
```

### root: assert

[Declaration source](mod.ts#L21)

```text
reference assert: ./packages/capacity/standard.ts:176:1
```

### root: check

[Declaration source](mod.ts#L21)

```text
reference check: ./packages/capacity/standard.ts:157:1
```

### root: compose

[Declaration source](mod.ts#L21)

```text
reference compose: ./packages/capacity/standard.ts:125:1
```

### root: constraint

[Declaration source](mod.ts#L21)

```text
reference constraint: ./packages/capacity/standard.ts:70:1
```

### root: define

[Declaration source](mod.ts#L21)

```text
reference define: ./packages/capacity/standard.ts:98:1
```

### root: field

[Declaration source](mod.ts#L21)

```text
reference field: ./packages/capacity/standard.ts:55:1
```

### root: unit

[Declaration source](mod.ts#L21)

```text
reference unit: ./packages/capacity/standard.ts:40:1
```

## standard

Import `@okikio/capacity/standard`. [Source](./standard.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding     | Contract owner or source                                      |
| -------------------- | ------------------------------------------------------------- |
| `StandardSchemaV1`   | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `recordCore`         | [record contracts](../record/API.md)                          |
| `schema`             | [schema contracts](../schema/API.md)                          |
| `CapacityConstraint` | [Source](types.ts)                                            |
| `CapacityDefinition` | [Source](types.ts)                                            |
| `CapacityField`      | [Source](types.ts)                                            |
| `CapacityFields`     | [Source](types.ts)                                            |
| `CapacityStatusType` | [Source](types.ts)                                            |
| `CapacityUnit`       | [Source](types.ts)                                            |
| `CapacityValues`     | [Source](types.ts)                                            |
| `CheckResult`        | [Source](types.ts)                                            |
| `ConstraintResult`   | [Source](types.ts)                                            |

### standard: assert

[Declaration source](standard.ts#L176)

```text
async function assert<DefinitionFields extends CapacityFields>(definition: CapacityDefinition<DefinitionFields>, input: Readonly<Record<string, unknown>>): Promise<CheckResult<CapacityValues<DefinitionFields>>>
  Validate values and throw only when one or more declared constraints are exceeded.
```

### standard: check

[Declaration source](standard.ts#L157)

```text
async function check<DefinitionFields extends CapacityFields>(definition: CapacityDefinition<DefinitionFields>, input: Readonly<Record<string, unknown>>): Promise<CheckResult<CapacityValues<DefinitionFields>>>
  Validate values and report whether each capacity relationship is satisfied, hit, or exceeded.
```

### standard: compose

[Declaration source](standard.ts#L125)

```text
function compose<Definitions extends readonly CapacityFields[]>(...definitions: [Key in keyof Definitions]: CapacityDefinition<Definitions[Key]>): CapacityDefinition<MergeFields<Definitions>>
  Compose definitions without creating a second semantic owner for the same field.

  Reusing the exact same field or constraint object is intentional deduplication.
  A same-name field or same-id constraint created independently is rejected.
```

### standard: constraint

[Declaration source](standard.ts#L70)

```text
function constraint<Value extends Readonly<Record<string, unknown>>, UnitType extends CapacityUnit>(input: Readonly<{ readonly id: string; readonly description: string; readonly unit: UnitType; readonly used: (value: Value) => number; readonly maximum: (value: Value) => number; }>): CapacityConstraint<Value, UnitType>
  Define one measurable relationship between used and maximum capacity.
```

### standard: define

[Declaration source](standard.ts#L98)

```text
function define<DefinitionFields extends CapacityFields>(fields: DefinitionFields, input: Readonly<{ readonly constraints?: readonly CapacityConstraint<CapacityValues<DefinitionFields>>[]; }>): CapacityDefinition<DefinitionFields>
  Create an import-safe capacity definition from canonical fields and constraints.
```

### standard: field

[Declaration source](standard.ts#L55)

```text
function field<Schema extends StandardSchemaV1, UnitType extends CapacityUnit>(valueSchema: Schema, valueUnit: UnitType, input: Readonly<{ readonly description: string; }>): CapacityField<Schema, UnitType>
  Attach a Standard Schema contract and meaning to one capacity field.
```

### standard: unit

[Declaration source](standard.ts#L40)

```text
function unit<Id extends string>(id: Id, input: Readonly<{ readonly description: string; readonly symbol?: string; }>): CapacityUnit<Id>
  Define one reusable unit without attaching it to a runtime resource.
```

### standard: CapacityExceededError

[Declaration source](standard.ts#L23)

```text
class CapacityExceededError extends RangeError
  Error raised when validated values exceed one or more declared capacity constraints.

  constructor(check: CheckResult)
    Create this CapacityExceededError from the explicit contract values supplied by its caller.
  readonly check: CheckResult
    Capacity check that rejected admission, including the exceeded fields.
```

### standard: MergeFields

[Declaration source](standard.ts#L17)

```text
type MergeFields<Definitions extends readonly CapacityFields[]> = Definitions extends readonly [infer Head extends CapacityFields, ...infer Tail extends readonly CapacityFields[]] ? Head & MergeFields<Tail> : Readonly<Record<never, never>>
  Compile composed capacity field records into one statically visible field contract.
```

### standard: Admission

[Declaration source](standard.ts#L259)

```text
reference Admission: ./packages/capacity/types.ts:98:1
```

### standard: AdmissionCancellation

[Declaration source](standard.ts#L260)

```text
reference AdmissionCancellation: ./packages/capacity/types.ts:104:1
```

### standard: AdmissionLease

[Declaration source](standard.ts#L261)

```text
reference AdmissionLease: ./packages/capacity/types.ts:119:1
```

### standard: AdmissionLimits

[Declaration source](standard.ts#L262)

```text
reference AdmissionLimits: ./packages/capacity/types.ts:92:1
```

### standard: AdmissionRequest

[Declaration source](standard.ts#L263)

```text
reference AdmissionRequest: ./packages/capacity/types.ts:95:1
```

### standard: AdmissionSnapshot

[Declaration source](standard.ts#L264)

```text
reference AdmissionSnapshot: ./packages/capacity/types.ts:107:1
```

### standard: CapacityConstraint

[Declaration source](standard.ts#L265)

```text
reference CapacityConstraint: ./packages/capacity/types.ts:34:1
```

### standard: CapacityDefinition

[Declaration source](standard.ts#L266)

```text
reference CapacityDefinition: ./packages/capacity/types.ts:51:1
```

### standard: CapacityField

[Declaration source](standard.ts#L267)

```text
reference CapacityField: ./packages/capacity/types.ts:13:1
```

### standard: CapacityFields

[Declaration source](standard.ts#L268)

```text
reference CapacityFields: ./packages/capacity/types.ts:26:1
```

### standard: CapacityStatusType

[Declaration source](standard.ts#L269)

```text
reference CapacityStatusType: ./packages/capacity/types.ts:61:1
```

### standard: CapacityUnit

[Declaration source](standard.ts#L270)

```text
reference CapacityUnit: ./packages/capacity/types.ts:3:1
```

### standard: CapacityValues

[Declaration source](standard.ts#L271)

```text
reference CapacityValues: ./packages/capacity/types.ts:29:1
```

### standard: CheckResult

[Declaration source](standard.ts#L272)

```text
reference CheckResult: ./packages/capacity/types.ts:82:1
```

### standard: ConstraintResult

[Declaration source](standard.ts#L273)

```text
reference ConstraintResult: ./packages/capacity/types.ts:64:1
```

## types

Import `@okikio/capacity/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                      |
| ------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1` | External declaration: `@standard-schema/spec/dist/index.d.ts` |

### types: Admission

[Declaration source](types.ts#L98)

```text
interface Admission
  Opaque owner of one set of named admission limits.

  readonly limits: AdmissionLimits
    Immutable limits configured when the admission pool was created.
```

### types: AdmissionLease

[Declaration source](types.ts#L119)

```text
interface AdmissionLease extends AsyncDisposable
  AdmissionLease returned after a named request is admitted.

  readonly request: AdmissionRequest
    Exact units reserved by this lease.
  release(): void
    Release the reservation. Repeated calls are safe.
```

### types: AdmissionSnapshot

[Declaration source](types.ts#L107)

```text
interface AdmissionSnapshot
  Live admission state used by diagnostics and runtime topology logs.

  readonly capacity: AdmissionLimits
    Configured total capacity by named dimension.
  readonly available: AdmissionLimits
    Remaining admission capacity without exceeding this admission maximum.
  readonly queuedRequests: number
    Number of acquisition requests currently waiting for capacity.
  readonly oldestWaitMs?: number
    Age in milliseconds of the oldest queued request, or zero when no request waits.
```

### types: CapacityConstraint

[Declaration source](types.ts#L34)

```text
interface CapacityConstraint<Value extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, UnitType extends CapacityUnit = CapacityUnit>
  One relationship that compares used capacity with the maximum valid capacity.

  readonly id: string
    Stable identifier for diagnostics and tests.
  readonly description: string
    Plain-English explanation of the relationship.
  readonly unit: UnitType
    CapacityUnit shared by `used` and `maximum`.
  readonly used: (value: Value) => number
    Return the amount currently used by this relationship.
  readonly maximum: (value: Value) => number
    Return the maximum amount allowed by this relationship.
```

### types: CapacityDefinition

[Declaration source](types.ts#L51)

```text
interface CapacityDefinition<DefinitionFields extends CapacityFields = CapacityFields>
  Import-safe capacity definition. It performs no I/O and reads no ambient state.

  readonly fields: DefinitionFields
    Canonical fields keyed by their stable value names.
  readonly keys: readonly (keyof DefinitionFields & string)[]
    Stable field order used by validation and projections.
  readonly constraints: readonly CapacityConstraint<CapacityValues<DefinitionFields>>[]
    Relationships evaluated after all fields validate.
```

### types: CapacityField

[Declaration source](types.ts#L13)

```text
interface CapacityField<Schema extends StandardSchemaV1 = StandardSchemaV1, UnitType extends CapacityUnit = CapacityUnit>
  One schema-backed value that participates in a capacity definition.

  readonly schema: Schema
    Standard Schema contract used to validate the value before constraints run.
  readonly unit: UnitType
    CapacityUnit used by this field.
  readonly description: string
    Plain-English explanation of the value.
```

### types: CapacityUnit

[Declaration source](types.ts#L3)

```text
interface CapacityUnit<Id extends string = string>
  Named unit used to explain what one capacity value measures.

  readonly id: Id
    Stable unit identifier used by generated diagnostics and documentation.
  readonly description: string
    Plain-English description of what the unit measures.
  readonly symbol?: string
    Optional short display symbol, such as `bytes`, `req`, or `slots`.
```

### types: CheckResult

[Declaration source](types.ts#L82)

```text
interface CheckResult<Value extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>
  Parsed values and every evaluated capacity relationship.

  readonly value: Value
    Normalized admission request used to evaluate all configured capacity dimensions.
  readonly status: CapacityStatusType
    Aggregate admission status after every declared capacity constraint is evaluated.
  readonly constraints: readonly ConstraintResult[]
    Per-dimension results that explain the aggregate admission decision.
```

### types: ConstraintResult

[Declaration source](types.ts#L64)

```text
interface ConstraintResult<UnitType extends CapacityUnit = CapacityUnit>
  Result for one evaluated constraint.

  readonly id: string
    Stable capacity dimension key used for requests, limits, and diagnostic snapshots.
  readonly description: string
    Human-readable constraint purpose used by documentation and diagnostics.
  readonly unit: UnitType
    Unit associated with the capacity dimension when the constraint is quantitative.
  readonly status: CapacityStatusType
    Whether this individual constraint currently admits the requested work.
  readonly used: number
    Current amount already consumed in this capacity dimension.
  readonly maximum: number
    Maximum simultaneous or retained values permitted by this constraint.
  readonly remaining: number
    Positive when capacity remains, zero when the limit is hit, negative when exceeded.
```

### types: AdmissionCancellation

[Declaration source](types.ts#L104)

```text
type AdmissionCancellation = AbortSignal | Readonly<{ readonly signal: AbortSignal; }>
  AdmissionCancellation input accepted by {@link acquire}. A Context can be passed directly.
```

### types: AdmissionLimits

[Declaration source](types.ts#L92)

```text
type AdmissionLimits = Readonly<Record<string, number>>
  Inputs accepted by one named atomic admission pool.
```

### types: AdmissionRequest

[Declaration source](types.ts#L95)

```text
type AdmissionRequest = Readonly<Record<string, number>>
  Units requested atomically from an admission pool.
```

### types: CapacityFields

[Declaration source](types.ts#L26)

```text
type CapacityFields = Readonly<Record<string, CapacityField>>
  Named fields accepted by a capacity definition.
```

### types: CapacityStatusType

[Declaration source](types.ts#L61)

```text
type CapacityStatusType = "satisfied" | "hit" | "exceeded"
  Overall or per-constraint capacity state.
```

### types: CapacityValues

[Declaration source](types.ts#L29)

```text
type CapacityValues<DefinitionFields extends CapacityFields> = readonly [Key in keyof DefinitionFields]: StandardSchemaV1.InferOutput<DefinitionFields[Key]["schema"]>
  Parsed values inferred from a set of capacity fields.
```
