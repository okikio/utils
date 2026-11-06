/** Small Core/Intelligence consumers. They share real process and thread providers. @module */
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as task from '@okikio/task';
import * as resource from '@okikio/capability/resource';
import * as workflow from '@okikio/workflow';
import type { Sql } from 'postgres';
import * as schemaCore from '@okikio/schema';

export const Process = engine.define({ id: 'consumer.process' });
export const Thread = engine.define({ id: 'consumer.thread' });
export const Database = resource.define<{ sql: Sql; namespace: string }>({
	id: 'consumer.database',
	description: 'Borrow the application SQL pool.',
});
export const InputSchema = schemaCore.object({
	source: schemaCore.string(),
	gate: schemaCore.optional(schemaCore.string()),
});
export const WorkSchema = schemaCore.extend(InputSchema, {
	batch: schemaCore.refine(
		schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		(value) => value >= 0,
		'Value is below the minimum.',
	),
	label: schemaCore.string(),
});
export const ResultSchema = schemaCore.object({ value: schemaCore.number() });
export const Approved = workflow.signal('consumer.approved', schemaCore.boolean());
export const Write = activity.define({
	id: 'consumer.write',
	version: '1',
	input: WorkSchema,
	result: ResultSchema,
	resources: [Database],
	placement: engine.require(Process),
	effects: [task.ProgressEffect],
});
export const Analyze = activity.define({
	id: 'consumer.analyze',
	version: '1',
	input: WorkSchema,
	result: ResultSchema,
	resources: [Database],
	placement: engine.require(Thread),
	effects: [task.ProgressEffect],
});
export const Clean = activity.define({
	id: 'consumer.clean',
	version: '1',
	input: WorkSchema,
	result: ResultSchema,
	resources: [Database],
	placement: engine.require(Process),
	effects: [task.ProgressEffect],
});
export const Notify = activity.define({
	id: 'consumer.notify',
	version: '1',
	input: WorkSchema,
	result: ResultSchema,
	resources: [Database],
	placement: engine.require(Process),
	effects: [task.ProgressEffect],
});
export const Import = workflow.define({
	id: 'consumer.import',
	version: '1',
	input: InputSchema,
	result: ResultSchema,
	activities: [Write, Clean, Notify],
});
export const Knowledge = workflow.define({
	id: 'consumer.knowledge',
	version: '1',
	input: WorkSchema,
	result: ResultSchema,
	activities: [Write],
});
export const Research = workflow.define({
	id: 'consumer.research',
	version: '1',
	input: InputSchema,
	result: ResultSchema,
	activities: [Analyze, Clean],
	workflows: [Knowledge],
});

export const imports = workflow.implement(Import, function* (ctx) {
	yield* workflow.defer(ctx.trigger(Clean, { ...ctx.input, batch: 0, label: 'outer' }));
	yield* workflow.defer(ctx.trigger(Clean, { ...ctx.input, batch: 0, label: 'inner' }));
	let value = 0;
	for (let batch = 1; batch <= 3; batch++) {
		value += (yield* ctx.trigger(Write, { ...ctx.input, batch, label: 'rows' })).value;
	}
	yield* ctx.trigger(Notify, { ...ctx.input, batch: 0, label: 'notification' }, { background: true });
	const approved = yield* workflow.wait(Approved);
	if (approved.type === 'received' && !approved.value) throw new Error('Import rejected.');
	return { value };
});
export const knowledge = workflow.implement(Knowledge, function* (ctx) {
	return yield* ctx.trigger(Write, ctx.input);
});
export const research = workflow.implement(Research, function* (ctx) {
	yield* workflow.defer(ctx.trigger(Knowledge, { ...ctx.input, batch: 0, label: 'child.cleanup' }));
	// A composed generator owns its branch cleanup and still appears in saved history.
	function* first() {
		yield* workflow.defer(ctx.trigger(Clean, { ...ctx.input, batch: 0, label: 'branch' }));
		return yield* ctx.trigger(Analyze, { ...ctx.input, batch: 1, label: 'first' });
	}
	const result = yield* workflow.parallel({
		first: first(),
		second: ctx.trigger(Analyze, { ...ctx.input, batch: 2, label: 'second' }),
	});
	return yield* ctx.trigger(Knowledge, {
		...ctx.input,
		batch: result.first.value + result.second.value,
		label: 'publication',
	});
});
const attempt = {
	maxAttempts: 5,
	deadlineMs: 60_000,
	recovery: 'retry',
	retry: 'transient',
	delay: { initialMs: 20, maximumMs: 50 },
	requires: [],
} as const;
export const Policy = workflow.PolicySchema.parse({
	id: 'consumer',
	version: '1',
	limits: {
		inputBytes: 4096,
		resultBytes: 4096,
		historyBytes: 1_048_576,
		pendingRoots: 100,
		reservedSuccessors: 0,
		pendingChildren: 100,
		pendingFinalizers: 100,
	},
	claims: { leaseMs: 2000, renewEveryMs: 200, recoverEveryMs: 25 },
	activities: [Write, Analyze, Clean, Notify].map((definition) => ({ definition, ...attempt })),
	workflows: [
		{
			definition: Import,
			maxInstructions: 100,
			requires: ['workflow.cleanup'],
			maximumChildren: 1,
			children: [{ definition: Notify, maximum: 1 }],
		},
		{
			definition: Research,
			maxInstructions: 100,
			requires: ['workflow.cleanup'],
			maximumChildren: 2,
			children: [{ definition: Knowledge, maximum: 2 }],
		},
		{ definition: Knowledge, maxInstructions: 100, requires: [] },
	],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60_000, resultsMs: 60_000, auditMs: 60_000 },
});
