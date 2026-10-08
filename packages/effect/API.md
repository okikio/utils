# @okikio/effect contracts

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
| `@okikio/effect`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/effect/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/effect`. [Source](./mod.ts).

Represent an externally visible fact separately from delivery. Logging that a file was saved does not prove an outbox or
billing ledger accepted that fact.

Create an occurrence without delivery when staging work, then emit it through an owner that accepts or rejects it. Add a
queue-backed emitter when the application needs delayed delivery. Stable keys let an authoritative sink deduplicate
retries; the utility cannot make arbitrary external side effects exactly once. Declared effects restrict what a scope
may emit, and cancellation after acceptance does not revoke the accepted fact.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source               |
| ------------------------ | -------------------------------------- |
| `catalogCore`            | [catalog contracts](../catalog/API.md) |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md) |
| `contextCore`            | [context contracts](../context/API.md) |
| `Context`                | [context contracts](../context/API.md) |
| `schema`                 | [schema contracts](../schema/API.md)   |
| `Queue`                  | [queue contracts](../queue/API.md)     |
| `QueueClaim`             | [queue contracts](../queue/API.md)     |
| `EffectCatalog`          | [Source](types.ts)                     |
| `EffectContext`          | [Source](types.ts)                     |
| `EffectCreateOptions`    | [Source](types.ts)                     |
| `EffectDefinition`       | [Source](types.ts)                     |
| `EffectDrainOptions`     | [Source](types.ts)                     |
| `EffectEmitter`          | [Source](types.ts)                     |
| `EffectEncoded`          | [Source](types.ts)                     |
| `EffectHandler`          | [Source](types.ts)                     |
| `EffectOccurrence`       | [Source](types.ts)                     |
| `EffectOptions`          | [Source](types.ts)                     |
| `EffectOutbox`           | [Source](types.ts)                     |
| `EffectOutboxOptions`    | [Source](types.ts)                     |
| `EffectReceiptType`      | [Source](types.ts)                     |
| `EffectRuntime`          | [Source](types.ts)                     |
| `EffectScopeOptions`     | [Source](types.ts)                     |
| `EffectSelection`        | [Source](types.ts)                     |
| `EffectValue`            | [Source](types.ts)                     |
| `EffectValueInput`       | [Source](types.ts)                     |

### root: catalog

[Declaration source](mod.ts#L131)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, EffectDefinition>>>(namespace: Namespace, entries: Entries): EffectCatalog<Entries>
  Create a named immutable effect catalog.
```

### root: compose

