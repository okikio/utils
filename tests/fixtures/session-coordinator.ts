/** Real host coordinator, run directly or bundled in a container. HTTP is a bounded test control surface. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import process from 'node:process';
import { createServer } from 'node:http';
import postgresjs from 'postgres';
import * as worker from '@okikio/activity/worker';
import * as child from '@okikio/activity/process';
import * as threads from '@okikio/runtime/node/worker';
import * as processes from '@okikio/runtime/node/process';
import * as context from '@okikio/context';
import * as resources from '@okikio/capability/resource';
import * as workflow from '@okikio/workflow';
import * as postgres from '@okikio/storage/workflow/postgres';
import { Child, ChildLive, Engine, InputSchema, Parent, ParentLive, Policy, Work } from './session-contract.ts';

const sql = postgresjs(process.env.DATABASE_URL!, { max: 8, onnotice() {} });
try {
	await using ctx = context.create({ id: 'session-coordinator' });
	await using collection = resources.create(resources.implementations(), { ctx, host: {} });
	const kind = process.env.SESSION_KIND === 'thread' ? 'thread' : 'process';
	const target = `${kind}:sessions`;
	const selection = process.env.POOL_SELECTION === '1';
	const limits = selection ? { maximum: 2, minimum: 2, concurrency: 1 } : { maximum: 1, concurrency: 4 };
	const env = { ...process.env, SESSION_TARGET: target };
	await using provider = kind === 'thread'
		? await worker.create({
			ctx,
			engine: Engine,
			activities: [Work],
			...limits,
			maximumWaiting: 8,
			shutdownMs: 3000,
			module: new URL(process.env.SESSION_THREAD_MODULE ?? './session-thread.ts', import.meta.url),
			create: (module) => threads.create(module, { env }),
		})
		: await child.create({
			ctx,
			engine: Engine,
			activities: [Work],
			...limits,
			maximumWaiting: 8,
			adapter: processes.create(),
			start: {
				command: process.execPath,
				arguments: [new URL(process.env.SESSION_PROCESS_MODULE ?? './session-process.ts', import.meta.url).pathname],
				env,
				stderr: { type: 'capture', maximumBytes: 8192 },
				shutdown: { graceMs: 3000, forceMs: 1000 },
			},
		});
	await using store = postgres.open({ database: sql, namespace: process.env.SESSION_NAMESPACE! });
	const stop = new AbortController();
	const compute = { id: target, generation: 1 };
	await using serving = await workflow.serve({
		store,
		resources: collection,
		engine: Engine,
		policies: [Policy],
		workflows: [ParentLive, ChildLive],
		activities: [],
		engines: [{ engine: Engine, provider, capacity: 4 }],
		hostId: 'sessions',
		compute,
		shutdown: stop.signal,
		pollIntervalMs: 25,
		capacity: { activations: 2, activities: 4, finalizers: 1, control: 1 },
	});
	await using scheduler = workflow.scheduler({
		async command(parent, command) {
			if (command.type !== 'child-workflow' || command.workflow !== Child) throw new Error('Unexpected child.');
			await using ctx = await workflow.context({
				definition: Child,
				input: command.input,
				runId: crypto.randomUUID(),
				ctx: parent,
			});
			return workflow.success(
				await workflow.run({
					ctx,
					scheduler,
					implementation: workflow.implement(Child, function* (ctx) {
						return yield* workflow.placement.scope(command.options.location!, ChildLive.program(ctx));
					}),
				}),
			);
		},
	});
	await using _registration = await scheduler.register({
		engine: Engine,
		provider,
		hostId: 'sessions',
		capacity: 4,
		compute,
	});
	const client = workflow.client({ store, policy: Policy });
	const server = createServer((request, response) => {
		if (request.url === '/hosts') {
			response.end(JSON.stringify(provider.hosts()));
			return;
		}
		if (request.url === '/ready') {
			response.end(String(process.pid));
			return;
		}
		void (async () => {
			const parts: Buffer[] = [];
			let bytes = 0;
			for await (const part of request) {
				const chunk = Buffer.from(part);
				bytes += chunk.byteLength;
				if (bytes > 8192) throw new Error('Input exceeds 8192 bytes.');
				parts.push(chunk);
			}
			const input = InputSchema.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
			if (request.url === '/retire') {
				if (!input.host) throw new Error('Host reference required.');
				await provider.retire(input.host);
				return { status: 'retired' };
			}
			const location = input.reference
				? workflow.placement.session(input.reference)
				: input.host
				? workflow.placement.host(compute, input.host)
				: workflow.placement.on(compute);
			if (request.url === '/durable') {
				const ref = await client.trigger(Parent, input, { scope: 'session', key: crypto.randomUUID(), location });
				return await client.wait(Parent, ref, { signal: AbortSignal.timeout(15000), intervalMs: 10 });
			}
			await using run = await workflow.context({ definition: Parent, input, runId: crypto.randomUUID(), ctx });
			return await workflow.run({
				ctx: run,
				scheduler,
				implementation: workflow.implement(Parent, function* (ctx) {
					return yield* workflow.placement.scope(location, ParentLive.program(ctx));
				}),
			});
		})().then((result) => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(result));
		}, (error: unknown) => {
			response.statusCode = 500;
			response.end(String(error));
		});
	});
	const shutdown = () => {
		server.close();
		stop.abort();
	};
	process.once('SIGTERM', shutdown);
	try {
		await new Promise<void>((resolve) => server.listen(Number(process.env.PORT ?? 0), '0.0.0.0', resolve));
		const address = server.address();
		console.log(`session-ready:${typeof address === 'object' && address ? address.port : ''}`);
		await serving.closed;
	} finally {
		server.close();
		process.off('SIGTERM', shutdown);
	}
} finally {
	await sql.end({ timeout: 2 });
}
