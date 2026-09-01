import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	Catalog,
	CatalogEntryIdentity,
	CatalogSelection,
	DefinitionInput as CatalogDefinitionInput,
} from '@okikio/catalog';
import type { Context as BaseContext, Snapshot as ContextSnapshot } from '@okikio/context';
import type { EffectDefinition, EffectDefinitions, EffectEmitter } from '@okikio/effect';
import type { Definition as FailureDefinition, Occurrence as FailureOccurrence } from '@okikio/failure';
import type { RequirementDefinition, RequirementInput, RequirementDocument, RequirementScopeOptions } from '@okikio/requirement';
import type { Result as ExplicitResult } from '@okikio/result';
import type { Queue } from '@okikio/queue';
import type { ResiliencePolicy } from '@okikio/resilience';

/** Static schema accepted by workflow definitions, signals, and events. */
export type WorkflowSchema<WorkflowInput = unknown, Output = WorkflowInput> = StandardSchemaV1<WorkflowInput, Output>;

/** Structural activity-engine identity referenced without importing the activity package. */
export interface EngineReference extends CatalogEntryIdentity {
	/** Stable discriminant for this engine value. */
	readonly kind: 'activity-engine';
}

/** Selection mode attached to one engine candidate. */
export type EngineChoiceModeType = 'required' | 'preferred' | 'allowed';

/** Structural engine candidate retained in an activity contract. */
export interface EngineChoiceReference {
	/** Stable discriminant for this engine choice value. */
	readonly kind: 'activity-engine-choice';
	/** Selection or operation mode that controls this engine choice. */
	readonly mode: EngineChoiceModeType;
	/** Engine identity associated with this engine choice. */
	readonly engine: EngineReference;
}

/** Structural ordered placement retained in an activity contract. */
export interface EnginePlacementReference {
	/** Stable discriminant for this engine placement value. */
	readonly kind: 'activity-engine-placement';
	/** Ordered structural engine choices retained without importing the activity package. */
	readonly choices: readonly EngineChoiceReference[];
}

/** Structural activity contract referenced by workflow instructions. */
export interface ActivityReference extends CatalogEntryIdentity {
	/** Stable discriminant for this activity value. */
	readonly kind: 'activity';
	/** Contract version used to distinguish incompatible activity shapes. */
	readonly version: string;
	/** Schema that validates activity input before execution. */
	readonly input: WorkflowSchema;
	/** Schema that validates successful activity output. */
	readonly result: WorkflowSchema;
	/** Expected failure definitions or data declared by this activity. */
	readonly failures: readonly FailureDefinition[];
	/** Requirements owned directly by this activity; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDefinition[];
	/** Ordered engine placement declaration used before attempt dispatch. */
	readonly placement: EnginePlacementReference;
	/** Static resilience policies applied at the activity lifecycle. */
	readonly resilience: readonly ResiliencePolicy[];
}