[Declaration source](mod.ts#L153)

```text
function compose<Entry extends EffectDefinition>(...input: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[]
  Compose effect definitions, catalogs, selections, and nested arrays.
```

### root: create

[Declaration source](mod.ts#L160)

```text
async function create<Effect extends EffectDefinition>(definition: Effect, value: EffectValueInput<Effect>, options: EffectCreateOptions): Promise<EffectOccurrence<Effect>>
  Create one schema-validated effect occurrence without delivering it.
```

### root: decode

[Declaration source](mod.ts#L263)

```text
async function decode<Entry extends EffectDefinition>(value: unknown, trusted: CatalogDefinitionInput<Entry>): Promise<EffectOccurrence<Entry>>
  Decode and validate a durable occurrence through trusted exact definitions.
```

### root: define

[Declaration source](mod.ts#L116)

```text
function define<Id extends string, ValueSchema extends import("./types.ts").EffectSchema>(input: EffectOptions<Id, ValueSchema>): EffectDefinition<Id, ValueSchema>
  Define one immutable effect contract that code may announce.
```

### root: emit

[Declaration source](mod.ts#L204)

```text
function emit<Effect extends EffectDefinition>(ctx: EffectContext, occurrence: EffectOccurrence<Effect>): Promise<EffectOccurrence<Effect>>
  Emit one already-created occurrence and wait until its exact owner accepts responsibility.
```

[Declaration source](mod.ts#L209)

```text
function emit<Effect extends EffectDefinition>(ctx: EffectContext, definition: Effect, value: EffectValueInput<Effect>, options: EffectCreateOptions): Promise<EffectOccurrence<Effect>>
  Create and emit one occurrence as a convenience for ordinary call sites.

  Execute the emit overload and return the exact accepted occurrence.
```

### root: emitter

[Declaration source](mod.ts#L367)

```text
function emitter(...handlers: readonly EffectHandler[]): EffectEmitter
  Create a direct effect emitter from exact handlers.

  Direct acceptance runs the handler before `emit()` resolves. Use this form
  when producer and effect owner share one process and no durable handoff is
  required.
```

### root: encode

[Declaration source](mod.ts#L256)

```text
async function encode(value: EffectOccurrence): Promise<EffectEncoded>
  Encode an occurrence after revalidating its durable value.
```

### root: implement

[Declaration source](mod.ts#L351)

```text
function implement<Effect extends EffectDefinition>(definition: Effect, accept: EffectHandler<Effect>["accept"]): EffectHandler<Effect>
  Bind one exact effect definition to its authoritative acceptance behavior.
```

### root: is

[Declaration source](mod.ts#L279)

```text
function is<Effect extends EffectDefinition>(value: unknown, definition: Effect): value is EffectOccurrence<Effect>
  Return whether a value is an occurrence of one exact effect definition.
```

### root: isOccurrence

[Declaration source](mod.ts#L274)

```text
function isOccurrence(value: unknown): value is EffectOccurrence
  Return whether a value is an effect occurrence created by this module instance.
```

### root: outbox

[Declaration source](mod.ts#L386)

```text
function outbox(options: EffectOutboxOptions): EffectOutbox
  Create a queue-backed effect outbox.

  Producer acceptance occurs when `queue.add()` commits the idempotent outbox
  item. `drain()` later claims that item and invokes the one exact handler. The
  injected queue remains caller-owned unless `disposeQueue` is true.
```

### root: scope

[Declaration source](mod.ts#L186)

```text
function scope<Base extends import("@okikio/context").Context>(ctx: Base, options: EffectScopeOptions): EffectContext<Base>
  Create an unowned effect-aware view of an existing execution context.

  The returned scope borrows the parent context, emitter, and effect
  declarations. It creates no hidden registry and owns no cleanup.
```

### root: select

[Declaration source](mod.ts#L142)

```text
function select<Entries extends Readonly<Record<PropertyKey, EffectDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: EffectCatalog<Entries>, keys: Keys): EffectSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select a key-preserving effect catalog subset.
```

### root: DuplicateEffectHandlerError

[Declaration source](mod.ts#L90)

```text
class DuplicateEffectHandlerError extends TypeError
  Error raised when two implementations claim authority for the same effect definition.

  constructor(definition: EffectDefinition)
    Create one configuration error for duplicate authoritative effect ownership.
  readonly definition: EffectDefinition
    Exact effect definition claimed by more than one authoritative handler.
```

### root: MissingEffectEmitterError

[Declaration source](mod.ts#L82)

```text
class MissingEffectEmitterError extends Error
  Error raised when effect emission has no configured authoritative owner.

  constructor()
```

### root: MissingEffectHandlerError

[Declaration source](mod.ts#L103)

```text
class MissingEffectHandlerError extends Error
  Error raised when an effect owner has no exact handler for a declared effect.

  constructor(definition: EffectDefinition)
    Create one execution error for a declared effect with no accepting handler.
  readonly definition: EffectDefinition
    Exact declared effect definition for which no authoritative handler exists.
```

### root: UndeclaredEffectError

[Declaration source](mod.ts#L69)

```text
class UndeclaredEffectError extends Error
  Error raised when runtime code emits an effect that was not declared by the execution scope.

  constructor(definition: EffectDefinition)
    Create one execution error for an undeclared effect announcement.
  readonly definition: EffectDefinition
    Exact effect definition that the active execution did not declare.
```

### root: UnknownEffectDefinitionError

[Declaration source](mod.ts#L56)

```text
class UnknownEffectDefinitionError extends TypeError
  Error raised when durable effect data references an unknown trusted definition.

  constructor(id: string)
    Create this UnknownEffectDefinitionError from the explicit contract values supplied by its caller.
  readonly id: string
    Stable identity used to correlate this contract or occurrence.
```

### root: EffectCatalog

[Declaration source](mod.ts#L511)

```text
reference EffectCatalog: ./packages/effect/types.ts:108:1
```

### root: EffectContext

[Declaration source](mod.ts#L512)

```text
reference EffectContext: ./packages/effect/types.ts:95:1
```

### root: EffectCreateOptions

[Declaration source](mod.ts#L513)

```text
reference EffectCreateOptions: ./packages/effect/types.ts:70:1
```

### root: EffectDefinition

[Declaration source](mod.ts#L514)

```text
reference EffectDefinition: ./packages/effect/types.ts:23:1
```

### root: EffectDefinitions

[Declaration source](mod.ts#L515)

```text
reference EffectDefinitions: ./packages/effect/types.ts:120:1
```

### root: EffectDrainOptions

[Declaration source](mod.ts#L516)

```text
reference EffectDrainOptions: ./packages/effect/types.ts:155:1
```

### root: EffectEmitter

[Declaration source](mod.ts#L517)

```text
reference EffectEmitter: ./packages/effect/types.ts:81:1
```

### root: EffectEncoded

[Declaration source](mod.ts#L518)

```text
reference EffectEncoded: ./packages/effect/types.ts:60:1
```

### root: EffectHandler

[Declaration source](mod.ts#L519)

```text
reference EffectHandler: ./packages/effect/types.ts:123:1
```

### root: EffectOccurrence

[Declaration source](mod.ts#L520)

```text
reference EffectOccurrence: ./packages/effect/types.ts:48:1
```

### root: EffectOptions

[Declaration source](mod.ts#L521)

```text
reference EffectOptions: ./packages/effect/types.ts:13:1
```

### root: EffectOutbox

[Declaration source](mod.ts#L522)

```text
reference EffectOutbox: ./packages/effect/types.ts:177:1
```

### root: EffectOutboxOptions

[Declaration source](mod.ts#L523)

```text
reference EffectOutboxOptions: ./packages/effect/types.ts:139:1
```

### root: EffectReceiptType

[Declaration source](mod.ts#L524)

```text
reference EffectReceiptType: ./packages/effect/types.ts:131:1
```

### root: EffectRuntime

[Declaration source](mod.ts#L525)

```text
reference EffectRuntime: ./packages/effect/types.ts:87:1
```

### root: EffectScopeOptions

[Declaration source](mod.ts#L526)

```text
reference EffectScopeOptions: ./packages/effect/types.ts:100:1
```

### root: EffectSelection

[Declaration source](mod.ts#L527)

```text
reference EffectSelection: ./packages/effect/types.ts:114:1
```

### root: EffectValue

[Declaration source](mod.ts#L528)

```text
reference EffectValue: ./packages/effect/types.ts:39:1
```

### root: EffectValueInput

[Declaration source](mod.ts#L529)

```text
reference EffectValueInput: ./packages/effect/types.ts:36:1
```

## types

Import `@okikio/effect/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source                                      |
| ------------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1`       | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `Catalog`                | [catalog contracts](../catalog/API.md)                        |
| `CatalogEntryIdentity`   | [catalog contracts](../catalog/API.md)                        |
| `CatalogSelection`       | [catalog contracts](../catalog/API.md)                        |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md)                        |
| `BaseContext`            | [context contracts](../context/API.md)                        |

### types: EffectCreateOptions

[Declaration source](types.ts#L70)

```text
interface EffectCreateOptions
  Options accepted by `effects.create()` and the convenience `emit()` form.

  readonly key: string
    Stable key for this logical consequence within the owning execution.
```

### types: EffectDefinition

[Declaration source](types.ts#L23)

```text
interface EffectDefinition<Id extends string = string, ValueSchema extends EffectSchema = EffectSchema> extends CatalogEntryIdentity
  Immutable declaration of one one-way consequence that code may announce.

  readonly kind: "effect"
    Stable discriminant for one declared effect contract.
  readonly id: Id
    Stable effect identity used by emitters, outboxes, and exact handlers.
  readonly description?: string
    Human-readable consequence meaning used by documentation and diagnostics.
  readonly value: ValueSchema
    Schema that owns validation of the effect value.
```

### types: EffectDrainOptions

[Declaration source](types.ts#L155)

```text
interface EffectDrainOptions
  Options accepted while draining one bounded batch from an outbox.

  readonly owner?: string
    Claim owner identity used for this drain pass.
  readonly limit?: number
    Maximum queued effects claimed during this pass.
  readonly duration?: Temporal.Duration | Temporal.DurationLike | string
    Lease duration for each claimed effect while a handler owns it.
```

### types: EffectDrainResultType

[Declaration source](types.ts#L165)

```text
interface EffectDrainResultType
  Outcome counters for one bounded outbox drain operation.

  readonly claimed: number
    Number of queue items claimed by this drain pass.
  readonly accepted: number
    Number of effects whose exact handlers accepted ownership.
  readonly retried: number
    Number of effects returned for another bounded attempt.
  readonly failed: number
    Number of effects committed as terminal failures after retry exhaustion.
```

### types: EffectEmitter

[Declaration source](types.ts#L81)

```text
interface EffectEmitter
  Authoritative owner for declared effects when code announces an occurrence.

  Resolution means the owner accepted responsibility. It does not mean any
  downstream work triggered by the effect has completed.

  emit(ctx: BaseContext, occurrence: EffectOccurrence): Promise<void>
    Accept ownership of one occurrence or reject before ownership transfer completes.
```

### types: EffectEncoded

[Declaration source](types.ts#L60)

```text
interface EffectEncoded
  Durable effect envelope that can cross a process, Worker, queue, or store.

  readonly id: string
    Stable effect definition ID resolved by the receiving host.
  readonly key: string
    Retry-stable logical consequence key.
  readonly value: unknown
    Cloneable effect value that the receiving definition validates again.
```

### types: EffectHandler

[Declaration source](types.ts#L123)

```text
interface EffectHandler<Effect extends EffectDefinition = EffectDefinition>
  Exact implementation that accepts one effect definition.

  readonly definition: Effect
    Exact effect definition accepted by this handler.
  accept(ctx: BaseContext, occurrence: EffectOccurrence<Effect>): void | Promise<void>
    Accept one occurrence. Resolution is the authoritative ownership-transfer point.
```

### types: EffectOccurrence

[Declaration source](types.ts#L48)

```text
interface EffectOccurrence<Effect extends EffectDefinition = EffectDefinition>
  One frozen occurrence of a declared effect.

  The caller-owned key identifies the same logical consequence across retries.
  It must not include an attempt number when a later attempt is retrying the
  same consequence.

  readonly kind: "effect-occurrence"
    Stable discriminant for one concrete consequence occurrence.
  readonly definition: Effect
    Exact effect definition whose handler must accept this consequence.
  readonly key: string
    Retry-stable logical identity. A retried attempt reuses the same key for the same consequence.
  readonly value: EffectValue<Effect>
    Schema-validated consequence data.
```

### types: EffectOptions

[Declaration source](types.ts#L13)

```text
interface EffectOptions<Id extends string = string, ValueSchema extends EffectSchema = EffectSchema>
  Options accepted by `effects.define()`.

  readonly id: Id
    Stable effect identity used for declarations, durable envelopes, and handler matching.
  readonly description?: string
    Human-readable consequence meaning used by documentation and diagnostics.
  readonly value: ValueSchema
    Schema that validates the concrete consequence data before ownership transfer.
```

### types: EffectOutbox

[Declaration source](types.ts#L177)

```text
interface EffectOutbox extends EffectEmitter, AsyncDisposable
  Queue-backed effect owner whose enqueue commit is the producer acceptance point.

  drain(ctx: BaseContext, options?: EffectDrainOptions): Promise<EffectDrainResultType>
    Claim and handle one bounded batch without changing producer acceptance semantics.
  close(reason?: unknown): Promise<void>
    Stop new outbox work and release resources owned by this outbox.
```

### types: EffectOutboxOptions

[Declaration source](types.ts#L139)

```text
interface EffectOutboxOptions
  Options accepted while creating a queue-backed effect outbox.

  readonly queue: import("@okikio/queue").Queue<EffectEncoded, EffectReceiptType>
    Queue that durably or locally owns admitted effect occurrences until terminal handling.
  readonly handlers: readonly EffectHandler[]
    Exact handlers available to accept queued effect definitions.
  readonly maximumAttempts?: number
    Maximum handler attempts before the queued effect enters failed terminal state.
  readonly retryDelay?: Temporal.Duration | Temporal.DurationLike | string
    Delay applied when an effect handler must retry.
  readonly disposeQueue?: boolean
    Close the injected queue when the outbox closes. Defaults to false.
  readonly identity?: (ctx: BaseContext, occurrence: EffectOccurrence) => string
    Override the stable queue idempotency key derived from context and effect identity.
```

### types: EffectReceiptType

[Declaration source](types.ts#L131)

```text
interface EffectReceiptType
  Successful terminal receipt stored after an outbox handler accepts one queued effect.

  readonly id: string
    Stable effect definition ID whose queued occurrence was accepted.
  readonly key: string
    Retry-stable occurrence key whose downstream ownership is now established.
```

### types: EffectRuntime

[Declaration source](types.ts#L87)

```text
interface EffectRuntime
  Declared-effect state attached to one local execution context.

  readonly emitter?: EffectEmitter
    Authoritative effect owner used by `effects.emit()` in this execution context.
  readonly effects: readonly EffectDefinition[]
    Exact effect definitions the active code declared it may emit.
```

### types: EffectScopeOptions

[Declaration source](types.ts#L100)

```text
interface EffectScopeOptions
  Options accepted by `effects.scope()`.

  readonly emitter?: EffectEmitter
    Effect owner. Omit only when emission must fail as unconfigured.
  readonly effects: CatalogDefinitionInput<EffectDefinition>
    Exact effect definitions that code in this scope can emit.
```

### types: EffectCatalog

[Declaration source](types.ts#L108)

```text
type EffectCatalog<Entries extends Readonly<Record<PropertyKey, EffectDefinition>>> = Catalog<Entries[keyof Entries], Entries>
  Named effect catalog.
```

### types: EffectContext

[Declaration source](types.ts#L95)

```text
type EffectContext<Base extends BaseContext = BaseContext> = Base & Readonly<{ readonly effects: EffectRuntime; }>
  Execution-context view with declared-effect delivery available.
```

### types: EffectDefinitions

[Declaration source](types.ts#L120)

```text
type EffectDefinitions = CatalogDefinitionInput<EffectDefinition>
  Recursive input accepted where effect definitions are declared.
```

### types: EffectSchema

[Declaration source](types.ts#L10)

```text
type EffectSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>
  Standard Schema contract used to validate one effect value.
```

### types: EffectSelection

[Declaration source](types.ts#L114)

```text
type EffectSelection<Entry extends EffectDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>
  Key-preserving effect catalog selection.
```

### types: EffectValue

[Declaration source](types.ts#L39)

```text
type EffectValue<Effect extends EffectDefinition> = StandardSchemaV1.InferOutput<Effect["value"]>
  Validated value carried by one occurrence.
```

### types: EffectValueInput

[Declaration source](types.ts#L36)

```text
type EffectValueInput<Effect extends EffectDefinition> = StandardSchemaV1.InferInput<Effect["value"]>
  Input accepted when creating one occurrence.
```
