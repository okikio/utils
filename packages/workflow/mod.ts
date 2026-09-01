/**
 * Deterministic iterator workflow definitions, instructions, controls, and interpreter.
 *
 * The generic interpreter owns orchestration semantics. Durable storage, claims,
 * timers, queues, and provider work belong in concrete packages.
 *
 * @module
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { encodeHex } from '@std/encoding/hex';
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import * as contextCore from '@okikio/context';
import * as effects from '@okikio/effect';
import * as failures from '@okikio/failure';
import * as faultCore from '@okikio/fault';
import * as requirement from '@okikio/requirement';
import * as result from '@okikio/result';
import * as recordCore from '@okikio/record';
import * as schema from '@okikio/schema';
import { freeze as freezeAffinity } from './affinity.ts';
import * as durable from './durable.ts';
import { Branch } from './branch.ts';
import * as kernelOperation from './operation.ts';
import { Reducer } from './reducer.ts';
import { MAX_ACTIVE_CHILDREN, Scope } from './scope.ts';
import { createActivityJobs, SchedulerClosedError } from './jobs.ts';
import type { Cause, Exit } from './kernel.ts';

import type {
	ActivityCommand,
	ActivityCommandOptions,
	ActivityReference,
	WorkflowCommandOptions,
	WorkflowAnnotations,
	WorkflowCompletionAny,
	WorkflowCancelled,
	ChildOptions,
	ChildWorkflowCommand,
	WorkflowContext,
	WorkflowControlInstruction,
	WorkflowContextOptions,
	WorkflowDefinition,
	WorkflowOptions,
	WorkflowDocument,
	WorkflowDurableValue,
	WorkflowEffectCommand,
	Scheduler,
	WorkflowDeferCommand,
	WorkflowRunOptions,
	WorkflowFailure,
	WorkflowFault,
	WorkflowImplementation,
	WorkflowInstruction,
	WorkflowInstructionDescription,
	WorkflowInstructionIdentity,
	SchedulerOptions,
	WorkflowMapEntry,
	WorkflowMapInstruction,
	WorkflowMapOptions,
	WorkflowOperation,
	WorkflowOperationFailures,
	WorkflowOperations,
	WorkflowOperationValues,
	WorkflowParallelInstruction,
	WorkflowParallelOptions,
	WorkflowRaceInstruction,
	WorkflowRaceOptions,
	WorkflowRaceResult,
	WorkflowRetryInstruction,
	WorkflowRetryOptions,
	WorkflowSettledValues,
	WorkflowSignal,
	WorkflowSleepCommand,
	WorkflowSuccess,
	WorkflowWaitCommand,
	WorkflowCatalog,
	WorkflowReference,
	WorkflowSelection,
} from './types.ts';

/** Version shared by the built-in workflow instruction envelopes in this source revision. */
const builtInInstructionVersion = 1;
/** Associates immutable author-facing operations with their serializable instruction without exposing mutable state. */
const operationInstructions = new WeakMap<object, WorkflowInstruction>();

/** Unexpected fault reported by a workflow interpreter. */
export class FaultError extends Error {
	readonly fault: unknown;

	constructor(fault: unknown) {
		super(faultCore.message(fault), { cause: fault });
		this.name = 'FaultError';
		this.fault = fault;
	}
}

/** Cancellation reported by a workflow interpreter. */
export class CancelledError extends Error {
	readonly reason: unknown;

	constructor(reason: unknown) {
		super('Workflow instruction was cancelled.', reason === undefined ? undefined : { cause: reason });
		this.name = 'CancelledError';
		this.reason = reason;
	}
}

/** Terminal continue-as-new request surfaced by an interpreter. */
export class ContinueAsNewError extends Error {
	readonly input: unknown;

	constructor(input: unknown) {
		super('Workflow requested continue as new.');
		this.name = 'ContinueAsNewError';
		this.input = input;
	}
}

/** Lifecycle defect containing primary work and one or more cleanup failures. */
export class CleanupFailureError extends Error {
	readonly primary: unknown;
	readonly cleanupFailures: readonly unknown[];

	constructor(primary: unknown, cleanupFailures: readonly unknown[]) {
		super('Workflow work failed and one or more required cleanups also failed.', { cause: primary });
		this.name = 'CleanupFailureError';
		this.primary = primary;
		this.cleanupFailures = Object.freeze([...cleanupFailures]);
	}
}

/** Invalid workflow program behavior discovered while closing a generator. */
export class CleanupInstructionError extends Error {
	readonly instruction: WorkflowInstruction;

	constructor(instruction: WorkflowInstruction) {
		super(
			'Workflow generator cleanup must not yield instructions. Register external cleanup with workflow.defer().',
		);
		this.name = 'CleanupInstructionError';
		this.instruction = instruction;
	}
}

/**
 * Owns the internal sibling cancellation state used by the durable workflow interpreter.
 *
 * @internal
 */
class SiblingCancellation {
	readonly reason: unknown;

	constructor(reason: unknown) {
		this.reason = reason;
	}
}

/** Define one immutable workflow contract. */
export function define<const Authoring extends WorkflowOptions>(input: Authoring): WorkflowDefinition<Authoring> {
	recordCore.assert(input, 'workflow definition');
	assertIdentifier(input.id, 'workflow');
	assertIdentifier(input.version, 'workflow version');
	schema.assert(input.input, 'workflow input schema');
	schema.assert(input.result, 'workflow result schema');
	const failures = input.failures === undefined ? Object.freeze([]) : catalogCore.compose(input.failures);
	const workflowEffects = input.effects === undefined ? Object.freeze([]) : effects.compose(input.effects);
	const activities = input.activities === undefined ? Object.freeze([]) : catalogCore.compose(input.activities);
	const workflows = input.workflows === undefined ? Object.freeze([]) : catalogCore.compose(input.workflows);
	const requirements = input.requirements === undefined ? Object.freeze([]) : requirement.compose(input.requirements);
	return Object.freeze({
		kind: 'workflow',
		id: input.id,
		version: input.version,
		...(input.description === undefined ? {} : { description: input.description }),
		input: input.input,
		result: input.result,
		failures,
		effects: workflowEffects,
		activities,
		workflows,
		requirements,
	}) as WorkflowDefinition<Authoring>;
}

/** Bind one exact workflow definition to its deterministic generator program. */
export function implement<Workflow extends WorkflowDefinition>(
	definition: Workflow,
	program: WorkflowImplementation<Workflow>['program'],
): WorkflowImplementation<Workflow> {
	if (typeof program !== 'function') throw new TypeError('Workflow implementation must provide a generator program.');
	return Object.freeze({ definition, program });
}

/** Create a named immutable workflow catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, WorkflowDefinition>>,
>(namespace: Namespace, entries: Entries): WorkflowCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving workflow catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, WorkflowDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: WorkflowCatalog<Entries>,
	keys: Keys,
): WorkflowSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose workflows, catalogs, selections, and nested arrays. */
export function compose<Entry extends WorkflowDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Define one immutable signal contract. */
export function signal<Value>(
	input: Readonly<{
		readonly id: string;
		readonly description?: string;
		readonly value: StandardSchemaV1<unknown, Value>;
	}>,
): WorkflowSignal<Value> {
	recordCore.assert(input, 'workflow signal definition');
	assertIdentifier(input.id, 'workflow signal');
	schema.assert(input.value, 'workflow signal schema');
	return Object.freeze({ kind: 'workflow-signal', ...input });
}

/** Create an author-facing operation backed by one instruction. */
export function operation<Value, Failure = never>(instruction: WorkflowInstruction): WorkflowOperation<Value, Failure> {
	assertInstruction(instruction);
	const value = Object.freeze({
		/**
		 * Returns the native iterator view used by synchronous iteration protocols.
		 *
		 * @internal
		 */
		*[Symbol.iterator](): Generator<WorkflowInstruction, Value, WorkflowCompletionAny> {
			const completion = yield instruction;
			if (completion.type === 'success') return completion.value as Value;
			if (completion.type === 'failure') throw completion.failure;
			if (completion.type === 'fault') throw new FaultError(completion.fault);
			throw new CancelledError(completion.reason);
		},
	});
	operationInstructions.set(value, instruction);
	return value;
}

