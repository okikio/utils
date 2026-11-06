/** A real worker entry for progress and external-event recovery tests. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as schemaCore from '@okikio/schema';
import postgresjs from 'postgres';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/capability/effect';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as postgres from '@okikio/storage/workflow/postgres';

export const Engine = engine.define({ id: 'event-host' });
export const Progress = effect.define({
	id: 'import.progress',
	value: schemaCore.object({
		rows: schemaCore.refine(
			schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
			(value) => value >= 0,
			'Expected a nonnegative number.',
		),
	}),
});
export const Approved = workflow.signal({ id: 'import.approved', value: schemaCore.string() });
export const Wait = workflow.define({
	id: 'import.wait',
	version: '1',
	input: schemaCore.object({ until: schemaCore.optional(schemaCore.string()) }),
	result: schemaCore.union([
		schemaCore.object({ type: schemaCore.literal('received'), value: schemaCore.string() }),
		schemaCore.object({ type: schemaCore.literal('timeout') }),
	]),
});
export const WaitLive = workflow.implement(Wait, function* (ctx) {
	return yield* workflow.wait({
		event: Approved,
		key: 'approval',
		...(ctx.input.until === undefined ? {} : { until: ctx.input.until }),
	});
});
export const Report = activity.define({
	id: 'import.rows',
	version: '1',
	input: schemaCore.object({}),
	result: schemaCore.number(),
	placement: engine.require(Engine),
	effects: [Progress],
});
export const ReportLive = activity.implement(Report, {
	async run(ctx) {
		const rows = ctx.attempt === 1 ? 200 : 400;
		await effect.emit(ctx, Progress, { rows }, { key: `rows:${rows}` });
		if (ctx.attempt === 1) {
			await new Promise<void>((_resolve, reject) => {
				if (ctx.signal.aborted) reject(ctx.signal.reason);
				else ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
			});
		}
		return 400;
	},
});
export const Policy = workflow.PolicySchema.parse({
	id: 'events.policy',
	version: '1',
	limits: {
		inputBytes: 65_536,
		resultBytes: 65_536,
		historyBytes: 262_144,
		pendingRoots: 20,
		reservedSuccessors: 0,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 600, renewEveryMs: 100, recoverEveryMs: 25 },
	activities: [{
		definition: Report,
		maxAttempts: 3,
		deadlineMs: 30_000,
		retry: 'transient',
		delay: { initialMs: 10, maximumMs: 100 },
		recovery: 'retry',
		requires: ['effects.progress'],
	}],
	workflows: [{ definition: Wait, maxInstructions: 10, requires: ['workflow.events'] }],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60_000, resultsMs: 60_000, auditMs: 60_000 },
});

if (import.meta.main) {
	const sql = postgresjs(process.env.DATABASE_URL!, { max: 8, onnotice() {} });
	await using store = postgres.open({ database: sql, namespace: process.env.EVENT_NAMESPACE! });
	await using ctx = context.create({ id: 'event-host' });
	await using resources = resource.create(resource.implementations(), { ctx, host: {} });
	await using worker = await workflow.serve({
		store,
		shutdown: new AbortController().signal,
		policies: [Policy],
		workflows: [WaitLive],
		activities: [ReportLive],
		progress: [Progress],
		resources,
		engine: Engine,
		hostId: 'event-host',
		capacity: { activations: 1, activities: 1, finalizers: 1, control: 1 },
	});
	console.log(JSON.stringify({ ready: true }));
	await worker.closed;
	await sql.end();
}
