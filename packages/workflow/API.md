# @okikio/workflow contracts

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
| `@okikio/workflow`          | [./mod.ts](./mod.ts)           | [root](#root)         |
| `@okikio/workflow/dispatch` | [./dispatch.ts](./dispatch.ts) | [dispatch](#dispatch) |
| `@okikio/workflow/history`  | [./history.ts](./history.ts)   | [history](#history)   |
| `@okikio/workflow/types`    | [./types.ts](./types.ts)       | [types](#types)       |

## root

Import `@okikio/workflow`. [Source](./mod.ts).

Resume a named sequence from recorded instruction completions and send activities to eligible executors. Retrying a long
function from its first line can repeat expensive work and duplicate an external commit.

Run the complete local dispatch example first, then select Worker or process activity providers without changing the
workflow definition. Share authoritative dispatch and history adapters before spreading execution across computers.
Placement selects an eligible engine and host; claims fence attempts. Replay records instruction outcomes, not live
stack frames, sockets or threads. External effects still need stable idempotency keys and an accepting sink. The
in-memory example survives replica replacement only while its owning process retains the stores.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                 | Contract owner or source                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| `StandardSchemaV1`               | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `encodeHex`                      | [External source](https://jsr.io/@std/encoding/1.0.11/hex.ts)              |
| `durationCore`                   | [duration contracts](../duration/API.md)                                   |
| `catalogCore`                    | [catalog contracts](../catalog/API.md)                                     |
| `CatalogDefinitionInput`         | [catalog contracts](../catalog/API.md)                                     |
| `contextCore`                    | [context contracts](../context/API.md)                                     |
| `effects`                        | [effect contracts](../effect/API.md)                                       |
| `failures`                       | [failure contracts](../failure/API.md)                                     |
| `faultCore`                      | [fault contracts](../fault/API.md)                                         |
| `requirement`                    | [requirement contracts](../requirement/API.md)                             |
| `result`                         | [result contracts](../result/API.md)                                       |
| `recordCore`                     | [record contracts](../record/API.md)                                       |
| `schema`                         | [schema contracts](../schema/API.md)                                       |
| `freezeAffinity`                 | [Source](affinity.ts)                                                      |
| `assert`                         | [Source](assert.ts)                                                        |
| `durable`                        | [Source](durable.ts)                                                       |
| `Branch`                         | [Source](branch.ts)                                                        |
| `kernelOperation`                | [Source](operation.ts)                                                     |
| `Reducer`                        | [Source](reducer.ts)                                                       |
| `retryCore`                      | [Source](retry.ts)                                                         |
| `MAX_ACTIVE_CHILDREN`            | [Source](scope.ts)                                                         |
| `Scope`                          | [Source](scope.ts)                                                         |
| `createActivityJobs`             | [Source](jobs.ts)                                                          |
| `SchedulerClosedError`           | [Source](jobs.ts)                                                          |
| `Cause`                          | [Source](kernel.ts)                                                        |
| `Exit`                           | [Source](kernel.ts)                                                        |
| `ActivityCommand`                | [Source](types.ts)                                                         |
| `ActivityCommandOptions`         | [Source](types.ts)                                                         |
| `ActivityReference`              | [Source](types.ts)                                                         |
| `ChildOptions`                   | [Source](types.ts)                                                         |
| `ChildWorkflowCommand`           | [Source](types.ts)                                                         |
| `Scheduler`                      | [Source](types.ts)                                                         |
| `SchedulerOptions`               | [Source](types.ts)                                                         |
| `WorkflowAnnotations`            | [Source](types.ts)                                                         |
| `WorkflowCancelled`              | [Source](types.ts)                                                         |
| `WorkflowCatalog`                | [Source](types.ts)                                                         |
| `WorkflowCommandOptions`         | [Source](types.ts)                                                         |
| `WorkflowCompletionAny`          | [Source](types.ts)                                                         |
| `WorkflowContext`                | [Source](types.ts)                                                         |
| `WorkflowContextOptions`         | [Source](types.ts)                                                         |
| `WorkflowControlInstruction`     | [Source](types.ts)                                                         |
| `WorkflowDeferCommand`           | [Source](types.ts)                                                         |
| `WorkflowDefinition`             | [Source](types.ts)                                                         |
| `WorkflowDocument`               | [Source](types.ts)                                                         |
| `WorkflowDurableValue`           | [Source](types.ts)                                                         |
| `WorkflowEffectCommand`          | [Source](types.ts)                                                         |
| `WorkflowFailure`                | [Source](types.ts)                                                         |
| `WorkflowFault`                  | [Source](types.ts)                                                         |
| `WorkflowImplementation`         | [Source](types.ts)                                                         |
| `WorkflowInstruction`            | [Source](types.ts)                                                         |
| `WorkflowInstructionDescription` | [Source](types.ts)                                                         |
| `WorkflowInstructionIdentity`    | [Source](types.ts)                                                         |
| `WorkflowMapEntry`               | [Source](types.ts)                                                         |
| `WorkflowMapInstruction`         | [Source](types.ts)                                                         |
| `WorkflowMapOptions`             | [Source](types.ts)                                                         |
| `WorkflowOperation`              | [Source](types.ts)                                                         |
| `WorkflowOperationFailures`      | [Source](types.ts)                                                         |
| `WorkflowOperations`             | [Source](types.ts)                                                         |
| `WorkflowOperationValues`        | [Source](types.ts)                                                         |
| `WorkflowOptions`                | [Source](types.ts)                                                         |
| `WorkflowParallelInstruction`    | [Source](types.ts)                                                         |
| `WorkflowParallelOptions`        | [Source](types.ts)                                                         |
| `WorkflowRaceInstruction`        | [Source](types.ts)                                                         |
| `WorkflowRaceOptions`            | [Source](types.ts)                                                         |
| `WorkflowRaceResult`             | [Source](types.ts)                                                         |
| `WorkflowReference`              | [Source](types.ts)                                                         |
| `WorkflowRetryInstruction`       | [Source](types.ts)                                                         |
| `WorkflowRetryOptions`           | [Source](types.ts)                                                         |
| `WorkflowRunOptions`             | [Source](types.ts)                                                         |
| `WorkflowSelection`              | [Source](types.ts)                                                         |
| `WorkflowSettledValues`          | [Source](types.ts)                                                         |
| `WorkflowSignal`                 | [Source](types.ts)                                                         |
| `WorkflowSleepCommand`           | [Source](types.ts)                                                         |
| `WorkflowSuccess`                | [Source](types.ts)                                                         |
| `WorkflowWaitCommand`            | [Source](types.ts)                                                         |

### root: activity

[Declaration source](mod.ts#L345)

```text
function activity<Value, Failure>(definition: ActivityReference, input: unknown, options: ActivityCommandOptions): WorkflowOperation<Value, Failure>
  Create an activity command without importing the activity package.
```

### root: cancelled

[Declaration source](mod.ts#L831)

```text
function cancelled(reason: unknown): WorkflowCancelled
  Create a cancelled completion.
```

### root: catalog

[Declaration source](mod.ts#L284)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, WorkflowDefinition>>>(namespace: Namespace, entries: Entries): WorkflowCatalog<Entries>
  Create a named immutable workflow catalog.
```

### root: child

[Declaration source](mod.ts#L402)

```text
function child<WorkflowDefinition extends WorkflowReference>(definition: WorkflowDefinition, input: import("./types.ts").WorkflowInput<WorkflowDefinition>, options: ChildOptions): WorkflowOperation<import("./types.ts").WorkflowResult<WorkflowDefinition>, import("./types.ts").WorkflowFailures<WorkflowDefinition>>
  Start or await one child workflow.
```

### root: compose

[Declaration source](mod.ts#L303)

```text
function compose<Entry extends WorkflowDefinition>(...input: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[]
  Compose workflows, catalogs, selections, and nested arrays.
```

### root: context

[Declaration source](mod.ts#L629)

```text
async function context<Workflow extends WorkflowDefinition>(options: WorkflowContextOptions<Workflow>): Promise<WorkflowContext<Workflow> & AsyncDisposable>
  Create a validated workflow context by deriving local cancellation from a parent context.
```

### root: continue

[Declaration source](mod.ts#L475)

```text
function continue<WorkflowInput>(input: WorkflowInput, options: WorkflowCommandOptions): WorkflowOperation<never>
  End the current run and request an atomic continuation with new input.
```

### root: defer

[Declaration source](mod.ts#L451)

```text
function defer(cleanup: WorkflowOperation<unknown, unknown>, options: WorkflowCommandOptions): WorkflowOperation<void>
  Register a cleanup operation that executes when the workflow scope closes.
```

### root: define

[Declaration source](mod.ts#L248)

```text
function define<Authoring extends WorkflowOptions>(input: Authoring): WorkflowDefinition<Authoring>
  Define one immutable workflow contract.
```

### root: describe

[Declaration source](mod.ts#L843)

```text
function describe(instruction: WorkflowInstruction, path: string): WorkflowInstructionDescription
  Describe one yielded instruction as JSON-safe durable history data.

  The description stores exact definition identities and serializable input,
  but it never stores schemas, generator objects, resource handles, or child
  operation closures. Control children are verified at their own deterministic
  paths when the interpreter enters them.
```

### root: document

[Declaration source](mod.ts#L874)

```text
function document(input: CatalogDefinitionInput<WorkflowDefinition>): readonly WorkflowDocument[]
  Create deterministic JSON-safe workflow documentation.
```

### root: effect

[Declaration source](mod.ts#L432)

```text
function effect<Effect_ extends effects.EffectDefinition>(definition: Effect_, value: effects.EffectValueInput<Effect_>, options: WorkflowCommandOptions): WorkflowOperation<void>
  Request one workflow-level effect announcement.

  The operation is deterministic data. Delivery happens only when the Scheduler
  interprets the instruction, and the operation completes only after the
  configured effect owner accepts responsibility.
```

### root: executor

[Declaration source](jobs.ts#L194)

```text
async function executor(options: ExecutorOptions): Promise<EngineRegistration>
  Start an activity executor that can run independently from a Scheduler.

  The executor compiles live provider behavior in its own host, advertises only
  serializable capabilities to dispatch storage, and claims no more than its
  registered capacity.
```

### root: failed

[Declaration source](mod.ts#L821)

```text
function failed<Failure>(failure: Failure): WorkflowFailure<Failure>
  Create a declared-failure completion.
```

### root: fault

[Declaration source](mod.ts#L826)

```text
function fault(reason: unknown): WorkflowFault
  Create an unexpected-fault completion.
```

### root: identify

[Declaration source](mod.ts#L865)

```text
async function identify(instruction: WorkflowInstruction, path: string): Promise<WorkflowInstructionIdentity>
  Create the stable SHA-256 identity used to compare replayed instructions.

  A durable adapter persists this identity before it dispatches external work.
  On replay, the adapter compares the newly yielded fingerprint with history.
  A mismatch is workflow divergence and must fail instead of dispatching new
  work under an old history position.
```

### root: implement

[Declaration source](mod.ts#L275)

```text
function implement<Workflow extends WorkflowDefinition>(definition: Workflow, program: WorkflowImplementation<Workflow>["program"]): WorkflowImplementation<Workflow>
  Bind one exact workflow definition to its deterministic generator program.
```

### root: map

[Declaration source](mod.ts#L547)

```text
function map<Item, Value, Failure>(items: readonly Item[], createOperation: (item: Item, index: number) => WorkflowOperation<Value, Failure>, options: WorkflowMapOptions<Item> & Readonly<{ readonly failure?: "fail-fast"; }>): WorkflowOperation<readonly Value[], Failure>
  Create and coordinate one bounded keyed operation for every input item.
```

[Declaration source](mod.ts#L553)

```text
function map<Item, Value, Failure>(items: readonly Item[], createOperation: (item: Item, index: number) => WorkflowOperation<Value, Failure>, options: WorkflowMapOptions<Item> & Readonly<{ readonly failure: "settle"; }>): WorkflowOperation<readonly result.Result<Value, Failure>[], never>
  Create bounded mapped operations and return explicit results for every item.

  Create either fail-fast or settled bounded mapping after overload resolution.
```

### root: operation

[Declaration source](mod.ts#L324)

```text
function operation<Value, Failure = never>(instruction: WorkflowInstruction): WorkflowOperation<Value, Failure>
  Create an author-facing operation backed by one instruction.
```

### root: parallel

[Declaration source](mod.ts#L492)

```text
function parallel<Values extends WorkflowOperations>(operations: Values, options?: WorkflowParallelOptions & Readonly<{ readonly failure?: "fail-fast"; }>): WorkflowOperation<WorkflowOperationValues<Values>, WorkflowOperationFailures<Values>>
  Coordinate keyed child operations in parallel.
```

[Declaration source](mod.ts#L497)

```text
function parallel<Values extends WorkflowOperations>(operations: Values, options: WorkflowParallelOptions & Readonly<{ readonly failure: "settle"; }>): WorkflowOperation<WorkflowSettledValues<Values>, never>
  Coordinate keyed child operations and return explicit results for every branch.

  Create either fail-fast or settled parallel coordination after overload resolution.
```

### root: race

[Declaration source](mod.ts#L525)

```text
function race<Values extends WorkflowOperations>(operations: Values, options: WorkflowRaceOptions): WorkflowOperation<WorkflowRaceResult<Values>, WorkflowOperationFailures<Values>>
  Return the first terminal keyed branch and cancel the others.
```

### root: retry

[Declaration source](mod.ts#L592)

```text
function retry<Value, Failure>(childOperation: WorkflowOperation<Value, Failure>, options: WorkflowRetryOptions): WorkflowOperation<Value, Failure>
  Repeat one operation according to one explicit maximum-attempt policy.
```

### root: run

[Declaration source](mod.ts#L666)

```text
async function run<Workflow extends WorkflowDefinition>(options: WorkflowRunOptions<Workflow>): Promise<import("./types.ts").WorkflowResult<Workflow>>
  Execute one workflow program through an instruction interpreter.
```

### root: scheduler

[Declaration source](mod.ts#L723)

```text
function scheduler(input: SchedulerOptions): Scheduler
  Create the standard workflow Scheduler.

  The Scheduler interprets control instructions, admits activity items to the
  configured dispatch owner, and delegates other leaf commands to the command
  host. Independent executors claim matching activity work from dispatch.
```

### root: select

[Declaration source](mod.ts#L292)

```text
function select<Entries extends Readonly<Record<PropertyKey, WorkflowDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: WorkflowCatalog<Entries>, keys: Keys): WorkflowSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select a key-preserving workflow catalog subset.
```

### root: signal

[Declaration source](mod.ts#L310)

```text
function signal<Value>(input: Readonly<{ readonly id: string; readonly description?: string; readonly value: StandardSchemaV1<unknown, Value>; }>): WorkflowSignal<Value>
  Define one immutable signal contract.
```

### root: sleep

[Declaration source](mod.ts#L366)

```text
function sleep(duration: Temporal.DurationLike | string, options: WorkflowCommandOptions): WorkflowOperation<Temporal.Instant>
  Wait for a durable duration.
```

### root: success

[Declaration source](mod.ts#L816)

```text
function success<Value>(value: Value): WorkflowSuccess<Value>
  Create a successful completion.
```

### root: wait

[Declaration source](mod.ts#L383)

```text
function wait<Value>(definition: WorkflowSignal<Value>, input: unknown, options: WorkflowCommandOptions): WorkflowOperation<Value>
  Wait for one matching signal value.
```

### root: CancelledError

[Declaration source](mod.ts#L178)

```text
class CancelledError extends Error
  Cancellation reported by a workflow interpreter.

  constructor(reason: unknown)
    Create this CancelledError from the explicit contract values supplied by its caller.
  readonly reason: unknown
    Caller or runtime reason retained for cancellation or failure diagnostics.
```

### root: CleanupFailureError

[Declaration source](mod.ts#L204)

```text
class CleanupFailureError extends Error
  Lifecycle defect containing primary work and one or more cleanup failures.

  constructor(primary: unknown, cleanupFailures: readonly unknown[])
    Create this CleanupFailureError from the explicit contract values supplied by its caller.
  readonly primary: unknown
    Primary selected interpretation or source occurrence.
  readonly cleanupFailures: readonly unknown[]
    Failures encountered while releasing owned resources; successful work does not erase them.
```

### root: CleanupInstructionError

[Declaration source](mod.ts#L220)

```text
class CleanupInstructionError extends Error
  Invalid workflow program behavior discovered while closing a generator.

  constructor(instruction: WorkflowInstruction)
    Create this CleanupInstructionError from the explicit contract values supplied by its caller.
  readonly instruction: WorkflowInstruction
    Serializable workflow instruction whose completion is owned by history and scheduling.
```

### root: ContinueAsNewError

[Declaration source](mod.ts#L191)

```text
class ContinueAsNewError extends Error
  Terminal continue-as-new request surfaced by an interpreter.

  constructor(input: unknown)
    Create this ContinueAsNewError from the explicit contract values supplied by its caller.
  readonly input: unknown
    Input supplied to this validated operation or interpretation.
```

### root: FaultError

[Declaration source](mod.ts#L165)

```text
class FaultError extends Error
  Unexpected fault reported by a workflow interpreter.

  constructor(fault: unknown)
    Create this FaultError from the explicit contract values supplied by its caller.
  readonly fault: unknown
    Unexpected diagnostic data projected for this boundary.
```

### root: SchedulerClosedError

[Declaration source](jobs.ts#L42)

```text
class SchedulerClosedError extends Error
  Raised when a caller uses a Scheduler after its owned lifetime has ended.

  constructor(reason?: unknown)
    Create one lifecycle error for work submitted after Scheduler shutdown.
  readonly reason: unknown
    Original Scheduler shutdown reason.
```

### root: ActivityAddOptions

[Declaration source](mod.ts#L1778)

```text
reference ActivityAddOptions: ./packages/workflow/types.ts:772:1
```

### root: ActivityAttemptControl

[Declaration source](mod.ts#L1779)

```text
reference ActivityAttemptControl: ./packages/workflow/types.ts:932:1
```

### root: ActivityAttemptResultType

[Declaration source](mod.ts#L1780)

```text
reference ActivityAttemptResultType: ./packages/workflow/types.ts:924:1
```

### root: ActivityAttemptType

[Declaration source](mod.ts#L1781)

```text
reference ActivityAttemptType: ./packages/workflow/types.ts:894:1
```

### root: ActivityClaimOptions

[Declaration source](mod.ts#L1782)

```text
reference ActivityClaimOptions: ./packages/workflow/types.ts:798:1
```

### root: ActivityClaimType

[Declaration source](mod.ts#L1783)

```text
reference ActivityClaimType: ./packages/workflow/types.ts:754:1
```

### root: ActivityCommand

[Declaration source](mod.ts#L1784)

```text
reference ActivityCommand: ./packages/workflow/types.ts:211:1
```

### root: ActivityCommandOptions

[Declaration source](mod.ts#L1785)

```text
reference ActivityCommandOptions: ./packages/workflow/types.ts:205:1
```

### root: ActivityDispatch

[Declaration source](mod.ts#L1786)

```text
reference ActivityDispatch: ./packages/workflow/types.ts:838:1
```

### root: ActivityDispatchStatsType

[Declaration source](mod.ts#L1787)

```text
reference ActivityDispatchStatsType: ./packages/workflow/types.ts:814:1
```

### root: ActivityJobResultType

[Declaration source](mod.ts#L1788)

```text
reference ActivityJobResultType: ./packages/workflow/types.ts:697:1
```

### root: ActivityJobType

[Declaration source](mod.ts#L1789)

```text
reference ActivityJobType: ./packages/workflow/types.ts:679:1
```

### root: ActivityOriginType

[Declaration source](mod.ts#L1790)

```text
reference ActivityOriginType: ./packages/workflow/types.ts:665:1
```

### root: ActivityRefType

[Declaration source](mod.ts#L1792)

```text
reference ActivityRefType: ./packages/workflow/types.ts:704:1
```

### root: ActivityReference

[Declaration source](mod.ts#L1791)

```text
reference ActivityReference: ./packages/workflow/types.ts:58:1
```

### root: ActivityRetryOptions

[Declaration source](mod.ts#L1793)

```text
reference ActivityRetryOptions: ./packages/workflow/types.ts:808:1
```

### root: ChildOptions

[Declaration source](mod.ts#L1794)

```text
reference ChildOptions: ./packages/workflow/types.ts:255:1
```

### root: ChildWorkflowCommand

[Declaration source](mod.ts#L1795)

```text
reference ChildWorkflowCommand: ./packages/workflow/types.ts:263:1
```

### root: ComputeType

[Declaration source](mod.ts#L1796)

```text
reference ComputeType: ./packages/workflow/types.ts:710:1
```

### root: EngineAffinityType

[Declaration source](mod.ts#L1797)

```text
reference EngineAffinityType: ./packages/workflow/types.ts:202:1
```

### root: EngineCapacityType

[Declaration source](mod.ts#L1798)

```text
reference EngineCapacityType: ./packages/workflow/types.ts:655:1
```

### root: EngineChoiceModeType

[Declaration source](mod.ts#L1799)

```text
reference EngineChoiceModeType: ./packages/workflow/types.ts:29:1
```

### root: EngineChoiceReference

[Declaration source](mod.ts#L1800)

```text
reference EngineChoiceReference: ./packages/workflow/types.ts:32:1
```

### root: EnginePlacementReference

[Declaration source](mod.ts#L1801)

```text
reference EnginePlacementReference: ./packages/workflow/types.ts:42:1
```

### root: EnginePlacementType

[Declaration source](mod.ts#L1802)

```text
reference EnginePlacementType: ./packages/workflow/types.ts:50:1
```

### root: EngineProvider

[Declaration source](mod.ts#L1803)

```text
reference EngineProvider: ./packages/workflow/types.ts:938:1
```

### root: EngineReference

[Declaration source](mod.ts#L1804)

```text
reference EngineReference: ./packages/workflow/types.ts:23:1
```

### root: EngineRegistration

[Declaration source](mod.ts#L1805)

```text
reference EngineRegistration: ./packages/workflow/types.ts:974:1
```

### root: EngineRegistrationOptions

[Declaration source](mod.ts#L1806)

```text
reference EngineRegistrationOptions: ./packages/workflow/types.ts:952:1
```

### root: ExecutorActivityType

[Declaration source](mod.ts#L1807)

```text
reference ExecutorActivityType: ./packages/workflow/types.ts:722:1
```

### root: ExecutorJoinOptions

[Declaration source](mod.ts#L1808)

```text
reference ExecutorJoinOptions: ./packages/workflow/types.ts:778:1
```

### root: ExecutorLeaseType

[Declaration source](mod.ts#L1809)

```text
reference ExecutorLeaseType: ./packages/workflow/types.ts:730:1
```

### root: ExecutorOptions

[Declaration source](mod.ts#L1810)

```text
reference ExecutorOptions: ./packages/workflow/types.ts:1032:1
```

### root: History

[Declaration source](mod.ts#L1811)

```text
reference History: ./packages/workflow/types.ts:615:1
```

### root: HistoryCompletionType

[Declaration source](mod.ts#L1812)

```text
reference HistoryCompletionType: ./packages/workflow/types.ts:583:1
```

### root: HistoryEntryType

[Declaration source](mod.ts#L1813)

```text
reference HistoryEntryType: ./packages/workflow/types.ts:635:1
```

### root: HistoryFailureOccurrenceType

[Declaration source](mod.ts#L1814)

```text
reference HistoryFailureOccurrenceType: ./packages/workflow/types.ts:568:1
```

### root: HistoryFailureType

[Declaration source](mod.ts#L1815)

```text
reference HistoryFailureType: ./packages/workflow/types.ts:578:1
```

### root: HistoryInput

[Declaration source](mod.ts#L1816)

```text
reference HistoryInput: ./packages/workflow/types.ts:590:1
```

### root: HistoryOptions

[Declaration source](mod.ts#L1817)

```text
reference HistoryOptions: ./packages/workflow/types.ts:629:1
```

### root: HistorySnapshotType

[Declaration source](mod.ts#L1818)

```text
reference HistorySnapshotType: ./packages/workflow/types.ts:647:1
```

### root: HistoryValueType

[Declaration source](mod.ts#L1819)

```text
reference HistoryValueType: ./packages/workflow/types.ts:563:1
```

### root: MemoryDispatchOptions

[Declaration source](mod.ts#L1820)

```text
reference MemoryDispatchOptions: ./packages/workflow/types.ts:884:1
```

### root: MemoryHistory

[Declaration source](mod.ts#L1821)

```text
reference MemoryHistory: ./packages/workflow/types.ts:623:1
```

### root: Scheduler

[Declaration source](mod.ts#L1822)

```text
reference Scheduler: ./packages/workflow/types.ts:1042:1
```

### root: SchedulerOptions

[Declaration source](mod.ts#L1823)

```text
reference SchedulerOptions: ./packages/workflow/types.ts:1006:1
```

### root: WorkflowAnnotations

[Declaration source](mod.ts#L1824)

```text
reference WorkflowAnnotations: ./packages/workflow/types.ts:165:1
```

### root: WorkflowCancelled

[Declaration source](mod.ts#L1825)

```text
reference WorkflowCancelled: ./packages/workflow/types.ts:483:1
```

### root: WorkflowCatalog

[Declaration source](mod.ts#L1826)

```text
reference WorkflowCatalog: ./packages/workflow/types.ts:1074:1
```

### root: WorkflowCommand

[Declaration source](mod.ts#L1827)

```text
reference WorkflowCommand: ./packages/workflow/types.ts:439:1
```

### root: WorkflowCommandBase

[Declaration source](mod.ts#L1828)

```text
reference WorkflowCommandBase: ./packages/workflow/types.ts:182:1
```

### root: WorkflowCommandHandler

[Declaration source](mod.ts#L1829)

```text
reference WorkflowCommandHandler: ./packages/workflow/types.ts:556:1
```

### root: WorkflowCommandOptions

[Declaration source](mod.ts#L1830)

```text
reference WorkflowCommandOptions: ./packages/workflow/types.ts:194:1
```

### root: WorkflowCompletion

[Declaration source](mod.ts#L1831)

```text
reference WorkflowCompletion: ./packages/workflow/types.ts:491:1
```

### root: WorkflowCompletionAny

[Declaration source](mod.ts#L1832)

```text
reference WorkflowCompletionAny: ./packages/workflow/types.ts:498:1
```

### root: WorkflowContext

[Declaration source](mod.ts#L1833)

```text
reference WorkflowContext: ./packages/workflow/types.ts:151:1
```

### root: WorkflowContextOptions

[Declaration source](mod.ts#L1834)

```text
reference WorkflowContextOptions: ./packages/workflow/types.ts:1052:1
```

### root: WorkflowContinueCommand

[Declaration source](mod.ts#L1835)

```text
reference WorkflowContinueCommand: ./packages/workflow/types.ts:297:1
```

### root: WorkflowControlBase

[Declaration source](mod.ts#L1836)

```text
reference WorkflowControlBase: ./packages/workflow/types.ts:188:1
```

### root: WorkflowControlInstruction

[Declaration source](mod.ts#L1837)

```text
reference WorkflowControlInstruction: ./packages/workflow/types.ts:449:1
```

### root: WorkflowDeferCommand

[Declaration source](mod.ts#L1838)

```text
reference WorkflowDeferCommand: ./packages/workflow/types.ts:289:1
```

### root: WorkflowDefinition

[Declaration source](mod.ts#L1839)

```text
reference WorkflowDefinition: ./packages/workflow/types.ts:118:1
```

### root: WorkflowDocument

[Declaration source](mod.ts#L1840)

```text
reference WorkflowDocument: ./packages/workflow/types.ts:1086:1
```

### root: WorkflowDurableValue

[Declaration source](mod.ts#L1841)

```text
reference WorkflowDurableValue: ./packages/workflow/types.ts:404:1
```

### root: WorkflowEffectCommand

[Declaration source](mod.ts#L1842)

```text
reference WorkflowEffectCommand: ./packages/workflow/types.ts:279:1
```

### root: WorkflowFailure

[Declaration source](mod.ts#L1843)

```text
reference WorkflowFailure: ./packages/workflow/types.ts:467:1
```

### root: WorkflowFailures

[Declaration source](mod.ts#L1844)

```text
reference WorkflowFailures: ./packages/workflow/types.ts:146:1
```

### root: WorkflowFault

[Declaration source](mod.ts#L1845)

```text
reference WorkflowFault: ./packages/workflow/types.ts:475:1
```

### root: WorkflowImplementation

[Declaration source](mod.ts#L1846)

```text
reference WorkflowImplementation: ./packages/workflow/types.ts:548:1
```

### root: WorkflowInput

[Declaration source](mod.ts#L1847)

```text
reference WorkflowInput: ./packages/workflow/types.ts:136:1
```

### root: WorkflowInstruction

[Declaration source](mod.ts#L1848)

```text
reference WorkflowInstruction: ./packages/workflow/types.ts:456:1
```

### root: WorkflowInstructionBase

[Declaration source](mod.ts#L1849)

```text
reference WorkflowInstructionBase: ./packages/workflow/types.ts:168:1
```

### root: WorkflowInstructionDescription

[Declaration source](mod.ts#L1850)

```text
reference WorkflowInstructionDescription: ./packages/workflow/types.ts:413:1
```

### root: WorkflowInstructionIdentity

[Declaration source](mod.ts#L1851)

```text
reference WorkflowInstructionIdentity: ./packages/workflow/types.ts:431:1
```

### root: WorkflowMapEntry

[Declaration source](mod.ts#L1852)

```text
reference WorkflowMapEntry: ./packages/workflow/types.ts:338:1
```

### root: WorkflowMapInstruction

[Declaration source](mod.ts#L1853)

```text
reference WorkflowMapInstruction: ./packages/workflow/types.ts:360:1
```

### root: WorkflowMapOptions

[Declaration source](mod.ts#L1854)

```text
reference WorkflowMapOptions: ./packages/workflow/types.ts:346:1
```

### root: WorkflowOperation

[Declaration source](mod.ts#L1855)

```text
reference WorkflowOperation: ./packages/workflow/types.ts:501:1
```

### root: WorkflowOperationFailure

[Declaration source](mod.ts#L1856)

```text
reference WorkflowOperationFailure: ./packages/workflow/types.ts:515:1
```

### root: WorkflowOperationFailures

[Declaration source](mod.ts#L1857)

```text
reference WorkflowOperationFailures: ./packages/workflow/types.ts:535:1
```

### root: WorkflowOperationValue

[Declaration source](mod.ts#L1859)

```text
reference WorkflowOperationValue: ./packages/workflow/types.ts:511:1
```

### root: WorkflowOperationValues

[Declaration source](mod.ts#L1860)

```text
reference WorkflowOperationValues: ./packages/workflow/types.ts:522:1
```

### root: WorkflowOperations

[Declaration source](mod.ts#L1858)

```text
reference WorkflowOperations: ./packages/workflow/types.ts:519:1
```

### root: WorkflowOptions

[Declaration source](mod.ts#L1861)

```text
reference WorkflowOptions: ./packages/workflow/types.ts:94:1
```

### root: WorkflowParallelInstruction

[Declaration source](mod.ts#L1862)

```text
reference WorkflowParallelInstruction: ./packages/workflow/types.ts:313:1
```

### root: WorkflowParallelOptions

[Declaration source](mod.ts#L1863)

```text
reference WorkflowParallelOptions: ./packages/workflow/types.ts:305:1
```

### root: WorkflowProgram

[Declaration source](mod.ts#L1864)

```text
reference WorkflowProgram: ./packages/workflow/types.ts:545:1
```

### root: WorkflowRaceInstruction

[Declaration source](mod.ts#L1865)

```text
reference WorkflowRaceInstruction: ./packages/workflow/types.ts:329:1
```

### root: WorkflowRaceOptions

[Declaration source](mod.ts#L1866)

```text
reference WorkflowRaceOptions: ./packages/workflow/types.ts:326:1
```

### root: WorkflowRaceResult

[Declaration source](mod.ts#L1867)

```text
reference WorkflowRaceResult: ./packages/workflow/types.ts:540:1
```

### root: WorkflowReference

[Declaration source](mod.ts#L1868)

```text
reference WorkflowReference: ./packages/workflow/types.ts:78:1
```

### root: WorkflowResult

[Declaration source](mod.ts#L1869)

```text
reference WorkflowResult: ./packages/workflow/types.ts:141:1
```

### root: WorkflowRetryInstruction

[Declaration source](mod.ts#L1870)

```text
reference WorkflowRetryInstruction: ./packages/workflow/types.ts:386:1
```

### root: WorkflowRetryOptions

[Declaration source](mod.ts#L1871)

```text
reference WorkflowRetryOptions: ./packages/workflow/types.ts:372:1
```

### root: WorkflowRunOptions

[Declaration source](mod.ts#L1872)

```text
reference WorkflowRunOptions: ./packages/workflow/types.ts:1064:1
```

### root: WorkflowSchema

[Declaration source](mod.ts#L1873)

```text
reference WorkflowSchema: ./packages/workflow/types.ts:20:1
```

### root: WorkflowSelection

[Declaration source](mod.ts#L1874)

```text
reference WorkflowSelection: ./packages/workflow/types.ts:1080:1
```

### root: WorkflowSettledValues

[Declaration source](mod.ts#L1875)

```text
reference WorkflowSettledValues: ./packages/workflow/types.ts:527:1
```

### root: WorkflowSignal

[Declaration source](mod.ts#L1876)

```text
reference WorkflowSignal: ./packages/workflow/types.ts:235:1
```

### root: WorkflowSleepCommand

[Declaration source](mod.ts#L1877)

```text
reference WorkflowSleepCommand: ./packages/workflow/types.ts:227:1
```

### root: WorkflowSuccess

[Declaration source](mod.ts#L1878)

```text
reference WorkflowSuccess: ./packages/workflow/types.ts:459:1
```

### root: WorkflowWaitCommand

[Declaration source](mod.ts#L1879)

```text
reference WorkflowWaitCommand: ./packages/workflow/types.ts:245:1
```

## dispatch

Import `@okikio/workflow/dispatch`. [Source](./dispatch.ts).

Durable activity dispatch contracts and the process-local reference store.

A dispatch owner retains logical activity items, executor registrations, temporary attempt leases, placement decisions,
and terminal results. Workflow schedulers and activity executors can therefore run in different hosts while sharing one
storage implementation.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source               |
| --------------------------- | -------------------------------------- |
| `context`                   | [context contracts](../context/API.md) |
| `record`                    | [record contracts](../record/API.md)   |
| `freezeAffinity`            | [Source](affinity.ts)                  |
| `affinityMatches`           | [Source](affinity.ts)                  |
| `assert`                    | [Source](assert.ts)                    |
| `compute`                   | [Source](compute.ts)                   |
| `durable`                   | [Source](durable.ts)                   |
| `ActivityAddOptions`        | [Source](types.ts)                     |
| `ActivityClaimOptions`      | [Source](types.ts)                     |
| `ActivityClaimType`         | [Source](types.ts)                     |
| `ActivityDispatch`          | [Source](types.ts)                     |
| `ActivityDispatchStatsType` | [Source](types.ts)                     |
| `ActivityJobResultType`     | [Source](types.ts)                     |
| `ActivityJobType`           | [Source](types.ts)                     |
| `ActivityRefType`           | [Source](types.ts)                     |
| `ActivityRetryOptions`      | [Source](types.ts)                     |
| `ExecutorJoinOptions`       | [Source](types.ts)                     |
| `ExecutorLeaseType`         | [Source](types.ts)                     |
| `HistoryValueType`          | [Source](types.ts)                     |
| `MemoryDispatchOptions`     | [Source](types.ts)                     |

### dispatch: memory

[Declaration source](dispatch.ts#L144)

```text
function memory(options: MemoryDispatchOptions): ActivityDispatch
  Create a bounded process-local activity dispatch owner.

  The implementation exercises the same item, registration, placement, lease,
  and stale-completion contract required from SQL, OPFS, or remote adapters.
  Process exit still loses every record.
```

### dispatch: DispatchCapacityError

[Declaration source](dispatch.ts#L66)

```text
class DispatchCapacityError extends RangeError
  Raised when process-local dispatch reaches its configured active-item bound.

  constructor(capacity: number)
    Create one capacity error before another active item is retained.
  readonly capacity: number
    Maximum active logical items configured for the dispatch owner.
```

### dispatch: DispatchClosedError

[Declaration source](dispatch.ts#L53)

```text
class DispatchClosedError extends Error
  Raised after an activity dispatch owner has stopped permanently.

  constructor(reason?: unknown)
    Create one lifecycle error for an operation attempted after dispatch shutdown.
  readonly reason: unknown
    Original dispatch shutdown reason.
```

### dispatch: StaleActivityClaimError

[Declaration source](dispatch.ts#L92)

```text
class StaleActivityClaimError extends Error
  Raised when a late activity attempt tries to mutate work owned by another claim.

  constructor(itemId: string, claimId: string)
    Create one ownership error for a rejected late attempt mutation.
  readonly itemId: string
    Stable logical item identity targeted by the stale claim.
  readonly claimId: string
    Attempt claim identity that no longer owns the item.
```

### dispatch: StaleExecutorError

[Declaration source](dispatch.ts#L79)

```text
class StaleExecutorError extends Error
  Raised when an executor mutation uses a replaced, expired, or closed generation.

  constructor(executorId: string)
    Create one stale-generation error for a rejected executor mutation.
  readonly executorId: string
    Replaced, expired, or closed executor registration identity.
```

### dispatch: ActivityAddOptions

[Declaration source](dispatch.ts#L33)

```text
reference ActivityAddOptions: ./packages/workflow/types.ts:772:1
```

### dispatch: ActivityClaimOptions

[Declaration source](dispatch.ts#L34)

```text
reference ActivityClaimOptions: ./packages/workflow/types.ts:798:1
```

### dispatch: ActivityClaimType

[Declaration source](dispatch.ts#L35)

```text
reference ActivityClaimType: ./packages/workflow/types.ts:754:1
```

### dispatch: ActivityDispatch

[Declaration source](dispatch.ts#L36)

```text
reference ActivityDispatch: ./packages/workflow/types.ts:838:1
```

### dispatch: ActivityDispatchStatsType

[Declaration source](dispatch.ts#L37)

```text
reference ActivityDispatchStatsType: ./packages/workflow/types.ts:814:1
```

### dispatch: ActivityJobResultType

[Declaration source](dispatch.ts#L38)

```text
reference ActivityJobResultType: ./packages/workflow/types.ts:697:1
```

### dispatch: ActivityJobType

[Declaration source](dispatch.ts#L39)

```text
reference ActivityJobType: ./packages/workflow/types.ts:679:1
```

### dispatch: ActivityRefType

[Declaration source](dispatch.ts#L40)

```text
reference ActivityRefType: ./packages/workflow/types.ts:704:1
```

### dispatch: ActivityRetryOptions

[Declaration source](dispatch.ts#L41)

```text
reference ActivityRetryOptions: ./packages/workflow/types.ts:808:1
```

### dispatch: ComputeType

[Declaration source](dispatch.ts#L42)

```text
reference ComputeType: ./packages/workflow/types.ts:710:1
```

### dispatch: EngineAffinityType

[Declaration source](dispatch.ts#L43)

```text
reference EngineAffinityType: ./packages/workflow/types.ts:202:1
```

### dispatch: ExecutorActivityType

[Declaration source](dispatch.ts#L44)

```text
reference ExecutorActivityType: ./packages/workflow/types.ts:722:1
```

### dispatch: ExecutorJoinOptions

[Declaration source](dispatch.ts#L45)

```text
reference ExecutorJoinOptions: ./packages/workflow/types.ts:778:1
```

### dispatch: ExecutorLeaseType

[Declaration source](dispatch.ts#L46)

```text
reference ExecutorLeaseType: ./packages/workflow/types.ts:730:1
```

### dispatch: HistoryFailureOccurrenceType

[Declaration source](dispatch.ts#L47)

```text
reference HistoryFailureOccurrenceType: ./packages/workflow/types.ts:568:1
```

### dispatch: HistoryValueType

[Declaration source](dispatch.ts#L48)

```text
reference HistoryValueType: ./packages/workflow/types.ts:563:1
```

### dispatch: MemoryDispatchOptions

[Declaration source](dispatch.ts#L49)

```text
reference MemoryDispatchOptions: ./packages/workflow/types.ts:884:1
```

## history

Import `@okikio/workflow/history`. [Source](./history.ts).

Workflow instruction history and replay semantics.

A history owner receives every deterministic instruction before external work starts. It can return an already recorded
completion during replay or call `next()` to advance a new instruction. Concrete durable storage belongs in a package.
This module provides only the generic behavior contract and a bounded process-local reference implementation.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding        | Contract owner or source               |
| ----------------------- | -------------------------------------- |
| `context`               | [context contracts](../context/API.md) |
| `assert`                | [Source](assert.ts)                    |
| `HistoryCompletionType` | [Source](types.ts)                     |
| `HistoryEntryType`      | [Source](types.ts)                     |
| `HistoryInput`          | [Source](types.ts)                     |
| `HistoryOptions`        | [Source](types.ts)                     |
| `HistorySnapshotType`   | [Source](types.ts)                     |
| `MemoryHistory`         | [Source](types.ts)                     |
| `WorkflowCompletionAny` | [Source](types.ts)                     |

### history: memory

[Declaration source](history.ts#L102)

````text
function memory(options: HistoryOptions): MemoryHistory
  Creates a bounded process-local workflow history.

  The history deduplicates concurrent scheduling of the same run/path and
  returns a recorded completion on replay. It rejects a changed fingerprint at
  an existing path. Process exit loses all entries, so this implementation is
  suitable for tests and local execution only.

  The configured `maximumEntries` bounds retained memory. A durable provider
  can implement the same {@link History} interface with database claims and
  persisted completion encoding.

  @example
      Local replay

      ```ts
      import * as history from '@okikio/workflow/history';
      import * as workflow from '@okikio/workflow';

      await using records = history.memory({ maximumEntries: 1_000 });
      await using scheduler = workflow.scheduler({ history: records });
      ```

  @example
      Inspect one run in a test

      ```ts
      const snapshot = records.inspect('run-42');
      console.log(snapshot.entries);
      ```
````

### history: HistoryCapacityError

[Declaration source](history.ts#L49)

```text
class HistoryCapacityError extends RangeError
  Raised when bounded process-local history cannot admit another instruction.

  constructor(maximum: number)
    Create one capacity error before local history would exceed its configured retained-entry limit.
  readonly maximum: number
    Configured maximum retained instruction count.
```

### history: ReplayError

[Declaration source](history.ts#L24)

```text
class ReplayError extends Error
  Raised when replay yields different instruction identity at an existing path.

  constructor(runId: string, path: string, expected: string, actual: string)
    Create one replay-divergence error with the recorded and newly yielded fingerprints.
  readonly runId: string
    Workflow run whose replay diverged.
  readonly path: string
    Deterministic instruction path that no longer matches history.
  readonly expected: string
    Fingerprint already recorded by history.
  readonly actual: string
    Fingerprint yielded by the current workflow program.
```

## types

Import `@okikio/workflow/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding          | Contract owner or source                                                   |
| ------------------------- | -------------------------------------------------------------------------- |
| `StandardSchemaV1`        | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `Catalog`                 | [catalog contracts](../catalog/API.md)                                     |
| `CatalogEntryIdentity`    | [catalog contracts](../catalog/API.md)                                     |
| `CatalogSelection`        | [catalog contracts](../catalog/API.md)                                     |
| `CatalogDefinitionInput`  | [catalog contracts](../catalog/API.md)                                     |
| `BaseContext`             | [context contracts](../context/API.md)                                     |
| `ContextSnapshot`         | [context contracts](../context/API.md)                                     |
| `EffectDefinition`        | [effect contracts](../effect/API.md)                                       |
| `EffectDefinitions`       | [effect contracts](../effect/API.md)                                       |
| `EffectEmitter`           | [effect contracts](../effect/API.md)                                       |
| `FailureDefinition`       | [failure contracts](../failure/API.md)                                     |
| `FailureOccurrence`       | [failure contracts](../failure/API.md)                                     |
| `RequirementDefinition`   | [requirement contracts](../requirement/API.md)                             |
| `RequirementDocument`     | [requirement contracts](../requirement/API.md)                             |
| `RequirementInput`        | [requirement contracts](../requirement/API.md)                             |
| `RequirementScopeOptions` | [requirement contracts](../requirement/API.md)                             |
| `ExplicitResult`          | [result contracts](../result/API.md)                                       |
| `ResiliencePolicy`        | [resilience contracts](../resilience/API.md)                               |

### types: ActivityAddOptions

[Declaration source](types.ts#L772)

```text
interface ActivityAddOptions
  Idempotent admission options for one logical activity item.

  readonly key: string
    Stable key derived from complete workflow instruction identity.
```

### types: ActivityAttemptControl

[Declaration source](types.ts#L932)

```text
interface ActivityAttemptControl
  Host controls available while one provider owns a fenced attempt.

  heartbeat(value?: unknown): Promise<void>
    Renew the authoritative queue claim after provider liveness evidence.
```

### types: ActivityAttemptType

[Declaration source](types.ts#L894)

```text
interface ActivityAttemptType
  Serializable identity and input for one fenced activity attempt.

  readonly jobId: string
    Stable logical job ID shared by every attempt of the same activity request.
  readonly attempt: number
    One-based Scheduler attempt number for this logical activity job.
  readonly claimId: string
    Exact queue claim ID that fences all mutations from this attempt.
  readonly activityId: string
    Stable activity definition ID resolved by the receiving provider.
  readonly activityVersion: string
    Activity contract version required by the selected provider.
  readonly engineId: string
    Engine definition ID selected before this attempt was dispatched.
  readonly registrationId: string
    Exact live registration ID whose capacity owns this attempt.
  readonly hostId: string
    Provider host ID paired with `generation` for stale-result fencing.
  readonly generation: number
    Host generation used to fence results from a replaced live host.
  readonly origin: ActivityOriginType
    Durable workflow instruction identity that admitted this logical job.
  readonly context: ContextSnapshot
    Serializable execution-context snapshot restored by the receiving host.
  readonly input: unknown
    Cloneable schema-safe activity input delivered to the selected provider.
  readonly admitted: true
    True because the Scheduler applied direct active requirements before placement.
```

### types: ActivityClaimOptions

[Declaration source](types.ts#L798)

```text
interface ActivityClaimOptions
  Options used when one executor claims available activity items.

  readonly limit?: number
    Maximum items to claim without exceeding registered capacity.
  readonly duration: Temporal.Duration | Temporal.DurationLike | string
    Attempt lease duration.
  readonly wait?: boolean
    Wait for matching work instead of returning an empty collection.
```

### types: ActivityClaimType

[Declaration source](types.ts#L754)

```text
interface ActivityClaimType
  Temporary ownership token for one activity attempt.

  readonly id: string
    Unique claim identity used to fence every attempt mutation.
  readonly itemId: string
    Stable logical activity item identity.
  readonly executorId: string
    Exact executor registration generation that owns the attempt.
  readonly attempt: number
    One-based attempt number for this logical activity item.
  readonly value: ActivityJobType
    Activity item input and placement contract retained by the dispatch owner.
  readonly claimedAt: Temporal.Instant
    Instant when ownership was granted.
  readonly expiresAt: Temporal.Instant
    Instant after which another executor may recover the item.
```

### types: ActivityCommand

[Declaration source](types.ts#L211)

```text
interface ActivityCommand<Value = unknown, Failure = unknown> extends WorkflowCommandBase
  Activity execution command.

  readonly type: "activity"
    Stable discriminant for this activity variant.
  readonly activity: ActivityReference
    Activity declaration or reference whose validated attempt is requested.
  readonly input: unknown
    Activity input retained as serializable workflow instruction data.
  readonly options: ActivityCommandOptions
    Caller-selected policy for this operation.
  readonly _value?: Value
    Compile-time result inference slot; it is not a live result promise.
  readonly _failure?: Failure
    Compile-time failure inference slot; consumers do not use it as runtime outcome authority.
```

### types: ActivityCommandOptions

[Declaration source](types.ts#L205)

```text
interface ActivityCommandOptions extends WorkflowCommandOptions
  Public options accepted by activity requests.

  readonly affinity?: EngineAffinityType
    Exact host-affinity fields that a live registration must match.
```

### types: ActivityDispatch

[Declaration source](types.ts#L838)

```text
interface ActivityDispatch extends AsyncDisposable
  Durable activity item, executor registration, placement, and claim authority.

  Concrete adapters must make each mutation atomic in their storage model and
  use storage-authoritative time for leases. The memory implementation is a
  process-local conformance reference, not a persistence claim.

  add(ctx: BaseContext, value: ActivityJobType, options: ActivityAddOptions): Promise<ActivityRefType>
    Admit or find one logical item by complete idempotency key.
  result(ctx: BaseContext, ref: ActivityRefType): Promise<ActivityJobResultType>
    Wait for and return the authoritative terminal result of one logical item.
  cancel(ctx: BaseContext, ref: ActivityRefType, reason?: HistoryValueType): Promise<void>
    Cancel one logical item using producer authority.
  join(ctx: BaseContext, options: ExecutorJoinOptions): Promise<ExecutorLeaseType>
    Register a new executor generation and fence an older generation of the same host.
  renewExecutor(ctx: BaseContext, lease: ExecutorLeaseType, duration: Temporal.Duration | Temporal.DurationLike | string): Promise<ExecutorLeaseType>
    Extend one exact executor registration lease.
  resize(ctx: BaseContext, lease: ExecutorLeaseType, capacity: number): Promise<ExecutorLeaseType>
    Change future claim capacity for one exact executor generation.
  drain(ctx: BaseContext, lease: ExecutorLeaseType): Promise<void>
    Stop new claims and wait until the executor has no active attempts.
  leave(ctx: BaseContext, lease: ExecutorLeaseType): Promise<void>
    Remove a drained executor generation from placement.
  claim(ctx: BaseContext, lease: ExecutorLeaseType, options: ActivityClaimOptions): Promise<readonly ActivityClaimType[]>
    Claim matching items without exceeding registered executor capacity.
  watch(ctx: BaseContext, claim: ActivityClaimType): Promise<"cancelled" | "lost">
    Wait until a claimed item is cancelled or this exact attempt loses ownership.
  renew(ctx: BaseContext, claim: ActivityClaimType, duration: Temporal.Duration | Temporal.DurationLike | string): Promise<ActivityClaimType>
    Extend one exact activity attempt claim.
  complete(ctx: BaseContext, claim: ActivityClaimType, result: ActivityJobResultType): Promise<void>
    Conditionally store a terminal result for the current claim owner.
  retry(ctx: BaseContext, claim: ActivityClaimType, options?: ActivityRetryOptions): Promise<void>
    Return the current claim to queued state with optional backoff.
  stats(): Promise<ActivityDispatchStatsType>
    Return authoritative item, executor, and local waiter counters.
  close(reason?: unknown): Promise<void>
    Stop admission and reject blocked dispatch calls.
```

### types: ActivityDispatchStatsType

[Declaration source](types.ts#L814)

```text
interface ActivityDispatchStatsType
  Snapshot counters for one activity dispatch owner.

  readonly queued: number
    Logical items currently eligible for a future claim.
  readonly claimed: number
    Logical items currently owned by temporary attempt claims.
  readonly completed: number
    Logical items with a stored success, declared failure, or fault.
  readonly cancelled: number
    Logical items with a stored cancellation result.
  readonly executors: number
    Live executor generations currently known to this dispatch owner.
  readonly waitingClaims: number
    Executor claim calls currently blocked for matching capacity and work.
  readonly waitingResults: number
    Scheduler calls currently waiting for terminal item results.
```

### types: ActivityJobType

[Declaration source](types.ts#L679)

```text
interface ActivityJobType
  One serializable logical activity job stored by the Scheduler queue.

  readonly activityId: string
    Stable activity definition ID resolved from the replayed workflow instruction.
  readonly activityVersion: string
    Activity contract version that must match the replayed instruction and selected provider.
  readonly input: unknown
    JSON-safe activity input retained by the authoritative activity job store.
  readonly origin: ActivityOriginType
    Workflow instruction identity that admitted this logical activity job.
  readonly context: ContextSnapshot
    Serializable execution-context snapshot restored by the receiving host.
  readonly affinity?: EngineAffinityType
    Serializable affinity facts that must match before placement.
  readonly placement: readonly EnginePlacementType[]
    Ordered engine choices copied from the activity contract for storage-side placement.
```

### types: ActivityOriginType

[Declaration source](types.ts#L665)

```text
interface ActivityOriginType
  Serializable activity-job origin retained for replay and diagnostics.

  readonly workflowId: string
    Workflow definition ID that yielded this activity instruction.
  readonly workflowVersion: string
    Workflow definition version that originated this work.
  readonly runId: string
    Workflow run ID whose history owns this logical activity job.
  readonly instructionPath: string
    Deterministic instruction path inside the workflow program.
  readonly instructionFingerprint: string
    Fingerprint used to detect replay divergence at the instruction path.
```

### types: ActivityRefType

[Declaration source](types.ts#L704)

```text
interface ActivityRefType
  Stable reference to one logical activity item across every execution attempt.

  readonly id: string
    Store-assigned identity retained through retries and terminal result lookup.
```

### types: ActivityReference

[Declaration source](types.ts#L58)

```text
interface ActivityReference extends CatalogEntryIdentity
  Structural activity contract referenced by workflow instructions.

  readonly kind: "activity"
    Stable discriminant for this activity value.
  readonly version: string
    Contract version used to distinguish incompatible activity shapes.
  readonly input: WorkflowSchema
    Schema that validates activity input before execution.
  readonly result: WorkflowSchema
    Schema that validates successful activity output.
  readonly failures: readonly FailureDefinition[]
    Expected failure definitions or data declared by this activity.
  readonly requirements: readonly RequirementDefinition[]
    Requirements owned directly by this activity; reachable dependency requirements remain separate.
  readonly placement: EnginePlacementReference
    Ordered engine placement declaration used before attempt dispatch.
  readonly resilience: readonly ResiliencePolicy[]
    Static resilience policies applied at the activity lifecycle.
```

### types: ActivityRetryOptions

[Declaration source](types.ts#L808)

```text
interface ActivityRetryOptions
  Retry timing committed by the current activity attempt owner.

  readonly delay?: Temporal.Duration | Temporal.DurationLike | string
    Relative delay before the item can be claimed again.
```

### types: ChildOptions

[Declaration source](types.ts#L255)

```text
interface ChildOptions extends WorkflowCommandOptions
  Public options accepted by child workflow operations.

  readonly cancellation?: "follow-parent" | "request" | "independent"
    Policy that relates child-work cancellation to the parent lifetime.
  readonly result?: "wait" | "discard"
    Whether the parent waits for the child result or deliberately discards it.
```

### types: ChildWorkflowCommand

[Declaration source](types.ts#L263)

```text
interface ChildWorkflowCommand<Value = unknown, Failure = unknown> extends WorkflowCommandBase
  Start or await one child workflow.

  readonly type: "child-workflow"
    Stable discriminant for this childworkflow variant.
  readonly workflow: WorkflowReference
    Declared child-workflow reference whose input and result contracts are known.
  readonly input: unknown
    Child-workflow input retained as serializable instruction data.
  readonly options: ChildOptions
    Caller-selected policy for this operation.
  readonly _value?: Value
    Compile-time result inference slot; it is not a live result promise.
  readonly _failure?: Failure
    Compile-time failure inference slot; consumers do not use it as runtime outcome authority.
```

### types: ComputeType

[Declaration source](types.ts#L710)

```text
interface ComputeType
  Optional compute identity advertised by an executor.

  readonly id: string
    Stable identity chosen by the compute owner.
  readonly kind?: string
    Open compute class such as `process`, `thread`, `container`, or an application-owned term.
  readonly parent?: string
    Optional parent compute identity when this host participates in a hierarchy.
  readonly attributes?: EngineAffinityType
    Serializable facts for diagnostics or compute-aware placement policy.
```

### types: EngineCapacityType

[Declaration source](types.ts#L655)

```text
interface EngineCapacityType
  Capacity advertised by one live engine registration.

  readonly maximum: number
    Maximum simultaneous attempts admitted through this registration.
  readonly active: number
    Attempts currently owned by this Scheduler replica.
  readonly available: number
    Remaining local admission slots.
```

### types: EngineChoiceReference

[Declaration source](types.ts#L32)

```text
interface EngineChoiceReference
  Structural engine candidate retained in an activity contract.

  readonly kind: "activity-engine-choice"
    Stable discriminant for this engine choice value.
  readonly mode: EngineChoiceModeType
    Selection or operation mode that controls this engine choice.
  readonly engine: EngineReference
    Engine identity associated with this engine choice.
```

### types: EnginePlacementReference

[Declaration source](types.ts#L42)

```text
interface EnginePlacementReference
  Structural ordered placement retained in an activity contract.

  readonly kind: "activity-engine-placement"
    Stable discriminant for this engine placement value.
  readonly choices: readonly EngineChoiceReference[]
    Ordered structural engine choices retained without importing the activity package.
```

### types: EnginePlacementType

[Declaration source](types.ts#L50)

```text
interface EnginePlacementType
  One stored engine choice after a scheduler copies a definition placement.

  readonly engine: string
    Stable engine definition ID used to select a compatible executor.
  readonly mode: EngineChoiceModeType
    Selection mode retained from the activity contract.
```

### types: EngineProvider

[Declaration source](types.ts#L938)

```text
interface EngineProvider
  Live execution target registered with one Scheduler.

  readonly activities: readonly ActivityReference[]
    Exact activity definitions this provider can run.
  run(ctx: BaseContext, attempt: ActivityAttemptType, control: ActivityAttemptControl): Promise<ActivityAttemptResultType>
    Fulfill one fenced attempt without creating another logical retry.
  cancel?(attempt: ActivityAttemptType, reason?: unknown): void | Promise<void>
    Best-effort cooperative cancellation for an attempt already dispatched.
```

### types: EngineReference

[Declaration source](types.ts#L23)

```text
interface EngineReference extends CatalogEntryIdentity
  Structural activity-engine identity referenced without importing the activity package.

  readonly kind: "activity-engine"
    Stable discriminant for this engine value.
```

### types: EngineRegistration

[Declaration source](types.ts#L974)

```text
interface EngineRegistration extends AsyncDisposable
  Live registration handle. Disposal stops new placement and fences late results.

  readonly id: string
    Unique registration identity used to fence attempts from other registrations.
  readonly engine: EngineReference
    Exact engine definition represented by this registration.
  readonly hostId: string
    Stable host identity whose reconnects increment generation.
  readonly generation: number
    Monotonic host generation used to reject late results after reconnect.
  readonly protocolVersion: number
    Protocol version advertised by the live provider.
  readonly affinity: EngineAffinityType | undefined
    Serializable affinity facts used by Scheduler placement.
  readonly compute: ComputeType | undefined
    Optional topology-neutral compute identity advertised by this executor.
  readonly activities: readonly ActivityReference[]
    Exact activity definitions this provider can execute.
  readonly capacity: EngineCapacityType
    Current local admission capacity snapshot.
  readonly leaseUntil: Temporal.Instant | undefined
    Absolute registration lease expiry when the registration is leased.
  readonly draining: boolean
    Whether the registration has stopped accepting new placement.
  renew(duration: Temporal.Duration | Temporal.DurationLike | string): Promise<void>
    Extend a leased registration from the Scheduler clock.
  resize(maximum: number): Promise<void>
    Change the maximum local attempt capacity advertised for future placement.
  drain(): Promise<void>
    Stop new placement and resolve after active attempts leave the registration.
```

### types: EngineRegistrationOptions

[Declaration source](types.ts#L952)

```text
interface EngineRegistrationOptions
  Inputs accepted when registering one live engine provider.

  readonly engine: EngineReference
    Exact engine definition advertised by this live registration.
  readonly provider: EngineProvider
    Live provider that accepts fenced attempts for this registration.
  readonly hostId: string
    Stable live-host identity used with generation fencing.
  readonly capacity?: number
    Maximum simultaneous attempts this registration can own.
  readonly affinity?: EngineAffinityType
    Serializable host-affinity facts considered during placement.
  readonly compute?: ComputeType
    Optional compute identity; hierarchy-aware hosts can provide `parent`, while flat hosts omit it.
  readonly protocolVersion?: number
    Provider protocol version recorded for compatibility checks.
  readonly lease?: Temporal.Duration | Temporal.DurationLike | string
    Optional registration lease. Omit for a process-local registration owned by explicit disposal.
  readonly disposeProvider?: boolean
    Transfer provider disposal to the registration when true.
```

### types: ExecutorActivityType

[Declaration source](types.ts#L722)

```text
interface ExecutorActivityType
  Serializable activity identity advertised by one executor generation.

  readonly id: string
    Stable activity definition ID.
  readonly version: string
    Exact activity contract version accepted by the executor.
```

### types: ExecutorJoinOptions

[Declaration source](types.ts#L778)

```text
interface ExecutorJoinOptions
  Inputs used to register one independently hosted executor.

  readonly engineId: string
    Engine identity advertised by the executor.
  readonly hostId: string
    Stable host identity whose reconnects advance the generation fence.
  readonly activities: readonly ExecutorActivityType[]
    Activity identities accepted by this executor.
  readonly capacity: number
    Maximum simultaneous attempts this executor can own.
  readonly affinity?: EngineAffinityType
    Serializable placement facts considered by dispatch matching.
  readonly compute?: ComputeType
    Optional compute identity; omit it for a topology-free executor pool.
  readonly protocolVersion: number
    Provider protocol version recorded for compatibility checks.
  readonly duration?: Temporal.Duration | Temporal.DurationLike | string
    Optional registration lease for crash recovery.
```

### types: ExecutorLeaseType

[Declaration source](types.ts#L730)

```text
interface ExecutorLeaseType
  Durable registration lease used to claim and fence activity attempts.

  readonly id: string
    Store-assigned identity for this exact host generation.
  readonly engineId: string
    Engine identity advertised by the executor.
  readonly hostId: string
    Stable host identity whose reconnects advance `generation`.
  readonly generation: number
    Monotonic generation that fences work from an older incarnation of the same host.
  readonly protocolVersion: number
    Protocol version used to reject incompatible hosts.
  readonly activities: readonly ExecutorActivityType[]
    Activity contracts this executor can run.
  readonly affinity?: EngineAffinityType
    Serializable placement facts advertised by this executor.
  readonly compute?: ComputeType
    Optional topology-neutral compute identity.
  readonly capacity: number
    Maximum simultaneous attempts admitted through this executor.
  readonly expiresAt?: Temporal.Instant
    Absolute expiry for a leased registration, or undefined for an explicitly owned local registration.
```

### types: ExecutorOptions

[Declaration source](types.ts#L1032)

```text
interface ExecutorOptions extends EngineRegistrationOptions
  Options accepted by the independently hosted activity executor.

  readonly dispatch: ActivityDispatch
    Durable dispatch owner shared with one or more workflow schedulers.
  readonly ctx?: BaseContext
    Parent host lifetime. Omit to create an independently owned root lifetime.
  readonly claimDuration?: Temporal.Duration | Temporal.DurationLike | string
    Attempt claim duration renewed by activity heartbeats.
```

### types: History

[Declaration source](types.ts#L615)

```text
interface History extends AsyncDisposable
  Authoritative instruction-history behavior used by a Scheduler.

  A history can return a recorded completion during replay or call `next()` to
  advance a new instruction. Durable implementations must persist identity
  before external dispatch and fence concurrent owners in their own storage
  transaction/claim model.

  schedule(input: HistoryInput): Promise<WorkflowCompletionAny>
    Return a recorded completion or advance one new deterministic instruction.
  close(reason?: unknown): Promise<void>
    Stop accepting new history work and release implementation-owned state.
```

### types: HistoryEntryType

[Declaration source](types.ts#L635)

```text
interface HistoryEntryType
  Immutable diagnostic record for one retained workflow instruction.

  readonly path: string
    Deterministic workflow instruction path.
  readonly fingerprint: string
    Fingerprint recorded when the instruction first entered history.
  readonly completion?: HistoryCompletionType
    JSON-safe recorded completion when the instruction reached terminal state.
  readonly pending: boolean
    Whether one process-local caller currently owns the unresolved instruction.
```

### types: HistoryFailureOccurrenceType

[Declaration source](types.ts#L568)

```text
interface HistoryFailureOccurrenceType
  JSON-safe expected-failure occurrence retained by workflow history.

  readonly id: string
    Stable failure definition ID resolved through the replayed workflow contract.
  readonly data: WorkflowDurableValue
    JSON-safe failure data revalidated before the occurrence is reconstructed.
  readonly message: string
    Durable failure message retained without a process-local cause.
```

### types: HistoryInput

[Declaration source](types.ts#L590)

```text
interface HistoryInput
  Input passed to one workflow instruction history owner.

  readonly ctx: WorkflowContext
    Workflow execution context containing the stable run identity.
  readonly instruction: WorkflowInstruction
    Exact instruction yielded at the current deterministic path.
  readonly path: string
    Deterministic path within the workflow program.
  readonly identity: WorkflowInstructionIdentity
    Stable description and fingerprint used to verify replay.
  readonly next: () => Promise<WorkflowCompletionAny>
    Advances this instruction when history has no recorded completion.
  readonly encode: (completion: WorkflowCompletionAny) => Promise<HistoryCompletionType>
    Encodes a newly produced completion into the JSON-safe history representation.
  readonly decode: (completion: HistoryCompletionType) => Promise<WorkflowCompletionAny>
    Decodes one stored history completion through the current exact workflow definitions.
```

### types: HistoryOptions

[Declaration source](types.ts#L629)

```text
interface HistoryOptions
  Bounded process-local history options used by `history.memory()`.

  readonly maximumEntries?: number
    Maximum instruction records retained across all in-memory runs.
```

### types: HistorySnapshotType

[Declaration source](types.ts#L647)

```text
interface HistorySnapshotType
  Immutable diagnostic snapshot of one workflow run's process-local history.

  readonly runId: string
    Stable workflow run identity.
  readonly entries: readonly HistoryEntryType[]
    Retained instruction records sorted by deterministic path.
```

### types: MemoryDispatchOptions

[Declaration source](types.ts#L884)

```text
interface MemoryDispatchOptions
  Options for the process-local activity dispatch reference implementation.

  readonly capacity?: number
    Maximum queued or claimed logical activity items.
  readonly clock?: BaseContext["clock"]
    Clock used for placement, availability, and leases.
  readonly id?: () => string
    Optional deterministic identity source used by tests.
```

### types: MemoryHistory

[Declaration source](types.ts#L623)

```text
interface MemoryHistory extends History
  Process-local history behavior with deterministic diagnostic inspection.

  inspect(runId: string): HistorySnapshotType
    Return the retained instruction state for one workflow run.
```

### types: Scheduler

[Declaration source](types.ts#L1042)

```text
interface Scheduler extends AsyncDisposable
  Workflow interpreter and activity-placement authority.

  schedule(ctx: WorkflowContext, instruction: WorkflowInstruction, path: string): Promise<WorkflowCompletionAny>
    Advance one deterministic workflow instruction through the Scheduler authority.
  register(options: EngineRegistrationOptions): Promise<EngineRegistration>
    Register one live execution provider for an exact engine definition.
  close(reason?: unknown): Promise<void>
    Stop new scheduling and release Scheduler-owned state.
```

### types: SchedulerOptions

[Declaration source](types.ts#L1006)

```text
interface SchedulerOptions
  Options accepted by the standard workflow Scheduler.

  readonly id?: string
    Optional Scheduler identity used to namespace process-local coordination and diagnostics.
  readonly clock?: BaseContext["clock"]
    Clock used for queue claims, registration leases, and retry scheduling.
  readonly command?: WorkflowCommandHandler
    Non-activity command implementation for timers, signals, children, and events.
  readonly history?: History
    Instruction history and replay owner. Omit for non-replayed local execution.
  readonly disposeHistory?: boolean
    Dispose an injected history owner when the Scheduler closes.
  readonly requirements?: RequirementScopeOptions
    Host interpreters used for active workflow and activity admission requirements.
  readonly effect?: EffectEmitter
    Authoritative owner for workflow-level effect announcements.
  readonly activityDispatch?: ActivityDispatch
    Durable dispatch owner shared by workflow schedulers and independent executors.
  readonly activityCapacity?: number
    Maximum items for the default process-local activity dispatch.
  readonly claimDuration?: Temporal.Duration | Temporal.DurationLike | string
    Default activity claim duration before a stalled attempt can be retried.
  readonly disposeActivityDispatch?: boolean
    Dispose an injected activity dispatch owner when the Scheduler closes.
```

### types: WorkflowCancelled

[Declaration source](types.ts#L483)

```text
interface WorkflowCancelled
  Cancelled instruction completion.

  readonly type: "cancelled"
    Stable discriminant for this workflow cancelled variant.
  readonly reason: unknown
    Cancellation reason propagated from the owning workflow or Task lifetime.
```

### types: WorkflowCommandBase

[Declaration source](types.ts#L182)

```text
interface WorkflowCommandBase extends WorkflowInstructionBase
  Shared leaf-command metadata.

  readonly category: "command"
    Instruction category used to route this workflow command base without inspecting its payload.
```

### types: WorkflowCommandOptions

[Declaration source](types.ts#L194)

```text
interface WorkflowCommandOptions
  Public options accepted by simple workflow commands.

  readonly key?: string
    Caller-stable key used for deterministic identity or keyed coordination.
  readonly annotations?: WorkflowAnnotations
    Serializable operator-facing annotations that do not affect execution semantics.
```

### types: WorkflowContext

[Declaration source](types.ts#L151)

```text
interface WorkflowContext<Workflow extends WorkflowDefinition = WorkflowDefinition> extends BaseContext
  Runtime workflow context. It deliberately has no resource resolver.

  readonly workflow: Workflow
    Exact workflow definition whose deterministic program is active.
  readonly runId: string
    Stable workflow-run identity shared across replay activations.
  readonly input: WorkflowInput<Workflow>
    Schema-validated workflow input for this run.
  readonly version: Workflow["version"]
    Workflow definition version recorded for deterministic replay.
  checkpoint(): Promise<void>
    Wait at the pause gate inherited from the owning Task, or only check cancellation when no Task owns the run.
```

### types: WorkflowContextOptions

[Declaration source](types.ts#L1052)

```text
interface WorkflowContextOptions<Workflow extends WorkflowDefinition>
  Inputs accepted while creating one validated workflow context.

  readonly definition: Workflow
    Exact import-safe definition bound to this workflow.
  readonly runId: string
    Stable workflow-run identity used by history and deterministic child/job identity.
  readonly input: unknown
    Untrusted workflow input validated against the definition before the program starts.
  readonly ctx: BaseContext
    Borrowed parent execution context for this workflow.
```

### types: WorkflowContinueCommand

[Declaration source](types.ts#L297)

```text
interface WorkflowContinueCommand extends WorkflowCommandBase
  End the current run and atomically continue with new input.

  readonly type: "continue"
    Stable discriminant for this workflow continue variant.
  readonly input: unknown
    New workflow input persisted for the continued run generation.
```

### types: WorkflowControlBase

[Declaration source](types.ts#L188)

```text
interface WorkflowControlBase extends WorkflowInstructionBase
  Shared control-instruction metadata.

  readonly category: "control"
    Instruction category used to route this workflow control base without inspecting its payload.
```

### types: WorkflowDeferCommand

[Declaration source](types.ts#L289)

```text
interface WorkflowDeferCommand extends WorkflowCommandBase
  Register one cleanup operation for the current workflow scope.

  readonly type: "defer"
    Stable discriminant for this workflow defer variant.
  readonly cleanup: ActivityCommand<unknown, unknown> | ChildWorkflowCommand<unknown, unknown>
    Cleanup activity or child workflow registered for workflow-scope cleanup.
```

### types: WorkflowDefinition

[Declaration source](types.ts#L118)

```text
interface WorkflowDefinition<Authoring extends WorkflowOptions = WorkflowOptions> extends WorkflowReference
  Immutable workflow contract independent from a concrete interpreter.

  readonly description?: string
    Human-readable workflow purpose used by documentation and diagnostics.
  readonly input: Authoring["input"]
    Authoring input schema retained with its exact inferred type.
  readonly result: Authoring["result"]
    Authoring result schema retained with its exact inferred type.
  readonly failures: readonly FailureDefinition[]
    Expected failure definitions or data declared by this workflow.
  readonly effects: readonly EffectDefinition[]
    Effect definitions that code in this workflow may announce.
  readonly activities: readonly ActivityReference[]
    Exact activity definitions admitted by this immutable workflow contract.
  readonly workflows: readonly WorkflowReference[]
    Exact child-workflow definitions admitted by this immutable workflow contract.
```

### types: WorkflowDocument

[Declaration source](types.ts#L1086)

```text
interface WorkflowDocument
  JSON-safe workflow documentation.

  readonly id: string
    Stable workflow definition ID exposed in deterministic generated documentation.
  readonly version: string
    Contract version used to distinguish incompatible workflow shapes.
  readonly description?: string
    Human-readable workflow purpose used by documentation and diagnostics.
  readonly inputVendor: string
    Standard Schema vendor reported by the input contract for documentation.
  readonly resultVendor: string
    Standard Schema vendor reported by the result contract for documentation.
  readonly failures: readonly string[]
    Expected failure definitions or data declared by this workflow.
  readonly effects: readonly string[]
    Effect definitions that code in this workflow may announce.
  readonly activities: readonly string[]
    Stable IDs of activities declared by this workflow contract.
  readonly workflows: readonly string[]
    Stable IDs of child workflows declared by this workflow contract.
  readonly requirements: readonly RequirementDocument[]
    Requirements owned directly by this workflow; reachable dependency requirements remain separate.
```

### types: WorkflowEffectCommand

[Declaration source](types.ts#L279)

```text
interface WorkflowEffectCommand extends WorkflowCommandBase
  Emit one declared effect through the Scheduler's authoritative effect owner.

  readonly type: "effect"
    Stable discriminant for this workflow effect variant.
  readonly effect: EffectDefinition
    Exact declared effect definition emitted by this workflow instruction.
  readonly value: unknown
    Effect value validated by the exact effect definition before authoritative acceptance.
```

### types: WorkflowFailure

[Declaration source](types.ts#L467)

```text
interface WorkflowFailure<Failure = unknown>
  Declared instruction failure completion.

  readonly type: "failure"
    Stable discriminant for this workflow failure variant.
  readonly failure: Failure
    Expected declared failure returned to the suspended workflow generator.
```

### types: WorkflowFault

[Declaration source](types.ts#L475)

```text
interface WorkflowFault
  Unexpected interpreter or implementation fault completion.

  readonly type: "fault"
    Stable discriminant for this workflow fault variant.
  readonly fault: unknown
    Unexpected fault data that must not be treated as a declared failure.
```

### types: WorkflowImplementation

[Declaration source](types.ts#L548)

```text
interface WorkflowImplementation<Workflow extends WorkflowDefinition = WorkflowDefinition>
  Exact workflow implementation.

  readonly definition: Workflow
    Exact import-safe definition bound to this workflow implementation.
  readonly program: (ctx: WorkflowContext<Workflow>) => WorkflowProgram<WorkflowResult<Workflow>>
    Deterministic generator program bound to the exact workflow definition.
```

### types: WorkflowInstructionBase

[Declaration source](types.ts#L168)

```text
interface WorkflowInstructionBase
  Shared instruction metadata.

  readonly category: "command" | "control"
    Instruction category used to route this workflow instruction base without inspecting its payload.
  readonly type: string
    Stable discriminant for this workflow instruction base variant.
  readonly version: number
    Contract version used to distinguish incompatible workflow instruction base shapes.
  readonly key?: string
    Caller-stable key used for deterministic identity or keyed coordination.
  readonly annotations?: WorkflowAnnotations
    Serializable operator-facing annotations that do not affect execution semantics.
```

### types: WorkflowInstructionDescription

[Declaration source](types.ts#L413)

```text
interface WorkflowInstructionDescription
  Serializable description of one yielded workflow instruction.

  readonly path: string
    Deterministic or canonical path associated with this workflow instruction description.
  readonly category: WorkflowInstruction["category"]
    Instruction category used to route this workflow instruction description without inspecting its payload.
  readonly type: WorkflowInstruction["type"]
    Stable discriminant for this workflow instruction description variant.
  readonly version: number
    Contract version used to distinguish incompatible workflow instruction description shapes.
  readonly key?: string
    Caller-stable key used for deterministic identity or keyed coordination.
  readonly annotations?: WorkflowAnnotations
    Serializable operator-facing annotations that do not affect execution semantics.
  readonly payload: WorkflowDurableValue
    JSON-safe instruction payload used in deterministic fingerprint calculation.
```

### types: WorkflowInstructionIdentity

[Declaration source](types.ts#L431)

```text
interface WorkflowInstructionIdentity
  Stable persisted identity material for one yielded workflow instruction.

  readonly description: WorkflowInstructionDescription
    Human-readable workflow instruction identity purpose used by documentation and diagnostics.
  readonly fingerprint: string
    Stable fingerprint recorded to detect semantic divergence on replay.
```

### types: WorkflowMapEntry

[Declaration source](types.ts#L338)

```text
interface WorkflowMapEntry<Value = unknown, Failure = unknown>
  One keyed operation created for a mapped input.

  readonly key: string
    Caller-stable key used for deterministic identity or keyed coordination.
  readonly operation: WorkflowOperation<Value, Failure>
    Child operation coordinated by this workflow map.
```

### types: WorkflowMapInstruction

[Declaration source](types.ts#L360)

```text
interface WorkflowMapInstruction<Value = unknown, Failure = unknown> extends WorkflowControlBase
  Bounded keyed mapping coordination.

  readonly type: "map"
    Stable discriminant for this workflow map variant.
  readonly entries: readonly WorkflowMapEntry<Value, Failure>[]
    Ordered entries retained by this workflow map.
  readonly concurrency: number
    Maximum child operations allowed to make progress at once.
  readonly failure: "fail-fast" | "settle"
    Normalized sibling-failure policy persisted with the map instruction.
```

### types: WorkflowMapOptions

[Declaration source](types.ts#L346)

```text
interface WorkflowMapOptions<Item>
  Public options accepted by bounded mapping.

  readonly concurrency: number
    Maximum child operations allowed to make progress at once.
  readonly key: (item: Item, index: number) => string
    Caller-stable key used for deterministic identity or keyed coordination.
  readonly failure?: "fail-fast" | "settle"
    Sibling-failure policy for mapped child operations.
  readonly instructionKey?: string
    Optional stable key attached to the generated map control instruction.
  readonly annotations?: WorkflowAnnotations
    Serializable operator-facing annotations that do not affect execution semantics.
```

### types: WorkflowOperation

[Declaration source](types.ts#L501)

```text
interface WorkflowOperation<Value, Failure = never>
  Author-facing yieldable workflow value.

  readonly _value?: Value
    Compile-time success type marker. It carries no runtime workflow state.
  readonly _failure?: Failure
    Compile-time declared-failure marker. It carries no runtime workflow state.
  [[Symbol.iterator]](): Generator<WorkflowInstruction, Value, WorkflowCompletionAny>
    Yield this operation's serializable instruction and return its validated successful completion.
```

### types: WorkflowOptions

[Declaration source](types.ts#L94)

```text
interface WorkflowOptions
  Authoring options accepted by {@link define}.

  readonly id: string
    Stable workflow definition ID exposed in deterministic generated documentation.
  readonly version: string
    Contract version used to distinguish incompatible workflow shapes.
  readonly description?: string
    Human-readable workflow purpose used by documentation and diagnostics.
  readonly input: WorkflowSchema
    Schema that validates workflow input before execution.
  readonly result: WorkflowSchema
    Schema that validates successful workflow output.
  readonly failures?: CatalogDefinitionInput<FailureDefinition>
    Expected failure definitions or data declared by this workflow.
  readonly effects?: EffectDefinitions
    Required one-way consequences this workflow program may emit.
  readonly requirements?: RequirementInput
    Requirements owned directly by this workflow; reachable dependency requirements remain separate.
  readonly activities?: CatalogDefinitionInput<ActivityReference>
    Activity definitions this workflow is permitted to request.
  readonly workflows?: CatalogDefinitionInput<WorkflowReference>
    Child-workflow definitions this workflow is permitted to start.
```

### types: WorkflowParallelInstruction

[Declaration source](types.ts#L313)

```text
interface WorkflowParallelInstruction<Operations_ extends WorkflowOperations = WorkflowOperations> extends WorkflowControlBase
  Keyed parallel child-operation coordination.

  readonly type: "parallel"
    Stable discriminant for this workflow parallel variant.
  readonly operations: Operations_
    Keyed child operations coordinated by this workflow parallel.
  readonly concurrency?: number
    Maximum child operations allowed to make progress at once.
  readonly failure: "fail-fast" | "settle"
    Normalized sibling-failure policy persisted with the control instruction.
```

### types: WorkflowParallelOptions

[Declaration source](types.ts#L305)

```text
interface WorkflowParallelOptions extends WorkflowCommandOptions
  Public options accepted by parallel coordination.

  readonly concurrency?: number
    Maximum child operations allowed to make progress at once.
  readonly failure?: "fail-fast" | "settle"
    Sibling-failure policy for this parallel operation.
```

### types: WorkflowRaceInstruction

[Declaration source](types.ts#L329)

```text
interface WorkflowRaceInstruction<Operations_ extends WorkflowOperations = WorkflowOperations> extends WorkflowControlBase
  First-terminal child-operation coordination.

  readonly type: "race"
    Stable discriminant for this workflow race variant.
  readonly operations: Operations_
    Keyed child operations coordinated by this workflow race.
```

### types: WorkflowReference

[Declaration source](types.ts#L78)

```text
interface WorkflowReference extends CatalogEntryIdentity
  Structural workflow contract referenced by child-workflow instructions.

  readonly kind: "workflow"
    Stable discriminant for this workflow value.
  readonly version: string
    Contract version used to distinguish incompatible workflow shapes.
  readonly input: WorkflowSchema
    Schema that validates workflow input before execution.
  readonly result: WorkflowSchema
    Schema that validates successful workflow output.
  readonly failures: readonly FailureDefinition[]
    Expected failure definitions or data declared by this workflow.
  readonly requirements: readonly RequirementDefinition[]
    Requirements owned directly by this workflow; reachable dependency requirements remain separate.
```

### types: WorkflowRetryInstruction

[Declaration source](types.ts#L386)

```text
interface WorkflowRetryInstruction<Value = unknown, Failure = unknown> extends WorkflowControlBase
  Repeat one operation according to one explicit policy.

  readonly type: "retry"
    Stable discriminant for this workflow retry variant.
  readonly operation: WorkflowOperation<Value, Failure>
    Child operation coordinated by this workflow retry.
  readonly maximumAttempts: number
    Maximum logical attempts permitted before the workflow retry becomes terminal.
  readonly delay?: Temporal.Duration
    Initial retry delay before another workflow retry attempt is eligible.
  readonly backoff: number
    Multiplier applied to successive retry delays.
  readonly maximumDelay?: Temporal.Duration
    Upper bound for calculated retry delay.
  readonly jitter: number
    Bounded randomization factor applied to retry delay.
```

### types: WorkflowRetryOptions

[Declaration source](types.ts#L372)

```text
interface WorkflowRetryOptions extends WorkflowCommandOptions
  Public options accepted by workflow-level retry.

  readonly maximumAttempts: number
    Maximum logical attempts permitted before the workflow retry becomes terminal.
  readonly delay?: Temporal.DurationLike | string
    Initial retry delay before another workflow retry attempt is eligible.
  readonly backoff?: number
    Multiplier applied to successive retry delays.
  readonly maximumDelay?: Temporal.DurationLike | string
    Upper bound for calculated retry delay.
  readonly jitter?: number
    Bounded randomization factor applied to retry delay.
```

### types: WorkflowRunOptions

[Declaration source](types.ts#L1064)

```text
interface WorkflowRunOptions<Workflow extends WorkflowDefinition>
  Inputs accepted while executing one workflow implementation.

  readonly ctx: WorkflowContext<Workflow>
    Borrowed parent execution context for this workflow run.
  readonly implementation: WorkflowImplementation<Workflow>
    Exact deterministic workflow implementation to replay and advance.
  readonly scheduler: Scheduler
    Scheduler authority used for every yielded instruction.
```

### types: WorkflowSignal

[Declaration source](types.ts#L235)

```text
interface WorkflowSignal<Value = unknown> extends CatalogEntryIdentity
  Stable signal definition.

  readonly kind: "workflow-signal"
    Stable discriminant for this workflow signal value.
  readonly description?: string
    Human-readable workflow signal purpose used by documentation and diagnostics.
  readonly value: WorkflowSchema<unknown, Value>
    Schema that validates each value delivered for this workflow signal.
```

### types: WorkflowSleepCommand

[Declaration source](types.ts#L227)

```text
interface WorkflowSleepCommand extends WorkflowCommandBase
  Durable sleep command.

  readonly type: "sleep"
    Stable discriminant for this workflow sleep variant.
  readonly duration: Temporal.Duration
    Lease or wait duration applied by this workflow sleep.
```

### types: WorkflowSuccess

[Declaration source](types.ts#L459)

```text
interface WorkflowSuccess<Value = unknown>
  Successful instruction completion.

  readonly type: "success"
    Stable discriminant for this workflow success variant.
  readonly value: Value
    Validated success value returned to the suspended workflow generator.
```

### types: WorkflowWaitCommand

[Declaration source](types.ts#L245)

```text
interface WorkflowWaitCommand<Value = unknown> extends WorkflowCommandBase
  Wait for one matching signal value.

  readonly type: "wait"
    Stable discriminant for this workflow wait variant.
  readonly signal: WorkflowSignal<Value>
    Abort signal controlling this workflow wait local lifetime.
  readonly input: unknown
    Optional correlation or matching data supplied to the signal host.
```

### types: ActivityAttemptResultType

[Declaration source](types.ts#L924)

```text
type ActivityAttemptResultType = Readonly<{ readonly type: "success"; readonly value: unknown; }> | Readonly<{ readonly type: "failure"; readonly failure: unknown; }> | Readonly<{ readonly type: "fault"; readonly fault: unknown; }> | Readonly<{ readonly type: "cancelled"; readonly reason: unknown; }> | Readonly<{ readonly type: "lost"; readonly reason: unknown; }>
  Terminal or retryable result reported by an activity engine provider.
```

### types: ActivityJobResultType

[Declaration source](types.ts#L697)

```text
type ActivityJobResultType = Readonly<{ readonly type: "success"; readonly value: HistoryValueType; }> | Readonly<{ readonly type: "failure"; readonly failure: HistoryFailureOccurrenceType; }> | Readonly<{ readonly type: "fault"; readonly fault: HistoryValueType; }> | Readonly<{ readonly type: "cancelled"; readonly reason: HistoryValueType; }>
  Serializable terminal result retained by the authoritative activity job store.
```

### types: EngineAffinityType

[Declaration source](types.ts#L202)

```text
type EngineAffinityType = Readonly<Record<string, string | number | boolean>>
  Serializable affinity requested from a registered activity engine.
```

### types: EngineChoiceModeType

[Declaration source](types.ts#L29)

```text
type EngineChoiceModeType = "required" | "preferred" | "allowed"
  Selection mode attached to one engine candidate.
```

### types: HistoryCompletionType

[Declaration source](types.ts#L583)

```text
type HistoryCompletionType = Readonly<{ readonly type: "success"; readonly value: HistoryValueType; }> | Readonly<{ readonly type: "failure"; readonly failure: HistoryFailureType; }> | Readonly<{ readonly type: "fault"; readonly fault: HistoryValueType; }> | Readonly<{ readonly type: "cancelled"; readonly reason: HistoryValueType; }>
  JSON-safe completion record that a durable workflow history can persist directly.
```

### types: HistoryFailureType

[Declaration source](types.ts#L578)

```text
type HistoryFailureType = Readonly<{ readonly kind: "occurrence"; readonly value: HistoryFailureOccurrenceType; }> | Readonly<{ readonly kind: "value"; readonly value: HistoryValueType; }>
  JSON-safe expected-failure representation retained by workflow history.
```

### types: HistoryValueType

[Declaration source](types.ts#L563)

```text
type HistoryValueType = Readonly<{ readonly kind: "undefined"; }> | Readonly<{ readonly kind: "value"; readonly value: WorkflowDurableValue; }>
  JSON-safe representation of a value retained in workflow completion history.
```

### types: WorkflowAnnotations

[Declaration source](types.ts#L165)

```text
type WorkflowAnnotations = Readonly<Record<string, string | number | boolean>>
  Instruction annotations safe to persist or expose to operators.
```

### types: WorkflowCatalog

[Declaration source](types.ts#L1074)

```text
type WorkflowCatalog<Entries extends Readonly<Record<PropertyKey, WorkflowDefinition>>> = Catalog<Entries[keyof Entries], Entries>
  Named workflow catalog.
```

### types: WorkflowCommand

[Declaration source](types.ts#L439)

```text
type WorkflowCommand = ActivityCommand | WorkflowSleepCommand | WorkflowWaitCommand | ChildWorkflowCommand | WorkflowEffectCommand | WorkflowDeferCommand | WorkflowContinueCommand
  Leaf instructions requesting one interpreter-owned action.
```

### types: WorkflowCommandHandler

[Declaration source](types.ts#L556)

```text
type WorkflowCommandHandler = (ctx: WorkflowContext, command: Exclude<WorkflowCommand, ActivityCommand>, path: string) => Promise<WorkflowCompletionAny>
  Leaf-command execution supplied for non-activity workflow commands.
```

### types: WorkflowCompletion

[Declaration source](types.ts#L491)

```text
type WorkflowCompletion<Value = unknown, Failure = unknown> = WorkflowSuccess<Value> | WorkflowFailure<Failure> | WorkflowFault | WorkflowCancelled
  WorkflowCompletion returned by an interpreter for one suspended instruction.
```

### types: WorkflowCompletionAny

[Declaration source](types.ts#L498)

```text
type WorkflowCompletionAny = WorkflowCompletion<unknown, unknown>
  Runtime-erased completion.
```

### types: WorkflowControlInstruction

[Declaration source](types.ts#L449)

```text
type WorkflowControlInstruction = WorkflowParallelInstruction | WorkflowRaceInstruction | WorkflowMapInstruction | WorkflowRetryInstruction
  Instructions coordinating nested operations.
```

### types: WorkflowDurableValue

[Declaration source](types.ts#L404)

```text
type WorkflowDurableValue = null | boolean | number | string | readonly WorkflowDurableValue[] | Readonly<{ readonly [key: string]: WorkflowDurableValue; }>
  JSON-safe value that can be persisted as workflow history.
```

### types: WorkflowFailures

[Declaration source](types.ts#L146)

```text
type WorkflowFailures<WorkflowDefinition extends WorkflowReference> = WorkflowDefinition["failures"][number] extends infer Failure_ extends FailureDefinition ? FailureOccurrence<Failure_> : never
  Declared failure occurrence union inferred from a workflow definition.
```

### types: WorkflowInput

[Declaration source](types.ts#L136)

```text
type WorkflowInput<WorkflowDefinition extends WorkflowReference> = StandardSchemaV1.InferOutput<WorkflowDefinition["input"]>
  WorkflowInput value inferred from a workflow definition.
```

### types: WorkflowInstruction

[Declaration source](types.ts#L456)

```text
type WorkflowInstruction = WorkflowCommand | WorkflowControlInstruction
  Any instruction understood by a workflow interpreter.
```

### types: WorkflowOperationFailure

[Declaration source](types.ts#L515)

```text
type WorkflowOperationFailure<Value extends WorkflowOperation<unknown, unknown>> = Value extends WorkflowOperation<infer _Output, infer Failure> ? Failure : never
  Extract the failure value from an operation.
```

### types: WorkflowOperationFailures

[Declaration source](types.ts#L535)

```text
type WorkflowOperationFailures<Values extends WorkflowOperations> = WorkflowOperationFailure<Values[keyof Values]>
  Union of failures represented by a keyed operation record.
```

### types: WorkflowOperationValue

[Declaration source](types.ts#L511)

```text
type WorkflowOperationValue<Value extends WorkflowOperation<unknown, unknown>> = Value extends WorkflowOperation<infer Output, infer _Failure> ? Output : never
  Extract the success value from an operation.
```

### types: WorkflowOperationValues

[Declaration source](types.ts#L522)

```text
type WorkflowOperationValues<Values extends WorkflowOperations> = readonly [Key in keyof Values]: WorkflowOperationValue<Values[Key]>
  Key-preserving operation success values.
```

### types: WorkflowOperations

[Declaration source](types.ts#L519)

```text
type WorkflowOperations = Readonly<Record<string, WorkflowOperation<unknown, unknown>>>
  Keyed operation record.
```

### types: WorkflowProgram

[Declaration source](types.ts#L545)

```text
type WorkflowProgram<Value> = Generator<WorkflowInstruction, Value, WorkflowCompletionAny>
  Workflow generator program.
```

### types: WorkflowRaceOptions

[Declaration source](types.ts#L326)

```text
type WorkflowRaceOptions = WorkflowCommandOptions
  Public options accepted by race coordination.
```

### types: WorkflowRaceResult

[Declaration source](types.ts#L540)

```text
type WorkflowRaceResult<Values extends WorkflowOperations> = readonly [Key in keyof Values]: Readonly<{ readonly key: Key; readonly value: WorkflowOperationValue<Values[Key]>; }>[keyof Values]
  WorkflowResult returned by a race.
```

### types: WorkflowResult

[Declaration source](types.ts#L141)

```text
type WorkflowResult<WorkflowDefinition extends WorkflowReference> = StandardSchemaV1.InferOutput<WorkflowDefinition["result"]>
  Result value inferred from a workflow definition.
```

### types: WorkflowSchema

[Declaration source](types.ts#L20)

```text
type WorkflowSchema<WorkflowInput = unknown, Output = WorkflowInput> = StandardSchemaV1<WorkflowInput, Output>
  Static schema accepted by workflow definitions, signals, and events.
```

### types: WorkflowSelection

[Declaration source](types.ts#L1080)

```text
type WorkflowSelection<Entry extends WorkflowDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>
  Key-preserving workflow catalog selection.
```

### types: WorkflowSettledValues

[Declaration source](types.ts#L527)

```text
type WorkflowSettledValues<Values extends WorkflowOperations> = readonly [Key in keyof Values]: ExplicitResult<WorkflowOperationValue<Values[Key]>, WorkflowOperationFailure<Values[Key]>>
  Key-preserving settled operation values.
```