/** Create an activity command without importing the activity package. */
export function activity<Value, Failure>(
	definition: ActivityReference,
	input: unknown,
	options: ActivityCommandOptions = {},
): WorkflowOperation<Value, Failure> {
	const normalizedOptions = normalizeActivityOptions(options);
	const command: ActivityCommand<Value, Failure> = Object.freeze({
		category: 'command',
		type: 'activity',
		version: builtInInstructionVersion,
		activity: definition,
		input: durable.snapshot(input, 'activity input'),
		options: normalizedOptions,
		...instructionMetadata(normalizedOptions),
	});
	return operation(command);
}

/** Wait for a durable duration. */
export function sleep(
	duration: Temporal.DurationLike | string,
	options: WorkflowCommandOptions = {},
): WorkflowOperation<Temporal.Instant> {
	const command: WorkflowSleepCommand = Object.freeze({
		category: 'command',
		type: 'sleep',
		version: builtInInstructionVersion,
		duration: Temporal.Duration.from(duration),
		...instructionMetadata(options),
	});
	return operation(command);
}

/** Wait for one matching signal value. */
export function wait<Value>(
	definition: WorkflowSignal<Value>,
	input: unknown,
	options: WorkflowCommandOptions = {},
): WorkflowOperation<Value> {
	const command: WorkflowWaitCommand<Value> = Object.freeze({
		category: 'command',
		type: 'wait',
		version: builtInInstructionVersion,
		signal: definition,
		input: durable.snapshot(input, 'wait input'),
		...instructionMetadata(options),
	});
	return operation(command);
}

/** Start or await one child workflow. */
export function child<WorkflowDefinition extends WorkflowReference>(
	definition: WorkflowDefinition,
	input: import('./types.ts').WorkflowInput<WorkflowDefinition>,
	options: ChildOptions = {},
): WorkflowOperation<import('./types.ts').WorkflowResult<WorkflowDefinition>, import('./types.ts').WorkflowFailures<WorkflowDefinition>> {
	const normalizedOptions = normalizeChildOptions(options);
	const command: ChildWorkflowCommand = Object.freeze({
		category: 'command',
		type: 'child-workflow',
		version: builtInInstructionVersion,
		workflow: definition,
		input: durable.snapshot(input, 'child workflow input'),
		options: normalizedOptions,
		...instructionMetadata(normalizedOptions),
	});
	return operation(command);
}

/**
 * Request one workflow-level required effect.
 *
 * The operation is deterministic data. Delivery happens only when the Scheduler
 * interprets the instruction, and the operation completes only after the
 * configured effect owner accepts responsibility.
 */
export function effect<Effect_ extends effects.EffectDefinition>(
	definition: Effect_,
	value: effects.EffectValueInput<Effect_>,
	options: WorkflowCommandOptions = {},
): WorkflowOperation<void> {
	const command: WorkflowEffectCommand = Object.freeze({
		category: 'command',
		type: 'effect',
		version: builtInInstructionVersion,
		effect: definition,
		value: durable.snapshot(value, 'effect value'),
		...instructionMetadata(options),
	});
	return operation(command);
}

/** Register a cleanup operation that executes when the workflow scope closes. */
export function defer(cleanup: WorkflowOperation<unknown, unknown>, options: WorkflowCommandOptions = {}): WorkflowOperation<void> {
	const cleanupInstruction = createdInstruction(cleanup, 'workflow.defer cleanup');
	if (
		cleanupInstruction.category !== 'command' ||
		(cleanupInstruction.type !== 'activity' && cleanupInstruction.type !== 'child-workflow')
	) {
		throw new TypeError('workflow.defer cleanup must be one activity or child-workflow operation.');
	}
	const command: WorkflowDeferCommand = Object.freeze({
		category: 'command',
		type: 'defer',
		version: builtInInstructionVersion,
		cleanup: cleanupInstruction,
		...instructionMetadata(options),
	});
	return operation(command);
}

/** End the current run and request an atomic continuation with new input. */
function continueRun<WorkflowInput>(input: WorkflowInput, options: WorkflowCommandOptions = {}): WorkflowOperation<never> {
	const command: import('./types.ts').WorkflowContinueCommand = Object.freeze({
		category: 'command',
		type: 'continue',
		version: builtInInstructionVersion,
		input: durable.snapshot(input, 'continue-as-new input'),
		...instructionMetadata(options),
	});
	return operation(command);
}

/** Coordinate keyed child operations in parallel. */
export function parallel<Values extends WorkflowOperations>(
	operations: Values,
	options?: WorkflowParallelOptions & Readonly<{ readonly failure?: 'fail-fast' }>,
): WorkflowOperation<WorkflowOperationValues<Values>, WorkflowOperationFailures<Values>>;
/** Coordinate keyed child operations and return explicit results for every branch. */
export function parallel<Values extends WorkflowOperations>(
	operations: Values,
	options: WorkflowParallelOptions & Readonly<{ readonly failure: 'settle' }>,
): WorkflowOperation<WorkflowSettledValues<Values>, never>;
/** Create either fail-fast or settled parallel coordination after overload resolution. */
export function parallel<Values extends WorkflowOperations>(
	operations: Values,
	options: WorkflowParallelOptions = {},
): WorkflowOperation<unknown, unknown> {
	recordCore.assert(options, 'workflow parallel options');
	assertOperations(operations);
	const instruction: WorkflowParallelInstruction<Values> = Object.freeze({
		category: 'control',
		type: 'parallel',
		version: builtInInstructionVersion,
		operations: freezeRecord(operations),
		failure: options.failure ?? 'fail-fast',
		...(options.concurrency === undefined
			? {}
			: { concurrency: boundedConcurrency(options.concurrency, 'parallel concurrency') }),
		...instructionMetadata(options),
	});
	return operation(instruction);
}

/** Return the first terminal keyed branch and cancel the others. */
export function race<Values extends WorkflowOperations>(
	operations: Values,
	options: WorkflowRaceOptions = {},
): WorkflowOperation<WorkflowRaceResult<Values>, WorkflowOperationFailures<Values>> {
	recordCore.assert(options, 'workflow race options');
	assertOperations(operations);
	if (Object.keys(operations).length > MAX_ACTIVE_CHILDREN) {
		throw new RangeError(`Workflow race cannot start more than ${MAX_ACTIVE_CHILDREN} child operations.`);
	}
	const instruction: WorkflowRaceInstruction<Values> = Object.freeze({
		category: 'control',
		type: 'race',
		version: builtInInstructionVersion,
		operations: freezeRecord(operations),
		...instructionMetadata(options),
	});
	return operation(instruction);
}

/** Create and coordinate one bounded keyed operation for every input item. */
export function map<Item, Value, Failure>(
	items: readonly Item[],
	createOperation: (item: Item, index: number) => WorkflowOperation<Value, Failure>,
	options: WorkflowMapOptions<Item> & Readonly<{ readonly failure?: 'fail-fast' }>,
): WorkflowOperation<readonly Value[], Failure>;
/** Create bounded mapped operations and return explicit results for every item. */
export function map<Item, Value, Failure>(
	items: readonly Item[],
	createOperation: (item: Item, index: number) => WorkflowOperation<Value, Failure>,
	options: WorkflowMapOptions<Item> & Readonly<{ readonly failure: 'settle' }>,
): WorkflowOperation<readonly result.Result<Value, Failure>[], never>;
/** Create either fail-fast or settled bounded mapping after overload resolution. */
export function map<Item, Value, Failure>(
	items: readonly Item[],
	createOperation: (item: Item, index: number) => WorkflowOperation<Value, Failure>,
	options: WorkflowMapOptions<Item>,
): WorkflowOperation<unknown, unknown> {
	recordCore.assert(options, 'workflow map options');
	if (typeof options.key !== 'function') throw new TypeError('workflow map key must be a function.');
	const keys = new Set<string>();
	const entries = Object.freeze(items.map((item, index): WorkflowMapEntry<Value, Failure> => {
		const key = options.key(item, index);
		assertStableKey(key);
		if (keys.has(key)) throw new TypeError(`Workflow map produced duplicate key ${JSON.stringify(key)}.`);
		keys.add(key);
		const childOperation = createOperation(item, index);
		assertOperation(childOperation);
		return Object.freeze({ key, operation: childOperation });
	}));
	const instruction: WorkflowMapInstruction<Value, Failure> = Object.freeze({
		category: 'control',
		type: 'map',
		version: builtInInstructionVersion,
		entries,
		concurrency: boundedConcurrency(options.concurrency, 'map concurrency'),
		failure: options.failure ?? 'fail-fast',
		...(options.instructionKey === undefined ? {} : { key: options.instructionKey }),
		...(options.annotations === undefined ? {} : { annotations: freezeAnnotations(options.annotations) }),
	});
	return operation(instruction);
}

