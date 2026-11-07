/**
 * Author workflow operations and their stable instruction identities without starting an interpreter.
 * @module
 */

import { temporal } from '@okikio/duration/temporal';
import * as codec from '@okikio/schema/codec';
import { encodeHex } from '@std/encoding/hex';
import type * as effects from '@okikio/capability/effect';
import type * as result from '@okikio/result';
import * as recordCore from '@okikio/collection/record';
import * as schema from '@okikio/schema';
import { freeze as freezeAffinity } from './affinity.ts';
import * as assert from './assert.ts';
import * as placement from './placement.ts';
import * as durable from './durable.ts';
import { MAX_ACTIVE_CHILDREN } from './scope.ts';
import type {
	ActivityCommand,
	ActivityCommandOptions,
	ActivityReference,
	ChildOptions,
	ChildWorkflowCommand,
	DurationWaitType,
	EventWaitType,
	UntilWaitType,
	WorkflowAnnotations,
	WorkflowCommandOptions,
	WorkflowCompletionAny,
	WorkflowDeferCommand,
	WorkflowDurableValue,
	WorkflowEffectCommand,
	WorkflowInstruction,
	WorkflowInstructionDescription,
	WorkflowInstructionIdentity,
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
	WorkflowReference,
	WorkflowRetryInstruction,
	WorkflowRetryOptions,
	WorkflowSettledValues,
	WorkflowSignal,
	WorkflowSleepCommand,
	WorkflowWaitCommand,
} from './types.ts';
import { assertIdentifier, assertInstruction, assertOperation, assertStableKey, boundedConcurrency } from './assert.ts';
import { CancelledError, FaultError } from './errors.ts';

/** Version shared by the built-in workflow instruction envelopes in this source revision. */
const builtInInstructionVersion = 1;
/**
 * Associates immutable author-facing operations with their serializable instruction without exposing
 * mutable state.
 */
const operationInstructions = new WeakMap<object, WorkflowInstruction>();

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
	const command = Object.freeze(
		{
			category: 'command',
			type: 'activity',
			version: builtInInstructionVersion,
			activity: definition,
			input: durable.snapshot(input, 'activity input'),
			options: normalizedOptions,
			...instructionMetadata(normalizedOptions),
		} satisfies ActivityCommand<Value, Failure>,
	);
	return operation(command);
}

/** Sleep for a duration or until an absolute deadline. Saved timers release worker capacity. */
export function sleep(
	duration: Temporal.DurationLike | string | { readonly until: string },
	options: WorkflowCommandOptions = {},
): WorkflowOperation<Temporal.Instant> {
	if (typeof duration === 'object' && 'until' in duration) return wait({ until: duration.until, ...options });
	const command = Object.freeze(
		{
			category: 'command',
			type: 'sleep',
			version: builtInInstructionVersion,
			duration: temporal.Duration.from(duration),
			...instructionMetadata(options),
		} satisfies WorkflowSleepCommand,
	);
	return operation(command);
}

/** Wait until a pinned absolute UTC instant.
 * @deprecated Use `wait({ until })`, which returns a Temporal.Instant.
 */
export function sleepUntil(until: string, options: WorkflowCommandOptions = {}): WorkflowOperation<string> {
	const instant = temporal.Instant.from(until).toString();
	return operation({
		category: 'command',
		type: 'sleep-until',
		version: 1,
		until: instant,
		...instructionMetadata(options),
	});
}

/**
 * Wait for an event addressed to this run and key. Early delivery is retained by
 * the store. Use an absolute deadline so a restart does not extend the wait.
 * Timeout is a value; cancellation still cancels the workflow.
 * @deprecated Use `wait({ event: definition, key, until })`.
 */
export function waitForEvent<Value>(
	definition: WorkflowSignal<Value>,
	options: WorkflowCommandOptions & { readonly key?: string; readonly until?: string } = {},
): WorkflowOperation<import('./types.ts').EventResult<Value>> {
	assertIdentifier(definition.id, 'workflow event');
	schema.assert(codec.input(definition.value), 'workflow event schema');
	const eventKey = options.key ?? 'default';
	if (!eventKey.trim() || eventKey.length > 512) throw new TypeError('Event key must contain 1..512 characters.');
	const until = options.until === undefined ? undefined : temporal.Instant.from(options.until).toString();
	return operation({
		category: 'command',
		type: 'wait-event',
		version: builtInInstructionVersion,
		event: definition,
		eventKey,
		...instructionMetadata(options),
		...(until === undefined ? {} : { until }),
	});
}

