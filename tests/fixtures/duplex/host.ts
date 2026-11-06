/** The actual container application: native HTTP sockets, local activities and borrowed caller authority. @module */
import '@okikio/dispose/polyfill';
import process from 'node:process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import * as context from '@okikio/context';
import * as activity from '@okikio/activity';
import * as local from '@okikio/activity/local';
import * as duplex from '@okikio/activity/http/duplex';
import * as permission from '@okikio/authz/permission';
import * as effect from '@okikio/capability/effect';
import * as resource from '@okikio/capability/resource';
import * as json from '@okikio/streams/json';
import * as schema from '@okikio/schema';
import { Effect, Engine, Permission, Work } from './contracts.ts';

const token = process.env.DUPLEX_TOKEN;
if (!token) throw new Error('The owned container requires its per-run credential.');
const allowedOrigin = process.env.DUPLEX_ORIGIN;
const started: string[] = [], closed: string[] = [], cleanup: string[] = [], failed: string[] = [];
const active = new Set<string>();
/** Waiting is published only after all requested heartbeats were acknowledged by the host. */
const waiting = new Set<string>();
/** Manual cleanup deliberately holds the activity's owned scope until the external test releases it. */
const releases = new Map<string, () => void>();
let preflights = 0, authenticatedPosts = 0, deniedOrigins = 0;
/** Retain only recent receipts so repeated benchmark attempts cannot grow fixture memory without bound. */
function remember(values: string[], id: string): void {
	values.push(id);
	if (values.length > 256) values.shift();
}
await using owner = context.create({ id: 'duplex-container-host' });
await using resources = resource.create(resource.implementations(), { ctx: owner, host: {} });
const implementation = activity.implement(Work, {
	async run(ctx) {
		const { id, mode, cleanup: policy, calls = 1 } = ctx.input;
		if (started.includes(id)) throw new Error('Scenario identities must be unique within this fixture.');
		remember(started, id);
		active.add(id);
		const released = policy === 'manual'
			? new Promise<void>((resolve) => {
				releases.set(id, resolve);
			})
			: Promise.resolve();
		try {
			for (let index = 0; index < calls; index++) await ctx.heartbeat({ id, index });
			if (mode === 'wait') {
				waiting.add(id);
				if (!ctx.signal.aborted) {
					await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
				}
				throw ctx.signal.reason;
			}
			await permission.assert(ctx, Permission, id);
			await effect.emit(ctx, Effect, { id }, { key: id });
			return { id, pid: process.pid };
		} finally {
			remember(cleanup, id);
			await released;
			releases.delete(id);
			waiting.delete(id);
			active.delete(id);
			if (policy === 'failure') {
				remember(failed, id);
				// Deliberately replace cancellation with a cleanup fault to test terminal ownership.
				// deno-lint-ignore no-unsafe-finally
				throw new Error('The fixture provider failed during cleanup.');
			}
			remember(closed, id);
		}
	},
});
const accept = duplex.handler({
	provider: local.create({ engine: Engine, implementations: [implementation], resources }),
	activities: [Work],
	concurrency: 2,
	maximumPending: 8,
	maximumCalls: 64,
	timeoutMs: 20_000,
	cleanupMs: 5_000,
	authenticate(request) {
		const valid = request.headers.get('authorization') === `Bearer ${token}`;
		if (valid) authenticatedPosts++;
		return valid;
	},
	// This isolated fixture accepts only its exact declared contract and stable live generation.
	// Production callers must additionally consult their own durable tenant/claim authority.
	authorize: (_request, attempt) =>
		attempt.engineId === Engine.id && attempt.activityId === Work.id && attempt.generation === 1,
});
const ReleaseSchema = schema.object({ id: schema.string({ minLength: 1, maxLength: 128 }) });

/** Apply exact-origin policy before auth/body parsing, then add readable protocol response headers. */
async function route(request: Request): Promise<Response> {
	const origin = request.headers.get('origin');
	if (origin && origin !== allowedOrigin) {
		deniedOrigins++;
		return new Response(null, { status: 403, headers: { vary: 'Origin', 'cache-control': 'no-store' } });
	}
	const headers = new Headers({ vary: 'Origin' });
	if (origin) {
		headers.set('access-control-allow-origin', origin);
		headers.set('access-control-allow-methods', 'POST, GET, OPTIONS');
		headers.set(
			'access-control-allow-headers',
			'authorization, content-type, x-okikio-activity-version, x-okikio-activity-operation',
		);
		headers.set('access-control-expose-headers', 'x-okikio-activity-version');
	}
	let result: Response;
	const path = new URL(request.url).pathname;
	if (request.method === 'OPTIONS') {
		preflights++;
		result = new Response(null, { status: origin ? 204 : 400 });
	} else if (path === '/ready') result = new Response('ready');
	else if (request.headers.get('authorization') !== `Bearer ${token}`) result = new Response(null, { status: 401 });
	else if (path === '/metrics' && request.method === 'GET') {
		result = Response.json({
			pid: process.pid,
			runtime: process.version,
			started,
			active: [...active],
			waiting: [...waiting],
			cleanup,
			closed,
			failed,
			preflights,
			authenticatedPosts,
			deniedOrigins,
		});
	} else if (path === '/release' && request.method === 'POST' && request.body) {
		const { id } = await schema.parse(ReleaseSchema, await json.read(request.body, 1024, request.signal));
		const release = releases.get(id);
		if (!release) result = new Response(null, { status: 404 });
		else {
			release();
			result = new Response(null, { status: 204 });
		}
	} else if (path === '/shutdown' && request.method === 'POST') {
		for (const release of releases.values()) release();
		await accept.close();
		await resources[Symbol.asyncDispose]();
		await owner[Symbol.asyncDispose]();
		result = new Response(null, { status: 204 });
	} else if (path === '/attempt') result = await accept(request);
	else result = new Response(null, { status: 404 });
	for (const [key, value] of headers) result.headers.set(key, value);
	return result;
}

const server = createServer(async (incoming, outgoing) => {
	const disconnected = new AbortController();
	outgoing.on('close', () => {
		if (!outgoing.writableFinished) disconnected.abort();
	});
	try {
		const headers = new Headers();
		for (const [key, value] of Object.entries(incoming.headers)) {
			if (Array.isArray(value)) { for (const item of value) headers.append(key, item); }
			else if (value !== undefined) headers.set(key, value);
		}
		const options: RequestInit & { duplex: 'half' } = {
			method: incoming.method,
			headers,
			signal: disconnected.signal,
			duplex: 'half',
			...(['GET', 'HEAD'].includes(incoming.method ?? 'GET')
				? {}
				: { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array> }),
		};
		const response = await route(new Request(`http://fixture${incoming.url}`, options));
		outgoing.writeHead(response.status, Object.fromEntries(response.headers));
		outgoing.flushHeaders();
		if (response.body) {
			for await (const chunk of response.body) {
				if (!outgoing.write(chunk)) await once(outgoing, 'drain', { signal: disconnected.signal });
			}
		}
		outgoing.end();
	} catch {
		if (!outgoing.headersSent) outgoing.writeHead(500);
		outgoing.end();
	}
});
server.requestTimeout = 10_000;
server.listen(8080, '0.0.0.0');
await once(server, 'listening');
console.log(JSON.stringify({ ready: true, pid: process.pid, runtime: process.version }));
// This application's lifetime is the container lifetime. The harness drains /shutdown before stopping its PID.
await new Promise<void>((resolve) => server.once('close', () => resolve()));