/** Repeat one operation according to one explicit maximum-attempt policy. */
export function retry<Value, Failure>(
	childOperation: WorkflowOperation<Value, Failure>,
	options: WorkflowRetryOptions,
): WorkflowOperation<Value, Failure> {
	recordCore.assert(options, 'workflow retry options');
	assertOperation(childOperation);
	const delay = options.delay === undefined ? undefined : Temporal.Duration.from(options.delay);
	const maximumDelay = options.maximumDelay === undefined ? undefined : Temporal.Duration.from(options.maximumDelay);
	const backoff = options.backoff ?? 1;
	if (!Number.isFinite(backoff) || backoff < 1) {
		throw new TypeError('retry backoff must be a finite number greater than or equal to 1.');
	}
	const jitter = options.jitter ?? 0;
	if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
		throw new TypeError('retry jitter must be between 0 and 1.');
	}
	if (delay === undefined && (maximumDelay !== undefined || backoff !== 1 || jitter !== 0)) {
		throw new TypeError('retry maximumDelay, backoff, and jitter require retry delay.');
	}
	const instruction: WorkflowRetryInstruction<Value, Failure> = Object.freeze({
		category: 'control',
		type: 'retry',
		version: builtInInstructionVersion,
		operation: childOperation,
		maximumAttempts: positiveInteger(options.maximumAttempts, 'retry maximumAttempts'),
		...(delay === undefined ? {} : { delay }),
		backoff,
		...(maximumDelay === undefined ? {} : { maximumDelay }),
		jitter,
		...instructionMetadata(options),
	});
	return operation(instruction);
}

/** Create a validated workflow context by deriving local cancellation from a parent context. */
export async function context<Workflow extends WorkflowDefinition>(
	options: WorkflowContextOptions<Workflow>,
): Promise<WorkflowContext<Workflow> & AsyncDisposable> {
	recordCore.assert(options, 'workflow context options');
	const normalized: WorkflowContextOptions<Workflow> = Object.freeze({ ...options });
	assertIdentifier(normalized.runId, 'workflow run');
	const input = await schema.parse(normalized.definition.input, normalized.input) as import('./types.ts').WorkflowInput<Workflow>;
	const owned = contextCore.child(normalized.ctx, { id: normalized.runId });
	const checkpoint = inheritedCheckpoint(normalized.ctx, owned);
	return Object.freeze({
		id: owned.id,
		...(owned.traceId === undefined ? {} : { traceId: owned.traceId }),
		...(owned.deploymentId === undefined ? {} : { deploymentId: owned.deploymentId }),
		...(owned.idempotencyKey === undefined ? {} : { idempotencyKey: owned.idempotencyKey }),
		startedAt: owned.startedAt,
		...(owned.deadline === undefined ? {} : { deadline: owned.deadline }),
		signal: owned.signal,
		clock: owned.clock,
		workflow: normalized.definition,
		runId: normalized.runId,
		input,
		version: normalized.definition.version,
		checkpoint,
		/**
		 * Releases owned state and waits for cleanup completion when used with `await using`.
		 *
		 * @internal
		 */
		async [Symbol.asyncDispose]() {
			await owned[Symbol.asyncDispose]();
		},
	});
}

/** Execute one workflow program through an instruction interpreter. */
export async function run<Workflow extends WorkflowDefinition>(
	options: WorkflowRunOptions<Workflow>,
): Promise<import('./types.ts').WorkflowResult<Workflow>> {
	recordCore.assert(options, 'workflow run options');
	const normalized: WorkflowRunOptions<Workflow> = Object.freeze({ ...options });
	if (normalized.implementation.definition !== normalized.ctx.workflow) {
		throw new TypeError('Workflow implementation and context must reference the same exact definition.');
	}
	const cleanups: WorkflowOperation<unknown, unknown>[] = [];
	let primaryFailure: unknown;
	let hasPrimaryFailure = false;
	let value: import('./types.ts').WorkflowResult<Workflow> | undefined;
	try {
		const unvalidated = await driveIterator(
			normalized.implementation.program(normalized.ctx),
			normalized.ctx,
			normalized.scheduler,
			`${normalized.ctx.workflow.id}@${normalized.ctx.version}`,
			cleanups,
		);
		value = await schema.parse(normalized.ctx.workflow.result, unvalidated) as import('./types.ts').WorkflowResult<Workflow>;
	} catch (error) {
		primaryFailure = error;
		hasPrimaryFailure = true;
	}

	const cleanupFailures = await runCleanups(cleanups, normalized.ctx, normalized.scheduler);
	if (hasPrimaryFailure) {
		if (cleanupFailures.length > 0) throw new CleanupFailureError(primaryFailure, cleanupFailures);
		throw primaryFailure;
	}
	if (cleanupFailures.length > 0) {
		throw new AggregateError(cleanupFailures, 'Workflow completed, but one or more required cleanups failed.');
	}
	return value!;
}

/** Execute one author-facing operation outside a complete workflow program. */
async function resolveOperation<Value, Failure>(
	childOperation: WorkflowOperation<Value, Failure>,
	ctx: WorkflowContext,
	scheduler: Scheduler,
	path = `${ctx.workflow.id}@${ctx.version}/operation`,
): Promise<Value> {
	assertOperation(childOperation);
	return await driveIterator(childOperation[Symbol.iterator](), ctx, scheduler, path, []);
}

/**
 * Create the standard workflow Scheduler.
 *
 * The Scheduler interprets control instructions, owns activity job admission
 * and engine placement, and delegates other leaf commands to the configured
 * command handler. The default activity queue is process-local; callers can
 * inject a durable queue that implements the same claim contract.
 */
export function scheduler(input: SchedulerOptions = {}): Scheduler {
	recordCore.assert(input, 'workflow scheduler options');
	const options: SchedulerOptions = Object.freeze({ ...input });
	const jobs = createActivityJobs(options, options.clock ?? contextCore.SystemClock);
	let closed = false;
	let closePromise: Promise<void> | undefined;

	const scheduler: Scheduler = Object.freeze({
		async schedule(ctx: WorkflowContext, instruction: WorkflowInstruction, path: string) {
			if (closed) return fault(new SchedulerClosedError());
			const identity = await identify(instruction, path);
			const next = async (): Promise<WorkflowCompletionAny> => {
				if (instruction.category === 'control') return await runControl(ctx, instruction, path, scheduler);
				if (instruction.type === 'defer') return success(undefined);
				if (instruction.type === 'continue') throw new ContinueAsNewError(instruction.input);
				try {
					if (instruction.type === 'activity') {
						// Admission requirements run before provider placement. This prevents an
						// unauthorized request from consuming engine capacity. Target-bearing
						// permissions remain declarations only until activity code checks a target.
						const admission = requirement.scope(ctx, options.requirements);
						const active = requirement.bind(admission, instruction.activity.requirements);
						await requirement.apply(active, instruction.activity.requirements);
						return activityCompletion(await jobs.run(ctx, instruction, path, identity.fingerprint));
					}
					if (instruction.type === 'effect') {
						if (!ctx.workflow.effects.includes(instruction.effect)) {
							return fault(new TypeError(`Workflow ${JSON.stringify(ctx.workflow.id)} emitted undeclared effect ${JSON.stringify(instruction.effect.id)}.`));
						}
						if (options.effect === undefined) return fault(new effects.MissingEffectEmitterError());
						const occurrence = await effects.create(instruction.effect, instruction.value, { key: identity.fingerprint });
						await options.effect.emit(ctx, occurrence);
						return success(undefined);
					}
					if (options.command === undefined) {
						return fault(new TypeError(`Workflow command ${JSON.stringify(instruction.type)} has no configured host.`));
					}
					return await options.command(ctx, instruction, path);
				} catch (error) {
					return isCancellation(error) ? cancelled(cancellationReason(error)) : fault(error);
				}
			};
			if (options.history === undefined) return await next();
			return await options.history.schedule({
				ctx,
				instruction,
				path,
				identity,
				next,
				encode: (completion) => encodeCompletion(completion),
				decode: (completion) => decodeCompletion(ctx.workflow, completion),
			});
		},
		async register(options: import('./types.ts').EngineRegistrationOptions) {
			if (closed) throw new SchedulerClosedError();
			return await jobs.register(options);
		},
		close(reason?: unknown) {
			if (closePromise !== undefined) return closePromise;
			closed = true;
			closePromise = (async () => {
				await jobs.close(reason);
				if (options.disposeHistory === true && options.history !== undefined) await options.history.close(reason);
			})();
			return closePromise;
		},
		[Symbol.asyncDispose]() {
			return scheduler.close();
		},
	});
	return scheduler;
}

