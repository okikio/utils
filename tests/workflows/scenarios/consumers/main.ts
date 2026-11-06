/** Explicit service, worker, process and thread entrypoints for the recovery suite. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as processes from '@okikio/activity/process';
import * as threads from '@okikio/activity/worker';
import * as deno from '@okikio/runtime/deno/process';
import * as signals from '@okikio/runtime/deno/signals';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as resource from '@okikio/capability/resource';
import * as http from '@okikio/server/http';
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';
import * as response from '@okikio/http/response';
import * as schemaCore from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import postgresjs from 'postgres';
import { configure, getLogger, getStreamSink, reset } from '@logtape/logtape';
import {
	Analyze,
	Approved,
	Clean,
	Database,
	Import,
	imports,
	InputSchema,
	knowledge,
	Notify,
	Policy,
	Process,
	Research,
	research,
	Thread,
	Write,
} from './contracts.ts';
import { analyze, clean, notify, write } from './activities.ts';

const url = Deno.env.get('DATABASE_URL');
const namespace = Deno.env.get('CONSUMER_NAMESPACE');
if (!url || !namespace) throw new Error('DATABASE_URL and CONSUMER_NAMESPACE are required.');
const role = new URL(import.meta.url).searchParams.get('role') ?? Deno.args[0] ?? 'thread';
const sql = postgresjs(url, { max: 4, onnotice() {} });
// Keep stdout exclusively for the process protocol or the test startup message.
await configure({
	sinks: { stderr: getStreamSink(Deno.stderr.writable, { closeStream: false }) },
	loggers: [
		{ category: ['consumer'], lowestLevel: 'info', sinks: ['stderr'] },
		{ category: ['utils'], lowestLevel: 'info', sinks: ['stderr'] },
		{ category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
	],
});
const log = getLogger(['consumer']);
try {
	await using owner = context.create({ id: `${role}:${crypto.randomUUID()}` });
	await using resources = resource.create(
		resource.implementations(resource.implement(Database, { create: () => ({ sql, namespace }) })),
		{ ctx: owner, host: {} },
	);
	if (role === 'process') {
		await using server = processes.serve({
			engine: Process,
			implementations: [write, clean, notify],
			resources,
			input: Deno.stdin.readable,
			output: Deno.stdout.writable,
		});
		await server.closed;
	} else if (role === 'thread') {
		await using server = threads.serve({ engine: Thread, implementations: [analyze], resources });
		await server.closed;
	} else if (role === 'host') {
		await using store = postgres.open({ database: sql, namespace });
		await using process = await processes.create({
			ctx: owner,
			engine: Process,
			activities: [Write, Clean, Notify],
			adapter: deno.create(),
			start: {
				command: Deno.execPath(),
				arguments: ['run', '-A', new URL('./main.ts', import.meta.url).pathname, 'process'],
				stderr: { type: 'inherit' },
			},
			maximum: 3,
		});
		await using thread = await threads.create({
			ctx: owner,
			engine: Thread,
			activities: [Analyze],
			module: new URL('./main.ts?role=thread', import.meta.url),
			maximum: 2,
		});
		await using shutdown = context.create({ id: 'consumer.shutdown' });
		signals.attach(shutdown);
		{
			await using worker = await workflow.serve({
				store,
				resources,
				policies: [Policy],
				hostId: owner.id,
				workflows: [imports, research, knowledge],
				activities: [],
				engines: [{ engine: Process, provider: process, capacity: 3, reserved: 1 }, {
					engine: Thread,
					provider: thread,
					capacity: 2,
				}],
				capacity: { activations: 2, activities: 4, control: 1, finalizers: 1 },
				shutdown: shutdown.signal,
				pollIntervalMs: 100,
			});
			const client = workflow.client({ store, policy: Policy });
			const Client = resource.define<{ client: typeof client }>({
				id: 'consumer.client',
				description: 'Borrow the workflow client.',
			});
			const Accepted = response.accepted(workflow.ReferenceSchema, { description: 'Accepted work.' });
			const Sent = response.ok(schemaCore.boolean(), { description: 'Accepted event.' });
			const Snapshot = response.ok(workflow.SnapshotSchema, { description: 'Saved work and progress.' });
			const StartImport = endpoint.post({
				id: 'consumer.import.start',
				path: '/imports',
				json: InputSchema,
				resources: [Client],
				responses: [Accepted],
			});
			const StartResearch = endpoint.post({
				id: 'consumer.research.start',
				path: '/research',
				json: InputSchema,
				resources: [Client],
				responses: [Accepted],
			});
			const RefSchema = schemaCore.transform(schemaCore.unknown(), (value) => workflow.ReferenceSchema.parse(value));
			const Send = endpoint.post({
				id: 'consumer.send',
				path: '/events',
				json: schemaCore.object({ ref: RefSchema, value: schemaCore.boolean() }),
				resources: [Client],
				responses: [Sent],
			});
			const Status = endpoint.post({
				id: 'consumer.status',
				path: '/status',
				json: schemaCore.object({ ref: RefSchema }),
				resources: [Client],
				responses: [Snapshot],
			});
			const Api = service.define({
				id: 'consumer.api',
				path: '/',
				endpoints: [StartImport, StartResearch, Send, Status],
			});
			const implementation = service.implement(Api, {
				resources: resource.implementations(resource.implement(Client, { create: () => ({ client }) })),
				endpoints: [
					endpoint.handler(
						StartImport,
						async ({ input, resources }) =>
							response.create(
								Accepted,
								await (await resources.get(Client)).client.trigger(Import, input.json, {
									scope: 'workspace',
									key: input.json.source,
								}),
							),
					),
					endpoint.handler(
						StartResearch,
						async ({ input, resources }) =>
							response.create(
								Accepted,
								await (await resources.get(Client)).client.trigger(Research, input.json, {
									scope: 'workspace',
									key: input.json.source,
								}),
							),
					),
					endpoint.handler(Send, async ({ input, resources }) => {
						if (input.json.ref.namespace !== namespace || input.json.ref.scope !== 'workspace') {
							throw new Error('Wrong scope.');
						}
						await (await resources.get(Client)).client.send(input.json.ref, Approved, input.json.value);
						return response.create(Sent, true);
					}),
					endpoint.handler(Status, async ({ input, resources }) => {
						if (input.json.ref.namespace !== namespace || input.json.ref.scope !== 'workspace') {
							throw new Error('Wrong scope.');
						}
						const definition = input.json.ref.definition.id === Import.id ? Import : Research;
						return response.create(
							Snapshot,
							await (await resources.get(Client)).client.get(definition, input.json.ref, { children: true }),
						);
					}),
				],
			});
			await using runtime = service.create(service.compile(implementation), { host: {} });
			const app = http.create({
				routes: [
					http.route('GET', '/ready', async () => {
						const result = await worker.check({ signal: AbortSignal.timeout(2000) });
						return Response.json(result, { status: result.ready ? 200 : 503 });
					}),
					http.mount('/', runtime.fetch),
				],
			});
			const listener = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, app.fetch);
			log.info('Worker and service started for {namespace}.', { namespace });
			console.log(JSON.stringify({ ready: true, port: listener.addr.port }));
			try {
				await worker.closed;
			} finally {
				await listener.shutdown();
			}
		}
	} else throw new Error('Unknown consumer role.');
} finally {
	try {
		await sql.end({ timeout: 2 });
	} finally {
		await reset();
	}
}
