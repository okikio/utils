# @okikio/activity contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                     | Source                       | Reference           |
| -------------------------- | ---------------------------- | ------------------- |
| `@okikio/activity`         | [./mod.ts](./mod.ts)         | [root](#root)       |
| `@okikio/activity/engine`  | [./engine.ts](./engine.ts)   | [engine](#engine)   |
| `@okikio/activity/local`   | [./local.ts](./local.ts)     | [local](#local)     |
| `@okikio/activity/process` | [./process.ts](./process.ts) | [process](#process) |
| `@okikio/activity/types`   | [./types.ts](./types.ts)     | [types](#types)     |
| `@okikio/activity/worker`  | [./worker.ts](./worker.ts)   | [worker](#worker)   |

## root

Import `@okikio/activity`. [Source](./mod.ts).

Turn a provider operation into a named, versioned unit of work with validated inputs, results and engine placement. A
plain function leaves every caller to repeat those checks and decide which runtime may run it.

Start with a direct local attempt, then register the same definition with a workflow executor. Add resource declarations
when the operation needs a browser or storage client; add permission requirements and effects when it changes
authoritative state. The activity owns its attempt context and borrows the collection. A Worker or process provider
changes execution location; it does not move live closures, sockets or promises. Dispatch and storage adapters still own
durable placement, leases and recovery.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                | Contract owner or source                       |
| ------------------------------- | ---------------------------------------------- |
| `catalogCore`                   | [catalog contracts](../catalog/API.md)         |
| `CatalogDefinitionInput`        | [catalog contracts](../catalog/API.md)         |
| `contextCore`                   | [context contracts](../context/API.md)         |
| `effectCore`                    | [effect contracts](../effect/API.md)           |
| `failureCore`                   | [failure contracts](../failure/API.md)         |
| `permissionCore`                | [permission contracts](../permission/API.md)   |
| `requirementCore`               | [requirement contracts](../requirement/API.md) |
| `RequirementDefinition`         | [requirement contracts](../requirement/API.md) |
| `resourceCore`                  | [resource contracts](../resource/API.md)       |
| `resilienceCore`                | [resilience contracts](../resilience/API.md)   |
| `resultCore`                    | [result contracts](../result/API.md)           |
| `schema`                        | [schema contracts](../schema/API.md)           |
| `workflow`                      | [workflow contracts](../workflow/API.md)       |
| `engineCore`                    | [Source](engine.ts)                            |
| `ActivityCatalog`               | [Source](types.ts)                             |
| `ActivityContext`               | [Source](types.ts)                             |
| `ActivityDefinition`            | [Source](types.ts)                             |
| `ActivityDocument`              | [Source](types.ts)                             |
| `ActivityFailures`              | [Source](types.ts)                             |
| `ActivityImplementation`        | [Source](types.ts)                             |
| `ActivityImplementationOptions` | [Source](types.ts)                             |
| `ActivityInput`                 | [Source](types.ts)                             |
| `ActivityOperation`             | [Source](types.ts)                             |
| `ActivityOptions`               | [Source](types.ts)                             |
| `ActivityRequestOptions`        | [Source](types.ts)                             |
| `ActivityResources`             | [Source](types.ts)                             |
| `ActivityResult`                | [Source](types.ts)                             |
| `ActivityRunOptions`            | [Source](types.ts)                             |
| `ActivitySelection`             | [Source](types.ts)                             |
| `ActivityTryResult`             | [Source](types.ts)                             |

### root: catalog

[Declaration source](mod.ts#L144)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, ActivityDefinition>>>(namespace: Namespace, entries: Entries): ActivityCatalog<Entries>
  Create a named immutable activity catalog.
```

### root: compose

[Declaration source](mod.ts#L163)

```text
function compose<Entry extends ActivityDefinition>(...input: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[]
  Compose activities, catalogs, selections, and nested arrays.
```

### root: define

[Declaration source](mod.ts#L103)

```text
function define<Authoring extends ActivityOptions>(input: Authoring): ActivityDefinition<Authoring>
  Define one immutable external-work contract.
```

### root: document

[Declaration source](mod.ts#L267)

```text
function document(input: CatalogDefinitionInput<ActivityDefinition>): readonly ActivityDocument[]
  Create deterministic JSON-safe activity documentation.
```

### root: implement

[Declaration source](mod.ts#L135)

```text
function implement<Activity extends ActivityDefinition>(definition: Activity, input: ActivityImplementationOptions<Activity>): ActivityImplementation<Activity>
  Bind concrete behavior to one exact activity contract without selecting placement.
```

### root: isFailure

[Declaration source](mod.ts#L259)

```text
function isFailure<Activity extends ActivityDefinition>(definition: Activity, reason: unknown): reason is ActivityFailures<Activity>
  Return whether a reason is one of an activity's exact declared failures.
```

### root: request

[Declaration source](mod.ts#L170)

```text
function request<Activity extends ActivityDefinition>(definition: Activity, input: ActivityInput<Activity>, options: ActivityRequestOptions): ActivityOperation<Activity>
  Create one serializable workflow request for an activity. No external work starts.
```

### root: run

[Declaration source](mod.ts#L209)

```text
async function run<Activity extends ActivityDefinition>(options: ActivityRunOptions<Activity>): Promise<ActivityResult<Activity>>
  Run one concrete activity attempt immediately in the current host.

  The attempt validates input/result schemas, applies direct active
  requirements, exposes every statically reachable permission only for later
  explicit checks, provides typed resource access, and disposes attempt-owned values.
  Resource declarations constrain the TypeScript dependency model. They do not
  sandbox untrusted implementation code at runtime.
```

### root: select

[Declaration source](mod.ts#L152)

```text
function select<Entries extends Readonly<Record<PropertyKey, ActivityDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: ActivityCatalog<Entries>, keys: Keys): ActivitySelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select a key-preserving activity catalog subset.
```

### root: try

[Declaration source](mod.ts#L179)

```text
function try<Activity extends ActivityDefinition>(definition: Activity, input: ActivityInput<Activity>, options: ActivityRequestOptions): workflow.WorkflowOperation<ActivityTryResult<Activity>, never>
  Create one workflow request that converts only declared failures into an explicit result.
```

### root: InvalidEngineError

[Declaration source](mod.ts#L66)

```text
class InvalidEngineError extends TypeError
  Error raised when a selected engine is not part of an activity placement.

  constructor(activityId: string, engineId: string)
    Create one placement defect that identifies both activity and incompatible engine.
  readonly activityId: string
    Stable activity ID whose attempt reached an incompatible engine.
  readonly engineId: string
    Engine ID carried by the invalid attempt.
```

### root: UndeclaredFailureError

[Declaration source](mod.ts#L82)

```text
class UndeclaredFailureError extends Error
  Error raised when an activity throws an expected failure it did not declare.

  constructor(activity: ActivityDefinition, failure: import("@okikio/failure").Occurrence)
    Create this UndeclaredFailureError from the explicit contract values supplied by its caller.
  readonly activity: ActivityDefinition
    Activity declaration or reference whose validated attempt is requested.
  readonly failure: import("@okikio/failure").Occurrence
    Expected failure data retained under its declared contract.
```

### root: ActivityCatalog

[Declaration source](mod.ts#L333)

```text
reference ActivityCatalog: ./packages/activity/types.ts:166:1
```

### root: ActivityContext

[Declaration source](mod.ts#L334)

```text
reference ActivityContext: ./packages/activity/types.ts:92:1
```

### root: ActivityDefinition

[Declaration source](mod.ts#L335)

```text
reference ActivityDefinition: ./packages/activity/types.ts:53:1
```

### root: ActivityDocument

[Declaration source](mod.ts#L336)

```text
reference ActivityDocument: ./packages/activity/types.ts:178:1
```

### root: ActivityFailures

[Declaration source](mod.ts#L337)

```text
reference ActivityFailures: ./packages/activity/types.ts:88:1
```

### root: ActivityImplementation

[Declaration source](mod.ts#L338)

```text
reference ActivityImplementation: ./packages/activity/types.ts:119:1
```

### root: ActivityImplementationOptions

[Declaration source](mod.ts#L339)

```text
reference ActivityImplementationOptions: ./packages/activity/types.ts:127:1
```

### root: ActivityInput

[Declaration source](mod.ts#L340)

```text
reference ActivityInput: ./packages/activity/types.ts:79:1
```

### root: ActivityOperation

[Declaration source](mod.ts#L341)

```text
reference ActivityOperation: ./packages/activity/types.ts:210:1
```

### root: ActivityOptions

[Declaration source](mod.ts#L342)

```text
reference ActivityOptions: ./packages/activity/types.ts:27:1
```

### root: ActivityRequestOptions

[Declaration source](mod.ts#L343)

```text
reference ActivityRequestOptions: ./packages/activity/types.ts:133:1
```

### root: ActivityResources

[Declaration source](mod.ts#L344)

```text
reference ActivityResources: ./packages/activity/types.ts:85:1
```

### root: ActivityResult

[Declaration source](mod.ts#L345)

```text
reference ActivityResult: ./packages/activity/types.ts:82:1
```

### root: ActivityRunOptions

[Declaration source](mod.ts#L346)

```text
reference ActivityRunOptions: ./packages/activity/types.ts:136:1
```

### root: ActivitySchema

[Declaration source](mod.ts#L347)

```text
reference ActivitySchema: ./packages/activity/types.ts:24:1
```

### root: ActivitySelection

[Declaration source](mod.ts#L348)

```text
reference ActivitySelection: ./packages/activity/types.ts:172:1
```

### root: ActivityTryResult

[Declaration source](mod.ts#L349)

```text
reference ActivityTryResult: ./packages/activity/types.ts:204:1
```

## engine

Import `@okikio/activity/engine`. [Source](./engine.ts).

Import-safe activity-engine definitions and deterministic placement choices.

An engine definition names an execution target. It is not a live process, Worker, extension context, or remote
connection. Live providers register an exact definition with a workflow Scheduler.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source               |
| ---------------------- | -------------------------------------- |
| `CatalogEntryIdentity` | [catalog contracts](../catalog/API.md) |

### engine: allow

[Declaration source](engine.ts#L80)

```text
function allow<Engine extends EngineDefinition>(engine: Engine): EngineChoiceType<Engine>
  Add one fallback engine after preferred candidates.
```

### engine: compose

[Declaration source](engine.ts#L103)

```text
function compose(...input: readonly EnginePlacementInputType[]): EnginePlacementType
  Flatten engine placement contributions while preserving authored priority.

  A required engine is exclusive. Preferred and allowed candidates can be
  combined. Duplicate exact definitions collapse to their strongest authored
  mode without changing the first occurrence order.
```

### engine: define

[Declaration source](engine.ts#L65)

```text
function define<Id extends string>(input: EngineOptions<Id>): EngineDefinition<Id>
  Define one immutable engine contract without starting a live host.
```

### engine: document

[Declaration source](engine.ts#L131)

```text
function document(input: EnginePlacementInputType): readonly EnginePlacementDocumentType[]
  Create deterministic documentation for one normalized placement.
```

### engine: oneOf

[Declaration source](engine.ts#L90)

```text
function oneOf(...input: readonly EnginePlacementInputType[]): EnginePlacementType
  Normalize one ordered engine selection and reject ambiguous declarations.
```

### engine: prefer

[Declaration source](engine.ts#L85)

```text
function prefer<Engine extends EngineDefinition>(engine: Engine): EngineChoiceType<Engine>
  Give one engine priority over allowed fallback candidates.
```

### engine: require

[Declaration source](engine.ts#L75)

```text
function require<Engine extends EngineDefinition>(engine: Engine): EngineChoiceType<Engine>
  Select one exact engine with no fallback.
```

### engine: EngineChoiceType

[Declaration source](engine.ts#L33)

```text
interface EngineChoiceType<Engine extends EngineDefinition = EngineDefinition>
  One immutable engine candidate before placement normalization.

  readonly kind: "activity-engine-choice"
    Stable discriminant for one engine-placement contribution.
  readonly mode: EngineChoiceModeType
    Selection strength used when the Scheduler chooses among live registrations.
  readonly engine: Engine
    Exact import-safe engine definition selected by this contribution.
```

### engine: EngineDefinition

[Declaration source](engine.ts#L12)

```text
interface EngineDefinition<Id extends string = string> extends CatalogEntryIdentity
  Immutable execution-target contract used by activity placement.

  readonly kind: "activity-engine"
    Stable discriminant that prevents placement values from being confused with other catalog entries.
  readonly id: Id
    Stable execution-target identity recorded in activity placement and Scheduler history.
  readonly description?: string
    Human-readable explanation of the execution environment this engine represents.
```

### engine: EngineOptions

[Declaration source](engine.ts#L22)

```text
interface EngineOptions<Id extends string = string>
  Options accepted by `engines.define()`.

  readonly id: Id
    Stable execution-target identity. It must remain unchanged across live provider generations.
  readonly description?: string
    Optional human-readable purpose used by documentation and diagnostics.
```

### engine: EnginePlacementDocumentType

[Declaration source](engine.ts#L57)

```text
interface EnginePlacementDocumentType
  JSON-safe placement documentation.

  readonly engine: string
    Stable engine ID safe to persist or expose in generated documentation.
  readonly mode: EngineChoiceModeType
    Selection strength associated with the documented engine.
```

### engine: EnginePlacementType

[Declaration source](engine.ts#L43)

```text
interface EnginePlacementType<Engine extends EngineDefinition = EngineDefinition>
  Ordered activity placement contract.

  readonly kind: "activity-engine-placement"
    Stable discriminant for one normalized engine-placement declaration.
  readonly choices: readonly EngineChoiceType<Engine>[]
    Ordered candidates retained in authored priority after duplicate normalization.
```

### engine: EngineChoiceModeType

[Declaration source](engine.ts#L30)

```text
type EngineChoiceModeType = "required" | "preferred" | "allowed"
  Selection meaning attached to one engine candidate.
```

### engine: EnginePlacementInputType

[Declaration source](engine.ts#L51)

```text
type EnginePlacementInputType = EngineChoiceType | EnginePlacementType | readonly EnginePlacementInputType[]
  Recursive input accepted where activity placement is declared.
```

## local

Import `@okikio/activity/local`. [Source](./local.ts).

Process-local activity engine provider.

The provider adapts exact activity implementations to the generic Workflow Scheduler engine protocol. It does not own
the Scheduler job, attempt number, retry policy, queue claim, or registration generation.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source                       |
| --------------------------- | ---------------------------------------------- |
| `context`                   | [context contracts](../context/API.md)         |
| `EffectEmitter`             | [effect contracts](../effect/API.md)           |
| `PermissionChecker`         | [permission contracts](../permission/API.md)   |
| `RequirementRuntime`        | [requirement contracts](../requirement/API.md) |
| `ResourceCollection`        | [resource contracts](../resource/API.md)       |
| `ActivityAttemptResultType` | [workflow contracts](../workflow/API.md)       |
| `EngineProvider`            | [workflow contracts](../workflow/API.md)       |
| `activity`                  | [Source](mod.ts)                               |
| `remote`                    | [Source](remote.ts)                            |
| `ActivityDefinition`        | [Source](types.ts)                             |
| `ActivityImplementation`    | [Source](types.ts)                             |
| `EngineDefinition`          | [Source](engine.ts)                            |

### local: create

[Declaration source](local.ts#L60)

```text
function create(options: LocalProviderOptions): EngineProvider
  Create one borrowed process-local engine provider.

  The returned provider owns no resource collection and starts no background
  worker. Every `run()` call executes one dispatch-owned attempt immediately.
```

### local: MissingActivityError

[Declaration source](local.ts#L39)

```text
class MissingActivityError extends Error
  Raised when a provider receives an activity it did not register.

  constructor(activityId: string, version: string)
    Create one configuration error for an activity/version the provider does not implement.
  readonly activityId: string
    Stable activity ID requested from this local provider.
  readonly version: string
    Activity contract version requested from this local provider.
```

### local: LocalProviderOptions

[Declaration source](local.ts#L21)

```text
interface LocalProviderOptions
  Options accepted by `local.create()`.

  readonly engine: EngineDefinition
    Exact engine definition represented by this local provider.
  readonly implementations: readonly ActivityImplementation[]
    Implementations available through this provider.
  readonly resources: ResourceCollection
    Borrowed resource collection shared by local attempts.
  readonly permission?: PermissionChecker
    Optional actor-specific permission evaluator.
  readonly effect?: EffectEmitter
    Optional authoritative effect owner.
  readonly requirements?: RequirementRuntime
    Generic requirement interpreters used by direct attempts and resources.
  readonly checkpoint?: () => Promise<void>
    Optional cooperative pause gate supplied by the host.
```

## process

Import `@okikio/activity/process`. [Source](./process.ts).

Activity engine providers backed by owned child processes.

The provider composes `@okikio/process`, `@okikio/process/channel`, and `@okikio/pool`. Those utilities keep ownership
of process lifecycle, framed correlation, and reusable host capacity. The Workflow Scheduler remains the only owner of
logical activity attempts and retries.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source                       |
| --------------------------- | ---------------------------------------------- |
| `contexts`                  | [context contracts](../context/API.md)         |
| `Context`                   | [context contracts](../context/API.md)         |
| `Owned`                     | [context contracts](../context/API.md)         |
| `EffectEmitter`             | [effect contracts](../effect/API.md)           |
| `PermissionChecker`         | [permission contracts](../permission/API.md)   |
| `pool`                      | [pool contracts](../pool/API.md)               |
| `Pool`                      | [pool contracts](../pool/API.md)               |
| `processes`                 | [process contracts](../process/API.md)         |
| `ProcessAdapter`            | [process contracts](../process/API.md)         |
| `Process`                   | [process contracts](../process/API.md)         |
| `StartOptionsType`          | [process contracts](../process/API.md)         |
| `channel`                   | [process contracts](../process/API.md)         |
| `ProcessChannel`            | [process contracts](../process/API.md)         |
| `RequirementRuntime`        | [requirement contracts](../requirement/API.md) |
| `ResourceCollection`        | [resource contracts](../resource/API.md)       |
| `ActivityAttemptControl`    | [workflow contracts](../workflow/API.md)       |
| `ActivityAttemptResultType` | [workflow contracts](../workflow/API.md)       |
| `ActivityAttemptType`       | [workflow contracts](../workflow/API.md)       |
| `EngineProvider`            | [workflow contracts](../workflow/API.md)       |
| `activity`                  | [Source](mod.ts)                               |
| `remote`                    | [Source](remote.ts)                            |
| `transport`                 | [Source](transport.ts)                         |
| `ActivityDefinition`        | [Source](types.ts)                             |
| `ActivityImplementation`    | [Source](types.ts)                             |
| `EngineDefinition`          | [Source](engine.ts)                            |

### process: create

[Declaration source](process.ts#L129)

```text
async function create(options: ProcessProviderOptions): Promise<ProcessProvider>
  Create one process-backed activity provider.

  `stdin` and `stdout` are reserved for the typed protocol. The caller may
  configure `stderr` for bounded diagnostics. A failed channel invalidates the
  corresponding pool value; process replacement remains pool-owned and logical
  retry remains Scheduler-owned.
```

### process: serve

[Declaration source](process.ts#L276)

```text
function serve(options: ProcessServeOptions): channel.ProcessServer
  Serve activity attempts over one child process's protocol streams.

  The returned channel server does not own the operating-system process. The
  executable chooses its own exit policy after `server.closed` resolves.
```

### process: MissingProcessActivityError

[Declaration source](process.ts#L329)

```text
class MissingProcessActivityError extends Error
  Expected configuration error when the child lacks one registered activity implementation.

  constructor(activityId: string, version: string)
    Create one configuration error when the child process lacks the requested activity implementation.
  readonly activityId: string
    Stable activity ID requested from this child process.
  readonly version: string
    Activity contract version requested from this child process.
```

[Declaration source](process.ts#L35)

```text
private interface Active
  Active attempt state required to answer child-to-parent reverse calls.

  readonly activity: ActivityDefinition
    Exact activity contract associated with this in-flight process request.
  readonly attempt: ActivityAttemptType
    Fenced Scheduler attempt whose reverse calls remain valid while this request is active.
  readonly control: ActivityAttemptControl
    Scheduler-owned controls used for heartbeats while this process request is active.
```

[Declaration source](process.ts#L45)

```text
private interface Host
  One reusable child process and its framed request endpoint.

  readonly ctx: Owned
    Stable lifetime for one pooled child-process host.
  readonly process: Process
    Owned child process whose stdin/stdout carry the activity protocol.
  readonly channel: ProcessChannel<ActivityAttemptType, transport.WireResultType>
    Framed correlated request channel layered above the owned child process.
  readonly active: Map<string, Active>
    Active child request map keyed by queue claim ID for reverse-call correlation.
  close(reason?: unknown): Promise<void>
    Idempotent authoritative teardown used for both leased and idle hosts.
```

### process: ProcessProvider

[Declaration source](process.ts#L94)

```text
interface ProcessProvider extends EngineProvider, AsyncDisposable
  Owned bounded process engine provider.

  stats(): ReturnType<Pool<Host>["stats"]>
    Return the current reusable process-host pool snapshot.
  drain(reason?: unknown): Promise<void>
    Stop new process-host acquisition and wait for leased hosts to return.
```

### process: ProcessProviderOptions

[Declaration source](process.ts#L62)

```text
interface ProcessProviderOptions
  Options for one bounded child-process activity provider.

  readonly ctx: Context
    Borrowed parent execution context for this process provider.
  readonly engine: EngineDefinition
    Engine identity associated with this process provider.
  readonly activities: readonly ActivityDefinition[]
    Exact activity definitions this process provider exposes to Scheduler placement.
  readonly adapter: ProcessAdapter
    Operating-system process adapter used to spawn each owned child host.
  readonly start: ProcessStartOptions
    Child-process start options applied to every reusable process host.
  readonly maximum: number
    Maximum simultaneous or retained values permitted by this process provider.
  readonly minimum?: number
    Minimum retained or pre-created values requested for this process provider.
  readonly maximumIdle?: number
    Maximum idle process hosts retained for reuse.
  readonly maximumIdleAge?: Temporal.Duration | Temporal.DurationLike | string
    Maximum duration an idle process host may remain retained before recycling.
  readonly acquireTimeout?: Temporal.Duration | Temporal.DurationLike | string
    Maximum wait for one reusable process host before acquisition fails.
  readonly maximumFrameBytes?: number
    Maximum UTF-8 bytes accepted in one framed protocol message.
  readonly permission?: PermissionChecker
    Optional local policy checker that answers reverse permission calls from child activities.
  readonly effect?: EffectEmitter
    Optional local effect owner that answers reverse effect calls from child activities.
  readonly observe?: (value: unknown, attempt: ActivityAttemptType) => void | Promise<void>
    Optional observer for non-authoritative notices emitted by child activities.
```

### process: ProcessServeOptions

[Declaration source](process.ts#L102)

```text
interface ProcessServeOptions
  Options used by one child executable while serving activity attempts.

  readonly engine: EngineDefinition
    Engine identity associated with this process serve.
  readonly implementations: readonly ActivityImplementation[]
    Exact activity implementations this child process can execute.
  readonly resources: ResourceCollection
    Resource definitions or collection available to this process serve.
  readonly input: ReadableStream<Uint8Array>
    Protocol input byte stream, normally the child process stdin.
  readonly output: WritableStream<Uint8Array>
    Protocol-only byte stream used for framed responses; diagnostics belong on stderr.
  readonly requirements?: RequirementRuntime
    Requirements owned directly by this process serve; reachable dependency requirements remain separate.
  readonly maximumChecks?: number
    Maximum logical permission checks accepted by one remote activity evaluation.
  readonly maximumFrameBytes?: number
    Maximum UTF-8 bytes accepted in one framed protocol message.
```

### process: ProcessStartOptions

[Declaration source](process.ts#L59)

```text
type ProcessStartOptions = Omit<StartOptionsType, "stdin" | "stdout">
  Child-process launch input controlled by the provider.
```

## types

Import `@okikio/activity/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding              | Contract owner or source                                      |
| ----------------------------- | ------------------------------------------------------------- |
| `StandardSchemaV1`            | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `Catalog`                     | [catalog contracts](../catalog/API.md)                        |
| `CatalogSelection`            | [catalog contracts](../catalog/API.md)                        |
| `CatalogDefinitionInput`      | [catalog contracts](../catalog/API.md)                        |
| `BaseContext`                 | [context contracts](../context/API.md)                        |
| `OwnedResources`              | [context contracts](../context/API.md)                        |
| `EffectDefinition`            | [effect contracts](../effect/API.md)                          |
| `EffectDefinitions`           | [effect contracts](../effect/API.md)                          |
| `EffectEmitter`               | [effect contracts](../effect/API.md)                          |
| `EffectRuntime`               | [effect contracts](../effect/API.md)                          |
| `FailureDefinition`           | [failure contracts](../failure/API.md)                        |
| `FailureOccurrence`           | [failure contracts](../failure/API.md)                        |
| `PermissionChecker`           | [permission contracts](../permission/API.md)                  |
| `PermissionRuntime`           | [permission contracts](../permission/API.md)                  |
| `ResourceCollection`          | [resource contracts](../resource/API.md)                      |
| `ResourceDefinition`          | [resource contracts](../resource/API.md)                      |
| `ResourceValue`               | [resource contracts](../resource/API.md)                      |
| `RequirementDefinition`       | [requirement contracts](../requirement/API.md)                |
| `RequirementDocument`         | [requirement contracts](../requirement/API.md)                |
| `RequirementInput`            | [requirement contracts](../requirement/API.md)                |
| `RequirementRuntime`          | [requirement contracts](../requirement/API.md)                |
| `ResilienceInput`             | [resilience contracts](../resilience/API.md)                  |
| `ResiliencePolicy`            | [resilience contracts](../resilience/API.md)                  |
| `ExplicitResult`              | [result contracts](../result/API.md)                          |
| `ActivityCommandOptions`      | [workflow contracts](../workflow/API.md)                      |
| `ActivityReference`           | [workflow contracts](../workflow/API.md)                      |
| `WorkflowOperation`           | [workflow contracts](../workflow/API.md)                      |
| `EngineDefinition`            | [Source](engine.ts)                                           |
| `EnginePlacementDocumentType` | [Source](engine.ts)                                           |
| `EnginePlacementInputType`    | [Source](engine.ts)                                           |
| `EnginePlacementType`         | [Source](engine.ts)                                           |

### types: ActivityContext

[Declaration source](types.ts#L92)

```text
interface ActivityContext<Activity extends ActivityDefinition = ActivityDefinition> extends BaseContext, OwnedResources
  One concrete local activity-attempt context.

  readonly permissions: PermissionRuntime
    Permission state for dynamic checks declared by this activity attempt.
  readonly effects: EffectRuntime
    Effect state that limits announcements to effects declared by this activity.
  readonly requirements: RequirementRuntime
    Active requirement runtime inherited by resource borrows inside this attempt.
  readonly activity: Activity
    Exact activity definition whose implementation is running.
  readonly engine: EngineDefinition
    Engine definition selected by the Scheduler for this attempt.
  readonly jobId: string
    Stable logical activity-job identity shared by every retry attempt.
  readonly attempt: number
    One-based attempt number assigned by the Scheduler.
  readonly input: ActivityInput<Activity>
    Schema-validated activity input.
  get(definition: Resource): Promise<ResourceValue<Resource>>
    Lazily acquire one resource declared by this activity under this attempt's active requirement scope.
  checkpoint(): Promise<void>
    Wait at one explicit cooperative pause point.
  heartbeat(value?: unknown): Promise<void>
    Report attempt liveness or provider-specific progress to the owning Scheduler.
```

### types: ActivityDefinition

[Declaration source](types.ts#L53)

```text
interface ActivityDefinition<Authoring extends ActivityOptions = ActivityOptions> extends ActivityReference
  Immutable external-work contract.

  readonly kind: "activity"
    Stable discriminant for this activity value.
  readonly version: Authoring["version"]
    Contract version used to distinguish incompatible activity shapes.
  readonly description?: string
    Human-readable activity purpose used by documentation and diagnostics.
  readonly input: Authoring["input"]
    Standard Schema contract that validates activity input before an attempt starts.
  readonly result: Authoring["result"]
    Standard Schema contract that validates successful activity output before completion.
  readonly failures: readonly FailureDefinition[]
    Expected failure definitions or data declared by this activity.
  readonly effects: readonly EffectDefinition[]
    Declared effect definitions or scoped effect state associated with this activity.
  readonly placement: EnginePlacementType
    Ordered engine placement declaration used before attempt dispatch.
  readonly resources: readonly ResourceDefinition[]
    Resource definitions or collection available to this activity.
  readonly requirements: readonly RequirementDefinition[]
    Direct requirements only. Use inspection utilities for reachable requirements.
  readonly resilience: readonly ResiliencePolicy[]
    Static resilience policies applied at the activity lifecycle.
```

### types: ActivityDocument

[Declaration source](types.ts#L178)

```text
interface ActivityDocument
  JSON-safe activity documentation.

  readonly id: string
    Stable external-work identity used by workflow instructions, providers, and documentation.
  readonly version: string
    Contract version used to distinguish incompatible activity shapes.
  readonly description?: string
    Human-readable activity purpose used by documentation and diagnostics.
  readonly inputVendor: string
    Standard Schema vendor reported by the input contract for documentation.
  readonly resultVendor: string
    Standard Schema vendor reported by the result contract for documentation.
  readonly failures: readonly string[]
    Expected failure definitions or data declared by this activity.
  readonly effects: readonly string[]
    Effect definitions that code in this activity may announce.
  readonly placement: readonly EnginePlacementDocumentType[]
    Ordered JSON-safe engine placement documentation.
  readonly resources: readonly string[]
    Resource definitions or collection available to this activity.
  readonly requirements: readonly RequirementDocument[]
    Requirements owned directly by this activity; reachable dependency requirements remain separate.
  readonly resilience: readonly string[]
    Static resilience policies applied at the activity lifecycle.
```

### types: ActivityImplementation

[Declaration source](types.ts#L119)

```text
interface ActivityImplementation<Activity extends ActivityDefinition = ActivityDefinition>
  Concrete behavior bound to one exact activity definition. Placement remains host-owned.

  readonly definition: Activity
    Exact definition this behavior implements.
  run(ctx: ActivityContext<Activity>): ActivityResult<Activity> | Promise<ActivityResult<Activity>>
    Perform one activity attempt with validated input and scoped resources.
```

### types: ActivityImplementationOptions

[Declaration source](types.ts#L127)

```text
interface ActivityImplementationOptions<Activity extends ActivityDefinition>
  Options accepted by `activities.implement()`.

  run: ActivityImplementation<Activity>["run"]
    Concrete activity behavior bound to the exact definition.
```

### types: ActivityOptions

[Declaration source](types.ts#L27)

```text
interface ActivityOptions
  Options accepted by `activities.define()`.

  readonly id: string
    Stable external-work identity used by workflow instructions, providers, and documentation.
  readonly version: string
    Contract version used to distinguish incompatible activity shapes.
  readonly description?: string
    Human-readable activity purpose used by documentation and diagnostics.
  readonly input: ActivitySchema
    Schema that validates activity input before execution.
  readonly result: ActivitySchema
    Schema that validates successful activity output.
  readonly failures?: CatalogDefinitionInput<FailureDefinition>
    Expected failure definitions or data declared by this activity.
  readonly effects?: EffectDefinitions
    One-way consequences this activity can announce.
  readonly placement: EnginePlacementInputType
    Ordered execution-target selection interpreted by the workflow Scheduler.
  readonly resources?: CatalogDefinitionInput<ResourceDefinition>
    Resource definitions or collection available to this activity.
  readonly requirements?: RequirementInput
    Requirements owned directly by this activity. Resource requirements stay on their resources.
  readonly resilience?: ResilienceInput
    Static resilience policies applied at the activity lifecycle.
```

### types: ActivityRequestOptions

[Declaration source](types.ts#L133)

```text
interface ActivityRequestOptions extends ActivityCommandOptions
  Options stored in one serializable workflow activity request.
```

### types: ActivityRunOptions

[Declaration source](types.ts#L136)

```text
interface ActivityRunOptions<Activity extends ActivityDefinition>
  Inputs accepted by direct `activities.run()`.

  readonly implementation: ActivityImplementation<Activity>
    Exact local implementation to invoke.
  readonly engine: EngineDefinition
    Engine identity recorded in the local attempt context.
  readonly input: unknown
    Untrusted input validated against the activity definition before work starts.
  readonly ctx: BaseContext
    Borrowed parent context that owns cancellation and timing above this attempt.
  readonly resources: ResourceCollection
    Borrowed resource collection used for declared lazy resource acquisition.
  readonly jobId: string
    Stable logical job identity supplied by the caller or Scheduler.
  readonly attempt: number
    Current one-based attempt number.
  readonly permission?: PermissionChecker
    Optional policy evaluator used by dynamic permission checks.
  readonly effect?: EffectEmitter
    Optional authoritative owner for declared effect announcements.
  readonly requirements?: RequirementRuntime
    Additional requirement-family interpreters available to this direct host.
  readonly admitted?: boolean
    Skip direct admission requirements when the owning Scheduler already applied them before placement.
  readonly heartbeat?: (value?: unknown) => void | Promise<void>
    Optional liveness callback owned by the activity-attempt authority.
  readonly checkpoint?: () => Promise<void>
    Optional cooperative pause gate supplied by the owning Task or remote host.
```

### types: ActivityCatalog

[Declaration source](types.ts#L166)

```text
type ActivityCatalog<Entries extends Readonly<Record<PropertyKey, ActivityDefinition>>> = Catalog<Entries[keyof Entries], Entries>
  Named activity catalog.
```

### types: ActivityFailures

[Declaration source](types.ts#L88)

```text
type ActivityFailures<Activity extends ActivityDefinition> = Activity["failures"][number] extends infer Failure extends FailureDefinition ? FailureOccurrence<Failure> : never
  Declared failure occurrence union inferred from an activity.
```

### types: ActivityInput

[Declaration source](types.ts#L79)

```text
type ActivityInput<Activity extends ActivityDefinition> = StandardSchemaV1.InferOutput<Activity["input"]>
  Input value inferred from an activity definition.
```

### types: ActivityOperation

[Declaration source](types.ts#L210)

```text
type ActivityOperation<Activity extends ActivityDefinition> = WorkflowOperation<ActivityResult<Activity>, ActivityFailures<Activity>>
  Yieldable workflow request for one activity.
```

### types: ActivityResources

[Declaration source](types.ts#L85)

```text
type ActivityResources<Activity extends ActivityDefinition> = Activity["resources"][number]
  Resource union declared by an activity.
```

### types: ActivityResult

[Declaration source](types.ts#L82)

```text
type ActivityResult<Activity extends ActivityDefinition> = StandardSchemaV1.InferOutput<Activity["result"]>
  Result value inferred from an activity definition.
```

### types: ActivitySchema

[Declaration source](types.ts#L24)

```text
type ActivitySchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>
  Standard Schema contract accepted by activity inputs and results.
```

### types: ActivitySelection

[Declaration source](types.ts#L172)

```text
type ActivitySelection<Entry extends ActivityDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>
  Key-preserving activity catalog selection.
```

### types: ActivityTryResult

[Declaration source](types.ts#L204)

```text
type ActivityTryResult<Activity extends ActivityDefinition> = ExplicitResult<ActivityResult<Activity>, ActivityFailures<Activity>>
  Explicit result returned by `activities.try()`.
```

## worker

Import `@okikio/activity/worker`. [Source](./worker.ts).

Activity engine providers backed by standard Web Workers.

The parent provider owns a bounded pool of Worker handles. The Workflow Scheduler still owns logical jobs, attempts,
retries, registration identity, queue claims, and terminal settlement. Worker messages carry only serializable attempt
data and reverse calls for authoritative host services.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source                       |
| --------------------------- | ---------------------------------------------- |
| `contexts`                  | [context contracts](../context/API.md)         |
| `Context`                   | [context contracts](../context/API.md)         |
| `Owned`                     | [context contracts](../context/API.md)         |
| `EffectEmitter`             | [effect contracts](../effect/API.md)           |
| `PermissionChecker`         | [permission contracts](../permission/API.md)   |
| `pool`                      | [pool contracts](../pool/API.md)               |
| `Pool`                      | [pool contracts](../pool/API.md)               |
| `RequirementRuntime`        | [requirement contracts](../requirement/API.md) |
| `ResourceCollection`        | [resource contracts](../resource/API.md)       |
| `workers`                   | [worker contracts](../worker/API.md)           |
| `RawWorkerScope`            | [worker contracts](../worker/API.md)           |
| `WorkerOpenOptions`         | [worker contracts](../worker/API.md)           |
| `WorkerServer`              | [worker contracts](../worker/API.md)           |
| `ActivityAttemptControl`    | [workflow contracts](../workflow/API.md)       |
| `ActivityAttemptResultType` | [workflow contracts](../workflow/API.md)       |
| `ActivityAttemptType`       | [workflow contracts](../workflow/API.md)       |
| `EngineProvider`            | [workflow contracts](../workflow/API.md)       |
| `activity`                  | [Source](mod.ts)                               |
| `remote`                    | [Source](remote.ts)                            |
| `transport`                 | [Source](transport.ts)                         |
| `ActivityDefinition`        | [Source](types.ts)                             |
| `ActivityImplementation`    | [Source](types.ts)                             |
| `EngineDefinition`          | [Source](engine.ts)                            |

### worker: create

[Declaration source](worker.ts#L120)

```text
async function create(options: WorkerProviderOptions): Promise<WorkerProvider>
  Create one owned Worker-backed activity provider.

  The provider creates Workers lazily through `@okikio/pool`. Disposing the
  provider drains the pool and stops every Worker it owns. A Worker fault or
  protocol fault invalidates only the lease that observed it; the Scheduler
  decides whether the logical activity job receives another attempt.
```

### worker: serve

[Declaration source](worker.ts#L274)

```text
function serve(options: WorkerServeOptions): WorkerServer
  Serve activity attempts inside a Worker module.

  The server borrows the supplied resource collection. Every attempt restores
  a fresh local context from the parent snapshot, then `activity.run()` owns
  the attempt-local child scope. Permission checks, declared effects, and
  heartbeats use reverse request/result calls to the Scheduler-owning host.
```

### worker: MissingWorkerActivityError

[Declaration source](worker.ts#L325)

```text
class MissingWorkerActivityError extends Error
  Error returned when the Worker does not own the requested implementation.

  constructor(activityId: string, version: string)
    Create one configuration error when the Worker lacks the requested activity implementation.
  readonly activityId: string
    Stable activity ID requested from this Worker.
  readonly version: string
    Contract version used to distinguish incompatible missing worker activity error shapes.
```

[Declaration source](worker.ts#L33)

```text
private interface Active
  Runtime values stored for one request while reverse calls remain valid.

  readonly activity: ActivityDefinition
    Exact activity contract associated with this in-flight Worker request.
  readonly attempt: ActivityAttemptType
    Fenced Scheduler attempt whose reverse calls remain valid while this request is active.
  readonly control: ActivityAttemptControl
    Scheduler-owned controls used for heartbeats while this Worker request is active.
```

[Declaration source](worker.ts#L43)

```text
private interface Host
  One reusable Worker plus the active attempt correlation it owns.

  readonly ctx: Owned
    Stable lifetime for one pooled Worker host. It outlives individual acquisitions.
  readonly worker: workers.WorkerHandle<ActivityAttemptType, transport.WireResultType>
    Correlated Worker transport owned for the full reusable host lifetime.
  readonly active: Map<string, Active>
    Active Worker request map keyed by queue claim ID for reverse-call correlation.
  close(reason?: unknown): Promise<void>
    Idempotent authoritative teardown used for both leased and idle hosts.
```

### worker: WorkerProvider

[Declaration source](worker.ts#L89)

```text
interface WorkerProvider extends EngineProvider, AsyncDisposable
  Owned bounded Worker engine provider.

  stats(): ReturnType<Pool<Host>["stats"]>
    Current process-local Worker pool counters.
  drain(reason?: unknown): Promise<void>
    Stop new acquisition, wait for active leases, and close retained Workers.
```

### worker: WorkerProviderOptions

[Declaration source](worker.ts#L55)

```text
interface WorkerProviderOptions
  Options for one bounded Worker engine provider.

  readonly ctx: Context
    Parent context that owns the Worker pool and every Worker it creates.
  readonly engine: EngineDefinition
    Exact engine definition advertised when this provider is registered.
  readonly activities: readonly ActivityDefinition[]
    Exact activity definitions the remote Worker can run.
  readonly module: URL
    Worker module that calls `workerProvider.serve()`.
  readonly maximum: number
    Maximum reusable Worker count.
  readonly minimum?: number
    Minimum retained or pre-created values requested for this worker provider.
  readonly maximumIdle?: number
    Maximum idle Worker hosts retained for reuse.
  readonly maximumIdleAge?: Temporal.Duration | Temporal.DurationLike | string
    Maximum duration an idle Worker host may remain retained before recycling.
  readonly acquireTimeout?: Temporal.Duration | Temporal.DurationLike | string
    Maximum wait for one reusable Worker host before acquisition fails.
  readonly shutdownMs?: number
    Grace period for cooperative Worker shutdown before forced termination.
  readonly name?: string
    Optional Worker name forwarded to the runtime for diagnostics.
  readonly create?: WorkerOpenOptions<unknown, unknown>["create"]
    Optional raw Worker factory used by tests or non-default Worker hosts.
  readonly permission?: PermissionChecker
    Authoritative permission evaluator used by remote reverse calls.
  readonly effect?: EffectEmitter
    Authoritative effect owner used by remote reverse calls.
  readonly observe?: (value: unknown, attempt: ActivityAttemptType) => void | Promise<void>
    Optional non-authoritative activity observation sink.
```

### worker: WorkerServeOptions

[Declaration source](worker.ts#L97)

```text
interface WorkerServeOptions
  Options used by one Worker module while serving activity attempts.

  readonly engine: EngineDefinition
    Engine identity associated with this worker serve.
  readonly implementations: readonly ActivityImplementation[]
    Exact activity implementations this Worker can execute.
  readonly resources: ResourceCollection
    Resource definitions or collection available to this worker serve.
  readonly requirements?: RequirementRuntime
    Requirements owned directly by this worker serve; reachable dependency requirements remain separate.
  readonly maximumChecks?: number
    Maximum permission leaves permitted in one logical reverse call.
  readonly scope?: RawWorkerScope
    Optional Worker global scope override used by tests or specialized hosts.
```
