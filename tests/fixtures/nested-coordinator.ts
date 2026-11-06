/** A disposable durable executor used directly and bundled into actual containers. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { createServer } from 'node:http';
import process from 'node:process';
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as workflow from '@okikio/workflow';
import { ChildLive, compute, Engine, ParentLive, Policy } from './nested-contract.ts';
import { open, run, scheduler } from './nested-host.ts';

const database = postgresjs(process.env.DATABASE_URL!, { max: 8, onnotice() {} });
try {
	await using owner = context.create({ id: 'nested-coordinator' });
	await using resources = resource.create(resource.implementations(), { ctx: owner, host: {} });
	await using provider = await open(
		owner,
		process.env.PLACEMENT_KIND === 'thread' ? 'thread' : 'process',
		process.env.PLACEMENT_OWNER!,
	);
	await using store = postgres.open({ database, namespace: process.env.WORKFLOW_NAMESPACE! });
	const shutdown = new AbortController();
	await using serving = await workflow.serve({
		store,
		resources,
		engine: Engine,
		workflows: [ParentLive, ChildLive],
		activities: [],
		policies: [Policy],
		engines: [{ engine: Engine, provider, capacity: 2 }],
		hostId: process.env.PLACEMENT_OWNER!,
		compute: compute(process.env.PLACEMENT_OWNER!, process.env.PLACEMENT_KIND === 'thread' ? 'thread' : 'process'),
		shutdown: shutdown.signal,
		pollIntervalMs: 25,
		capacity: { activations: 1, activities: 2, finalizers: 1, control: 1 },
	});
	const server = createServer((request, response) => {
		if (request.url !== '/memory') {
			response.end('ready');
			return;
		}
		void (async () => {
			const kind = process.env.PLACEMENT_KIND === 'thread' ? 'thread' : 'process';
			await using local = scheduler();
			await using registration = await local.register({
				engine: Engine,
				provider,
				capacity: 2,
				hostId: process.env.PLACEMENT_OWNER!,
				compute: compute(process.env.PLACEMENT_OWNER!, kind),
			});
			void registration;
			return await run(
				owner,
				local,
				workflow.placement.on({ id: `${kind}:${process.env.PLACEMENT_OWNER}`, generation: 1 }),
			);
		})().then((receipts) => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(receipts));
		}, (error: unknown) => {
			response.statusCode = 500;
			response.end(String(error));
		});
	});
	const signal = () => {
		server.close();
		shutdown.abort();
	};
	process.once('SIGTERM', signal);
	try {
		if (process.env.PORT) {
			await new Promise<void>((resolve) => server.listen(Number(process.env.PORT), '0.0.0.0', resolve));
		}
		console.log('nested-ready');
		await serving.closed;
	} finally {
		server.close();
		process.off('SIGTERM', signal);
	}
} finally {
	await database.end({ timeout: 2 });
}