/**
 * Wait for an event or a timer with `yield*`. Event waits return received data or
 * a timeout. Timer waits return the instant supplied by the timer host. A saved
 * timer returns its stored deadline, even if a replacement resumes it later.
 *
 * A saved run releases its execution slot while waiting. Restarted generators
 * receive the saved result at the same instruction. Keep keys and deadlines
 * stable during replay. Use `defer()` to register cleanup; it does not delay work.
 *
 * @example
 * ```ts
 * const resumed = yield* workflow.wait({ duration: { seconds: 5 } });
 * const expired = yield* workflow.wait({ until: ctx.input.expiresAt });
 * const approval = yield* workflow.wait({ event: Approved, key: 'publish', until: ctx.input.expiresAt });
 * if (approval.type === 'received') console.log(approval.value);
 * ```
 */
export function wait<Value>(
	definition: WorkflowSignal<Value>,
	options?: WorkflowCommandOptions & { readonly until?: string },
): WorkflowOperation<import('./types.ts').EventResult<Value>>;
/** Wait for the named event and key, optionally until its deadline. */
export function wait<Value>(
	options: EventWaitType<Value>,
): WorkflowOperation<import('./types.ts').EventResult<Value>>;
/** Wait for a relative duration or absolute instant and receive the timer's result. */
export function wait(
	options: DurationWaitType | UntilWaitType,
): WorkflowOperation<Temporal.Instant>;
/** @deprecated Custom command-host hook. Use the event options form for local and durable event delivery. */
export function wait<Value>(
	definition: WorkflowSignal<Value>,
	input: unknown,
	options?: WorkflowCommandOptions,
): WorkflowOperation<Value>;
export function wait<Value>(
	request:
		| EventWaitType<Value>
		| DurationWaitType
		| UntilWaitType
		| WorkflowSignal<Value>,
	input?: unknown,
	options: WorkflowCommandOptions = {},
): WorkflowOperation<unknown> {
	if (!request || typeof request !== 'object') throw new TypeError('Wait requires event, duration, or until options.');
	// Retain the custom host signature and its saved instruction format for existing callers.
	if ('kind' in request) {
		if (request.kind !== 'workflow-signal') throw new TypeError('Invalid workflow signal.');
		if (
			arguments.length < 3 &&
			(input === undefined ||
				(typeof input === 'object' && input !== null &&
					Object.keys(input).every((key) => ['key', 'until', 'annotations'].includes(key))))
		) {
			return waitForEvent(request, input as WorkflowCommandOptions & { readonly until?: string } | undefined);
		}
		const command = Object.freeze(
			{
				category: 'command',
				type: 'wait',
				version: builtInInstructionVersion,
				signal: request,
				input: durable.snapshot(input, 'wait input'),
				...instructionMetadata(options),
			} satisfies WorkflowWaitCommand<Value>,
		);
		return operation(command);
	}
	if (request.event !== undefined) {
		if (request.duration !== undefined || typeof request.key !== 'string') {
			throw new TypeError('Event waits require a key and cannot include a duration.');
		}
		return waitForEvent(request.event, request);
	}
	if (request.duration !== undefined) {
		if (request.until !== undefined) throw new TypeError('Timer waits require exactly one of duration or until.');
		const duration = temporal.Duration.from(request.duration);
		if (duration.sign < 0) throw new RangeError('Wait duration must not be negative.');
		return sleep(duration, request);
	}
	if (request.until === undefined) throw new TypeError('Timer waits require exactly one of duration or until.');
	const timer = sleepUntil(request.until, request);
	// Convert the saved string at the generator boundary. Existing history stays readable.
	return Object.freeze({
		*[Symbol.iterator]() {
			return temporal.Instant.from(yield* timer);
		},
	});
}

/** Start or await one child workflow. */
export function child<WorkflowDefinition extends WorkflowReference>(
	definition: WorkflowDefinition,
	input: import('./types.ts').WorkflowInput<WorkflowDefinition>,
	options: ChildOptions = {},
): WorkflowOperation<
	import('./types.ts').WorkflowResult<WorkflowDefinition>,
	import('./types.ts').WorkflowFailures<WorkflowDefinition>
> {
	const normalizedOptions = normalizeChildOptions(options);
	const command = Object.freeze(
		{
			category: 'command',
			type: 'child-workflow',
			version: builtInInstructionVersion,
			workflow: definition,
			input: durable.snapshot(input, 'child workflow input'),
			options: normalizedOptions,
			...instructionMetadata(normalizedOptions),
		} satisfies ChildWorkflowCommand,
	);
	return operation(command);
}

