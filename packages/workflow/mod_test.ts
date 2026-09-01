import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as failures from '@okikio/failure';
import * as task from '@okikio/task';
import * as requirement from '@okikio/requirement';
import * as workflow from './mod.ts';

/** Creates one tiny Standard WorkflowSchema contract for workflow tests. */
function schema<Output>(validate: (value: unknown) => Output): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'test',
			validate(value: unknown) {
				try { return { value: validate(value) }; }
				catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
			},
		}),
	});
}

const AnySchema = schema((value) => value);
const TestFailure = failures.define({
	id: 'test.failure',
	description: 'Expected failure used by workflow programming-model tests.',
	data: AnySchema,
});

/** Creates one declared test-activity failure with durable data. */
async function expected(data: unknown, message: string): Promise<failures.Occurrence<typeof TestFailure>> {
	return await failures.create(TestFailure, { data, message });
}
const StringSchema = schema((value) => {
	if (typeof value !== 'string') throw new TypeError('Expected a string.');
	return value;
});
const TestEngine: workflow.EngineReference = Object.freeze({ kind: 'activity-engine', id: 'test' });
const TestPlacement: workflow.EnginePlacementReference = Object.freeze({
	kind: 'activity-engine-placement',
	choices: Object.freeze([Object.freeze({ kind: 'activity-engine-choice', mode: 'required', engine: TestEngine })]),
});
const TestActivity: workflow.ActivityReference = Object.freeze({
	kind: 'activity',
	id: 'test.operation',
	version: '1',
	input: AnySchema,
	result: AnySchema,
	failures: Object.freeze([TestFailure]),
	requirements: Object.freeze([]),
	placement: TestPlacement,
	resilience: Object.freeze([]),
});

/** One test activity request. */
function operation<Value = unknown, Failure = unknown>(input: unknown, key?: string): workflow.WorkflowOperation<Value, Failure> {
	return workflow.activity<Value, Failure>(TestActivity, input, key === undefined ? {} : { key });
}

/** Creates the common workflow contract used by control-instruction tests. */
function definition(result: StandardSchemaV1 = StringSchema): workflow.WorkflowDefinition {
	return workflow.define({
		id: 'test.workflow',
		version: '1',
		input: AnySchema,
		result,
		activities: [TestActivity],
	});
}

type ActivityHost = (
	ctx: context.Context,
	attempt: workflow.ActivityAttemptType,
) => Promise<workflow.ActivityAttemptResultType>;

interface ExecuteOptions {
	readonly activity?: ActivityHost;
	readonly command?: workflow.WorkflowCommandHandler;
	readonly history?: workflow.History;
	readonly result?: StandardSchemaV1;
}

/** Wraps one instruction observer as a disposable workflow history for tests. */
function history(
	schedule: workflow.History['schedule'],
): workflow.History {
	const value: workflow.History = Object.freeze({
		schedule,
		async close() {},
		async [Symbol.asyncDispose]() {},
	});
	return value;
}

