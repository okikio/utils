import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as failures from '@okikio/failure';
import * as history from './history.ts';
import * as queue from '@okikio/queue';
import * as resilience from '@okikio/resilience';
import * as workflow from './mod.ts';

/** Creates a minimal Standard Schema contract for Scheduler integration tests. */
function schema<Output>(validate: (value: unknown) => Output): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'scheduler-test',
			validate(value: unknown) {
				try { return { value: validate(value) }; }
				catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
			},
		}),
	});
}

const AnySchema = schema((value) => value);
const StringSchema = schema((value) => {
	if (typeof value !== 'string') throw new TypeError('Expected a string.');
	return value;
});

/** Builds one exact engine reference used by the workflow-only Scheduler tests. */
function engine(id: string): workflow.EngineReference {
	return Object.freeze({ kind: 'activity-engine', id });
}

/** Builds one placement from ordered engine choices without depending on @okikio/activity. */
function placement(
	...choices: readonly Readonly<{ readonly engine: workflow.EngineReference; readonly mode: workflow.EngineChoiceModeType }>[]
): workflow.EnginePlacementReference {
	return Object.freeze({
		kind: 'activity-engine-placement',
		choices: Object.freeze(choices.map((choice) => Object.freeze({
			kind: 'activity-engine-choice' as const,
			engine: choice.engine,
			mode: choice.mode,
		}))),
	});
}

/** Builds one activity reference with exact placement and optional retry policy. */
function activity(
	id: string,
	placement: workflow.EnginePlacementReference,
	resiliency: readonly import('@okikio/resilience').ResiliencePolicy[] = [],
): workflow.ActivityReference {
	return Object.freeze({
		kind: 'activity',
		id,
		version: '1',
		input: AnySchema,
		result: AnySchema,
		failures: Object.freeze([]),
		requirements: Object.freeze([]),
		placement: placement,
		resilience: Object.freeze([...resiliency]),
	});
}

/** Creates one workflow context and implementation around the supplied generator. */
async function program<Result>(
	parent: context.Context,
	activityDefinition: workflow.ActivityReference,
	run: (ctx: workflow.WorkflowContext) => workflow.WorkflowProgram<Result>,
	result: StandardSchemaV1<unknown, Result> = AnySchema as StandardSchemaV1<unknown, Result>,
) {
	const definition = workflow.define({
		id: `scheduler-test.${activityDefinition.id}`,
		version: '1',
		input: AnySchema,
		result,
		activities: [activityDefinition],
	});
	const implementation = workflow.implement(definition, run as never);
	const ctx = await workflow.context({ definition, runId: crypto.randomUUID(), input: {}, ctx: parent });
	return { definition, implementation, ctx };
}

/** Deferred synchronization point used to observe Scheduler capacity without timing assumptions. */
function deferred<Value = void>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((done) => resolve = done);
	return Object.freeze({ promise, resolve });
}


/**
 * Wraps the memory queue with structured-clone checks at its persistence seam.
 *
 * The wrapper models the minimum constraint a database or remote queue imposes:
 * Scheduler job input and terminal output must not retain schemas, functions,
 * failure definitions, or other live objects.
 */
function cloneQueue() {
	const base = queue.memory<workflow.ActivityJobType, workflow.ActivityJobResultType>();
	return Object.freeze({
		...base,
		async add(ctx: context.Context, input: workflow.ActivityJobType, options?: queue.QueueAddOptions) {
			return await base.add(ctx, structuredClone(input), options);
		},
		async complete(ctx: context.Context, claim: queue.QueueClaim<workflow.ActivityJobType>, output: workflow.ActivityJobResultType) {
			await base.complete(ctx, claim, structuredClone(output));
		},
	});
}