/** Convert one provider result into the completion consumed by the workflow generator. */
function activityCompletion(result: import('./types.ts').ActivityAttemptResultType): WorkflowCompletionAny {
	if (result.type === 'success') return success(result.value);
	if (result.type === 'failure') return failed(result.failure);
	if (result.type === 'cancelled') return cancelled(result.reason);
	if (result.type === 'lost') return fault(result.reason);
	return fault(result.fault);
}

/** Create a successful completion. */
export function success<Value>(value: Value): WorkflowSuccess<Value> {
	return Object.freeze({ type: 'success', value });
}

/** Create a declared-failure completion. */
export function failed<Failure>(failure: Failure): WorkflowFailure<Failure> {
	return Object.freeze({ type: 'failure', failure });
}

/** Create an unexpected-fault completion. */
export function fault(reason: unknown): WorkflowFault {
	return Object.freeze({ type: 'fault', fault: reason });
}

/** Create a cancelled completion. */
export function cancelled(reason: unknown): WorkflowCancelled {
	return Object.freeze({ type: 'cancelled', reason });
}

/**
 * Describe one yielded instruction as JSON-safe durable history data.
 *
 * The description stores exact definition identities and serializable input,
 * but it never stores schemas, generator objects, resource handles, or child
 * operation closures. Control children are verified at their own deterministic
 * paths when the interpreter enters them.
 */
export function describe(instruction: WorkflowInstruction, path: string): WorkflowInstructionDescription {
	assertInstruction(instruction);
	if (path.trim().length === 0) throw new TypeError('Workflow instruction path must not be empty.');
	return Object.freeze({
		path,
		category: instruction.category,
		type: instruction.type,
		version: instruction.version,
		...(instruction.key === undefined ? {} : { key: instruction.key }),
		...(instruction.annotations === undefined ? {} : { annotations: instruction.annotations }),
		payload: describeInstructionPayload(instruction),
	});
}

/**
 * Create the stable SHA-256 identity used to compare replayed instructions.
 *
 * A durable adapter persists this identity before it dispatches external work.
 * On replay, the adapter compares the newly yielded fingerprint with history.
 * A mismatch is workflow divergence and must fail instead of dispatching new
 * work under an old history position.
 */
export async function identify(instruction: WorkflowInstruction, path: string): Promise<WorkflowInstructionIdentity> {
	const description = describe(instruction, path);
	const encoded = new TextEncoder().encode(JSON.stringify(description));
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
	const fingerprint = encodeHex(digest);
	return Object.freeze({ description, fingerprint });
}

/** Create deterministic JSON-safe workflow documentation. */
export function document(input: CatalogDefinitionInput<WorkflowDefinition>): readonly WorkflowDocument[] {
	return Object.freeze(
		catalogCore.values(input).map((definition) =>
			Object.freeze({
				id: definition.id,
				version: definition.version,
				...(definition.description === undefined ? {} : { description: definition.description }),
				inputVendor: definition.input['~standard'].vendor,
				resultVendor: definition.result['~standard'].vendor,
				failures: Object.freeze(definition.failures.map((entry) => entry.id)),
				effects: Object.freeze(definition.effects.map((entry) => entry.id)),
				activities: Object.freeze(definition.activities.map((entry) => entry.id)),
				workflows: Object.freeze(definition.workflows.map((entry) => entry.id)),
				requirements: requirement.document(definition.requirements),
			})
		),
	);
}

/**
 * Builds the describe instruction payload used for diagnostics, replay identity, or generated documentation in the durable workflow interpreter.
 *
 * Workflow internals preserve deterministic instruction identity, replay, cancellation, registered cleanup, and control-instruction ownership.
 *
 * @internal
 */
function describeInstructionPayload(instruction: WorkflowInstruction): WorkflowDurableValue {
	if (instruction.category === 'control') {
		if (instruction.type === 'parallel') {
			return durable.snapshot({
				branches: Object.keys(instruction.operations).sort(),
				failure: instruction.failure,
				...(instruction.concurrency === undefined ? {} : { concurrency: instruction.concurrency }),
			}, 'parallel instruction');
		}
		if (instruction.type === 'race') {
			return durable.snapshot({ branches: Object.keys(instruction.operations).sort() }, 'race instruction');
		}
		if (instruction.type === 'map') {
			return durable.snapshot({
				entries: instruction.entries.map((entry) => entry.key),
				concurrency: instruction.concurrency,
				failure: instruction.failure,
			}, 'map instruction');
		}
		return durable.snapshot({
			maximumAttempts: instruction.maximumAttempts,
			...(instruction.delay === undefined ? {} : { delay: instruction.delay.toString() }),
			backoff: instruction.backoff,
			...(instruction.maximumDelay === undefined ? {} : { maximumDelay: instruction.maximumDelay.toString() }),
			jitter: instruction.jitter,
		}, 'retry instruction');
	}

	if (instruction.type === 'activity') {
		return durable.snapshot({
			activity: { id: instruction.activity.id, version: instruction.activity.version },
			input: instruction.input,
		}, 'activity command');
	}
	if (instruction.type === 'sleep') return durable.snapshot({ duration: instruction.duration.toString() }, 'sleep command');
	if (instruction.type === 'wait') {
		return durable.snapshot({ signal: instruction.signal.id, input: instruction.input }, 'wait command');
	}
	if (instruction.type === 'child-workflow') {
		return durable.snapshot({
			workflow: { id: instruction.workflow.id, version: instruction.workflow.version },
			input: instruction.input,
			cancellation: instruction.options.cancellation ?? 'follow-parent',
			result: instruction.options.result ?? 'wait',
		}, 'child workflow command');
	}
	if (instruction.type === 'effect') {
		return durable.snapshot({ effect: instruction.effect.id, value: instruction.value }, 'effect command');
	}
	if (instruction.type === 'defer') {
		return durable.snapshot({ cleanup: describeCleanup(instruction.cleanup) }, 'defer command');
	}
	return durable.snapshot({ input: instruction.input }, 'continue-as-new command');
}

/**
 * Builds the describe cleanup used for diagnostics, replay identity, or generated documentation in the durable workflow interpreter.
 *
 * Workflow internals preserve deterministic instruction identity, replay, cancellation, registered cleanup, and control-instruction ownership.
 *
 * @internal
 */
