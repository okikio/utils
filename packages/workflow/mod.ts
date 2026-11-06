/**
 * Run a named sequence while recording completed instructions so another attempt can continue. Restarting
 * an ordinary function from its first line can otherwise repeat both expensive work and external writes.
 *
 * A workflow definition describes the sequence. Activities perform the individual operations. Placement
 * chooses eligible executors, and claims prevent replaced attempts from committing new guarded work.
 *
 * Replay uses recorded instruction outcomes, not saved stack frames or live sockets. In-memory stores
 * survive replacement only within their owning process. Use durable storage for process recovery, and
 * receiver idempotency or transactional receipts for external writes.
 *
 * @example
 * ```ts
 * import * as activity from '@okikio/activity';
 * import * as engine from '@okikio/activity/engine';
 * import * as context from '@okikio/context';
 * import * as dispatch from '@okikio/workflow/dispatch';
 * import * as history from '@okikio/workflow/history';
 * import * as workflow from '@okikio/workflow';
 *
 * import * as schema from '@okikio/schema';
 * const TextSchema = schema.string();
 *
 * const Local = engine.define({ id: 'local' });
 * const Echo = activity.define({
 * 	id: 'example.echo',
 * 	version: '1',
 * 	input: TextSchema,
 * 	result: TextSchema,
 * 	placement: engine.require(Local),
 * });
 *
 * const EchoWorkflow = workflow.define({
 * 	id: 'example.echo-workflow',
 * 	version: '1',
 * 	input: TextSchema,
 * 	result: TextSchema,
 * 	activities: [Echo],
 * });
 * const EchoLive = workflow.implement(EchoWorkflow, function* (ctx) {
 * 	return yield* activity.request(Echo, ctx.input);
 * });
 *
 * await using parent = context.create({ id: 'example-parent' });
 * await using jobs = dispatch.memory();
 * await using records = history.memory();
 * await using scheduler = workflow.scheduler({
 * 	activityDispatch: jobs,
 * 	history: records,
 * });
 * await using executor = await workflow.executor({
 * 	dispatch: jobs,
 * 	engine: Local,
 * 	hostId: 'example-host',
 * 	capacity: 1,
 * 	provider: {
 * 		activities: [Echo],
 * 		async run(_ctx, attempt) {
 * 			return Object.freeze({ type: 'success', value: attempt.input });
 * 		},
 * 	},
 * });
 * await using run = await workflow.context({
 * 	definition: EchoWorkflow,
 * 	runId: 'example-run',
 * 	input: 'hello',
 * 	ctx: parent,
 * });
 *
 * console.log(
 * 	await workflow.run({
 * 		ctx: run,
 * 		implementation: EchoLive,
 * 		scheduler,
 * 	}),
 * ); // hello
 * ```
 *
 * @module
 */

import { temporal } from '@okikio/duration/temporal';
import * as codec from '@okikio/schema/codec';
import { TriggerEffect, TriggerSchema } from './trigger.ts';
import * as catalogCore from '@okikio/collection/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/collection/catalog';
import * as contextCore from '@okikio/context';
import * as effects from '@okikio/capability/effect';
import * as failures from '@okikio/result/failure';
import * as faultCore from '@okikio/result/fault';
import * as requirement from '@okikio/capability/requirement';
import * as result from '@okikio/result';
import * as recordCore from '@okikio/collection/record';
import * as schema from '@okikio/schema';
import * as durable from './durable.ts';
import { Branch } from './branch.ts';
import * as kernelOperation from './operation.ts';
import { Reducer } from './reducer.ts';
import * as retryCore from './retry.ts';
import { MAX_ACTIVE_CHILDREN, Scope } from './scope.ts';
import { createActivityJobs, SchedulerClosedError } from './jobs.ts';
import type { Cause, Exit } from './kernel.ts';
import type {
	Scheduler,
	SchedulerOptions,
	WorkflowCancelled,
	WorkflowCatalog,
	WorkflowCompletionAny,
	WorkflowContext,
	WorkflowControlInstruction,
	WorkflowDefinition,
	WorkflowDocument,
	WorkflowFailure,
	WorkflowFault,
	WorkflowImplementation,
	WorkflowInstruction,
	WorkflowMapInstruction,
	WorkflowOperation,
	WorkflowOptions,
	WorkflowParallelInstruction,
	WorkflowRaceInstruction,
	WorkflowRetryInstruction,
	WorkflowRunOptions,
	WorkflowSchema,
	WorkflowSelection,
	WorkflowSignal,
	WorkflowSuccess,
} from './types.ts';
import { assertIdentifier, assertInstruction, assertOperation, assertStableKey, boundedConcurrency } from './assert.ts';
import {
	CancelledError,
	CleanupFailureError,
	CleanupInstructionError,
	ContinueAsNewError,
	FaultError,
} from './errors.ts';
import { continueRun, createdInstruction, identify, operation, sleep } from './instructions.ts';
import { workflowContext } from './context.ts';