/** Structural workflow contract referenced by child-workflow instructions. */
export interface WorkflowReference extends CatalogEntryIdentity {
	/** Stable discriminant for this workflow value. */
	readonly kind: 'workflow';
	/** Contract version used to distinguish incompatible workflow shapes. */
	readonly version: string;
	/** Schema that validates workflow input before execution. */
	readonly input: WorkflowSchema;
	/** Schema that validates successful workflow output. */
	readonly result: WorkflowSchema;
	/** Expected failure definitions or data declared by this workflow. */
	readonly failures: readonly FailureDefinition[];
	/** Requirements owned directly by this workflow; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDefinition[];
}

/** Authoring options accepted by {@link define}. */
export interface WorkflowOptions {
	/** Stable workflow definition ID exposed in deterministic generated documentation. */
	readonly id: string;
	/** Contract version used to distinguish incompatible workflow shapes. */
	readonly version: string;
	/** Human-readable workflow purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Schema that validates workflow input before execution. */
	readonly input: WorkflowSchema;
	/** Schema that validates successful workflow output. */
	readonly result: WorkflowSchema;
	/** Expected failure definitions or data declared by this workflow. */
	readonly failures?: CatalogDefinitionInput<FailureDefinition>;
	/** Required one-way consequences this workflow program may emit. */
	readonly effects?: EffectDefinitions;
	/** Requirements owned directly by this workflow; reachable dependency requirements remain separate. */
	readonly requirements?: RequirementInput;
	/** Activity definitions this workflow is permitted to request. */
	readonly activities?: CatalogDefinitionInput<ActivityReference>;
	/** Child-workflow definitions this workflow is permitted to start. */
	readonly workflows?: CatalogDefinitionInput<WorkflowReference>;
}

/** Immutable workflow contract independent from a concrete interpreter. */
export interface WorkflowDefinition<Authoring extends WorkflowOptions = WorkflowOptions> extends WorkflowReference {
	/** Human-readable workflow purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Authoring input schema retained with its exact inferred type. */
	readonly input: Authoring['input'];
	/** Authoring result schema retained with its exact inferred type. */
	readonly result: Authoring['result'];
	/** Expected failure definitions or data declared by this workflow. */
	readonly failures: readonly FailureDefinition[];
	/** Required effect definitions or scoped effect state associated with this workflow. */
	readonly effects: readonly EffectDefinition[];
	/** Exact activity definitions admitted by this immutable workflow contract. */
	readonly activities: readonly ActivityReference[];
	/** Exact child-workflow definitions admitted by this immutable workflow contract. */
	readonly workflows: readonly WorkflowReference[];
}

/** WorkflowInput value inferred from a workflow definition. */
export type WorkflowInput<WorkflowDefinition extends WorkflowReference> = StandardSchemaV1.InferOutput<
	WorkflowDefinition['input']
>;

/** Result value inferred from a workflow definition. */
export type WorkflowResult<WorkflowDefinition extends WorkflowReference> = StandardSchemaV1.InferOutput<
	WorkflowDefinition['result']
>;

/** Declared failure occurrence union inferred from a workflow definition. */
export type WorkflowFailures<WorkflowDefinition extends WorkflowReference> = WorkflowDefinition['failures'][number] extends
	infer Failure_ extends FailureDefinition ? FailureOccurrence<Failure_>
	: never;

/** Runtime workflow context. It deliberately has no resource resolver. */
export interface WorkflowContext<Workflow extends WorkflowDefinition = WorkflowDefinition> extends BaseContext {
	/** Exact workflow definition whose deterministic program is active. */
	readonly workflow: Workflow;
	/** Stable workflow-run identity shared across replay activations. */
	readonly runId: string;
	/** Schema-validated workflow input for this run. */
	readonly input: WorkflowInput<Workflow>;
	/** Workflow definition version recorded for deterministic replay. */
	readonly version: Workflow['version'];
	/** Wait at the pause gate inherited from the owning Task, or only check cancellation when no Task owns the run. */
	checkpoint(): Promise<void>;
}

/** Instruction annotations safe to persist or expose to operators. */
export type WorkflowAnnotations = Readonly<Record<string, string | number | boolean>>;

/** Shared instruction metadata. */
export interface WorkflowInstructionBase {
	/** Instruction category used to route this workflow instruction base without inspecting its payload. */
	readonly category: 'command' | 'control';
	/** Stable discriminant for this workflow instruction base variant. */
	readonly type: string;
	/** Contract version used to distinguish incompatible workflow instruction base shapes. */
	readonly version: number;
	/** Caller-stable key used for deterministic identity or keyed coordination. */
	readonly key?: string;
	/** Serializable operator-facing annotations that do not affect execution semantics. */
	readonly annotations?: WorkflowAnnotations;
}

/** Shared leaf-command metadata. */
export interface WorkflowCommandBase extends WorkflowInstructionBase {
	/** Instruction category used to route this workflow command base without inspecting its payload. */
	readonly category: 'command';
}

/** Shared control-instruction metadata. */
export interface WorkflowControlBase extends WorkflowInstructionBase {
	/** Instruction category used to route this workflow control base without inspecting its payload. */
	readonly category: 'control';
}

/** Public options accepted by simple workflow commands. */
export interface WorkflowCommandOptions {
	/** Caller-stable key used for deterministic identity or keyed coordination. */
	readonly key?: string;
	/** Serializable operator-facing annotations that do not affect execution semantics. */
	readonly annotations?: WorkflowAnnotations;
}

/** Serializable affinity requested from a registered activity engine. */
export type EngineAffinityType = Readonly<Record<string, string | number | boolean>>;

/** Public options accepted by activity requests. */
export interface ActivityCommandOptions extends WorkflowCommandOptions {
	/** Exact host-affinity fields that a live registration must match. */
	readonly affinity?: EngineAffinityType;
}

/** Activity execution command. */
export interface ActivityCommand<Value = unknown, Failure = unknown> extends WorkflowCommandBase {
	/** Stable discriminant for this activity variant. */
	readonly type: 'activity';
	readonly activity: ActivityReference;
	/** Activity input retained as serializable workflow instruction data. */
	readonly input: unknown;
	readonly options: ActivityCommandOptions;
	readonly _value?: Value;
	readonly _failure?: Failure;
}

/** Durable sleep command. */
export interface WorkflowSleepCommand extends WorkflowCommandBase {
	/** Stable discriminant for this workflow sleep variant. */
	readonly type: 'sleep';
	/** Lease or wait duration applied by this workflow sleep. */
	readonly duration: Temporal.Duration;
}

/** Stable signal definition. */
export interface WorkflowSignal<Value = unknown> extends CatalogEntryIdentity {
	/** Stable discriminant for this workflow signal value. */
	readonly kind: 'workflow-signal';
	/** Human-readable workflow signal purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Schema that validates each value delivered for this workflow signal. */
	readonly value: WorkflowSchema<unknown, Value>;
}

/** Wait for one matching signal value. */
export interface WorkflowWaitCommand<Value = unknown> extends WorkflowCommandBase {
	/** Stable discriminant for this workflow wait variant. */
	readonly type: 'wait';
	/** Abort signal controlling this workflow wait local lifetime. */
	readonly signal: WorkflowSignal<Value>;
	/** Optional correlation or matching data supplied to the signal host. */
	readonly input: unknown;
}

/** Public options accepted by child workflow operations. */
export interface ChildOptions extends WorkflowCommandOptions {
	readonly cancellation?: 'follow-parent' | 'request' | 'independent';
	/** Whether the parent waits for the child result or deliberately discards it. */
	readonly result?: 'wait' | 'discard';
}

/** Start or await one child workflow. */
export interface ChildWorkflowCommand<Value = unknown, Failure = unknown> extends WorkflowCommandBase {
	/** Stable discriminant for this childworkflow variant. */
	readonly type: 'child-workflow';
	readonly workflow: WorkflowReference;
	/** Child-workflow input retained as serializable instruction data. */
	readonly input: unknown;
	readonly options: ChildOptions;
	readonly _value?: Value;
	readonly _failure?: Failure;
}

/** Emit one required effect through the Scheduler's authoritative effect owner. */
export interface WorkflowEffectCommand extends WorkflowCommandBase {
	/** Stable discriminant for this workflow effect variant. */
	readonly type: 'effect';
	/** Exact required-effect definition emitted by this workflow instruction. */
	readonly effect: EffectDefinition;
	/** Effect value validated by the exact effect definition before authoritative acceptance. */
	readonly value: unknown;
}

/** Register one cleanup operation for the current workflow scope. */
export interface WorkflowDeferCommand extends WorkflowCommandBase {
	/** Stable discriminant for this workflow defer variant. */
	readonly type: 'defer';
	/** Cleanup activity or child workflow registered for workflow-scope cleanup. */
	readonly cleanup: ActivityCommand<unknown, unknown> | ChildWorkflowCommand<unknown, unknown>;
}

/** End the current run and atomically continue with new input. */
export interface WorkflowContinueCommand extends WorkflowCommandBase {
	/** Stable discriminant for this workflow continue variant. */
	readonly type: 'continue';
	/** New workflow input persisted for the continued run generation. */
	readonly input: unknown;
}

/** Public options accepted by parallel coordination. */
export interface WorkflowParallelOptions extends WorkflowCommandOptions {
	/** Maximum child operations allowed to make progress at once. */
	readonly concurrency?: number;
	/** Sibling-failure policy for this parallel operation. */
	readonly failure?: 'fail-fast' | 'settle';
}

/** Keyed parallel child-operation coordination. */
export interface WorkflowParallelInstruction<Operations_ extends WorkflowOperations = WorkflowOperations> extends WorkflowControlBase {
	/** Stable discriminant for this workflow parallel variant. */
	readonly type: 'parallel';
	/** Keyed child operations coordinated by this workflow parallel. */
	readonly operations: Operations_;
	/** Maximum child operations allowed to make progress at once. */
	readonly concurrency?: number;
	/** Normalized sibling-failure policy persisted with the control instruction. */
	readonly failure: 'fail-fast' | 'settle';
}

/** Public options accepted by race coordination. */
export type WorkflowRaceOptions = WorkflowCommandOptions;

/** First-terminal child-operation coordination. */
export interface WorkflowRaceInstruction<Operations_ extends WorkflowOperations = WorkflowOperations> extends WorkflowControlBase {
	/** Stable discriminant for this workflow race variant. */
	readonly type: 'race';
	/** Keyed child operations coordinated by this workflow race. */
	readonly operations: Operations_;
}

/** One keyed operation created for a mapped input. */
export interface WorkflowMapEntry<Value = unknown, Failure = unknown> {
	/** Caller-stable key used for deterministic identity or keyed coordination. */
	readonly key: string;
	/** Child operation coordinated by this workflow map. */
	readonly operation: WorkflowOperation<Value, Failure>;
}

/** Public options accepted by bounded mapping. */
export interface WorkflowMapOptions<Item> {
	/** Maximum child operations allowed to make progress at once. */
	readonly concurrency: number;
	/** Caller-stable key used for deterministic identity or keyed coordination. */
	readonly key: (item: Item, index: number) => string;
	/** Sibling-failure policy for mapped child operations. */
	readonly failure?: 'fail-fast' | 'settle';
	/** Optional stable key attached to the generated map control instruction. */
	readonly instructionKey?: string;
	/** Serializable operator-facing annotations that do not affect execution semantics. */
	readonly annotations?: WorkflowAnnotations;
}

/** Bounded keyed mapping coordination. */
export interface WorkflowMapInstruction<Value = unknown, Failure = unknown> extends WorkflowControlBase {
	/** Stable discriminant for this workflow map variant. */
	readonly type: 'map';
	/** Ordered entries retained by this workflow map. */
	readonly entries: readonly WorkflowMapEntry<Value, Failure>[];
	/** Maximum child operations allowed to make progress at once. */
	readonly concurrency: number;
	/** Normalized sibling-failure policy persisted with the map instruction. */
	readonly failure: 'fail-fast' | 'settle';
}

/** Public options accepted by workflow-level retry. */
export interface WorkflowRetryOptions extends WorkflowCommandOptions {
	/** Maximum logical attempts permitted before the workflow retry becomes terminal. */
	readonly maximumAttempts: number;
	/** Initial retry delay before another workflow retry attempt is eligible. */
	readonly delay?: Temporal.DurationLike | string;
	/** Multiplier applied to successive retry delays. */
	readonly backoff?: number;
	/** Upper bound for calculated retry delay. */
	readonly maximumDelay?: Temporal.DurationLike | string;
	/** Bounded randomization factor applied to retry delay. */
	readonly jitter?: number;
}

/** Repeat one operation according to one explicit policy. */
export interface WorkflowRetryInstruction<Value = unknown, Failure = unknown> extends WorkflowControlBase {
	/** Stable discriminant for this workflow retry variant. */
	readonly type: 'retry';
	/** Child operation coordinated by this workflow retry. */
	readonly operation: WorkflowOperation<Value, Failure>;
	/** Maximum logical attempts permitted before the workflow retry becomes terminal. */
	readonly maximumAttempts: number;
	/** Initial retry delay before another workflow retry attempt is eligible. */
	readonly delay?: Temporal.Duration;
	/** Multiplier applied to successive retry delays. */
	readonly backoff: number;
	/** Upper bound for calculated retry delay. */
	readonly maximumDelay?: Temporal.Duration;
	/** Bounded randomization factor applied to retry delay. */
	readonly jitter: number;
}

/** JSON-safe value that can be persisted as workflow history. */
export type WorkflowDurableValue =
	| null
	| boolean
	| number
	| string
	| readonly WorkflowDurableValue[]
	| Readonly<{ readonly [key: string]: WorkflowDurableValue }>;

/** Serializable description of one yielded workflow instruction. */
export interface WorkflowInstructionDescription {
	/** Deterministic or canonical path associated with this workflow instruction description. */
	readonly path: string;
	/** Instruction category used to route this workflow instruction description without inspecting its payload. */
	readonly category: WorkflowInstruction['category'];
	/** Stable discriminant for this workflow instruction description variant. */
	readonly type: WorkflowInstruction['type'];
	/** Contract version used to distinguish incompatible workflow instruction description shapes. */
	readonly version: number;
	/** Caller-stable key used for deterministic identity or keyed coordination. */
	readonly key?: string;
	/** Serializable operator-facing annotations that do not affect execution semantics. */
	readonly annotations?: WorkflowAnnotations;
	/** JSON-safe instruction payload used in deterministic fingerprint calculation. */
	readonly payload: WorkflowDurableValue;
}

/** Stable persisted identity material for one yielded workflow instruction. */
export interface WorkflowInstructionIdentity {
	/** Human-readable workflow instruction identity purpose used by documentation and diagnostics. */
	readonly description: WorkflowInstructionDescription;
	/** Stable fingerprint recorded to detect semantic divergence on replay. */
	readonly fingerprint: string;
}

/** Leaf instructions requesting one interpreter-owned action. */
export type WorkflowCommand =
	| ActivityCommand
	| WorkflowSleepCommand
	| WorkflowWaitCommand
	| ChildWorkflowCommand
	| WorkflowEffectCommand
	| WorkflowDeferCommand
	| WorkflowContinueCommand;

/** Instructions coordinating nested operations. */
export type WorkflowControlInstruction = WorkflowParallelInstruction | WorkflowRaceInstruction | WorkflowMapInstruction | WorkflowRetryInstruction;

/** Any instruction understood by a workflow interpreter. */
export type WorkflowInstruction = WorkflowCommand | WorkflowControlInstruction;

/** Successful instruction completion. */
export interface WorkflowSuccess<Value = unknown> {
	/** Stable discriminant for this workflow success variant. */
	readonly type: 'success';
	/** Validated success value returned to the suspended workflow generator. */
	readonly value: Value;
}

/** Declared instruction failure completion. */
export interface WorkflowFailure<Failure = unknown> {
	/** Stable discriminant for this workflow failure variant. */
	readonly type: 'failure';
	/** Expected declared failure returned to the suspended workflow generator. */
	readonly failure: Failure;
}

/** Unexpected interpreter or implementation fault completion. */
export interface WorkflowFault {
	/** Stable discriminant for this workflow fault variant. */
	readonly type: 'fault';
	/** Unexpected fault data that must not be treated as a declared failure. */
	readonly fault: unknown;
}

/** Cancelled instruction completion. */
export interface WorkflowCancelled {
	/** Stable discriminant for this workflow cancelled variant. */
	readonly type: 'cancelled';
	/** Cancellation reason propagated from the owning workflow or Task lifetime. */
	readonly reason: unknown;
}

/** WorkflowCompletion returned by an interpreter for one suspended instruction. */
export type WorkflowCompletion<Value = unknown, Failure = unknown> =
	| WorkflowSuccess<Value>
	| WorkflowFailure<Failure>
	| WorkflowFault
	| WorkflowCancelled;

/** Runtime-erased completion. */
export type WorkflowCompletionAny = WorkflowCompletion<unknown, unknown>;

/** Author-facing yieldable workflow value. */
export interface WorkflowOperation<Value, Failure = never> {
	/** Compile-time success type marker. It carries no runtime workflow state. */
	readonly _value?: Value;
	/** Compile-time declared-failure marker. It carries no runtime workflow state. */
	readonly _failure?: Failure;
	/** Yield this operation's serializable instruction and return its validated successful completion. */
	[Symbol.iterator](): Generator<WorkflowInstruction, Value, WorkflowCompletionAny>;
}

/** Extract the success value from an operation. */
export type WorkflowOperationValue<Value extends WorkflowOperation<unknown, unknown>> = Value extends
	WorkflowOperation<infer Output, infer _Failure> ? Output : never;

/** Extract the failure value from an operation. */
export type WorkflowOperationFailure<Value extends WorkflowOperation<unknown, unknown>> = Value extends
	WorkflowOperation<infer _Output, infer Failure> ? Failure : never;

/** Keyed operation record. */
export type WorkflowOperations = Readonly<Record<string, WorkflowOperation<unknown, unknown>>>;

/** Key-preserving operation success values. */
export type WorkflowOperationValues<Values extends WorkflowOperations> = {
	readonly [Key in keyof Values]: WorkflowOperationValue<Values[Key]>;
};

/** Key-preserving settled operation values. */
export type WorkflowSettledValues<Values extends WorkflowOperations> = {
	readonly [Key in keyof Values]: ExplicitResult<WorkflowOperationValue<Values[Key]>, WorkflowOperationFailure<Values[Key]>>;
};

/** Union of failures represented by a keyed operation record. */
export type WorkflowOperationFailures<Values extends WorkflowOperations> = WorkflowOperationFailure<Values[keyof Values]>;

/** WorkflowResult returned by a race. */
export type WorkflowRaceResult<Values extends WorkflowOperations> = {
	readonly [Key in keyof Values]: Readonly<{ readonly key: Key; readonly value: WorkflowOperationValue<Values[Key]> }>;
}[keyof Values];

/** Workflow generator program. */
export type WorkflowProgram<Value> = Generator<WorkflowInstruction, Value, WorkflowCompletionAny>;

/** Exact workflow implementation. */
export interface WorkflowImplementation<Workflow extends WorkflowDefinition = WorkflowDefinition> {
	/** Exact import-safe definition bound to this workflow implementation. */
	readonly definition: Workflow;
	/** Deterministic generator program bound to the exact workflow definition. */
	readonly program: (ctx: WorkflowContext<Workflow>) => WorkflowProgram<WorkflowResult<Workflow>>;
}

/** Leaf-command execution supplied for non-activity workflow commands. */
export type WorkflowCommandHandler = (
	ctx: WorkflowContext,
	command: Exclude<WorkflowCommand, ActivityCommand>,
	path: string,
) => Promise<WorkflowCompletionAny>;

/** JSON-safe representation of a value retained in workflow completion history. */
export type HistoryValueType =
	| Readonly<{ readonly kind: 'undefined' }>
	| Readonly<{ readonly kind: 'value'; readonly value: WorkflowDurableValue }>;

/** JSON-safe expected-failure occurrence retained by workflow history. */
export interface HistoryFailureOccurrenceType {
	/** Stable failure definition ID resolved through the replayed workflow contract. */
	readonly id: string;
	/** JSON-safe failure data revalidated before the occurrence is reconstructed. */
	readonly data: WorkflowDurableValue;
	/** Durable failure message retained without a process-local cause. */
	readonly message: string;
}

/** JSON-safe expected-failure representation retained by workflow history. */
export type HistoryFailureType =
	| Readonly<{ readonly kind: 'occurrence'; readonly value: HistoryFailureOccurrenceType }>
	| Readonly<{ readonly kind: 'value'; readonly value: HistoryValueType }>;

/** JSON-safe completion record that a durable workflow history can persist directly. */
export type HistoryCompletionType =
	| Readonly<{ readonly type: 'success'; readonly value: HistoryValueType }>
	| Readonly<{ readonly type: 'failure'; readonly failure: HistoryFailureType }>
	| Readonly<{ readonly type: 'fault'; readonly fault: HistoryValueType }>
	| Readonly<{ readonly type: 'cancelled'; readonly reason: HistoryValueType }>;

/** Input passed to one workflow instruction history owner. */
export interface HistoryInput {
	/** Workflow execution context containing the stable run identity. */
	readonly ctx: WorkflowContext;
	/** Exact instruction yielded at the current deterministic path. */
	readonly instruction: WorkflowInstruction;
	/** Deterministic path within the workflow program. */
	readonly path: string;
	/** Stable description and fingerprint used to verify replay. */
	readonly identity: WorkflowInstructionIdentity;
	/** Advances this instruction when history has no recorded completion. */
	readonly next: () => Promise<WorkflowCompletionAny>;
	/** Encodes a newly produced completion into the JSON-safe history representation. */
	readonly encode: (completion: WorkflowCompletionAny) => Promise<HistoryCompletionType>;
	/** Decodes one stored history completion through the current exact workflow definitions. */
	readonly decode: (completion: HistoryCompletionType) => Promise<WorkflowCompletionAny>;
}

/**
 * Authoritative instruction-history behavior used by a Scheduler.
 *
 * A history can return a recorded completion during replay or call `next()` to
 * advance a new instruction. Durable implementations must persist identity
 * before external dispatch and fence concurrent owners in their own storage
 * transaction/claim model.
 */
export interface History extends AsyncDisposable {
	/** Return a recorded completion or advance one new deterministic instruction. */
	schedule(input: HistoryInput): Promise<WorkflowCompletionAny>;
	/** Stop accepting new history work and release implementation-owned state. */
	close(reason?: unknown): Promise<void>;
}

/** Process-local history behavior with deterministic diagnostic inspection. */
export interface MemoryHistory extends History {
	/** Return the retained instruction state for one workflow run. */
	inspect(runId: string): HistorySnapshotType;
}

/** Bounded process-local history options used by `history.memory()`. */
export interface HistoryOptions {
	/** Maximum instruction records retained across all in-memory runs. */
	readonly maximumEntries?: number;
}

/** Immutable diagnostic record for one retained workflow instruction. */
export interface HistoryEntryType {
	/** Deterministic workflow instruction path. */
	readonly path: string;
	/** Fingerprint recorded when the instruction first entered history. */
	readonly fingerprint: string;
	/** JSON-safe recorded completion when the instruction reached terminal state. */
	readonly completion?: HistoryCompletionType;
	/** Whether one process-local caller currently owns the unresolved instruction. */
	readonly pending: boolean;
}

/** Immutable diagnostic snapshot of one workflow run's process-local history. */
export interface HistorySnapshotType {
	/** Stable workflow run identity. */
	readonly runId: string;
	/** Retained instruction records sorted by deterministic path. */
	readonly entries: readonly HistoryEntryType[];
}

/** Capacity advertised by one live engine registration. */
export interface EngineCapacityType {
	/** Maximum simultaneous attempts admitted through this registration. */
	readonly maximum: number;
	/** Attempts currently owned by this Scheduler replica. */
	readonly active: number;
	/** Remaining local admission slots. */
	readonly available: number;
}

/** Serializable activity-job origin retained for replay and diagnostics. */
export interface ActivityOriginType {
	/** Workflow definition ID that yielded this activity instruction. */
	readonly workflowId: string;
	/** Workflow definition version that originated this work. */
	readonly workflowVersion: string;
	/** Workflow run ID whose history owns this logical activity job. */
	readonly runId: string;
	/** Deterministic instruction path inside the workflow program. */
	readonly instructionPath: string;
	/** Fingerprint used to detect replay divergence at the instruction path. */
	readonly instructionFingerprint: string;
}

/** One serializable logical activity job stored by the Scheduler queue. */
export interface ActivityJobType {
	/** Stable activity definition ID resolved from the replayed workflow instruction. */
	readonly activityId: string;
	/** Activity contract version that must match the replayed instruction and selected provider. */
	readonly activityVersion: string;
	/** JSON-safe activity input retained by the authoritative activity job store. */
	readonly input: unknown;
	/** Workflow instruction identity that admitted this logical activity job. */
	readonly origin: ActivityOriginType;
	/** Serializable execution-context snapshot restored by the receiving host. */
	readonly context: ContextSnapshot;
	/** Serializable affinity facts that must match before placement. */
	readonly affinity?: EngineAffinityType;
}

/** Serializable terminal result retained by the authoritative activity job store. */
export type ActivityJobResultType =
	| Readonly<{ readonly type: 'success'; readonly value: HistoryValueType }>
	| Readonly<{ readonly type: 'failure'; readonly failure: HistoryFailureOccurrenceType }>
	| Readonly<{ readonly type: 'fault'; readonly fault: HistoryValueType }>
	| Readonly<{ readonly type: 'cancelled'; readonly reason: HistoryValueType }>;

/** Serializable identity and input for one fenced activity attempt. */
export interface ActivityAttemptType {
	/** Stable logical job ID shared by every attempt of the same activity request. */
	readonly jobId: string;
	/** One-based Scheduler attempt number for this logical activity job. */
	readonly attempt: number;
	/** Exact queue claim ID that fences all mutations from this attempt. */
	readonly claimId: string;
	/** Stable activity definition ID resolved by the receiving provider. */
	readonly activityId: string;
	/** Activity contract version required by the selected provider. */
	readonly activityVersion: string;
	/** Engine definition ID selected before this attempt was dispatched. */
	readonly engineId: string;
	/** Exact live registration ID whose capacity owns this attempt. */
	readonly registrationId: string;
	/** Provider host ID paired with `generation` for stale-result fencing. */
	readonly hostId: string;
	/** Host generation used to fence results from a replaced live host. */
	readonly generation: number;
	/** Durable workflow instruction identity that admitted this logical job. */
	readonly origin: ActivityOriginType;
	/** Serializable execution-context snapshot restored by the receiving host. */
	readonly context: ContextSnapshot;
	/** Cloneable schema-safe activity input delivered to the selected provider. */
	readonly input: unknown;
	/** True because the Scheduler applied direct active requirements before placement. */
	readonly admitted: true;
}

/** Terminal or retryable result reported by an activity engine provider. */
export type ActivityAttemptResultType =
	| Readonly<{ readonly type: 'success'; readonly value: unknown }>
	| Readonly<{ readonly type: 'failure'; readonly failure: unknown }>
	| Readonly<{ readonly type: 'fault'; readonly fault: unknown }>
	| Readonly<{ readonly type: 'cancelled'; readonly reason: unknown }>
	| Readonly<{ readonly type: 'lost'; readonly reason: unknown }>;

/** Host controls available while one provider owns a fenced attempt. */
export interface ActivityAttemptControl {
	/** Renew the authoritative queue claim after provider liveness evidence. */
	heartbeat(value?: unknown): Promise<void>;
}

/** Live execution target registered with one Scheduler. */
export interface EngineProvider {
	/** Exact activity definitions this provider can run. */
	readonly activities: readonly ActivityReference[];
	/** Fulfill one fenced attempt without creating another logical retry. */
	run(ctx: BaseContext, attempt: ActivityAttemptType, control: ActivityAttemptControl): Promise<ActivityAttemptResultType>;
	/** Best-effort cooperative cancellation for an attempt already dispatched. */
	cancel?(attempt: ActivityAttemptType, reason?: unknown): void | Promise<void>;
}

/** Inputs accepted when registering one live engine provider. */
export interface EngineRegistrationOptions {
	/** Exact engine definition advertised by this live registration. */
	readonly engine: EngineReference;
	/** Live provider that accepts fenced attempts for this registration. */
	readonly provider: EngineProvider;
	/** Stable live-host identity used with generation fencing. */
	readonly hostId: string;
	/** Maximum simultaneous attempts this registration can own. */
	readonly capacity?: number;
	/** Serializable host-affinity facts considered during placement. */
	readonly affinity?: EngineAffinityType;
	/** Provider protocol version recorded for compatibility checks. */
	readonly protocolVersion?: number;
	/** Optional registration lease. Omit for a process-local registration owned by explicit disposal. */
	readonly lease?: Temporal.Duration | Temporal.DurationLike | string;
	/** Transfer provider disposal to the registration when true. */
	readonly disposeProvider?: boolean;
}

/** Live registration handle. Disposal stops new placement and fences late results. */
export interface EngineRegistration extends AsyncDisposable {
	/** Unique registration identity used to fence attempts from other registrations. */
	readonly id: string;
	/** Exact engine definition represented by this registration. */
	readonly engine: EngineReference;
	/** Stable host identity whose reconnects increment generation. */
	readonly hostId: string;
	/** Monotonic host generation used to reject late results after reconnect. */
	readonly generation: number;
	/** Protocol version advertised by the live provider. */
	readonly protocolVersion: number;
	/** Serializable affinity facts used by Scheduler placement. */
	readonly affinity: EngineAffinityType | undefined;
	/** Exact activity definitions this provider can execute. */
	readonly activities: readonly ActivityReference[];
	/** Current local admission capacity snapshot. */
	readonly capacity: EngineCapacityType;
	/** Absolute registration lease expiry when the registration is leased. */
	readonly leaseUntil: Temporal.Instant | undefined;
	/** Whether the registration has stopped accepting new placement. */
	readonly draining: boolean;
	/** Extend a leased registration from the Scheduler clock. */
	renew(duration: Temporal.Duration | Temporal.DurationLike | string): void;
	/** Change the maximum local attempt capacity advertised for future placement. */
	resize(maximum: number): void;
	/** Stop new placement and resolve after active attempts leave the registration. */
	drain(): Promise<void>;
}

/** Options accepted by the standard workflow Scheduler. */
export interface SchedulerOptions {
	/** Optional Scheduler identity used to namespace process-local coordination and diagnostics. */
	readonly id?: string;
	/** Clock used for queue claims, registration leases, and retry scheduling. */
	readonly clock?: BaseContext['clock'];
	/** Non-activity command implementation for timers, signals, children, and events. */
	readonly command?: WorkflowCommandHandler;
	/** Instruction history and replay owner. Omit for non-replayed local execution. */
	readonly history?: History;
	/** Dispose an injected history owner when the Scheduler closes. */
	readonly disposeHistory?: boolean;
	/** Host interpreters used for active workflow and activity admission requirements. */
	readonly requirements?: RequirementScopeOptions;
	/** Authoritative owner for workflow-level required effects. */
	readonly effect?: EffectEmitter;
	/** Queue used as the authoritative process-local or durable activity job store. */
	readonly activityQueue?: Queue<ActivityJobType, ActivityJobResultType>;
	/** Maximum items for the default process-local activity queue. */
	readonly activityCapacity?: number;
	/** Default activity claim duration before a stalled attempt can be retried. */
	readonly claimDuration?: Temporal.Duration | Temporal.DurationLike | string;
	/** Dispose an injected activity queue when the Scheduler closes. */
	readonly disposeActivityQueue?: boolean;
}

/** Workflow interpreter and activity-placement authority. */
export interface Scheduler extends AsyncDisposable {
	/** Advance one deterministic workflow instruction through the Scheduler authority. */
	schedule(ctx: WorkflowContext, instruction: WorkflowInstruction, path: string): Promise<WorkflowCompletionAny>;
	/** Register one live execution provider for an exact engine definition. */
	register(options: EngineRegistrationOptions): Promise<EngineRegistration>;
	/** Stop new scheduling and release Scheduler-owned state. */
	close(reason?: unknown): Promise<void>;
}

/** Inputs accepted while creating one validated workflow context. */
export interface WorkflowContextOptions<Workflow extends WorkflowDefinition> {
	/** Exact import-safe definition bound to this workflow. */
	readonly definition: Workflow;
	/** Stable workflow-run identity used by history and deterministic child/job identity. */
	readonly runId: string;
	/** Untrusted workflow input validated against the definition before the program starts. */
	readonly input: unknown;
	/** Borrowed parent execution context for this workflow. */
	readonly ctx: BaseContext;
}

/** Inputs accepted while executing one workflow implementation. */
export interface WorkflowRunOptions<Workflow extends WorkflowDefinition> {
	/** Borrowed parent execution context for this workflow run. */
	readonly ctx: WorkflowContext<Workflow>;
	/** Exact deterministic workflow implementation to replay and advance. */
	readonly implementation: WorkflowImplementation<Workflow>;
	/** Scheduler authority used for every yielded instruction. */
	readonly scheduler: Scheduler;
}

/** Named workflow catalog. */
export type WorkflowCatalog<Entries extends Readonly<Record<PropertyKey, WorkflowDefinition>>> = Catalog<
	Entries[keyof Entries],
	Entries
>;

/** Key-preserving workflow catalog selection. */
export type WorkflowSelection<
	Entry extends WorkflowDefinition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

/** JSON-safe workflow documentation. */
export interface WorkflowDocument {
	/** Stable workflow definition ID exposed in deterministic generated documentation. */
	readonly id: string;
	/** Contract version used to distinguish incompatible workflow shapes. */
	readonly version: string;
	/** Human-readable workflow purpose used by documentation and diagnostics. */
	readonly description?: string;
	/** Standard Schema vendor reported by the input contract for documentation. */
	readonly inputVendor: string;
	/** Standard Schema vendor reported by the result contract for documentation. */
	readonly resultVendor: string;
	/** Expected failure definitions or data declared by this workflow. */
	readonly failures: readonly string[];
	/** Required effect definitions or scoped effect state associated with this workflow. */
	readonly effects: readonly string[];
	/** Stable IDs of activities declared by this workflow contract. */
	readonly activities: readonly string[];
	/** Stable IDs of child workflows declared by this workflow contract. */
	readonly workflows: readonly string[];
	/** Requirements owned directly by this workflow; reachable dependency requirements remain separate. */
	readonly requirements: readonly RequirementDocument[];
}