function describeCleanup(
	command: ActivityCommand<unknown, unknown> | ChildWorkflowCommand<unknown, unknown>,
): WorkflowDurableValue {
	if (command.type === 'activity') {
		return durable.snapshot({
			category: command.category,
			type: command.type,
			version: command.version,
			...(command.key === undefined ? {} : { key: command.key }),
			activity: { id: command.activity.id, version: command.activity.version },
			input: command.input,
		}, 'cleanup activity command');
	}
	return durable.snapshot({
		category: command.category,
		type: command.type,
		version: command.version,
		...(command.key === undefined ? {} : { key: command.key }),
		workflow: { id: command.workflow.id, version: command.workflow.version },
		input: command.input,
		cancellation: command.options.cancellation ?? 'follow-parent',
		result: command.options.result ?? 'wait',
	}, 'cleanup child command');
}

/**
 * Drives one workflow generator until completion while routing each yielded instruction through the deterministic interpreter.
 *
 * Workflow internals preserve deterministic instruction identity, replay, cancellation, registered cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function driveIterator<Value>(
	iterator: Generator<WorkflowInstruction, Value, WorkflowCompletionAny>,
	ctx: WorkflowContext,
	scheduler: Scheduler,
	basePath: string,
	cleanups: WorkflowOperation<unknown, unknown>[],
): Promise<Value> {
	let resume: WorkflowCompletionAny | undefined;
	let index = 0;
	const explicitKeys = new Set<string>();
	try {
		while (true) {
			if (resume?.type === 'fault') throw new FaultError(resume.fault);
			if (resume?.type === 'cancelled') throw new CancelledError(resume.reason);
			await ctx.checkpoint();
			let step: IteratorResult<WorkflowInstruction, Value>;
			try {
				step = resume === undefined ? iterator.next() : iterator.next(resume);
			} catch (error) {
				if (resume?.type === 'failure' && error !== resume.failure) {
					throw new CleanupFailureError(resume.failure, [error]);
				}
				throw error;
			}
			if (step.done) return step.value;
			const instruction = step.value;
			assertInstruction(instruction);
			assertUniqueInstructionKey(explicitKeys, instruction);
			const path = instructionPath(basePath, index, instruction);
			index += 1;
			let completion: WorkflowCompletionAny;
			try {
				completion = await scheduler.schedule(ctx, instruction, path);
			} catch (error) {
				if (error instanceof ContinueAsNewError) throw error;
				throw new FaultError(error);
			}
			if (instruction.category === 'command' && instruction.type === 'defer' && completion.type === 'success') {
				cleanups.push(operation(instruction.cleanup));
			}
			resume = completion;
		}
	} catch (error) {
		const cleanup = closeIterator(iterator);
		if (!cleanup.success) throw new CleanupFailureError(error, [cleanup.failure]);
		throw error;
	}
}

/**
 * Closes iterator and waits for the cleanup that the current owner is responsible for.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
function closeIterator<Value>(iterator: Generator<WorkflowInstruction, Value, WorkflowCompletionAny>):
	| Readonly<{ readonly success: true }>
	| Readonly<{ readonly success: false; readonly failure: unknown }> {
	try {
		const step = iterator.return?.(undefined as never);
		if (step !== undefined && !step.done) {
			return Object.freeze({ success: false, failure: new CleanupInstructionError(step.value) });
		}
		return Object.freeze({ success: true });
	} catch (error) {
		return Object.freeze({ success: false, failure: error });
	}
}

/**
 * Executes cleanups as one finite phase of the module runtime.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function runCleanups(
	cleanups: readonly WorkflowOperation<unknown, unknown>[],
	ctx: WorkflowContext,
	scheduler: Scheduler,
): Promise<readonly unknown[]> {
	if (cleanups.length === 0) return Object.freeze([]);
	await using owned = contextCore.create({
		id: `${ctx.runId}:cleanup`,
		...(ctx.traceId === undefined ? {} : { traceId: ctx.traceId }),
		...(ctx.deploymentId === undefined ? {} : { deploymentId: ctx.deploymentId }),
		startedAt: ctx.startedAt,
		clock: ctx.clock,
	});
	const cleanupContext = workflowContext(ctx, owned, false);
	const failures: unknown[] = [];
	for (let index = cleanups.length - 1; index >= 0; index -= 1) {
		try {
			await resolveOperation(
				cleanups[index]!,
				cleanupContext,
				scheduler,
				`${ctx.workflow.id}@${ctx.version}/cleanup/${index}`,
			);
		} catch (error) {
			failures.push(error);
		}
	}
	return Object.freeze(failures);
}

/**
 * Executes control as one finite phase of the module runtime.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function runControl(
	ctx: WorkflowContext,
	instruction: WorkflowControlInstruction,
	path: string,
	scheduler: Scheduler,
): Promise<WorkflowCompletionAny> {
	try {
		if (instruction.type === 'parallel') return await runParallel(ctx, instruction, path, scheduler);
		if (instruction.type === 'race') return await runRace(ctx, instruction, path, scheduler);
		if (instruction.type === 'map') return await runMap(ctx, instruction, path, scheduler);
		return await runRetry(ctx, instruction, path, scheduler);
	} catch (error) {
		if (error instanceof ContinueAsNewError) throw error;
		if (
			error instanceof CleanupFailureError || error instanceof CleanupInstructionError || error instanceof FaultError
		) {
			return fault(error instanceof FaultError ? error.fault : error);
		}
		if (isCancellation(error)) return cancelled(cancellationReason(error));
		return failed(error);
	}
}

/**
 * Executes parallel as one finite phase of the module runtime.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function runParallel(
	ctx: WorkflowContext,
	instruction: WorkflowParallelInstruction,
	path: string,
	scheduler: Scheduler,
): Promise<WorkflowCompletionAny> {
	const entries = Object.entries(instruction.operations);
	const concurrency = Math.min(instruction.concurrency ?? entries.length, entries.length);
	if (instruction.failure === 'settle') {
		const values = await ownedBounded(entries, concurrency, ctx, async ([key, childOperation], branchCtx) => {
			try {
				return [
					key,
					result.ok(await resolveOperation(childOperation, branchCtx, scheduler, `${path}/${encodeURIComponent(key)}`)),
				] as const;
			} catch (error) {
				if (isTerminalExecutionError(error)) throw error;
				return [key, result.fail(error)] as const;
			}
		});
		return success(Object.freeze(Object.fromEntries(values)));
	}
	const values = await failFast(entries, concurrency, ctx, async ([key, childOperation], branchCtx) => {
		return [
			key,
			await resolveOperation(childOperation, branchCtx, scheduler, `${path}/${encodeURIComponent(key)}`),
		] as const;
	});
	return success(Object.freeze(Object.fromEntries(values)));
}

/**
 * Executes race as one finite phase of the module runtime.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function runRace(
	ctx: WorkflowContext,
	instruction: WorkflowRaceInstruction,
	path: string,
	scheduler: Scheduler,
): Promise<WorkflowCompletionAny> {
	const entries = Object.entries(instruction.operations).sort(([left], [right]) => left.localeCompare(right));
	if (entries.length > MAX_ACTIVE_CHILDREN) {
		throw new RangeError(`Workflow race cannot start more than ${MAX_ACTIVE_CHILDREN} child operations.`);
	}
	const reducer = new Reducer();
	const scope = new Scope();
	const branches = entries.map(([key, childOperation]) => {
		const branch = createBranch(reducer, ctx, `workflow race branch ${key}`, async (branchCtx) => {
			const value = await resolveOperation(childOperation, branchCtx, scheduler, `${path}/${encodeURIComponent(key)}`);
			return Object.freeze({ key, value });
		});
		scope.addChild(branch);
		return Object.freeze({ key, branch, result: branch.start() });
	});
	const first = await Promise.race(branches.map(async (entry) => Object.freeze({ entry, exit: await entry.result })));
	const primary = exitFailure(first.exit);
	const reason = new SiblingCancellation(
		primary === undefined ? `Workflow race was won by ${first.entry.key}.` : primary,
	);
	await scope.close(reason);
	const settled = await Promise.all(branches.map(async (entry) => Object.freeze({ entry, exit: await entry.result })));
	const cleanupFailures = settled
		.filter(({ entry }) => entry !== first.entry)
		.map(({ exit }) => exitFailure(exit))
		.filter((failure) => failure !== undefined && !isSiblingCancellation(failure));
	if (primary !== undefined) {
		if (cleanupFailures.length > 0) throw new CleanupFailureError(primary, cleanupFailures);
		throw primary;
	}
	if (cleanupFailures.length > 0) throw new CleanupFailureError(first.exit, cleanupFailures);
	if (first.exit.type !== 'success') throw causeFailure(first.exit.cause);
	return success(first.exit.value);
}

/**
 * Executes map as one finite phase of the module runtime.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function runMap(
	ctx: WorkflowContext,
	instruction: WorkflowMapInstruction,
	path: string,
	scheduler: Scheduler,
): Promise<WorkflowCompletionAny> {
	if (instruction.failure === 'settle') {
		const values = await ownedBounded(instruction.entries, instruction.concurrency, ctx, async (entry, branchCtx) => {
			try {
				return result.ok(
					await resolveOperation(entry.operation, branchCtx, scheduler, `${path}/${encodeURIComponent(entry.key)}`),
				);
			} catch (error) {
				if (isTerminalExecutionError(error)) throw error;
				return result.fail(error);
			}
		});
		return success(Object.freeze(values));
	}
	const values = await failFast(instruction.entries, instruction.concurrency, ctx, async (entry, branchCtx) => {
		return await resolveOperation(entry.operation, branchCtx, scheduler, `${path}/${encodeURIComponent(entry.key)}`);
	});
	return success(Object.freeze(values));
}

/**
 * Executes retry as one finite phase of the module runtime.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function runRetry(
	ctx: WorkflowContext,
	instruction: WorkflowRetryInstruction,
	path: string,
	scheduler: Scheduler,
): Promise<WorkflowCompletionAny> {
	let previous: unknown;
	for (let attempt = 1; attempt <= instruction.maximumAttempts; attempt += 1) {
		try {
			return success(await resolveOperation(instruction.operation, ctx, scheduler, `${path}/attempt:${attempt}`));
		} catch (error) {
			if (isTerminalExecutionError(error)) throw error;
			previous = error;
			if (attempt < instruction.maximumAttempts && instruction.delay !== undefined) {
				const delay = retryDelay(instruction, path, attempt);
				await resolveOperation(sleep(delay.toString()), ctx, scheduler, `${path}/retry-delay:${attempt}`);
			}
		}
	}
	return failed(previous);
}

/**
 * Calculates the deterministic retry delay, including bounded jitter, for one instruction attempt.
 *
 * @internal
 */
