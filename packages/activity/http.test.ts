/** Real HTTP requests verify credential, bounded admission, and uncertain-result behavior. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as resource from '@okikio/capability/resource';
import * as local from './local.ts';
import type { ActivityAttemptType, EngineProvider } from '@okikio/workflow';
import * as activity from './mod.ts';
import * as engine from './engine.ts';
import * as http from './http.ts';

const Engine = engine.define({ id: 'http.test' });
const Add = activity.define({
	id: 'http.add',
	version: '1',
	input: codec.identity(schema.number()),
	result: codec.identity(schema.number()),
	placement: engine.require(Engine),
});
const control = {
	async heartbeat(): Promise<void> {
		throw new Error('Must not renew a remote lease locally.');
	},
};

/** Keep the caller's fenced attempt unchanged through the wire boundary. */
function attempt(ctx: context.Context): ActivityAttemptType {
	return {
		jobId: 'job',
		claimId: 'claim',
		attempt: 1,
		generation: 1,
		activityId: Add.id,
		activityVersion: Add.version,
		engineId: Engine.id,
		registrationId: 'registration',
		hostId: 'host',
		origin: {
			workflowId: 'workflow',
			workflowVersion: '1',
			runId: 'run',
			instructionPath: '0',
			instructionFingerprint: 'fingerprint',
		},
		context: context.snapshot(ctx),
		input: 4,
		admitted: true,
	};
}