/** Runs one workflow with a registered in-process test engine. */
async function runProgram(
	program: (ctx: workflow.WorkflowContext) => workflow.WorkflowProgram<unknown>,
	options: ExecuteOptions = {},
): Promise<unknown> {
	await using parent = context.create({ id: 'test-parent', clock: new context.TestClock() });
	const contract = definition(options.result);
	const implementation = workflow.implement(
		contract,
		program as (ctx: workflow.WorkflowContext<typeof contract>) => workflow.WorkflowProgram<workflow.WorkflowResult<typeof contract>>,
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
function deferred<Value = void>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}> {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((resolved) => resolve = resolved);
	return Object.freeze({ promise, resolve });
}

describe('workflow programming model', () => {
	it('rejects accessor-backed durable operation maps without invoking getters', () => {
		let reads = 0;
		const operations = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(operations, 'unsafe', { enumerable: true, get() { reads++; return operation('unsafe'); } });
		expect(() => workflow.parallel(operations as never)).toThrow('enumerable data property');
		expect(reads).toBe(0);
	});

	it('rejects invalid durable annotation values', () => {
		expect(() => workflow.sleep({ seconds: 1 }, { annotations: { valid: true, invalid: Number.POSITIVE_INFINITY } })).toThrow('finite number');
	});

	it('rejects accessor-backed workflow definitions before reading identity', () => {
		let reads = 0;
		const input = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(input, 'id', { enumerable: true, get() { reads++; return 'unsafe'; } });
		Object.defineProperty(input, 'version', { value: '1', enumerable: true });
		Object.defineProperty(input, 'input', { value: AnySchema, enumerable: true });
		Object.defineProperty(input, 'result', { value: AnySchema, enumerable: true });
		expect(() => workflow.define(input as never)).toThrow('enumerable data property');
		expect(reads).toBe(0);
	});

	it('applies active activity requirements before engine placement', async () => {
		const policy = Object.freeze({ kind: 'test-policy', id: 'test.admit' });
		const gate = requirement.define({ family: 'test', action: 'require', definition: policy });
		const gated: workflow.ActivityReference = Object.freeze({ ...TestActivity, id: 'test.gated', requirements: Object.freeze([gate]) });
		const contract = workflow.define({ id: 'test.gated-workflow', version: '1', input: AnySchema, result: AnySchema, activities: [gated] });
		const implementation = workflow.implement(contract, function* () { return yield* workflow.activity(gated, 'value'); });
		await using parent = context.create({ id: 'test-admission', clock: new context.TestClock() });
		await using ctx = await workflow.context({ definition: contract, runId: 'test-admission-run', input: {}, ctx: parent });
		let placed = 0;
		await using scheduler = workflow.scheduler({
			requirements: {
				interpreters: { test: { async apply() { throw new Error('denied before placement'); } } },
			},
		});
		await using registration = await scheduler.register({
			engine: TestEngine, hostId: 'test-host',
			provider: { activities: [gated], async run() { placed += 1; return workflow.success('unexpected'); } },
		});
		void registration;
		await expect(workflow.run({ ctx, implementation, scheduler })).rejects.toThrow('denied before placement');
		expect(placed).toBe(0);
	});

	it('keeps local Task lifecycle outside the durable workflow contract', async () => {
		const events: string[] = [];
		await using work = task.start(async (ctx) => {
			ctx.defer(() => void events.push('deferred'));
			ctx.use({ async [Symbol.asyncDispose]() { events.push('resource'); } });
			return 7;
		}, { id: 'workflow-test-task' });
		expect(await work.done).toBe(7);
		expect(work.status).toBe('completed');
		expect(events).toEqual(['resource', 'deferred']);
	});

	it('snapshots activity affinity before it becomes durable placement identity', () => {
		const affinity: { region: string; weight: number } = { region: 'east', weight: 1 };
		const value = workflow.activity(TestActivity, 'input', { affinity });
		affinity.region = 'west';
		affinity.weight = 2;
		const step = value[Symbol.iterator]().next();
		expect(step.done).toBe(false);
		if (!step.done && step.value.type === 'activity') {
			expect(step.value.options.affinity).toEqual({ region: 'east', weight: 1 });
			expect(Object.isFrozen(step.value.options.affinity)).toBe(true);
		}
	});

	it('rejects non-scalar activity affinity values', () => {
		expect(() => workflow.activity(TestActivity, 'input', { affinity: { region: Number.POSITIVE_INFINITY } })).toThrow('finite number');
	});

	it('creates lazy activity instructions without starting external work', () => {
		const value = operation({ value: 1 }, 'operation:one');
		const step = value[Symbol.iterator]().next();
		expect(step.done).toBe(false);
		if (!step.done) expect(step.value).toMatchObject({
			category: 'command', type: 'activity', key: 'operation:one', input: { value: 1 },
		});
	});

	it('uses deterministic sequential paths and lets programs catch declared failures', async () => {
		const paths: string[] = [];
		const expectedFailure = await expected({ operation: 'fail' }, 'expected failure');
		const output = await runProgram(function* () {
			const first = yield* operation<string>('first');
			try { yield* operation('fail'); }
			catch (error) { expect(error).toBe(expectedFailure); }
			const third = yield* operation<string>('third', 'stable-third');
			return `${first}:${third}`;
		}, {
			activity: async (_ctx, attempt) => {
				paths.push(attempt.origin.instructionPath);
				return attempt.input === 'fail'
					? workflow.failed(expectedFailure)
					: workflow.success(attempt.input);
			},
		});
		expect(output).toBe('first:third');
		expect(paths).toEqual([
			'test.workflow@1/0:activity',
			'test.workflow@1/1:activity',
			'test.workflow@1/stable-third:activity',
		]);
	});

	it('passes every nested instruction through one lifecycle wrapper', async () => {
		const paths: string[] = [];
		const output = await runProgram(function* () {
			const values = yield* workflow.parallel({
				first: operation<string>('first'),
				second: workflow.retry(operation<string, failures.Occurrence<typeof TestFailure>>('second'), { maximumAttempts: 1 }),
			});
			return `${values.first}:${values.second}`;
		}, {
			history: history(async ({ path, next }) => { paths.push(path); return await next(); }),
		});
		expect(output).toBe('first:second');
		expect([...paths].sort()).toEqual([
			'test.workflow@1/0:parallel',
			'test.workflow@1/0:parallel/first/0:activity',
			'test.workflow@1/0:parallel/second/0:retry',
			'test.workflow@1/0:parallel/second/0:retry/attempt:1/0:activity',
		].sort());
	});

	it('preserves undefined as an explicit workflow-command failure value', async () => {
		let rejected = false;
		try {
			await runProgram(function* () {
				yield* workflow.sleep('PT0.001S');
				return 'unreachable';
			}, { command: async () => workflow.failed(undefined) });
		} catch (error) {
			rejected = true;
			expect(error).toBe(undefined);
		}
		expect(rejected).toBe(true);
	});

	it('settles parallel branches without cancelling expected failures', async () => {
		const branchFailure = await expected({ branch: 'second' }, 'branch failed');
		const output = await runProgram(function* () {
			const values = yield* workflow.parallel({
				first: operation<string>('first'),
				second: operation<string, failures.Occurrence<typeof TestFailure>>('fail'),
			}, { failure: 'settle' });
			return values.first.ok && !values.second.ok
				? `${values.first.value}:${values.second.failure.message}`
				: 'invalid';
		}, {
			activity: async (_ctx, attempt) => attempt.input === 'fail'
				? workflow.failed(branchFailure)
				: workflow.success(attempt.input),
		});
		expect(output).toBe('first:branch failed');
	});

	it('cancels and awaits active siblings before fail-fast parallel resumes', async () => {
		const blockerStarted = deferred();
		let blockerStopped = false;
		const primaryFailure = await expected({ branch: 'failure' }, 'primary branch failure');
		const output = await runProgram(function* () {
			try {
				yield* workflow.parallel({ blocker: operation('block'), failure: operation('fail') });
			} catch (error) {
				expect(error).toBe(primaryFailure);
			}
			expect(blockerStopped).toBe(true);
			return 'cancelled and awaited';
		}, {
			activity: async (ctx, attempt) => {
				if (attempt.input === 'block') {
					blockerStarted.resolve();
					if (!ctx.signal.aborted) {
						await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
					}
					blockerStopped = true;
					return workflow.cancelled(ctx.signal.reason);
				}
				await blockerStarted.promise;
				return workflow.failed(primaryFailure);
			},
		});
		expect(output).toBe('cancelled and awaited');
	});

	it('returns one deterministic race winner and stops losing branches', async () => {
		const loserStarted = deferred();
		let loserStopped = false;
		const output = await runProgram(function* () {
			const winner = yield* workflow.race({ loser: operation('lose'), winner: operation('win') });
			expect(loserStopped).toBe(true);
			return `${String(winner.key)}:${String(winner.value)}`;
		}, {
			activity: async (ctx, attempt) => {
				if (attempt.input === 'lose') {
					loserStarted.resolve();
					if (!ctx.signal.aborted) {
						await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
					}
					loserStopped = true;
					return workflow.cancelled(ctx.signal.reason);
				}
				await loserStarted.promise;
				return workflow.success('won');
			},
		});
		expect(output).toBe('winner:won');
	});

	it('preserves mapped output order and rejects duplicate keys before execution', async () => {
		let attempts = 0;
		const output = await runProgram(function* () {
			const values = yield* workflow.map([3, 1, 2], (value) => operation<number>(value), {
				concurrency: 2,
				key: (value) => String(value),
			});
			return values.join(',');
		}, { activity: async (_ctx, attempt) => { attempts++; return workflow.success(attempt.input); } });
		expect(output).toBe('3,1,2');
		expect(attempts).toBe(3);
		expect(() => workflow.map([1, 1], (value) => operation(value), {
			concurrency: 1, key: (value) => String(value),
		})).toThrow('duplicate key');
	});

	it('uses fresh workflow retry paths and does not retry provider faults', async () => {
		const paths: string[] = [];
		let attempt = 0;
		const output = await runProgram(function* () {
			return String(yield* workflow.retry(operation<string, failures.Occurrence<typeof TestFailure>>('retry'), {
				maximumAttempts: 3, key: 'verification',
			}));
		}, {
			activity: async (_ctx, activityAttempt) => {
				paths.push(activityAttempt.origin.instructionPath);
				attempt++;
				return attempt < 3
					? workflow.failed(await expected({ attempt }, `failure ${attempt}`))
					: workflow.success('verified');
			},
		});
		expect(output).toBe('verified');
		expect(paths).toEqual([
			'test.workflow@1/verification:retry/attempt:1/0:activity',
			'test.workflow@1/verification:retry/attempt:2/0:activity',
			'test.workflow@1/verification:retry/attempt:3/0:activity',
		]);

		let faults = 0;
		await expect(runProgram(function* () {
			yield* workflow.retry(operation('fault'), { maximumAttempts: 3 });
			return 'unreachable';
		}, { activity: async () => { faults++; return workflow.fault(new Error('fault')); } })).rejects.toThrow(workflow.FaultError);
		expect(faults).toBe(1);
	});

	it('runs registered cleanups in reverse order after cancellation', async () => {
		const calls: string[] = [];
		await expect(runProgram(function* () {
			yield* workflow.defer(operation('cleanup:first'));
			yield* workflow.defer(operation('cleanup:second'));
			yield* operation('cancel');
			return 'unreachable';
		}, {
			activity: async (_ctx, attempt) => {
				if (attempt.input === 'cancel') return workflow.cancelled('cancelled by test');
				calls.push(String(attempt.input));
				return workflow.success(undefined);
			},
		})).rejects.toThrow(workflow.CancelledError);
		expect(calls).toEqual(['cleanup:second', 'cleanup:first']);
	});

	it('preserves primary and cleanup failures together', async () => {
		const primary = await expected({ phase: 'primary' }, 'primary');
		const cleanup = await expected({ phase: 'cleanup' }, 'cleanup');
		try {
			await runProgram(function* () {
				yield* workflow.defer(operation('cleanup'));
				yield* operation('primary');
				return 'unreachable';
			}, {
				activity: async (_ctx, attempt) => attempt.input === 'primary'
					? workflow.failed(primary)
					: workflow.failed(cleanup),
			});
			throw new Error('Expected workflow execution to fail.');
		} catch (error) {
			expect(error).toBeInstanceOf(workflow.CleanupFailureError);
			if (error instanceof workflow.CleanupFailureError) {
				expect(error.primary).toBe(primary);
				expect(error.cleanupFailures).toEqual([cleanup]);
			}
		}
	});

	it('keeps faults, cancellation, and continue-as-new outside program catch blocks while running finally', async () => {
		for (const mode of ['fault', 'cancel', 'continue'] as const) {
			let caught = false;
			let finalized = false;
			const execution = runProgram(function* () {
				try {
					if (mode === 'continue') yield* workflow.continue({ cursor: 2 });
					else yield* operation(mode);
				} catch {
					caught = true;
				} finally {
					finalized = true;
				}
				return 'unreachable';
			}, {
				activity: async () => mode === 'fault'
					? workflow.fault(new Error('fault'))
					: workflow.cancelled('cancelled'),
			});
			if (mode === 'fault') await expect(execution).rejects.toThrow(workflow.FaultError);
			else if (mode === 'cancel') await expect(execution).rejects.toThrow(workflow.CancelledError);
			else await expect(execution).rejects.toThrow(workflow.ContinueAsNewError);
			expect(caught).toBe(false);
			expect(finalized).toBe(true);
		}
	});

	it('snapshots durable instruction data without executing or losing caller state', () => {
		const negativeZero = operation(-0)[Symbol.iterator]().next();
		if (negativeZero.done) throw new Error('Expected an activity instruction.');
		expect(negativeZero.value.input).toBe(0);
		expect(Object.is(negativeZero.value.input, -0)).toBe(false);

		const sparse = new Array<unknown>(1);
		expect(() => operation(sparse)).toThrow('sparse array element');

		const extended: unknown[] = ['kept'];
		Object.defineProperty(extended, 'note', { value: 'would be dropped', enumerable: true });
		expect(() => operation(extended)).toThrow('extra enumerable array property');

		let reads = 0;
		const accessor = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(accessor, 'unsafe', {
			enumerable: true,
			get() {
				reads += 1;
				return 'executed';
			},
		});
		expect(() => operation(accessor)).toThrow('enumerable data property');
		expect(reads).toBe(0);
	});

	it('rejects non-durable input before an instruction can enter history', () => {
		expect(() => operation(new Date('2026-01-01T00:00:00Z'))).toThrow(TypeError);
		expect(() => operation({ callback: () => undefined })).toThrow(TypeError);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => operation(cyclic)).toThrow('cycle');
		expect(() => workflow.continue(Promise.resolve('not durable'))).toThrow(TypeError);
	});

	it('creates stable instruction fingerprints and exposes origin identity to providers', async () => {
		const firstStep = operation({ b: 2, a: 1 }, 'stable')[Symbol.iterator]().next();
		const secondStep = operation({ a: 1, b: 2 }, 'stable')[Symbol.iterator]().next();
		if (firstStep.done || secondStep.done) throw new Error('Expected activity instructions.');
		const first = await workflow.identify(firstStep.value, 'test.workflow@1/stable:activity');
		const second = await workflow.identify(secondStep.value, 'test.workflow@1/stable:activity');
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.description.payload).toMatchObject({ activity: { id: 'test.operation', version: '1' } });

		let origin: workflow.ActivityOriginType | undefined;
		const output = await runProgram(function* () { return yield* operation<string>('value', 'stable'); }, {
			activity: async (_ctx, attempt) => { origin = attempt.origin; return workflow.success(attempt.input); },
		});
		expect(output).toBe('value');
		expect(origin?.instructionPath).toBe('test.workflow@1/stable:activity');
		expect(origin?.instructionFingerprint.length).toBe(64);
	});

	it('persists deterministic workflow retry delays as sleep instructions', async () => {
		const sleeps: string[] = [];
		let attempts = 0;
		const output = await runProgram(function* () {
			return yield* workflow.retry(operation<string, failures.Occurrence<typeof TestFailure>>('retry-me'), {
				maximumAttempts: 3,
				delay: 'PT0.1S',
				backoff: 2,
				maximumDelay: 'PT0.25S',
				jitter: 0,
			});
		}, {
			activity: async () => {
				attempts++;
				return attempts < 3
					? workflow.failed(await expected({ attempt: attempts }, `attempt ${attempts}`))
					: workflow.success('done');
			},
			command: async (_ctx, command) => {
				if (command.type !== 'sleep') return workflow.fault(new Error('unexpected command'));
				sleeps.push(command.duration.toString());
				return workflow.success(Temporal.Instant.from('2026-08-08T00:00:00Z'));
			},
		});
		expect(output).toBe('done');
		expect(sleeps).toEqual(['PT0.1S', 'PT0.2S']);
	});

	it('persists cleanup registration before the workflow body advances', async () => {
		let bodyAdvanced = false;
		let sawRegistration = false;
		const calls: string[] = [];
		const output = await runProgram(function* () {
			yield* workflow.defer(operation('cleanup', 'cleanup-command'), { key: 'register-cleanup' });
			bodyAdvanced = true;
			return 'done';
		}, {
			history: history(async ({ instruction, next }) => {
				if (instruction.type === 'defer') sawRegistration = !bodyAdvanced;
				return await next();
			}),
			activity: async (_ctx, attempt) => { calls.push(String(attempt.input)); return workflow.success(undefined); },
		});
		expect(output).toBe('done');
		expect(sawRegistration).toBe(true);
		expect(calls).toEqual(['cleanup']);
		expect(() => workflow.defer(workflow.sleep('PT1S'))).toThrow('must be one activity or child-workflow operation');
	});

	it('rejects duplicate explicit instruction keys in one program scope', async () => {
		await expect(runProgram(function* () {
			yield* operation('first', 'same');
			yield* operation('second', 'same');
			return 'unreachable';
		})).rejects.toThrow('duplicate instruction key');
	});
});