function retryDelay(instruction: WorkflowRetryInstruction, path: string, failedAttempt: number): Temporal.Duration {
	const initialMilliseconds = durationMilliseconds(instruction.delay!);
	const maximumMilliseconds = instruction.maximumDelay === undefined
		? Number.POSITIVE_INFINITY
		: durationMilliseconds(instruction.maximumDelay);
	const backedOff = Math.min(initialMilliseconds * instruction.backoff ** (failedAttempt - 1), maximumMilliseconds);
	const jitterScale = instruction.jitter === 0
		? 1
		: 1 + ((deterministicUnit(`${path}:${failedAttempt}`) * 2) - 1) * instruction.jitter;
	return Temporal.Duration.from({ milliseconds: Math.max(0, Math.round(backedOff * jitterScale)) });
}

/**
 * Converts duration into the millisecond value used by the durable workflow interpreter.
 *
 * @internal
 */
function durationMilliseconds(duration: Temporal.Duration): number {
	let milliseconds: number;
	try {
		milliseconds = duration.total({ unit: 'milliseconds', relativeTo: Temporal.PlainDate.from('2000-01-01') });
	} catch (error) {
		throw new TypeError('Workflow retry delay must be convertible to milliseconds.', { cause: error });
	}
	if (!Number.isFinite(milliseconds) || milliseconds < 0) {
		throw new TypeError('Workflow retry delay must be a finite non-negative duration.');
	}
	return milliseconds;
}

/**
 * Derives a stable unit interval value from instruction identity so replay uses the same retry jitter.
 *
 * @internal
 */
function deterministicUnit(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0xffff_ffff;
}

/**
 * Runs bounded workflow branches while keeping each child operation owned and joined before the parent continues.
 *
 * Workflow internals preserve deterministic instruction identity, replay, cancellation, registered cleanup, and control-instruction ownership.
 *
 * @internal
 */
async function ownedBounded<WorkflowInput, Output>(
	values: readonly WorkflowInput[],
	concurrency: number,
	ctx: WorkflowContext,
	executeValue: (value: WorkflowInput, ctx: WorkflowContext, index: number) => Promise<Output>,
): Promise<Output[]> {
	if (values.length === 0) return [];
	const maximum = Math.min(boundedConcurrency(concurrency, 'concurrency'), values.length);
	const reducer = new Reducer();
	const scope = new Scope();
	const valuesByIndex = new Array<Output>(values.length);
	const active = new Map<number, Branch<Output>>();
	const failures: unknown[] = [];
	let nextIndex = 0;
	let primary: unknown;
	let hasPrimary = false;

	const launch = (index: number): void => {
		const branch = createBranch(
			reducer,
			ctx,
			`workflow branch ${index}`,
			(branchCtx) => executeValue(values[index]!, branchCtx, index),
		);
		scope.addChild(branch);
		active.set(index, branch);
		void branch.start().then((exit) => {
			active.delete(index);
			const failure = exitFailure(exit);
			if (failure === undefined && exit.type === 'success') valuesByIndex[index] = exit.value;
			else if (!hasPrimary) {
				primary = failure;
				hasPrimary = true;
				const reason = new SiblingCancellation(failure);
				void scope.close(reason);
			} else if (!isSiblingCancellation(failure)) failures.push(failure);
		});
	};

	while (active.size < maximum && nextIndex < values.length) launch(nextIndex++);
	while (active.size > 0) {
		await Promise.race([...active.values()].map((branch) => branch.settled()));
		while (!hasPrimary && active.size < maximum && nextIndex < values.length) launch(nextIndex++);
	}
	await scope.close(hasPrimary ? new SiblingCancellation(primary) : undefined);
	if (hasPrimary) {
		if (failures.length > 0) throw new CleanupFailureError(primary, failures);
		throw primary;
	}
	return valuesByIndex;
}

/**
 * Runs child workflow operations with fail-fast semantics and waits for sibling cancellation and cleanup before returning the failure.
 *
 * @internal
 */
async function failFast<WorkflowInput, Output>(
	values: readonly WorkflowInput[],
	concurrency: number,
	ctx: WorkflowContext,
	executeValue: (value: WorkflowInput, ctx: WorkflowContext, index: number) => Promise<Output>,
): Promise<Output[]> {
	return await ownedBounded(values, concurrency, ctx, executeValue);
}

/**
 * Creates the live branch used to execute one child workflow operation under structured ownership.
 *
 * @internal
 */
function createBranch<Output>(
	reducer: Reducer,
	ctx: WorkflowContext,
	name: string,
	executeValue: (ctx: WorkflowContext) => Promise<Output>,
): Branch<Output> {
	return new Branch(
		kernelOperation.fromPromise(name, async (signal) => {
			await using owned = contextCore.child(ctx, { signal });
			return await executeValue(workflowContext(ctx, owned));
		}),
		reducer,
	);
}

/**
 * Builds the branch exit failure used when the durable workflow interpreter cannot complete as intended.
 *
 * @internal
 */
function exitFailure<Value>(exit: Exit<Value>): unknown | undefined {
	if (exit.type === 'success') return undefined;
	return causeFailure(exit.cause);
}

/**
 * Builds the branch cause failure used when the durable workflow interpreter cannot complete as intended.
 *
 * @internal
 */
function causeFailure(cause: Cause): unknown {
	if (cause.type === 'failure') return cause.failure;
	if (cause.type === 'fault') return new FaultError(cause.fault);
	if (cause.type === 'cancelled') return new CancelledError(cause.reason);
	const failures = cause.causes.map(causeFailure);
	const primary = failures[0];
	return failures.length <= 1 ? primary : new CleanupFailureError(primary, failures.slice(1));
}