/** Own a real loopback listener; tests always join closure before releasing its port. */
async function listen(handler: (request: Request) => Promise<Response>) {
	const server = createServer(async (incoming, outgoing) => {
		const disconnected = new AbortController();
		outgoing.on('close', () => {
			if (!outgoing.writableFinished) disconnected.abort();
		});
		try {
			const chunks: Buffer[] = [];
			for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
			const request = new Request(`http://localhost${incoming.url}`, {
				method: incoming.method,
				headers: new Headers(incoming.headers as Record<string, string>),
				body: Buffer.concat(chunks),
				signal: disconnected.signal,
			});
			const result = await handler(request);
			outgoing.writeHead(result.status, Object.fromEntries(result.headers));
			outgoing.end(Buffer.from(await result.arrayBuffer()));
		} catch {
			outgoing.writeHead(500);
			outgoing.end();
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/attempt`,
		async [Symbol.asyncDispose]() {
			// Stop admission before closing sockets; Bun also requires this listener ownership order.
			await new Promise<void>((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
				server.closeAllConnections();
			});
		},
	};
}

function provider(
	run: EngineProvider['run'] = async (_ctx, value) => ({ type: 'success', value: Number(value.input) + 1 }),
): EngineProvider {
	return { activities: [Add], run };
}

const credentials = { authorization: 'Bearer test-only' };
const authenticate = (request: Request) => request.headers.get('authorization') === credentials.authorization;

function client(url: string, headers: HeadersInit = credentials) {
	return http.create({ engine: Engine, activities: [Add], url, headers: () => headers, allowLoopbackHttp: true });
}

describe('authenticated unary HTTP activities', () => {
	it('executes a real request and validates the exact result contract', async () => {
		await using ctx = context.create({ id: 'http-success' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const live = local.create({
			engine: Engine,
			implementations: [activity.implement(Add, {
				async run(ctx) {
					return ctx.input + 1;
				},
			})],
			resources,
		});
		await using server = await listen(
			http.handler({
				provider: live,
				activities: [Add],
				authenticate,
				authorize: (_request, value) => value.claimId === 'claim',
			}),
		);
		expect(await client(server.url).run(ctx, attempt(ctx), control)).toEqual({ type: 'success', value: 5 });
	});

	it('denies credentials and attempt authorization before execution', async () => {
		let calls = 0;
		const live = provider(async () => {
			calls++;
			return { type: 'success', value: 5 };
		});
		await using ctx = context.create({ id: 'http-denied' });
		await using server = await listen(
			http.handler({ provider: live, activities: [Add], authenticate, authorize: () => false }),
		);
		for (const headers of [{}, credentials]) {
			const result = await client(server.url, headers).run(ctx, attempt(ctx), control);
			expect(result.type).toBe('lost');
			if (result.type === 'lost') expect(result.reason).toBeInstanceOf(http.HttpActivityError);
		}
		expect(calls).toBe(0);
	});

	it('authenticates before parsing, rejects malformed and oversized bodies', async () => {
		const handle = http.handler({
			provider: provider(),
			activities: [Add],
			authenticate,
			authorize: () => true,
			maximumBytes: 1024,
		});
		const request = (body: string, authorized = true) =>
			new Request('https://example.test/attempt', {
				method: 'POST',
				headers: {
					...(authorized ? credentials : {}),
					'content-type': 'application/json',
					'x-okikio-activity-version': '1',
				},
				body,
			});
		expect((await handle(request('{', false))).status).toBe(401);
		await using server = await listen(handle);
		expect((await fetch(server.url, request('{'))).status).toBe(400);
		expect((await fetch(server.url, request(' '.repeat(1025)))).status).toBe(413);
	});

	it('does not accept malformed, oversized, or wrong-contract success responses', async () => {
		await using ctx = context.create({ id: 'http-invalid-response' });
		for (const body of ['{', JSON.stringify({ type: 'success', value: 'wrong' }), ' '.repeat(1025)]) {
			await using server = await listen(async () =>
				new Response(body, {
					headers: { 'content-type': 'application/json', 'x-okikio-activity-version': '1' },
				})
			);
			const remote = http.create({
				engine: Engine,
				activities: [Add],
				url: server.url,
				headers: () => credentials,
				allowLoopbackHttp: true,
				maximumBytes: 1024,
			});
			expect((await remote.run(ctx, attempt(ctx), control)).type).toBe('lost');
		}
	});

	it('does not dispatch work when cancellation already happened', async () => {
		let calls = 0;
		const stopped = new AbortController();
		stopped.abort('already stopped');
		await using ctx = context.create({ id: 'http-pre-cancel', signal: stopped.signal });
		await using server = await listen(async () => {
			calls++;
			return new Response(null, { status: 500 });
		});
		expect((await client(server.url).run(ctx, attempt(ctx), control)).type).toBe('cancelled');
		expect(calls).toBe(0);
	});

	it('keeps capacity reserved while work waits and rejects excess admission', async () => {
		let release!: () => void;
		let started!: () => void;
		const admitted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		await using ctx = context.create({ id: 'http-capacity' });
		await using server = await listen(http.handler({
			provider: provider(async () => {
				started();
				await waiting;
				return { type: 'success', value: 5 };
			}),
			activities: [Add],
			authenticate,
			authorize: () => true,
			concurrency: 1,
		}));
		const first = client(server.url).run(ctx, attempt(ctx), control);
		try {
			await admitted;
			const second = await client(server.url).run(ctx, attempt(ctx), control);
			expect(second.type).toBe('lost');
			if (second.type === 'lost') expect((second.reason as http.HttpActivityError).status).toBe(503);
		} finally {
			release();
		}
		expect((await first).type).toBe('success');
	});

	it('never acknowledges heartbeat without the actual claim authority', async () => {
		await using ctx = context.create({ id: 'http-heartbeat' });
		await using server = await listen(http.handler({
			provider: provider(async (_ctx, _attempt, host) => {
				await host.heartbeat();
				return { type: 'success', value: 5 };
			}),
			activities: [Add],
			authenticate,
			authorize: () => true,
		}));
		expect((await client(server.url).run(ctx, attempt(ctx), control)).type).toBe('lost');
	});

	it('reports cancellation after dispatch as uncertain and joins host cleanup', async () => {
		let started!: () => void;
		let cleaned!: () => void;
		const admitted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const cleanup = new Promise<void>((resolve) => {
			cleaned = resolve;
		});
		const controller = new AbortController();
		await using ctx = context.create({ id: 'http-cancel', signal: controller.signal });
		await using server = await listen(http.handler({
			provider: provider(async (host) => {
				started();
				try {
					await new Promise<void>((resolve) => {
						if (host.signal.aborted) resolve();
						else host.signal.addEventListener('abort', () => resolve(), { once: true });
					});
				} finally {
					cleaned();
				}
				return { type: 'cancelled', reason: 'disconnected' };
			}),
			activities: [Add],
			authenticate,
			authorize: () => true,
		}));
		const pending = client(server.url).run(ctx, attempt(ctx), control);
		await admitted;
		controller.abort('caller stopped');
		expect((await pending).type).toBe('lost');
		await cleanup;
	});

	it('rejects insecure non-loopback endpoints and credential redirects without retry', async () => {
		expect(() => client('http://example.test/attempt')).toThrow(TypeError);
		let requests = 0;
		await using ctx = context.create({ id: 'http-redirect' });
		await using server = await listen(async () => {
			requests++;
			return Response.redirect('https://example.test/', 307);
		});
		expect((await client(server.url).run(ctx, attempt(ctx), control)).type).toBe('lost');
		expect(requests).toBe(1);
	});
});
