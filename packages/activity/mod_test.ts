import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as effect from '@okikio/effect';
import * as failure from '@okikio/failure';
import * as permissions from '@okikio/permission';
import * as resource from '@okikio/resource';
import * as workflow from '@okikio/workflow';
import * as engine from './engine.ts';
import * as activity from './mod.ts';

/** Creates a small Standard Schema contract without coupling the tests to Zod. */
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

const InputSchema = schema((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { value?: unknown }).value !== 'string') {
		throw new TypeError('Expected a value string.');
	}
	return { value: (value as { value: string }).value };
});
const ResultSchema = schema((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { stored?: unknown }).stored !== 'boolean') {
		throw new TypeError('Expected a stored boolean.');
	}
	return { stored: (value as { stored: boolean }).stored };
});
const FailureDataSchema = schema((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { reason?: unknown }).reason !== 'string') {
		throw new TypeError('Expected a reason string.');
	}
	return { reason: (value as { reason: string }).reason };
});

const Browser = engine.define({ id: 'browser', description: 'Runs browser activities.' });
const Analysis = engine.define({ id: 'analysis', description: 'Runs analysis activities.' });
const Store = resource.define<{ readonly save: (value: string) => Promise<void> }>()({
	id: 'test.store',
	description: 'Stores values.',
});
const StoreUnavailable = failure.define({
	id: 'test.store-unavailable',
	description: 'The store is unavailable.',
	data: FailureDataSchema,
});
const StoreValue = activity.define({
	id: 'test.store-value',
	version: '1',
	description: 'Stores one value.',
	input: InputSchema,
	result: ResultSchema,
	failures: [StoreUnavailable],
	placement: engine.require(Browser),
	resources: [Store],
});
const StoreWrite = permissions.define({
	id: 'test.store-write',
	description: 'Write one stored value.',
	target: InputSchema,
});
const ValueStored = effect.define({
	id: 'test.value-stored',
	description: 'One value was stored successfully.',
	value: ResultSchema,
});
const GovernedStoreValue = activity.define({
	id: 'test.governed-store-value',
	version: '1',
	description: 'Stores one value after authorization and emits the required commit effect.',
	input: InputSchema,
	result: ResultSchema,
	effects: [ValueStored],
	placement: engine.require(Browser),
	resources: [Store],
	requirements: [permissions.require(StoreWrite)],
});

/** Creates one resource collection whose Store implementation appends to `values`. */
function resources(ctx: context.Owned, values: string[] = []): resource.ResourceCollection {
	const StoreLive = resource.implement(Store, {
		create() { return { async save(value: string) { values.push(value); } }; },
	});
	return resource.create(resource.implementations(StoreLive), { host: {}, ctx });
}