/**
 * Request one workflow-level effect announcement.
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
	const command = Object.freeze(
		{
			category: 'command',
			type: 'effect',
			version: builtInInstructionVersion,
			effect: definition,
			value: durable.snapshot(value, 'effect value'),
			...instructionMetadata(options),
		} satisfies WorkflowEffectCommand,
	);
	return operation(command);
}

/** Register a cleanup operation that executes when the workflow scope closes. */
export function defer(
	cleanup: WorkflowOperation<unknown, unknown>,
	options: WorkflowCommandOptions = {},
): WorkflowOperation<void> {
	const cleanupInstruction = createdInstruction(cleanup, 'workflow.defer cleanup');
	if (
		cleanupInstruction.category !== 'command' ||
		(cleanupInstruction.type !== 'activity' && cleanupInstruction.type !== 'child-workflow')
	) {
		throw new TypeError('workflow.defer cleanup must be one activity or child-workflow operation.');
	}
	const command = Object.freeze(
		{
			category: 'command',
			type: 'defer',
			version: builtInInstructionVersion,
			cleanup: cleanupInstruction,
			...instructionMetadata(options),
		} satisfies WorkflowDeferCommand,
	);
	return operation(command);
}

/** End the current run and request an atomic continuation with new input. */
export function continueRun<WorkflowInput>(
	input: WorkflowInput,
	options: WorkflowCommandOptions = {},
): WorkflowOperation<never> {
	const command = Object.freeze(
		{
			category: 'command',
			type: 'continue',
			version: builtInInstructionVersion,
			input: durable.snapshot(input, 'continue-as-new input'),
			...instructionMetadata(options),
		} satisfies import('./types.ts').WorkflowContinueCommand,
	);
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
	const instruction = Object.freeze(
		{
			category: 'control',
			type: 'parallel',
			version: builtInInstructionVersion,
			operations: freezeRecord(operations),
			failure: options.failure ?? 'fail-fast',
			...(options.concurrency === undefined
				? {}
				: { concurrency: boundedConcurrency(options.concurrency, 'parallel concurrency') }),
			...instructionMetadata(options),
		} satisfies WorkflowParallelInstruction<Values>,
	);
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
	const instruction = Object.freeze(
		{
			category: 'control',
			type: 'race',
			version: builtInInstructionVersion,
			operations: freezeRecord(operations),
			...instructionMetadata(options),
		} satisfies WorkflowRaceInstruction<Values>,
	);
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
	// Build every description now; concurrency limits execution later. The key and
	// factory callbacks must stay deterministic and must not perform external work.
	const entries = Object.freeze(items.map((item, index): WorkflowMapEntry<Value, Failure> => {
		const key = options.key(item, index);
		assertStableKey(key);
		if (keys.has(key)) throw new TypeError(`Workflow map produced duplicate key ${JSON.stringify(key)}.`);
		keys.add(key);
		const childOperation = createOperation(item, index);
		assertOperation(childOperation);
		return Object.freeze({ key, operation: childOperation });
	}));
	const instruction = Object.freeze(
		{
			category: 'control',
			type: 'map',
			version: builtInInstructionVersion,
			entries,
			concurrency: boundedConcurrency(options.concurrency, 'map concurrency'),
			failure: options.failure ?? 'fail-fast',
			...(options.instructionKey === undefined ? {} : { key: options.instructionKey }),
			...(options.annotations === undefined ? {} : { annotations: freezeAnnotations(options.annotations) }),
		} satisfies WorkflowMapInstruction<Value, Failure>,
	);
	return operation(instruction);
}

