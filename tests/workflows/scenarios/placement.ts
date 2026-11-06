/** General work placed on registered container processes, with a nested child. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { createServer } from 'node:http';
import process from 'node:process';
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as schema from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as engines from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';

export const Engine = engines.define({ id: 'placement.container' });
export const Work = activity.define({
	id: 'placement.work',
	version: '1',
	input: schema.string(),
	result: schema.string(),
	placement: engines.require(Engine),
});
export const Child = workflow.define({
	id: 'placement.child',
	version: '1',
	input: schema.string(),
	result: schema.string(),
	activities: [Work],
});
export const Parent = workflow.define({
	id: 'placement.parent',
	version: '1',
	input: schema.string(),
	result: schema.string(),
	workflows: [Child],
});
// Keep this entry independent of other executable fixtures. Bundling an imported
// entry can make its import.meta.main branch run inside this process too.
export const Policy = workflow.PolicySchema.parse({
	id: 'placement.container.policy',
	version: '1',
	limits: {
		inputBytes: 65536,
		resultBytes: 65536,
		historyBytes: 262144,
		pendingRoots: 20,
		reservedSuccessors: 0,
		pendingChildren: 20,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 600, renewEveryMs: 100, recoverEveryMs: 25 },
	activities: [{
		definition: Work,
		maxAttempts: 3,
		deadlineMs: 30000,
		retry: 'transient',
		delay: { initialMs: 10, maximumMs: 100 },
		recovery: 'retry',
		requires: [],
	}],
	workflows: [
		{
			definition: Parent,
			maxInstructions: 5,
			requires: [],
			maximumChildren: 1,
			children: [{ definition: Child, maximum: 1 }],
		},
		{ definition: Child, maxInstructions: 5, requires: [] },
	],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60000, resultsMs: 60000, auditMs: 60000 },
});

if (import.meta.main) {
	const sql = postgresjs(process.env.DATABASE_URL!, { max: 8, onnotice() {} });
	try {
		await using owner = context.create({ id: 'container-placement' });
		await using resources = resource.create(resource.implementations(), { ctx: owner, host: {} });
		await using store = postgres.open({ database: sql, namespace: process.env.WORKFLOW_NAMESPACE! });
		const shutdown = new AbortController();
		await using worker = await workflow.serve({
			store,
			resources,
			engine: Engine,
			policies: [Policy],
			workflows: [
				workflow.implement(Parent, function* (ctx) {
					return yield* workflow.child(Child, ctx.input);
				}),
				workflow.implement(Child, function* (ctx) {
					return yield* activity.request(Work, ctx.input);
				}),
			],
			activities: [activity.implement(Work, { run: (ctx) => `${process.env.WORKER_ID}:${ctx.input}` })],
			hostId: process.env.WORKER_ID!,
			compute: JSON.parse(process.env.COMPUTE!),
			shutdown: shutdown.signal,
			capacity: { activations: 1, activities: 2, finalizers: 1, control: 1 },
		});
		const server = createServer((_request, response) => {
			response.end('ready');
		});
		server.listen(8080, '0.0.0.0');
		process.once('SIGTERM', () => {
			server.close();
			shutdown.abort();
		});
		try {
			await worker.closed;
		} finally {
			server.close();
		}
	} finally {
		await sql.end({ timeout: 2 });
	}
}