export { TriggerEffect } from './trigger.ts';
export type { Trigger, TriggerOptions } from './trigger.ts';

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
	schema.assert(codec.input(input.input), 'workflow input schema');
	schema.assert(codec.input(input.result), 'workflow result schema');
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
): WorkflowSelection<Entries[Keys[number]], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose workflows, catalogs, selections, and nested arrays. */
export function compose<Entry extends WorkflowDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Define one immutable signal contract. */
export function signal<const Contract extends WorkflowSchema>(
	input: Readonly<{ readonly id: string; readonly description?: string; readonly value: Contract }>,
): WorkflowSignal<codec.ContractOutput<Contract>>;
/** Define an event from its short name and value contract. */
export function signal<const Contract extends WorkflowSchema>(
	id: string,
	value: Contract,
): WorkflowSignal<codec.ContractOutput<Contract>>;
export function signal<const Contract extends WorkflowSchema>(
	input: string | Readonly<{ readonly id: string; readonly description?: string; readonly value: Contract }>,
	value?: Contract,
): WorkflowSignal<codec.ContractOutput<Contract>> {
	const options = typeof input === 'string' ? { id: input, value } : input;
	recordCore.assert(options, 'workflow signal definition');
	assertIdentifier(options.id, 'workflow signal');
	if (options.value === undefined) throw new TypeError('Workflow signal requires a value contract.');
	schema.assert(codec.input(options.value), 'workflow signal schema');
	return Object.freeze({ kind: 'workflow-signal', ...options, value: options.value }) as WorkflowSignal<
		codec.ContractOutput<Contract>
	>;
}