describe('activity definitions and direct attempts', () => {
	it('uses the activity version as part of durable definition identity and documentation', () => {
		expect(StoreValue.version).toBe('1');
		expect(activity.document([StoreValue])).toMatchObject([{
			id: 'test.store-value',
			version: '1',
			placement: [{ engine: 'browser', mode: 'required' }],
		}]);
		expect(() => activity.define({
			id: 'test.invalid-version',
			version: 'not valid!',
			input: InputSchema,
			result: ResultSchema,
			placement: engine.require(Browser),
		})).toThrow(TypeError);
	});

	it('creates a lazy activity request without starting external work', () => {
		const operation = activity.request(StoreValue, { value: 'example' }, { key: 'store:example' });
		const step = operation[Symbol.iterator]().next();
		expect(step.done).toBe(false);
		if (!step.done) expect(step.value).toMatchObject({
			category: 'command',
			type: 'activity',
			activity: StoreValue,
			input: { value: 'example' },
			key: 'store:example',
		});
	});

	it('runs a concrete implementation with validated input and narrowed resources', async () => {
		await using ctx = context.create({ id: 'activity-parent', clock: new context.TestClock() });
		const values: string[] = [];
		await using collection = resources(ctx, values);
		const implementation = activity.implement(StoreValue, {
			async run(activityCtx) {
				const store = await activityCtx.get(Store);
				await store.save(activityCtx.input.value);
				activityCtx.heartbeat({ completed: 1 });
				return { stored: true };
			},
		});
		const heartbeats: unknown[] = [];
		const output = await activity.run({
			implementation,
			engine: Browser,
			input: { value: 'example' },
			ctx,
			resources: collection,
			jobId: 'job:store-example',
			attempt: 1,
			heartbeat(value) { heartbeats.push(value); },
		});
		expect(output).toEqual({ stored: true });
		expect(values).toEqual(['example']);
		expect(heartbeats).toEqual([{ completed: 1 }]);
	});

	it('carries declared permission and effect runtimes through one owned attempt context', async () => {
		await using ctx = context.create({ id: 'activity-governed-parent', clock: new context.TestClock() });
		await using collection = resources(ctx);
		let permissionCalls = 0;
		const accepted: effect.EffectOccurrence[] = [];
		const implementation = activity.implement(GovernedStoreValue, {
			async run(activityCtx) {
				await permissions.assert(activityCtx, StoreWrite, activityCtx.input);
				const store = await activityCtx.get(Store);
				await store.save(activityCtx.input.value);
				await effect.emit(activityCtx, ValueStored, { stored: true }, { key: `stored:${activityCtx.input.value}` });
				return { stored: true };
			},
		});

		const output = await activity.run({
			implementation,
			engine: Browser,
			input: { value: 'authorized' },
			ctx,
			resources: collection,
			jobId: 'job:governed-store',
			attempt: 1,
			permission: {
				maximumChecks: 10,
				async check(_ctx, requests) {
					permissionCalls++;
					expect(requests).toMatchObject([{ definition: StoreWrite, target: { value: 'authorized' } }]);
					return [{ allowed: true }];
				},
			},
			effect: {
				async emit(effectCtx, occurrence) {
					expect(effectCtx.id).toBe('job:governed-store');
					accepted.push(occurrence);
				},
			},
		});

		expect(output).toEqual({ stored: true });
		expect(permissionCalls).toBe(1);
		expect(accepted).toHaveLength(1);
		expect(accepted[0]).toMatchObject({
			definition: ValueStored,
			key: 'stored:authorized',
			value: { stored: true },
		});
	});

	it('fails closed when dynamic permission work has no checker', async () => {
		await using ctx = context.create({ id: 'activity-permission-missing', clock: new context.TestClock() });
		await using collection = resources(ctx);
		const implementation = activity.implement(GovernedStoreValue, {
			async run(activityCtx) {
				await permissions.assert(activityCtx, StoreWrite, activityCtx.input);
				return { stored: true };
			},
		});
		await expect(activity.run({
			implementation,
			engine: Browser,
			input: { value: 'blocked' },
			ctx,
			resources: collection,
			jobId: 'job:missing-permission-checker',
			attempt: 1,
		})).rejects.toBeInstanceOf(permissions.MissingPermissionCheckerError);
	});

	it('validates selected engine, input, result, and durable job identity', async () => {
		await using ctx = context.create({ id: 'activity-invalid', clock: new context.TestClock() });
		await using collection = resources(ctx);
		const invalidResult = activity.implement(StoreValue, { async run() { return { stored: 'yes' } as never; } });

		await expect(activity.run({
			implementation: invalidResult, engine: Analysis, input: { value: 'valid' }, ctx, resources: collection,
			jobId: 'job:invalid-engine', attempt: 1,
		})).rejects.toBeInstanceOf(activity.InvalidEngineError);
		await expect(activity.run({
			implementation: invalidResult, engine: Browser, input: { value: 'valid' }, ctx, resources: collection,
			jobId: 'job:invalid-result', attempt: 1,
		})).rejects.toThrow('Expected a stored boolean.');
		await expect(activity.run({
			implementation: invalidResult, engine: Browser, input: { value: 42 }, ctx, resources: collection,
			jobId: 'job:invalid-input', attempt: 1,
		})).rejects.toThrow('Expected a value string.');
		await expect(activity.run({
			implementation: invalidResult, engine: Browser, input: { value: 'valid' }, ctx, resources: collection,
			jobId: ' ', attempt: 1,
		})).rejects.toThrow('jobId must not be empty');
	});

	it('keeps declared failures explicit and rejects undeclared expected failures', async () => {
		await using ctx = context.create({ id: 'activity-failure', clock: new context.TestClock() });
		await using collection = resources(ctx);
		const expected = await failure.create(StoreUnavailable, { data: { reason: 'offline' } });
		const declared = activity.implement(StoreValue, { async run() { throw expected; } });
		await expect(activity.run({
			implementation: declared, engine: Browser, input: { value: 'x' }, ctx, resources: collection,
			jobId: 'job:declared-failure', attempt: 1,
		})).rejects.toBe(expected);

		const Other = failure.define({ id: 'test.other', description: 'Other failure.', data: FailureDataSchema });
		const undeclared = await failure.create(Other, { data: { reason: 'wrong contract' } });
		const invalid = activity.implement(StoreValue, { async run() { throw undeclared; } });
		await expect(activity.run({
			implementation: invalid, engine: Browser, input: { value: 'x' }, ctx, resources: collection,
			jobId: 'job:undeclared-failure', attempt: 1,
		})).rejects.toBeInstanceOf(activity.UndeclaredFailureError);
	});

	it('converts only declared workflow activity failures through activity.try()', async () => {
		const Workflow = workflow.define({
			id: 'test.activity-try',
			version: '1',
			input: InputSchema,
			result: schema((value) => value as activity.ActivityTryResult<typeof StoreValue>),
			activities: [StoreValue],
		});
		const implementation = workflow.implement(Workflow, function* (ctx) {
			return yield* activity.try(StoreValue, ctx.input);
		});
		await using parent = context.create({ id: 'workflow-parent', clock: new context.TestClock() });
		await using workflowCtx = await workflow.context({
			definition: Workflow, runId: 'run:activity-try', input: { value: 'example' }, ctx: parent,
		});
		const occurrence = await failure.create(StoreUnavailable, { data: { reason: 'offline' } });
		await using scheduler = workflow.scheduler();
		await using registration = await scheduler.register({
			engine: Browser,
			hostId: 'failure-provider',
			provider: {
				activities: [StoreValue],
				async run() { return { type: 'failure', failure: occurrence }; },
			},
		});
		void registration;
		const output = await workflow.run({ ctx: workflowCtx, implementation, scheduler });
		expect(output).toEqual({ ok: false, failure: occurrence });
	});
});
