/** One stateful workload shared by memory, durable, thread, process and container test. */
import process from 'node:process';
import { threadId } from 'node:worker_threads';
import * as schema from '@okikio/schema';
import * as activity from '@okikio/activity';
import * as context from '@okikio/context';
import * as engine from '@okikio/activity/engine';
import * as resource from '@okikio/capability/resource';
import * as workflow from '@okikio/workflow';
import * as scheduler from '@okikio/scheduler';

export const Engine = engine.define({ id: 'nested.probe' });
export const ReceiptSchema = schema.object({
	owner: schema.string(),
	instance: schema.string(),
	value: schema.string(),
	pid: schema.number(),
	thread: schema.number(),
	count: schema.number(),
	finished: schema.number(),
	checksum: schema.number(),
});
export type ReceiptType = schema.Output<typeof ReceiptSchema>;
/** Host collection owns the instance; each activity borrows it and joins its own release. */
export const State = resource.define<{ readonly instance: string; count: number; finished: number }>()({
	id: 'nested.state',
	description: 'Retain a counter on its physical execution host.',
});
export const StateLive = resource.implement(State, {
	create: () => ({ instance: crypto.randomUUID(), count: 0, finished: 0 }),
});
export const Work = activity.define({
	id: 'nested.work',
	version: '1',
	input: schema.string(),
	result: ReceiptSchema,
	resources: [State],
	placement: engine.require(Engine),
});
export const Live = activity.implement(Work, {
	async run(ctx) {
		const state = await ctx.get(State);
		state.count++;
		ctx.defer(async () => {
			// A later request must see this release, not merely an early result message.
			await new Promise<void>((resolve) => setTimeout(resolve, 2));
			state.finished++;
		});
		let checksum = 0;
		if (ctx.input === 'cpu') {
			// Fixed arithmetic in four chunks permits timers and sibling attempts to advance.
			for (let chunk = 0; chunk < 4; chunk++) {
				for (let index = 0; index < 10000; index++) checksum += index;
				await scheduler.yield(ctx.signal);
			}
		}
		if (ctx.input === 'io') await new Promise<void>((resolve) => setTimeout(resolve, 2));
		// The crash probe cannot finish between SQL observation and host termination.
		// Recovery runs attempt two on a new physical owner and may then return.
		if (ctx.input === 'slow' && ctx.attempt === 1) await context.waitFor(ctx, () => () => {});
		return {
			owner: process.env.PLACEMENT_OWNER ?? 'unnamed',
			instance: state.instance,
			value: ctx.input,
			pid: process.pid,
			thread: threadId,
			count: state.count,
			finished: state.finished,
			checksum,
		};
	},
});
export const Child = workflow.define({
	id: 'nested.child',
	version: '1',
	input: schema.string(),
	result: schema.array(ReceiptSchema),
	activities: [Work],
});
export const Parent = workflow.define({
	id: 'nested.parent',
	version: '1',
	input: schema.string(),
	result: schema.array(ReceiptSchema),
	workflows: [Child],
});
export const ChildLive = workflow.implement(Child, function* (ctx) {
	// Preserve one committed result before blocking the next attempt for the crash.
	const a = yield* activity.request(Work, ctx.input === 'slow' ? 'value' : ctx.input);
	const b = yield* activity.request(Work, ctx.input);
	return [a, b];
});
export const ParentLive = workflow.implement(Parent, function* (ctx) {
	return yield* workflow.child(Child, ctx.input);
});
export const Policy = workflow.PolicySchema.parse({
	id: 'nested.policy',
	version: '1',
	limits: {
		inputBytes: 65536,
		resultBytes: 65536,
		historyBytes: 262144,
		pendingRoots: 100,
		reservedSuccessors: 0,
		pendingChildren: 100,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 2000, renewEveryMs: 200, recoverEveryMs: 25 },
	activities: [{
		definition: Work,
		maxAttempts: 3,
		deadlineMs: 30000,
		retry: 'transient',
		delay: { initialMs: 10, maximumMs: 100 },
		recovery: 'retry',
		requires: [],
	}],
	workflows: [{
		definition: Parent,
		maxInstructions: 5,
		requires: [],
		maximumChildren: 1,
		children: [{ definition: Child, maximum: 1 }],
	}, { definition: Child, maxInstructions: 5, requires: [] }],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60000, resultsMs: 60000, auditMs: 60000 },
});

/** Labels are registration authority supplied by deployment; PID/thread receipts separately prove native execution. */
export function compute(owner: string, kind: 'thread' | 'process', capacity = 2): workflow.ComputeType {
	const ancestors = [{ id: 'node', generation: 1 }, { id: 'pod', generation: 1, parent: 'node' }, {
		id: `container:${owner}`,
		generation: 1,
		parent: 'pod',
		capacity,
	}];
	if (kind === 'thread') ancestors.push({ id: `process:${owner}`, generation: 1, parent: `container:${owner}` });
	return { id: `${kind}:${owner}`, kind, generation: 1, parent: ancestors.at(-1)!.id, ancestors };
}
