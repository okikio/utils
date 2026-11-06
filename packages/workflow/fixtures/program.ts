/** Static workflow contracts and a local runner; scenarios own histories and native host test. @module */
import * as codecs from '@okikio/schema/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as context from '@okikio/context';
import * as failures from '@okikio/result/failure';
import * as workflow from '../mod.ts';

/** Creates one tiny Standard WorkflowSchema contract for workflow tests. */
export function schema<Output>(validate: (value: unknown) => Output): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'test',
			validate(value: unknown) {
				try {
					return { value: validate(value) };
				} catch (error) {
					return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
				}
			},
		}),
	});
}

export const AnySchema = schema((value) => value);

export const TestFailure = failures.define({
	id: 'test.failure',
	description: 'Expected failure used by workflow programming-model tests.',
	data: codecs.identity(AnySchema),
});

/** Creates one declared test-activity failure with durable data. */
export async function expected(data: unknown, message: string): Promise<failures.Occurrence<typeof TestFailure>> {
	return await failures.create(TestFailure, { data, message });
}

export const StringSchema = schema((value) => {
	if (typeof value !== 'string') throw new TypeError('Expected a string.');
	return value;
});

/** A stable local provider identity shared by the declared activity and the registered runner. */
export const TestEngine = Object.freeze({ kind: 'activity-engine', id: 'test' } satisfies workflow.EngineReference);

/** Require the local test provider so a missing registration cannot silently select a fallback. */
export const TestPlacement = Object.freeze(
	{
		kind: 'activity-engine-placement',
		choices: Object.freeze([Object.freeze({ kind: 'activity-engine-choice', mode: 'required', engine: TestEngine })]),
	} satisfies workflow.EnginePlacementReference,
);

/** Static declaration only. Each run supplies its own activity operation and owns its Context. */
export const TestActivity = Object.freeze(
	{
		kind: 'activity',
		id: 'test.operation',
		version: '1',
		input: codecs.identity(AnySchema),
		result: codecs.identity(AnySchema),
		failures: Object.freeze([TestFailure]),
		requirements: Object.freeze([]),
		placement: TestPlacement,
		resilience: Object.freeze([]),
	} satisfies workflow.ActivityReference,
);

/** One test activity request. */
export function operation<Value = unknown, Failure = unknown>(
	input: unknown,
	key?: string,
): workflow.WorkflowOperation<Value, Failure> {
	return workflow.activity<Value, Failure>(TestActivity, input, key === undefined ? {} : { key });
}

/** Creates the common workflow contract used by control-instruction tests. */
export function definition(result: StandardSchemaV1 = StringSchema): workflow.WorkflowDefinition {
	return workflow.define({
		id: 'test.workflow',
		version: '1',
		input: codecs.identity(AnySchema),
		result: codecs.identity(result),
		activities: [TestActivity],
	});
}

export type ActivityHost = (
	ctx: context.Context,
	attempt: workflow.ActivityAttemptType,
) => Promise<workflow.ActivityAttemptResultType>;

export interface ExecuteOptions {
	/** Replace the registered local provider operation while preserving Scheduler admission and cleanup. */
	readonly activity?: ActivityHost;
	/** Observe or answer a durable command through the real workflow runner. */
	readonly command?: workflow.WorkflowCommandHandler;
	/** Borrow a scenario-owned history; this fixture does not claim persistence. */
	readonly history?: workflow.History;
	/** Override only result validation when a scenario returns a non-string value. */
	readonly result?: StandardSchemaV1;
}

/** Wraps one instruction observer as a disposable workflow history for tests. */
export function history(
	schedule: workflow.History['schedule'],
): workflow.History {
	const value = Object.freeze(
		{
			schedule,
			async close() {},
			async [Symbol.asyncDispose]() {},
		} satisfies workflow.History,
	);
	return value;
}

/** Runs one workflow with a registered in-process test engine. */
export async function runProgram(
	program: (ctx: workflow.WorkflowContext) => workflow.WorkflowProgram<unknown>,
	options: ExecuteOptions = {},
): Promise<unknown> {
	await using parent = context.create({ id: 'test-parent', clock: new context.TestClock() });
	const contract = definition(options.result);
	const implementation = workflow.implement(
		contract,
		program as (
			ctx: workflow.WorkflowContext<typeof contract>,
		) => workflow.WorkflowProgram<workflow.WorkflowResult<typeof contract>>,
	);
	await using ctx = await workflow.context({ definition: contract, runId: 'test-run', input: {}, ctx: parent });
	await using scheduler = workflow.scheduler({
		...(options.command === undefined ? {} : { command: options.command }),
		...(options.history === undefined ? {} : { history: options.history }),
	});
	await using registration = await scheduler.register({
		engine: TestEngine,
		hostId: 'test-host',
		// Control-instruction tests exercise workflow concurrency, not engine
		// backpressure. Keep the test provider wide enough that a blocking sibling
		// cannot prevent the failing sibling from reaching the Scheduler.
		capacity: 32,
		provider: {
			activities: [TestActivity],
			async run(activityCtx, attempt) {
				return options.activity === undefined
					? Object.freeze({ type: 'success', value: attempt.input })
					: await options.activity(activityCtx, attempt);
			},
		},
	});
	void registration;
	return await workflow.run({ ctx, implementation, scheduler });
}

/** Deferred synchronization point for sibling-cancellation tests. */
export function deferred<Value = void>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}> {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((resolved) => resolve = resolved);
	return Object.freeze({ promise, resolve });
}
