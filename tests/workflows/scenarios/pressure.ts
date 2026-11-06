/** One-slot worker fixture: parked approvals must release capacity and survive process replacement. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as schemaCore from '@okikio/schema';
import postgresjs from 'postgres';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as postgres from '@okikio/storage/workflow/postgres';
import { Approved, Engine } from './events.ts';
import { Policy as Base, Work, WorkLive } from './execution.ts';

/** Explicit test load, bounded to keep accidental local runs finite. */
export const count = Number(process.env.UTILS_WORKFLOW_PRESSURE_RUNS ?? 128);
if (!Number.isSafeInteger(count) || count < 33 || count > 2000) throw new RangeError('Pressure runs must be 33..2000.');
export const Program = workflow.define({
	id: 'pressure.approved-work',
	version: '1',
	input: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
	result: schemaCore.number(),
	activities: [Work],
});
export const ProgramLive = workflow.implement(Program, function* (ctx) {
	yield* workflow.wait({ event: Approved, key: 'approval' });
	return yield* activity.request(Work, { value: ctx.input });
});
export const Policy = workflow.PolicySchema.parse({
	...Base,
	id: 'pressure.policy',
	limits: { ...Base.limits, pendingRoots: count + 40 },
	claims: { leaseMs: 5000, renewEveryMs: 250, recoverEveryMs: 50 },
	workflows: [{ definition: Program, maxInstructions: 10, requires: ['workflow.events'] }],
});

if (import.meta.main) {
	const sql = postgresjs(process.env.DATABASE_URL!, { max: 8, onnotice() {} });
	try {
		await using store = postgres.open({ database: sql, namespace: process.env.EXECUTION_NAMESPACE! });
		await using ctx = context.create({ id: 'pressure-host' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		await using worker = await workflow.serve({
			store,
			resources,
			engine: Engine,
			workflows: [ProgramLive],
			activities: [WorkLive],
			policies: [Policy],
			hostId: 'pressure-host',
			shutdown: new AbortController().signal,
			pollIntervalMs: 100,
			capacity: { activations: 1, activities: 4, finalizers: 1, control: 1 },
		});
		console.log(JSON.stringify({ ready: true, pid: process.pid }));
		const timer = setInterval(() => console.log(JSON.stringify({ state: worker.state() })), 50);
		try {
			await worker.closed;
		} finally {
			clearInterval(timer);
		}
	} finally {
		await sql.end({ timeout: 2 });
	}
}
