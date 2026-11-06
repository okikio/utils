/** Real-process fixture for finite continuation and cleanup publication boundaries. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as schemaCore from '@okikio/schema';
import postgresjs from 'postgres';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as postgres from '@okikio/storage/workflow/postgres';

export const Engine = engine.define({ id: 'continuation.local' });
export const Store = resource.define<postgres.StoreType>()({
	id: 'continuation.store',
	description: 'Borrow the owning store for guarded fixture publication.',
});
const InputSchema = schemaCore.object({
	cursor: schemaCore.refine(
		schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		(value) => value >= 0,
		'Expected a nonnegative number.',
	),
	until: schemaCore.refine(
		schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		(value) => value >= 0,
		'Expected a nonnegative number.',
	),
	mode: schemaCore.oneOf(['basic', 'cleanup', 'cleanup-fail', 'nested']),
});
export const Write = activity.define({
	id: 'continuation.write',
	version: '1',
	input: schemaCore.object({
		cursor: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		label: schemaCore.oneOf(['work', 'cleanup']),
		fail: schemaCore.boolean(),
	}),
	result: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
	placement: engine.require(Engine),
	resources: [Store],
});
export const Program = workflow.define({
	id: 'continuation.program',
	version: '1',
	input: InputSchema,
	result: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
	activities: [Write],
});
export const Parent = workflow.define({
	id: 'continuation.parent',
	version: '1',
	input: InputSchema,
	result: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
	workflows: [Program],
});
export const Immediate = workflow.define({
	id: 'continuation.immediate',
	version: '1',
	input: InputSchema,
	result: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
});
export const CleanupChild = workflow.define({
	id: 'continuation.cleanup-child',
	version: '1',
	input: Write.input,
	result: Write.result,
	activities: [Write],
});
export const DeferredChild = workflow.define({
	id: 'continuation.deferred-child',
	version: '1',
	input: InputSchema,
	result: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
	workflows: [CleanupChild],
});
export const Finalizer = activity.define({
	id: 'continuation.finalizer',
	version: '1',
	input: workflow.FinalizationSchema,
	result: schemaCore.boolean(),
	placement: engine.require(Engine),
});
export const ProgramLive = workflow.implement(Program, function* (ctx) {
	if (ctx.input.mode === 'nested') {
		yield* workflow.parallel({ branch: workflow.continue({ ...ctx.input, mode: 'basic' }) });
	}
	if (ctx.input.mode === 'cleanup' || ctx.input.mode === 'cleanup-fail') {
		yield* workflow.defer(ctx.trigger(Write, {
			cursor: ctx.input.cursor,
			label: 'cleanup',
			fail: ctx.input.mode === 'cleanup-fail',
		}));
	}
	yield* ctx.trigger(Write, { cursor: ctx.input.cursor, label: 'work', fail: false });
	if (ctx.input.cursor < ctx.input.until) yield* workflow.continue({ ...ctx.input, cursor: ctx.input.cursor + 1 });
	return ctx.input.cursor;
});
export const ParentLive = workflow.implement(Parent, function* (ctx) {
	return yield* ctx.trigger(Program, ctx.input);
});
export const ImmediateLive = workflow.implement(Immediate, function* (ctx) {
	if (ctx.input.cursor < ctx.input.until) yield* workflow.continue({ ...ctx.input, cursor: ctx.input.cursor + 1 });
	return ctx.input.cursor;
});
export const CleanupChildLive = workflow.implement(CleanupChild, function* (ctx) {
	return yield* ctx.trigger(Write, ctx.input);
});
export const DeferredChildLive = workflow.implement(DeferredChild, function* (ctx) {
	yield* workflow.defer(ctx.trigger(CleanupChild, { cursor: ctx.input.cursor, label: 'cleanup', fail: true }));
	if (ctx.input.cursor < ctx.input.until) yield* workflow.continue({ ...ctx.input, cursor: ctx.input.cursor + 1 });
	return ctx.input.cursor;
});
export const Policy = workflow.PolicySchema.parse({
	id: 'continuation.policy',
	version: '1',
	limits: {
		inputBytes: 4096,
		resultBytes: 4096,
		historyBytes: 16_384,
		pendingRoots: 4,
		reservedSuccessors: 8,
		pendingChildren: 4,
		pendingFinalizers: 12,
	},
	claims: { leaseMs: 1000, renewEveryMs: 100, recoverEveryMs: 25 },
	activities: [{
		definition: Write,
		maxAttempts: 3,
		deadlineMs: 20_000,
		retry: 'transient',
		delay: { initialMs: 10, maximumMs: 100 },
		recovery: 'retry',
		requires: ['postgres.transactions', 'postgres.receipts'],
	}],
	workflows: [
		{
			definition: Program,
			maxInstructions: 4,
			maxContinuations: 2,
			requires: ['workflow.cleanup', 'workflow.continue'],
		},
		{ definition: Immediate, maxInstructions: 2, maxContinuations: 2, requires: ['workflow.continue'] },
		{
			definition: Parent,
			maxInstructions: 4,
			maximumChildren: 1,
			children: [{ definition: Program, maximum: 1 }],
			requires: [],
		},
		{ definition: CleanupChild, maxInstructions: 1, requires: [] },
		{
			definition: DeferredChild,
			maxInstructions: 2,
			maxContinuations: 1,
			maximumChildren: 1,
			children: [{ definition: CleanupChild, maximum: 1 }],
			requires: ['workflow.cleanup', 'workflow.continue'],
		},
	],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60_000, resultsMs: 60_000, auditMs: 60_000 },
});

if (import.meta.main) {
	const sql = postgresjs(process.env.DATABASE_URL!, { max: 8, onnotice() {} });
	try {
		await using store = postgres.open({
			database: sql,
			namespace: process.env.CONTINUATION_NAMESPACE!,
			notifications: false,
		});
		await using owner = context.create({ id: `continuation:${process.pid}` });
		await using resources = resource.create(
			resource.implementations(resource.implement(Store, { create: () => store })),
			{ ctx: owner, host: {} },
		);
		const write = activity.implement(Write, {
			async run(ctx) {
				if (ctx.input.fail) throw new Error('Fixture cleanup failed.');
				const database = await ctx.get(Store);
				const saved = await database.transaction(ctx.claim, {
					key: 'write/v1',
					input: ctx.input,
					result: Write.result,
				}, async (tx, receipt) => {
					const prior = await receipt.get();
					if (prior !== undefined) return prior;
					// Deliberately no domain uniqueness constraint: the receipt must prevent a repeated append.
					await tx`insert into utils_continuation_writes(namespace,run,job,label,cursor,pid)
 values (${database.namespace},${ctx.claim!.runId},${ctx.jobId},${ctx.input.label},${ctx.input.cursor},${process.pid})`;
					return await receipt.save(ctx.input.cursor);
				});
				if (process.env.HOLD_CLEANUP === 'true' && ctx.input.label === 'cleanup' && ctx.attempt === 1) {
					console.log(JSON.stringify({ gate: 'cleanup', pid: process.pid, job: ctx.jobId }));
					await new Promise<never>((_, reject) => {
						if (ctx.signal.aborted) reject(ctx.signal.reason);
						else ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
					});
				}
				return saved.value;
			},
		});
		if (process.env.HOLD_ROLLOVER === 'true') {
			const persist = store.continue!.bind(store);
			store.continue = async (...arguments_) => {
				await persist(...arguments_);
				console.log(JSON.stringify({ gate: 'rollover', pid: process.pid }));
				await new Promise<void>(() => {});
			};
		}
		const shutdown = new AbortController();
		process.once('SIGTERM', () => shutdown.abort());
		await using worker = await workflow.serve({
			store,
			resources,
			policies: [Policy],
			workflows: [ProgramLive, ParentLive, ImmediateLive, CleanupChildLive, DeferredChildLive],
			activities: [write],
			engine: Engine,
			hostId: owner.id,
			shutdown: shutdown.signal,
			capacity: { activations: 1, activities: 1, finalizers: 1, control: 1 },
			pollIntervalMs: 25,
		});
		console.log(JSON.stringify({ ready: true, pid: process.pid }));
		await worker.closed;
	} finally {
		await sql.end({ timeout: 2 });
	}
}