/**
 * Creates the workflow context that carries ownership and cancellation through the durable workflow interpreter.
 *
 * Workflow internals preserve deterministic instruction identity, replay, cancellation, registered cleanup, and control-instruction ownership.
 *
 * @internal
 */
function workflowContext(parent: WorkflowContext, owned: contextCore.Owned, inheritPause = true): WorkflowContext {
	const checkpoint = inheritPause
		? async (): Promise<void> => {
			contextCore.check(owned);
			await parent.checkpoint();
			contextCore.check(owned);
		}
		: async (): Promise<void> => contextCore.check(owned);
	return Object.freeze({
		id: owned.id,
		...(owned.traceId === undefined ? {} : { traceId: owned.traceId }),
		...(owned.deploymentId === undefined ? {} : { deploymentId: owned.deploymentId }),
		...(owned.idempotencyKey === undefined ? {} : { idempotencyKey: owned.idempotencyKey }),
		startedAt: owned.startedAt,
		...(owned.deadline === undefined ? {} : { deadline: owned.deadline }),
		signal: owned.signal,
		clock: owned.clock,
		workflow: parent.workflow,
		runId: parent.runId,
		input: parent.input,
		version: parent.version,
		checkpoint,
	});
}

/** Build the checkpoint inherited from a live Task without making Task ownership mandatory for durable workflows. */
function inheritedCheckpoint(parent: import('@okikio/context').Context, owned: contextCore.Owned): () => Promise<void> {
	const candidate = (parent as import('@okikio/context').Context & { readonly checkpoint?: unknown }).checkpoint;
	if (typeof candidate !== 'function') return async () => contextCore.check(owned);
	return async () => {
		contextCore.check(owned);
		await (candidate as () => Promise<void>).call(parent);
		contextCore.check(owned);
	};
}

/**
 * Builds the instruction path used by the durable workflow interpreter.
 *
 * @internal
 */
function instructionPath(base: string, index: number, instruction: WorkflowInstruction): string {
	const segment = instruction.key === undefined ? String(index) : encodeURIComponent(instruction.key);
	return `${base}/${segment}:${instruction.type}`;
}

/** Normalize activity command options, including durable affinity and annotation snapshots. @internal */
function normalizeActivityOptions(options: ActivityCommandOptions): ActivityCommandOptions {
	recordCore.assert(options, 'workflow activity options');
	const affinity = options.affinity === undefined ? undefined : freezeAffinity(options.affinity);
	const annotations = options.annotations === undefined ? undefined : freezeAnnotations(options.annotations);
	return Object.freeze({
		...(options.key === undefined ? {} : { key: options.key }),
		...(annotations === undefined ? {} : { annotations }),
		...(affinity === undefined ? {} : { affinity }),
	});
}

/** Normalize child-workflow options so nested metadata cannot change after operation creation. @internal */
function normalizeChildOptions(options: ChildOptions): ChildOptions {
	recordCore.assert(options, 'workflow child options');
	if (options.cancellation !== undefined && !['follow-parent', 'request', 'independent'].includes(options.cancellation)) {
		throw new TypeError('workflow child cancellation must be follow-parent, request, or independent.');
	}
	if (options.result !== undefined && options.result !== 'wait' && options.result !== 'discard') {
		throw new TypeError('workflow child result must be wait or discard.');
	}
	const annotations = options.annotations === undefined ? undefined : freezeAnnotations(options.annotations);
	return Object.freeze({
		...(options.key === undefined ? {} : { key: options.key }),
		...(annotations === undefined ? {} : { annotations }),
		...(options.cancellation === undefined ? {} : { cancellation: options.cancellation }),
		...(options.result === undefined ? {} : { result: options.result }),
	});
}


/**
 * Extracts stable instruction metadata used by diagnostics and the durable instruction description.
 *
 * @internal
 */
function instructionMetadata(
	options: WorkflowCommandOptions,
): Readonly<{ readonly key?: string; readonly annotations?: WorkflowAnnotations }> {
	recordCore.assert(options, 'workflow command options');
	if (options.key !== undefined) assertStableKey(options.key);
	return {
		...(options.key === undefined ? {} : { key: options.key }),
		...(options.annotations === undefined ? {} : { annotations: freezeAnnotations(options.annotations) }),
	};
}

/**
 * Snapshots annotations so later compilation cannot observe caller mutation.
 *
 * @internal
 */
function freezeAnnotations(value: WorkflowAnnotations): WorkflowAnnotations {
	const snapshot = recordCore.snapshot(value, 'workflow annotations');
	for (const [key, annotation] of recordCore.entries(snapshot, 'workflow annotations')) {
		if (typeof annotation !== 'string' && typeof annotation !== 'boolean' &&
			(typeof annotation !== 'number' || !Number.isFinite(annotation))) {
			throw new TypeError(`workflow annotation ${JSON.stringify(key)} must be a string, boolean, or finite number.`);
		}
	}
	return snapshot;
}

/**
 * Snapshots record so later compilation cannot observe caller mutation.
 *
 * @internal
 */
function freezeRecord<Values extends Readonly<Record<string, unknown>>>(value: Values): Values {
	return recordCore.snapshot(value, 'workflow operation record');
}

/**
 * Rejects invalid operations before it can enter authoritative module state.
 *
 * @internal
 */
function assertOperations(value: WorkflowOperations): void {
	recordCore.assert(value, 'workflow operation record');
	if (recordCore.keys(value, 'workflow operation record').length === 0) {
		throw new TypeError('Workflow control instruction requires at least one operation.');
	}
	for (const [key, childOperation] of recordCore.entries(value, 'workflow operation record')) {
		assertStableKey(key);
		assertOperation(childOperation);
	}
}

/**
 * Rejects invalid operation before it can enter authoritative module state.
 *
 * @internal
 */
function assertOperation(value: unknown): asserts value is WorkflowOperation<unknown, unknown> {
	if (
		typeof value !== 'object' || value === null ||
		typeof (value as WorkflowOperation<unknown, unknown>)[Symbol.iterator] !== 'function'
	) {
		throw new TypeError('Workflow operation must implement Symbol.iterator.');
	}
}

/**
 * Creates d instruction while preserving the module's ownership rules.
 *
 * @internal
 */
function createdInstruction(value: WorkflowOperation<unknown, unknown>, label: string): WorkflowInstruction {
	assertOperation(value);
	const instruction = operationInstructions.get(value as object);
	if (instruction === undefined) {
		throw new TypeError(`${label} must come from a workflow or activity operation creator.`);
	}
	return instruction;
}

/**
 * Rejects invalid instruction before it can enter authoritative module state.
 *
 * It preserves deterministic durable instruction identity, replay semantics, cancellation, cleanup, and control-instruction ownership.
 *
 * @internal
 */
function assertInstruction(value: unknown): asserts value is WorkflowInstruction {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('Workflow program yielded a non-instruction value.');
	}
	const instruction = value as Partial<WorkflowInstruction>;
	if (instruction.category !== 'command' && instruction.category !== 'control') {
		throw new TypeError('Workflow instruction category must be command or control.');
	}
	if (typeof instruction.type !== 'string' || instruction.type.length === 0) {
		throw new TypeError('Workflow instruction type must be a non-empty string.');
	}
	if (!Number.isSafeInteger(instruction.version) || (instruction.version ?? 0) < 1) {
		throw new TypeError('Workflow instruction version must be a positive safe integer.');
	}
}

/** Encode one workflow completion into data a durable History can persist directly. */
async function encodeCompletion(
	completion: WorkflowCompletionAny,
): Promise<import('./types.ts').HistoryCompletionType> {
	if (completion.type === 'success') {
		return Object.freeze({ type: 'success', value: historyValue(completion.value, 'workflow success') });
	}
	if (completion.type === 'failure') {
		if (failures.isOccurrence(completion.failure)) {
			const encoded = await failures.encode(completion.failure);
			const data = durable.snapshot(encoded.data, 'workflow failure data');
			return Object.freeze({
				type: 'failure',
				failure: Object.freeze({
					kind: 'occurrence',
					value: Object.freeze({ id: encoded.id, data, message: encoded.message }),
				}),
			});
		}
		return Object.freeze({ type: 'failure', failure: Object.freeze({ kind: 'value', value: historyValue(completion.failure, 'workflow failure') }) });
	}
	if (completion.type === 'cancelled') {
		return Object.freeze({ type: 'cancelled', reason: historyValue(encodeFault(completion.reason), 'workflow cancellation') });
	}
	return Object.freeze({ type: 'fault', fault: historyValue(encodeFault(completion.fault), 'workflow fault') });
}