/** Repeat one operation according to one explicit maximum-attempt policy. */
export function retry<Value, Failure>(
	childOperation: WorkflowOperation<Value, Failure>,
	options: WorkflowRetryOptions,
): WorkflowOperation<Value, Failure> {
	recordCore.assert(options, 'workflow retry options');
	assertOperation(childOperation);
	const delay = options.delay === undefined ? undefined : temporal.Duration.from(options.delay);
	const maximumDelay = options.maximumDelay === undefined ? undefined : temporal.Duration.from(options.maximumDelay);
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
	const instruction = Object.freeze(
		{
			category: 'control',
			type: 'retry',
			version: builtInInstructionVersion,
			operation: childOperation,
			maximumAttempts: assert.positive(options.maximumAttempts, 'retry maximumAttempts'),
			...(delay === undefined ? {} : { delay }),
			backoff,
			...(maximumDelay === undefined ? {} : { maximumDelay }),
			jitter,
			...instructionMetadata(options),
		} satisfies WorkflowRetryInstruction<Value, Failure>,
	);
	return operation(instruction);
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

/**

 * Copy only the fields that define requested work. Child programs are checked at their own paths, not

 * serialized here.

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
			...(instruction.options.affinity === undefined ? {} : { affinity: instruction.options.affinity }),
			...(instruction.options.location === undefined ? {} : { location: instruction.options.location }),
		}, 'activity command');
	}
	if (instruction.type === 'sleep') {
		return durable.snapshot({ duration: instruction.duration.toString() }, 'sleep command');
	}
	if (instruction.type === 'sleep-until') return durable.snapshot({ until: instruction.until }, 'absolute timer');
	if (instruction.type === 'wait-event') {
		return durable.snapshot({
			event: instruction.event.id,
			key: instruction.eventKey,
			until: instruction.until ?? null,
		}, 'event wait');
	}
	if (instruction.type === 'wait') {
		return durable.snapshot({ signal: instruction.signal.id, input: instruction.input }, 'wait command');
	}
	if (instruction.type === 'child-workflow') {
		return durable.snapshot({
			workflow: { id: instruction.workflow.id, version: instruction.workflow.version },
			input: instruction.input,
			...(instruction.options.location === undefined ? {} : { location: instruction.options.location }),
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

 * Include the complete cleanup request in its registration identity, so replay cannot silently

 * replace cleanup work.

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
			...(command.options.affinity === undefined ? {} : { affinity: command.options.affinity }),
			input: command.input,
			...(command.options.location === undefined ? {} : { location: command.options.location }),
		}, 'cleanup activity command');
	}
	return durable.snapshot({
		category: command.category,
		type: command.type,
		version: command.version,
		...(command.key === undefined ? {} : { key: command.key }),
		workflow: { id: command.workflow.id, version: command.workflow.version },
		input: command.input,
		...(command.options.location === undefined ? {} : { location: command.options.location }),

		cancellation: command.options.cancellation ?? 'follow-parent',
		result: command.options.result ?? 'wait',
	}, 'cleanup child command');
}

/** Normalize activity command options, including durable affinity and annotation snapshots. @internal */
function normalizeActivityOptions(options: ActivityCommandOptions): ActivityCommandOptions {
	recordCore.assert(options, 'workflow activity options');
	const affinity = options.affinity === undefined ? undefined : freezeAffinity(options.affinity);
	const annotations = options.annotations === undefined ? undefined : freezeAnnotations(options.annotations);
	return Object.freeze({
		...(options.location === undefined ? {} : { location: placement.SelectionSchema.parse(options.location) }),
		...(options.key === undefined ? {} : { key: options.key }),
		...(annotations === undefined ? {} : { annotations }),
		...(affinity === undefined ? {} : { affinity }),
	});
}

/** Normalize child-workflow options so nested metadata cannot change after operation creation. @internal */
function normalizeChildOptions(options: ChildOptions): ChildOptions {
	recordCore.assert(options, 'workflow child options');
	if (
		options.cancellation !== undefined && !['follow-parent', 'request', 'independent'].includes(options.cancellation)
	) {
		throw new TypeError('workflow child cancellation must be follow-parent, request, or independent.');
	}
	if (options.result !== undefined && options.result !== 'wait' && options.result !== 'discard') {
		throw new TypeError('workflow child result must be wait or discard.');
	}
	const annotations = options.annotations === undefined ? undefined : freezeAnnotations(options.annotations);
	return Object.freeze({
		...(options.location === undefined ? {} : { location: placement.SelectionSchema.parse(options.location) }),
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
		if (
			typeof annotation !== 'string' && typeof annotation !== 'boolean' &&
			(typeof annotation !== 'number' || !Number.isFinite(annotation))
		) {
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

/** Require at least one iterable branch with a unique record key suitable for stable replay paths. */
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
 * Recover the instruction associated with an operation authored by this module.
 *
 * The WeakMap keeps operation identity exact without exposing a mutable field.
 * A look-alike iterable cannot supply an authoritative instruction.
 *
 * @internal
 */
export function createdInstruction(value: WorkflowOperation<unknown, unknown>, label: string): WorkflowInstruction {
	assertOperation(value);
	const instruction = operationInstructions.get(value as object);
	if (instruction === undefined) {
		throw new TypeError(`${label} must come from a workflow or activity operation creator.`);
	}
	return instruction;
}