describe('workflow Scheduler activity ownership', () => {
	it('does not exceed registered engine capacity while parallel workflow branches wait', async () => {
		const Engine = engine('scheduler-capacity');
		const Activity = activity('capacity', placement({ engine: Engine, mode: 'required' }));
		await using parent = context.create({ id: 'scheduler-capacity', clock: new context.TestClock() });
		const setup = await program(parent, Activity, function* () {
			return yield* workflow.parallel({
				first: workflow.activity<string, never>(Activity, 'first'),
				second: workflow.activity<string, never>(Activity, 'second'),
			});
		});
		await using workflowCtx = setup.ctx;
		await using scheduler = workflow.scheduler();
		const firstStarted = deferred();
		const releaseFirst = deferred();
		let active = 0;
		let maximum = 0;
		const started: string[] = [];
		await using registration = await scheduler.register({
			engine: Engine,
			hostId: 'capacity-host',
			capacity: 1,
			provider: {
				activities: [Activity],
				async run(_ctx, attempt) {
					active += 1;
					maximum = Math.max(maximum, active);
					started.push(String(attempt.input));
					if (attempt.input === 'first') {
						firstStarted.resolve();
						await releaseFirst.promise;
					}
					active -= 1;
					return workflow.success(attempt.input);
				},
			},
		});
		void registration;

		const pending = workflow.run({ ctx: workflowCtx, implementation: setup.implementation, scheduler });
		await firstStarted.promise;
		await Promise.resolve();
		expect(started).toEqual(['first']);
		expect(registration.capacity).toMatchObject({ maximum: 1, active: 1, available: 0 });
		releaseFirst.resolve();
		expect(await pending).toEqual({ first: 'first', second: 'second' });
		expect(maximum).toBe(1);
	});

	it('snapshots engine registration policy and provider behavior at registration time', async () => {
		const Engine = engine('scheduler-registration-snapshot');
		const Activity = activity('registration-snapshot', placement({ engine: Engine, mode: 'required' }));
		await using parent = context.create({ id: 'scheduler-registration-snapshot' });
		const setup = await program(parent, Activity, function* () {
			return yield* workflow.activity<string, never>(Activity, 'value', { affinity: { region: 'east' } });
		}, StringSchema);
		await using workflowCtx = setup.ctx;
		await using scheduler = workflow.scheduler();
		const affinity: Record<string, string> = { region: 'east' };
		const activities: workflow.ActivityReference[] = [Activity];
		let originalCalls = 0;
		let replacementCalls = 0;
		const provider = {
			activities,
			async run(_ctx: context.Context, attempt: workflow.ActivityAttemptType) {
				originalCalls += 1;
				return workflow.success(attempt.input);
			},
		};
		await using registration = await scheduler.register({ engine: Engine, hostId: 'snapshot-host', affinity, provider });
		void registration;

		affinity.region = 'west';
		activities.length = 0;
		provider.run = async () => {
			replacementCalls += 1;
			return workflow.success('replacement');
		};

		expect(registration.affinity).toEqual({ region: 'east' });
		expect(registration.activities).toEqual([Activity]);
		expect(await workflow.run({ ctx: workflowCtx, implementation: setup.implementation, scheduler })).toBe('value');
		expect(originalCalls).toBe(1);
		expect(replacementCalls).toBe(0);
	});

	it('rejects accessor-backed engine registration and provider metadata without invoking getters', async () => {
		const Engine = engine('scheduler-registration-accessor');
		const Activity = activity('registration-accessor', placement({ engine: Engine, mode: 'required' }));
		await using scheduler = workflow.scheduler();
		let optionReads = 0;
		const options = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(options, 'engine', { enumerable: true, get() { optionReads += 1; return Engine; } });
		await expect(scheduler.register(options as unknown as workflow.EngineRegistrationOptions)).rejects.toThrow(TypeError);
		expect(optionReads).toBe(0);

		let providerReads = 0;
		const provider = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(provider, 'activities', { enumerable: true, get() { providerReads += 1; return [Activity]; } });
		Object.defineProperty(provider, 'run', { enumerable: true, value: async () => workflow.success('value') });
		await expect(scheduler.register({ engine: Engine, hostId: 'accessor-host', provider: provider as unknown as workflow.EngineProvider })).rejects.toThrow(TypeError);
		expect(providerReads).toBe(0);
	});

	it('renews the exact queue claim when a provider heartbeat crosses the original lease expiry', async () => {
		const clock = new context.TestClock();
		const Engine = engine('scheduler-heartbeat');
		const Activity = activity('heartbeat', placement({ engine: Engine, mode: 'required' }));
		await using parent = context.create({ id: 'scheduler-heartbeat', clock });
		const setup = await program(parent, Activity, function* () {
			return yield* workflow.activity<string, never>(Activity, 'value');
		}, StringSchema);
		await using workflowCtx = setup.ctx;
		await using scheduler = workflow.scheduler({ clock, claimDuration: { seconds: 5 } });
		await using registration = await scheduler.register({
			engine: Engine,
			hostId: 'heartbeat-host',
			provider: {
				activities: [Activity],
				async run(_ctx, attempt, control) {
					clock.advance({ seconds: 4 });
					await control.heartbeat({ phase: 'alive' });
					clock.advance({ seconds: 2 });
					return workflow.success(attempt.input);
				},
			},
		});
		void registration;
		expect(await workflow.run({ ctx: workflowCtx, implementation: setup.implementation, scheduler })).toBe('value');
	});

	it('fences a late host generation and retries the logical job on the replacement generation', async () => {
		const Engine = engine('scheduler-generation');
		const Activity = activity('generation', placement({ engine: Engine, mode: 'required' }), [
			resilience.retry({ maximumAttempts: 2, initialDelay: { milliseconds: 1 }, maximumDelay: { milliseconds: 1 }, jitter: false }),
		]);
		await using parent = context.create({ id: 'scheduler-generation' });
		const setup = await program(parent, Activity, function* () {
			return yield* workflow.activity<string, never>(Activity, 'value');
		}, StringSchema);
		await using workflowCtx = setup.ctx;
		await using scheduler = workflow.scheduler({ claimDuration: { seconds: 5 } });
		const firstStarted = deferred();
		const releaseFirst = deferred();
		const attempts: Array<Readonly<{ generation: number; attempt: number }>> = [];
		await using first = await scheduler.register({
			engine: Engine,
			hostId: 'same-host',
			provider: {
				activities: [Activity],
				async run(_ctx, attempt) {
					attempts.push({ generation: attempt.generation, attempt: attempt.attempt });
					firstStarted.resolve();
					await releaseFirst.promise;
					return workflow.success('stale');
				},
			},
		});
		const pending = workflow.run({ ctx: workflowCtx, implementation: setup.implementation, scheduler });
		await firstStarted.promise;
		await using second = await scheduler.register({
			engine: Engine,
			hostId: 'same-host',
			provider: {
				activities: [Activity],
				async run(_ctx, attempt) {
					attempts.push({ generation: attempt.generation, attempt: attempt.attempt });
					return workflow.success('replacement');
				},
			},
		});
		expect(second.generation).toBe(first.generation + 1);
		releaseFirst.resolve();
		expect(await pending).toBe('replacement');
		expect(attempts).toEqual([
			{ generation: first.generation, attempt: 1 },
			{ generation: second.generation, attempt: 2 },
		]);
	});

	it('uses ordered placement preferences and falls back only to explicitly allowed engines', async () => {
		const Preferred = engine('scheduler-preferred');
		const Allowed = engine('scheduler-allowed');
		const Activity = activity('placement', placement(
			{ engine: Preferred, mode: 'preferred' },
			{ engine: Allowed, mode: 'allowed' },
		));
		await using parent = context.create({ id: 'scheduler-placement', clock: new context.TestClock() });
		const setup = await program(parent, Activity, function* () {
			return yield* workflow.activity<string, never>(Activity, 'value');
		}, StringSchema);
		await using workflowCtx = setup.ctx;
		await using scheduler = workflow.scheduler();
		const used: string[] = [];
		await using fallback = await scheduler.register({
			engine: Allowed,
			hostId: 'allowed-host',
			provider: { activities: [Activity], async run() { used.push('allowed'); return workflow.success('allowed'); } },
		});
		void fallback;
		expect(await workflow.run({ ctx: workflowCtx, implementation: setup.implementation, scheduler })).toBe('allowed');
		expect(used).toEqual(['allowed']);
	});


	it('persists only serializable activity job state and replays a declared failure without a live engine', async () => {
		const Engine = engine('scheduler-durable-job');
		const Blocked = failures.define({
			id: 'scheduler.blocked',
			description: 'The activity is blocked.',
			data: schema((value) => {
				if (typeof value !== 'object' || value === null || (value as { code?: unknown }).code !== 'blocked') {
					throw new TypeError('Expected blocked failure data.');
				}
				return { code: 'blocked' as const };
			}),
		});
		const base = activity('durable-job', placement({ engine: Engine, mode: 'required' }));
		const Activity: workflow.ActivityReference = Object.freeze({ ...base, failures: Object.freeze([Blocked]) });
		const definition = workflow.define({
			id: 'scheduler-test.durable-job',
			version: '1',
			input: AnySchema,
			result: StringSchema,
			activities: [Activity],
		});
		const implementation = workflow.implement(definition, function* () {
			try {
				yield* workflow.activity(Activity, { source: 'durable' });
				return 'unexpected';
			} catch (error) {
				if (failures.isOccurrence(error) && error.definition === Blocked) return (error.data as { readonly code: 'blocked' }).code;
				throw error;
			}
		});
		await using parent = context.create({ id: 'scheduler-durable-job' });
		const jobs = cloneQueue();
		await using records = history.memory({ maximumEntries: 8 });
		const runId = 'durable-run';
		let providerCalls = 0;

		await using firstCtx = await workflow.context({ definition, runId, input: {}, ctx: parent });
		await using first = workflow.scheduler({ activityQueue: jobs, history: records });
		await using registration = await first.register({
			engine: Engine,
			hostId: 'durable-host',
			provider: {
				activities: [Activity],
				async run() {
					providerCalls += 1;
					return workflow.failed(await failures.create(Blocked, { data: { code: 'blocked' } }));
				},
			},
		});
		void registration;
		expect(await workflow.run({ ctx: firstCtx, implementation, scheduler: first })).toBe('blocked');
		expect(providerCalls).toBe(1);

		const snapshot = records.inspect(runId);
		expect(snapshot.entries).toHaveLength(1);
		const cloned = structuredClone(snapshot);
		expect(cloned.entries).toHaveLength(1);
		expect(snapshot.entries[0]?.completion).toMatchObject({
			type: 'failure',
			failure: { kind: 'occurrence', value: { id: Blocked.id, data: { code: 'blocked' } } },
		});

		// A second Scheduler can replay the terminal job from the queue without a
		// live engine registration because the persisted value contains only data.
		await using replayCtx = await workflow.context({ definition, runId, input: {}, ctx: parent });
		await using replay = workflow.scheduler({ activityQueue: jobs });
		expect(await workflow.run({ ctx: replayCtx, implementation, scheduler: replay })).toBe('blocked');
		expect(providerCalls).toBe(1);
	});

	it('waits for an unavailable required engine only until the owning workflow context is cancelled', async () => {
		const Required = engine('scheduler-required-missing');
		const Activity = activity('missing-placement', placement({ engine: Required, mode: 'required' }));
		await using parent = context.create({ id: 'scheduler-missing', clock: new context.TestClock() });
		const setup = await program(parent, Activity, function* () {
			return yield* workflow.activity<unknown, never>(Activity, 'value');
		});
		await using workflowCtx = setup.ctx;
		await using scheduler = workflow.scheduler();
		const pending = workflow.run({ ctx: workflowCtx, implementation: setup.implementation, scheduler });
		await Promise.resolve();
		context.cancel(parent, 'no engine will arrive');
		await expect(pending).rejects.toBeInstanceOf(workflow.CancelledError);
	});
});