/** Decode one persisted completion through exact definitions imported by the replayed workflow. */
async function decodeCompletion(
	workflow: WorkflowDefinition,
	completion: import('./types.ts').HistoryCompletionType,
): Promise<WorkflowCompletionAny> {
	if (completion.type === 'success') return success(historyValueOutput(completion.value));
	if (completion.type === 'cancelled') return cancelled(historyValueOutput(completion.reason));
	if (completion.type === 'fault') return fault(historyValueOutput(completion.fault));
	if (completion.failure.kind === 'value') return failed(historyValueOutput(completion.failure.value));
	const trusted = workflowFailures(workflow);
	return failed(await failures.decode(completion.failure.value, trusted));
}

/** Encode `undefined` explicitly while keeping every other completion value JSON-safe. */
function historyValue(value: unknown, label: string): import('./types.ts').HistoryValueType {
	if (value === undefined) return Object.freeze({ kind: 'undefined' });
	return Object.freeze({ kind: 'value', value: durable.snapshot(value, label) });
}

/** Restore the explicit undefined marker used by durable completion history. */
function historyValueOutput(value: import('./types.ts').HistoryValueType): unknown {
	return value.kind === 'undefined' ? undefined : value.value;
}

/** Collect exact failure definitions reachable from one workflow without global registration. */
function workflowFailures(workflow: WorkflowDefinition): readonly import('@okikio/failure').Definition[] {
	const failures = new Set<import('@okikio/failure').Definition>();
	for (const failure of workflow.failures) failures.add(failure);
	for (const activity of workflow.activities) for (const failure of activity.failures) failures.add(failure);
	// A child workflow may expose only failures declared by its own public
	// contract. Its internal activities are not part of the parent's authority.
	for (const child of workflow.workflows) for (const failure of child.failures) failures.add(failure);
	return Object.freeze([...failures]);
}

/** Convert unexpected runtime reasons to bounded JSON-safe diagnostic data. */
function encodeFault(value: unknown): faultCore.FaultValue {
	return faultCore.encode(value);
}

/**
 * Rejects invalid unique instruction key before it can enter authoritative module state.
 *
 * @internal
 */
function assertUniqueInstructionKey(keys: Set<string>, instruction: WorkflowInstruction): void {
	if (instruction.key === undefined) return;
	assertStableKey(instruction.key);
	if (keys.has(instruction.key)) {
		throw new TypeError(
			`Workflow program yielded duplicate instruction key ${JSON.stringify(instruction.key)} in one scope.`,
		);
	}
	keys.add(instruction.key);
}

/**
 * Rejects invalid identifier before it can enter authoritative module state.
 *
 * @internal
 */
function assertIdentifier(value: string, label: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) throw new TypeError(`Invalid ${label} id ${JSON.stringify(value)}.`);
}

/**
 * Rejects invalid stable key before it can enter authoritative module state.
 *
 * @internal
 */
function assertStableKey(value: string): void {
	if (value.trim().length === 0) throw new TypeError('Workflow instruction keys must not be empty.');
	if (value.length > 512) throw new TypeError('Workflow instruction keys must not exceed 512 characters.');
}

/**
 * Validates positive integer before it is used by the durable workflow interpreter.
 *
 * @internal
 */
function boundedConcurrency(value: number, label: string): number {
	const concurrency = positiveInteger(value, label);
	if (concurrency > MAX_ACTIVE_CHILDREN) {
		throw new RangeError(`${label} cannot exceed ${MAX_ACTIVE_CHILDREN}.`);
	}
	return concurrency;
}

function positiveInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
	return value;
}

/**
 * Checks whether terminal execution error satisfies the condition required by the durable workflow interpreter.
 *
 * @internal
 */
function isTerminalExecutionError(error: unknown): boolean {
	return error instanceof FaultError || error instanceof ContinueAsNewError || error instanceof CleanupFailureError ||
		isCancellation(error);
}

/**
 * Checks whether cancellation satisfies the condition required by the durable workflow interpreter.
 *
 * @internal
 */
function isCancellation(error: unknown): boolean {
	return error instanceof CancelledError ||
		error instanceof contextCore.ContextCancelledError ||
		error instanceof contextCore.ContextDeadlineExceededError;
}

/**
 * Returns the cancellation reason carried by one terminal workflow error by the durable workflow interpreter.
 *
 * @internal
 */
function cancellationReason(error: unknown): unknown {
	if (error instanceof CancelledError || error instanceof contextCore.ContextCancelledError) return error.reason;
	return error;
}

/**
 * Checks whether sibling cancellation satisfies the condition required by the durable workflow interpreter.
 *
 * @internal
 */
function isSiblingCancellation(error: unknown): boolean {
	if (error instanceof CancelledError) return error.reason instanceof SiblingCancellation;
	if (error instanceof contextCore.ContextCancelledError) return error.reason instanceof SiblingCancellation;
	return false;
}

export { continueRun as continue };
export { PlacementError, RegistrationConflictError, SchedulerClosedError } from './jobs.ts';
export type {
	WorkflowSchema,
	EngineReference,
	EngineChoiceModeType,
	EngineChoiceReference,
	EnginePlacementReference,
	ActivityReference,
	WorkflowReference,
	WorkflowOptions,
	WorkflowDefinition,
	WorkflowInput,
	WorkflowResult,
	WorkflowFailures,
	WorkflowContext,
	WorkflowAnnotations,
	WorkflowInstructionBase,
	WorkflowCommandBase,
	WorkflowControlBase,
	WorkflowCommandOptions,
	EngineAffinityType,
	ActivityCommandOptions,
	ActivityCommand,
	WorkflowSleepCommand,
	WorkflowSignal,
	WorkflowWaitCommand,
	ChildOptions,
	ChildWorkflowCommand,
	WorkflowEffectCommand,
	WorkflowDeferCommand,
	WorkflowContinueCommand,
	WorkflowParallelOptions,
	WorkflowParallelInstruction,
	WorkflowRaceOptions,
	WorkflowRaceInstruction,
	WorkflowMapEntry,
	WorkflowMapOptions,
	WorkflowMapInstruction,
	WorkflowRetryOptions,
	WorkflowRetryInstruction,
	WorkflowDurableValue,
	WorkflowInstructionDescription,
	WorkflowInstructionIdentity,
	WorkflowCommand,
	WorkflowControlInstruction,
	WorkflowInstruction,
	WorkflowSuccess,
	WorkflowFailure,
	WorkflowFault,
	WorkflowCancelled,
	WorkflowCompletion,
	WorkflowCompletionAny,
	WorkflowOperation,
	WorkflowOperationValue,
	WorkflowOperationFailure,
	WorkflowOperations,
	WorkflowOperationValues,
	WorkflowSettledValues,
	WorkflowOperationFailures,
	WorkflowRaceResult,
	WorkflowProgram,
	WorkflowImplementation,
	WorkflowCommandHandler,
	HistoryValueType,
	HistoryFailureOccurrenceType,
	HistoryFailureType,
	HistoryCompletionType,
	HistoryInput,
	History,
	MemoryHistory,
	HistoryOptions,
	HistoryEntryType,
	HistorySnapshotType,
	EngineCapacityType,
	ActivityOriginType,
	ActivityJobType,
	ActivityJobResultType,
	ActivityAttemptType,
	ActivityAttemptResultType,
	ActivityAttemptControl,
	EngineProvider,
	EngineRegistrationOptions,
	EngineRegistration,
	SchedulerOptions,
	Scheduler,
	WorkflowContextOptions,
	WorkflowRunOptions,
	WorkflowCatalog,
	WorkflowSelection,
	WorkflowDocument,
} from './types.ts';