/** Execute one workflow program through an instruction interpreter. */
export async function run<Workflow extends WorkflowDefinition>(
	options: WorkflowRunOptions<Workflow>,
): Promise<import('./types.ts').WorkflowResult<Workflow>> {
	recordCore.assert(options, 'workflow run options');
	const normalized = Object.freeze({ ...options } satisfies WorkflowRunOptions<Workflow>);
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
		value = await codec.read(
			normalized.ctx.workflow.result,
			await codec.write(normalized.ctx.workflow.result, unvalidated),
		) as import('./types.ts').WorkflowResult<
			Workflow
		>;
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
 * The Scheduler interprets control instructions, admits activity items to the
 * configured dispatch owner, and delegates other leaf commands to the command
 * host. Independent executors claim matching activity work from dispatch.
 */
export function scheduler(input: SchedulerOptions = {}): Scheduler {
	recordCore.assert(input, 'workflow scheduler options');
	const options = Object.freeze({ ...input } satisfies SchedulerOptions);
	const jobs = createActivityJobs(options, options.clock ?? contextCore.SystemClock);
	let closed = false;
	let closePromise: Promise<void> | undefined;

	const scheduler = Object.freeze(
		{
			/**
			 * Interpret one requested instruction through its declared provider and optional history. Input
			 * admission precedes provider capacity allocation.
			 */
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
							if (instruction.effect !== TriggerEffect && !ctx.workflow.effects.includes(instruction.effect)) {
								return fault(
									new TypeError(
										`Workflow ${JSON.stringify(ctx.workflow.id)} emitted undeclared effect ${
											JSON.stringify(instruction.effect.id)
										}.`,
									),
								);
							}
							if (options.effect === undefined) return fault(new effects.MissingEffectEmitterError());
							let value = instruction.value;
							if (instruction.effect === TriggerEffect) {
								const request = TriggerSchema.parse(value);
								const target = [...ctx.workflow.activities, ...ctx.workflow.workflows].find((entry) =>
									entry.kind === request.definition.kind && entry.id === request.definition.id &&
									entry.version === request.definition.version
								);
								if (!target) throw new TypeError('Background work must be declared by the workflow.');
								value = {
									...request,
									input: await codec.write(target.input, await codec.read(target.input, request.input)),
								};
							}
							const occurrence = await effects.create(instruction.effect, value, {
								key: identity.fingerprint,
							});
							await options.effect.emit(ctx, occurrence);
							return success(undefined);
						}
						if (instruction.type === 'wait-event' && options.events !== undefined) {
							return success(await options.events.wait(ctx, instruction, path));
						}
						if (options.command === undefined) {
							return fault(
								new TypeError(`Workflow command ${JSON.stringify(instruction.type)} has no configured host.`),
							);
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
					encode: (completion) => encodeCompletion(instruction, completion),
					decode: (completion) => decodeCompletion(ctx.workflow, instruction, completion),
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
			[Symbol.asyncDispose]: async (): Promise<void> => await scheduler.close(),
		} satisfies Scheduler,
	);
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

/** Create deterministic JSON-safe workflow documentation. */
export function document(input: CatalogDefinitionInput<WorkflowDefinition>): readonly WorkflowDocument[] {
	return Object.freeze(
		catalogCore.values(input).map((definition) =>
			Object.freeze({
				id: definition.id,
				version: definition.version,
				...(definition.description === undefined ? {} : { description: definition.description }),
				inputVendor: codec.input(definition.input)['~standard'].vendor,
				resultVendor: codec.input(definition.result)['~standard'].vendor,
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

 * Advance one generator with stable instruction paths; register successful defer requests and unwind

 * on any terminal error.

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
			assertUniqueKey(explicitKeys, instruction);
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

 * Run synchronous generator finally code. A yielded instruction is a cleanup defect; asynchronous

 * cleanup must be registered with defer().

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

/** Run registered cleanup in reverse order under a fresh, unpaused context; retain every cleanup failure. */
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

 * Select a control interpreter and preserve faults, cancellation and cleanup defects as terminal

 * completions.

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

 * Run keyed branches with bounded ownership; settled mode captures business failures while terminal

 * defects still stop siblings.

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
				if (isTerminalError(error)) throw error;
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

/** Observe the first branch exit, then cancel and join losers before exposing its value or failure. */
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
	// Exit type, rather than the thrown value, decides whether a failure exists.
	const hasPrimary = first.exit.type !== 'success';
	const primary = exitFailure(first.exit);
	const reason = new SiblingCancellation(
		hasPrimary ? primary : `Workflow race was won by ${first.entry.key}.`,
	);
	await scope.close(reason);
	const settled = await Promise.all(branches.map(async (entry) => Object.freeze({ entry, exit: await entry.result })));
	const cleanupFailures = settled
		.filter(({ entry, exit }) => entry !== first.entry && exit.type !== 'success')
		.map(({ exit }) => exitFailure(exit))
		.filter((failure) => !isSiblingCancellation(failure));
	if (hasPrimary) {
		if (cleanupFailures.length > 0) throw new CleanupFailureError(primary, cleanupFailures);
		throw primary;
	}
	if (cleanupFailures.length > 0) throw new CleanupFailureError(first.exit, cleanupFailures);
	return success(first.exit.value);
}

/** Run keyed item operations with bounded branch ownership and retain input order in the returned values. */
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
				if (isTerminalError(error)) throw error;
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

 * Repeat only business failures under a distinct attempt path; faults and cancellation bypass logical

 * retry.

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
			if (isTerminalError(error)) throw error;
			previous = error;
			if (attempt < instruction.maximumAttempts && instruction.delay !== undefined) {
				const delay = retryCore.delay(instruction, path, attempt);
				await resolveOperation(sleep(delay.toString()), ctx, scheduler, `${path}/retry-delay:${attempt}`);
			}
		}
	}
	return failed(previous);
}

/**

 * Admit at most concurrency branches; stop admission after the first failure and join sibling cleanup

 * before returning.

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

/** Project a branch exit for the Promise interpreter; successful exits return the no-failure marker. */
function exitFailure<Value>(exit: Exit<Value>): unknown | undefined {
	if (exit.type === 'success') return undefined;
	return causeFailure(exit.cause);
}

/** Restore fault and cancellation wrappers; retain ordered secondary causes as cleanup failures. */
function causeFailure(cause: Cause): unknown {
	if (cause.type === 'failure') return cause.failure;
	if (cause.type === 'fault') return new FaultError(cause.fault);
	if (cause.type === 'cancelled') return new CancelledError(cause.reason);
	const failures = cause.causes.map(causeFailure);
	const primary = failures[0];
	return failures.length <= 1 ? primary : new CleanupFailureError(primary, failures.slice(1));
}

/** Combine the scope path with an explicit encoded key, or its sequence position, and the instruction kind. */
function instructionPath(base: string, index: number, instruction: WorkflowInstruction): string {
	const segment = instruction.key === undefined ? String(index) : encodeURIComponent(instruction.key);
	return `${base}/${segment}:${instruction.type}`;
}

/** Encode one workflow completion into data a durable History can persist directly. */
async function encodeCompletion(
	instruction: WorkflowInstruction,
	completion: WorkflowCompletionAny,
): Promise<import('./types.ts').HistoryCompletionType> {
	if (completion.type === 'success') {
		return Object.freeze({
			type: 'success',
			value: durable.value(await transferSuccess(instruction, completion.value, 'write'), 'workflow success'),
		});
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
		return Object.freeze({
			type: 'failure',
			failure: Object.freeze({ kind: 'value', value: durable.value(completion.failure, 'workflow failure') }),
		});
	}
	if (completion.type === 'cancelled') {
		return Object.freeze({
			type: 'cancelled',
			reason: durable.value(faultCore.encode(completion.reason), 'workflow cancellation'),
		});
	}
	return Object.freeze({ type: 'fault', fault: durable.value(faultCore.encode(completion.fault), 'workflow fault') });
}

/** Decode one persisted completion through exact definitions imported by the replayed workflow. */
async function decodeCompletion(
	workflow: WorkflowDefinition,
	instruction: WorkflowInstruction,
	completion: import('./types.ts').HistoryCompletionType,
): Promise<WorkflowCompletionAny> {
	if (completion.type === 'success') {
		return success(await transferSuccess(instruction, durable.restore(completion.value), 'read', workflow));
	}
	if (completion.type === 'cancelled') return cancelled(durable.restore(completion.reason));
	if (completion.type === 'fault') return fault(durable.restore(completion.fault));
	if (completion.failure.kind === 'value') return failed(durable.restore(completion.failure.value));
	const trusted = workflowFailures(workflow);
	return failed(await failures.decode(completion.failure.value, trusted));
}

/**
 * Carry successful application values through the exact contract that authored
 * each instruction. Composite controls retain individual completion envelopes,
 * so undefined results and declared failures remain distinguishable during replay.
 */
async function transferSuccess(
	instruction: WorkflowInstruction,
	value: unknown,
	direction: 'read' | 'write',
	workflow?: WorkflowDefinition,
): Promise<unknown> {
	const transfer = direction === 'write' ? codec.write : codec.read;
	if (instruction.type === 'activity') return await transfer(instruction.activity.result, value);
	if (instruction.type === 'child-workflow') {
		return instruction.options.result === 'discard' ? undefined : await transfer(instruction.workflow.result, value);
	}
	if (instruction.type === 'sleep') {
		if (direction === 'write' && value instanceof temporal.Instant) return value.toString();
		if (direction === 'read' && typeof value === 'string') return temporal.Instant.from(value);
		throw new TypeError('Invalid relative timer completion.');
	}
	if (instruction.type === 'wait') return await transfer(instruction.signal.value, value);
	if (instruction.type === 'wait-event') {
		recordCore.assert(value, 'event completion');
		if (value.type === 'timeout') return { type: 'timeout' };
		if (value.type !== 'received') throw new TypeError('Invalid event completion.');
		return direction === 'write'
			? {
				type: 'received',
				value: durable.value(await codec.write(instruction.event.value, value.value), 'event result'),
			}
			: {
				type: 'received',
				value: await codec.read(
					instruction.event.value,
					durable.restore(value.value as import('./types.ts').HistoryValueType),
				),
			};
	}
	if (instruction.category !== 'control') return value;
	const nested = async (
		operation: WorkflowOperation<unknown, unknown>,
		input: unknown,
		settled = false,
	): Promise<unknown> => {
		const child = createdInstruction(operation, 'History child operation');
		if (direction === 'write') {
			if (!settled) return await encodeCompletion(child, success(input));
			recordCore.assert(input, 'settled result');
			if (input.ok !== true && input.ok !== false) throw new TypeError('Invalid settled result.');
			return await encodeCompletion(child, input.ok ? success(input.value) : failed(input.failure));
		}
		if (workflow === undefined) throw new TypeError('History decoding requires an exact workflow definition.');
		recordCore.assert(input, 'recorded completion');
		const completion = await decodeCompletion(
			workflow,
			child,
			input as unknown as import('./types.ts').HistoryCompletionType,
		);
		if (completion.type === 'success') return settled ? result.ok(completion.value) : completion.value;
		if (completion.type === 'failure' && settled) return result.fail(completion.failure);
		throw new TypeError('A successful control result contains an incompatible recorded completion.');
	};
	if (instruction.type === 'retry') return await nested(instruction.operation, value);
	if (instruction.type === 'map') {
		if (!Array.isArray(value) || value.length !== instruction.entries.length) {
			throw new TypeError('Invalid mapped history result.');
		}
		return await Promise.all(
			instruction.entries.map((entry, index) =>
				nested(entry.operation, value[index], instruction.failure === 'settle')
			),
		);
	}
	recordCore.assert(value, 'control history result');
	if (instruction.type === 'race') {
		if (typeof value.key !== 'string' || !Object.hasOwn(instruction.operations, value.key)) {
			throw new TypeError('Invalid recorded race winner.');
		}
		const operation = instruction.operations[value.key]!;
		return direction === 'write'
			? { key: value.key, completion: await nested(operation, value.value) }
			: { key: value.key, value: await nested(operation, value.completion) };
	}
	const entries = await Promise.all(
		Object.entries(instruction.operations).map(async ([key, operation]) => {
			if (!Object.hasOwn(value, key)) throw new TypeError(`Missing recorded parallel result ${JSON.stringify(key)}.`);
			return [key, await nested(operation, value[key], instruction.failure === 'settle')] as const;
		}),
	);
	return Object.fromEntries(entries);
}

/** Collect exact failure definitions reachable from one workflow without global registration. */
function workflowFailures(workflow: WorkflowDefinition): readonly import('@okikio/result/failure').Definition[] {
	const failures = new Set<import('@okikio/result/failure').Definition>();
	for (const failure of workflow.failures) failures.add(failure);
	for (const activity of workflow.activities) for (const failure of activity.failures) failures.add(failure);
	// A child workflow may expose only failures declared by its own public
	// contract. Its internal activities are not part of the parent's authority.
	for (const child of workflow.workflows) for (const failure of child.failures) failures.add(failure);
	return Object.freeze([...failures]);
}

/**

 * Reject a repeated explicit instruction key within this sequential scope before history can confuse

 * two requests.

 */
function assertUniqueKey(keys: Set<string>, instruction: WorkflowInstruction): void {
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

 * Exclude faults, continuation, cleanup defects and cancellation from settled business results and

 * logical retries.

 */
function isTerminalError(error: unknown): boolean {
	return error instanceof FaultError || error instanceof ContinueAsNewError || error instanceof CleanupFailureError ||
		isCancellation(error);
}

/** Recognize workflow cancellation wrappers and the context cancellation family. */
function isCancellation(error: unknown): boolean {
	return error instanceof CancelledError ||
		contextCore.cancelled(error);
}

/** Unwrap recognized cancellation errors while preserving other values unchanged. */
function cancellationReason(error: unknown): unknown {
	if (error instanceof CancelledError || error instanceof contextCore.ContextCancelledError) return error.reason;
	return error;
}

/**

 * Identify cancellation introduced by this control owner, so ordinary loser shutdown does not become

 * an extra cleanup defect.

 */
function isSiblingCancellation(error: unknown): boolean {
	if (error instanceof CancelledError) return error.reason instanceof SiblingCancellation;
	if (error instanceof contextCore.ContextCancelledError) return error.reason instanceof SiblingCancellation;
	return false;
}

export { continueRun as continue };
export { SchedulerClosedError } from './jobs.ts';
export type {
	ActivityAddOptions,
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
	ActivityClaimOptions,
	ActivityClaimType,
	ActivityCommand,
	ActivityCommandOptions,
	ActivityDispatch,
	ActivityDispatchStatsType,
	ActivityJobResultType,
	ActivityJobType,
	ActivityOriginType,
	ActivityReference,
	ActivityRefType,
	ActivityRetryOptions,
	ChildOptions,
	ChildWorkflowCommand,
	ComputeType,
	EngineAffinityType,
	EngineCapacityType,
	EngineChoiceModeType,
	EngineChoiceReference,
	EnginePlacementReference,
	EnginePlacementType,
	EngineProvider,
	EngineReference,
	EngineRegistration,
	EngineRegistrationOptions,
	ExecutorActivityType,
	ExecutorJoinOptions,
	ExecutorLeaseType,
	ExecutorOptions,
	History,
	HistoryCompletionType,
	HistoryEntryType,
	HistoryFailureOccurrenceType,
	HistoryFailureType,
	HistoryInput,
	HistoryOptions,
	HistorySnapshotType,
	HistoryValueType,
	MemoryDispatchOptions,
	MemoryHistory,
	Scheduler,
	SchedulerOptions,
	WorkflowAnnotations,
	WorkflowCancelled,
	WorkflowCatalog,
	WorkflowCommand,
	WorkflowCommandBase,
	WorkflowCommandHandler,
	WorkflowCommandOptions,
	WorkflowCompletion,
	WorkflowCompletionAny,
	WorkflowContext,
	WorkflowContextOptions,
	WorkflowContinueCommand,
	WorkflowControlBase,
	WorkflowControlInstruction,
	WorkflowDeferCommand,
	WorkflowDefinition,
	WorkflowDocument,
	WorkflowDurableValue,
	WorkflowEffectCommand,
	WorkflowFailure,
	WorkflowFailures,
	WorkflowFault,
	WorkflowImplementation,
	WorkflowInput,
	WorkflowInstruction,
	WorkflowInstructionBase,
	WorkflowInstructionDescription,
	WorkflowInstructionIdentity,
	WorkflowMapEntry,
	WorkflowMapInstruction,
	WorkflowMapOptions,
	WorkflowOperation,
	WorkflowOperationFailure,
	WorkflowOperationFailures,
	WorkflowOperations,
	WorkflowOperationValue,
	WorkflowOperationValues,
	WorkflowOptions,
	WorkflowParallelInstruction,
	WorkflowParallelOptions,
	WorkflowProgram,
	WorkflowRaceInstruction,
	WorkflowRaceOptions,
	WorkflowRaceResult,
	WorkflowReference,
	WorkflowResult,
	WorkflowRetryInstruction,
	WorkflowRetryOptions,
	WorkflowRunOptions,
	WorkflowSchema,
	WorkflowSelection,
	WorkflowSettledValues,
	WorkflowSignal,
	WorkflowSleepCommand,
	WorkflowSuccess,
	WorkflowTimerCommand,
	WorkflowWaitCommand,
} from './types.ts';

export { executor } from './jobs.ts';

export { client, ExitError } from './client.ts';
export type { Admission, ClientOptions, ClientStore, ClientType, SubmitType } from './client.ts';
export { serve } from './serve.ts';
export type { ServeOptions, Serving } from './serve.ts';
export type { EngineBinding } from './engines.ts';
export {
	ControlOptionsSchema,
	ControlSchema,
	ExecutionError,
	FinalizationSchema,
	PolicySchema,
	ReferenceSchema,
	SnapshotSchema,
} from './execution.ts';
export type { ControlOptions, ControlType } from './execution.ts';
export { ContinuationSchema } from './execution.ts';
export type { ContinuationType } from './execution.ts';
export type {
	ActivationType,
	AdmissionType,
	AttemptType,
	Claim,
	DefinitionType,
	ExecutionStore,
	HostType,
	IdentityType,
	InputType,
	IntentType,
	InvocationType,
	JobType,
	LocalActivity,
	OutcomeType,
	PolicyType,
	ReferenceType,
	SnapshotType,
	ValueType,
} from './execution.ts';

export type { DurationWaitType, EventResult, EventWaitType, UntilWaitType, WorkflowEventCommand } from './types.ts';

export type { ProgressType } from './execution.ts';

export { events } from './events.ts';
export type { EventInbox } from './events.ts';

export {
	activity,
	child,
	defer,
	describe,
	effect,
	identify,
	map,
	operation,
	parallel,
	race,
	retry,
	sleep,
	sleepUntil,
	wait,
	waitForEvent,
} from './instructions.ts';
export {
	CancelledError,
	CleanupFailureError,
	CleanupInstructionError,
	ContinueAsNewError,
	FaultError,
} from './errors.ts';
export { context } from './context.ts';

/** Required compute scopes and incarnation references; imports do not register hosts. */
export * as placement from './placement.ts';
