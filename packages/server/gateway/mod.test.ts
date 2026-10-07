import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/resource';
import * as service from '../service/mod.ts';
import * as gateway from './mod.ts';

const Body: StandardSchemaV1<unknown, { ok: boolean }> = {
	'~standard': { version: 1, vendor: 'test', validate: (value) => ({ value: value as { ok: boolean } }) },
};
const Ok = response.ok(Body, { id: 'test:ok', description: 'Successful response.' });
const Public = endpoint.post({ id: 'test.public', path: '/items', raw: Body, responses: [Ok] });
const serviceDefinition = service.define({ id: 'test-service', path: '/api/v1', endpoints: [Public] });
const serviceHandler = endpoint.handler(Public, async () => response.create(Ok, { ok: true }));
const compiledService = service.compile(service.implement(serviceDefinition, {
	endpoints: [serviceHandler],
	resources: resource.implementations(),
}));
const authentication = Object.freeze({ id: 'gateway.authentication', kind: 'authentication' });
const assertion = Object.freeze({ id: 'gateway.assertion', kind: 'authentication' });
const Observer = gateway.observer.define({
	id: 'gateway.telemetry',
	description: 'Records redacted gateway lifecycle events.',
});

function gatewayDefinition(options: Readonly<{
	readonly credentials?: gateway.GatewayCredentialPolicy;
	readonly redirects?: gateway.GatewayRedirectPolicy;
	readonly timeout?: Temporal.Duration;
	readonly observers?: boolean;
	readonly cache?: gateway.GatewayCachePolicy;
}> = {}) {
	return gateway.define({
		id: 'public-gateway',
		services: [gateway.mount(serviceDefinition, { origin: 'http://127.0.0.1:8787' })],
		policies: [gateway.policy({
			id: 'public-policy',
			endpoints: [Public],
			authenticate: authentication,
			assertion,
			bodyLimit: 16,
			cache: options.cache ?? gateway.noStore(),
			...(options.credentials === undefined ? {} : { credentials: options.credentials }),
			...(options.redirects === undefined ? {} : { redirects: options.redirects }),
			...(options.timeout === undefined ? {} : { timeout: options.timeout }),
		})],
		observers: options.observers ? [Observer] : [],
	});
}

function adapters() {
	return {
		authenticate: () => ({ headers: { 'x-trusted-actor': 'actor_1' } }),
		assert: () => ({ headers: { 'x-trusted-assertion': 'signed' } }),
	};
}

/** Join test-owned work without erasing its original thrown value. */
function settle<Value>(work: Promise<Value>): Promise<
	| Readonly<{ status: 'fulfilled'; value: Value }>
	| Readonly<{ status: 'rejected'; reason: unknown }>
> {
	return work.then(
		(value) => ({ status: 'fulfilled', value } as const),
		(reason: unknown) => ({ status: 'rejected', reason } as const),
	);
}

describe('gateway request preparation', () => {
	it('rebuilds transport trust metadata for host-owned continuation routes', async () => {
		const prepared = await gateway.prepare(
			new Request('https://app.example.invalid/start', {
				headers: {
					authorization: 'Bearer session',
					cookie: 'session=1',
					'clerk-secret-key': 'spoofed',
					'x-forwarded-for': '198.51.100.8',
					'x-real-ip': '203.0.113.9',
					'x-product-assertion': 'spoofed',
				},
			}),
			{
				requestId: () => 'request-1',
				clientIp: (request) => request.headers.get('x-real-ip') ?? undefined,
				metadataHeaders: { requestId: 'x-product-request-id' },
				trustedRequestHeaders: ['clerk-secret-key'],
				trustedRequestHeaderPrefixes: ['x-product-'],
			},
		);

		expect(prepared.requestId).toBe('request-1');
		expect(prepared.request.headers.get('authorization')).toBe('Bearer session');
		expect(prepared.request.headers.get('cookie')).toBe('session=1');
		expect(prepared.request.headers.get('clerk-secret-key')).toBeNull();
		expect(prepared.request.headers.get('x-product-assertion')).toBeNull();
		expect(prepared.request.headers.get('x-real-ip')).toBeNull();
		expect(prepared.request.headers.get('x-forwarded-for')).toBe('203.0.113.9');
		expect(prepared.request.headers.get('x-forwarded-host')).toBe('app.example.invalid');
		expect(prepared.request.headers.get('x-forwarded-proto')).toBe('https');
		expect(prepared.request.headers.get('x-request-id')).toBe('request-1');
		expect(prepared.request.headers.get('x-product-request-id')).toBe('request-1');
		expect(prepared.request.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
	});
});

describe('gateway compiler', () => {
	it('derives route ownership and security policy from imported service definitions', () => {
		const compiled = gateway.compile(gatewayDefinition());
		expect(compiled.routes[0]).toMatchObject({
			serviceId: 'test-service',
			endpointId: 'test.public',
			path: '/api/v1/items',
			origin: 'http://127.0.0.1:8787',
			credentials: {
				requestCookies: 'strip',
				requestAuthorization: 'strip',
				responseCookies: 'strip',
			},
			redirects: { mode: 'rewrite-origin' },
		});
		expect(compiled.manifest.routes[0]?.authentication).toEqual(['gateway.authentication']);
	});

	it('uses optional compiled service manifests only to detect definition drift', () => {
		const manifest = Object.freeze(
			{
				...compiledService.manifest,
				routes: Object.freeze(compiledService.manifest.routes.map((route) =>
					Object.freeze({
						...route,
						operationId: `${route.operationId}.stale`,
					})
				)),
			} satisfies service.ServiceManifest,
		);
		expect(() => gateway.compile(gatewayDefinition(), { services: [manifest] })).toThrow(
			gateway.GatewayCompilationError,
		);
	});

	it('rejects conflicting credential policies for one route', () => {
		const definition = gateway.define({
			id: 'conflict-gateway',
			services: [gateway.mount(serviceDefinition, { origin: 'http://127.0.0.1:8787' })],
			policies: [
				gateway.policy({ id: 'strip', endpoints: [Public], credentials: gateway.credentials() }),
				gateway.policy({
					id: 'preserve',
					endpoints: [Public],
					credentials: gateway.credentials({ requestCookies: 'preserve' }),
				}),
			],
		});
		expect(() => gateway.compile(definition, { services: [compiledService] })).toThrow(gateway.GatewayCompilationError);
	});
});

describe('gateway request and response policy', () => {
	it('strips caller credentials, spoofable trust fields, and replaces trace context', async () => {
		const compiled = gateway.compile(
			gatewayDefinition({
				credentials: gateway.credentials({
					requestCookies: 'strip',
					requestAuthorization: 'strip-after-authentication',
					responseCookies: 'preserve',
				}),
			}),
			{ services: [compiledService] },
		);
		let forwarded: Request | undefined;
		const runtime = gateway.create(compiled, {
			requestId: () => 'request_1',
			clientIp: () => '203.0.113.9',
			trustedRequestHeaderPrefixes: ['x-trusted-'],
			adapters: adapters(),
			fetch: async (input, init) => {
				forwarded = input instanceof Request ? input : new Request(input, init);
				const headers = new Headers({ connection: 'close', 'x-upstream': 'kept' });
				headers.append('Set-Cookie', 'first=1; Path=/');
				headers.append('Set-Cookie', 'second=2; Path=/');
				return new Response('ok', { headers });
			},
		});
		const body = new Uint8Array([0, 1, 2, 3]);
		const result = await runtime.fetch(
			new Request('http://localhost/api/v1/items', {
				method: 'POST',
				headers: {
					'x-trusted-actor': 'spoofed',
					'x-forwarded-for': 'spoofed',
					'x-real-ip': 'spoofed-real-ip',
					Authorization: 'Bearer caller-secret',
					Cookie: 'session=caller-secret',
					traceparent: '00-00000000000000000000000000000000-0000000000000000-01',
				},
				body,
			}),
		);
		expect(forwarded?.headers.get('x-trusted-actor')).toBe('actor_1');
		expect(forwarded?.headers.get('x-forwarded-for')).toBe('203.0.113.9');
		expect(forwarded?.headers.get('x-forwarded-host')).toBe('localhost');
		expect(forwarded?.headers.get('x-forwarded-proto')).toBe('http');
		expect(forwarded?.headers.get('x-real-ip')).toBeNull();
		expect(forwarded?.headers.get('authorization')).toBeNull();
		expect(forwarded?.headers.get('cookie')).toBeNull();
		expect(forwarded?.headers.get('x-request-id')).toBe('request_1');
		expect(forwarded?.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
		expect(new Uint8Array(await forwarded!.arrayBuffer())).toEqual(body);
		expect(result.headers.get('cache-control')).toBe('no-store');
		expect(result.headers.get('connection')).toBeNull();
		expect(result.headers.get('x-upstream')).toBe('kept');
		expect(result.headers.get('x-request-id')).toBe('request_1');
		const cookies = typeof result.headers.getSetCookie === 'function'
			? result.headers.getSetCookie()
			: [result.headers.get('set-cookie') ?? ''];
		expect(cookies.join('\n')).toContain('first=1');
		expect(cookies.join('\n')).toContain('second=2');
	});

	it('uses only host-selected routing metadata names and strips spoofed values', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		let forwarded: Request | undefined;
		const runtime = gateway.create(compiled, {
			requestId: () => 'request-1',
			metadataHeaders: {
				requestId: 'x-product-request-id',
				serviceId: 'x-product-service-id',
				routeId: 'x-product-route-id',
			},
			adapters: adapters(),
			fetch: async (input, init) => {
				forwarded = input instanceof Request ? input : new Request(input, init);
				return new Response('ok');
			},
		});
		const result = await runtime.fetch(
			new Request('https://gateway.example.invalid/api/v1/items', {
				method: 'POST',
				headers: { 'x-product-service-id': 'spoofed' },
			}),
		);
		expect(forwarded?.headers.get('x-product-request-id')).toBe('request-1');
		expect(forwarded?.headers.get('x-product-service-id')).toBe('test-service');
		expect(forwarded?.headers.get('x-product-route-id')).toBe(compiled.routes[0]?.id);
		expect(result.headers.get('x-product-request-id')).toBe('request-1');
	});

	it('strips response cookies by default', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			fetch: () => Promise.resolve(new Response('ok', { headers: { 'Set-Cookie': 'secret=1' } })),
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', { method: 'POST' }));
		expect(result.headers.get('set-cookie')).toBeNull();
	});

	for (const mode of ['no-store', 'pass-through'] as const) {
		it(`preserves credential and correlation policy after connection stripping with ${mode} caching`, async () => {
			const compiled = gateway.compile(
				gatewayDefinition({
					credentials: gateway.credentials({ responseCookies: 'preserve' }),
					cache: mode === 'no-store' ? gateway.noStore() : gateway.passThroughCache(),
				}),
				{ services: [compiledService] },
			);
			const upstreamHeaders = new Headers({
				connection: 'x-private-hop, x-product-request-id',
				'x-private-hop': 'must-not-pass',
				'x-product-request-id': 'untrusted',
				'cache-control': 'public, max-age=60',
				pragma: 'upstream-policy',
			});
			upstreamHeaders.append('set-cookie', 'first=1; Path=/');
			upstreamHeaders.append('set-cookie', 'second=2; Path=/');
			const runtime = gateway.create(compiled, {
				requestId: () => 'owned-request',
				metadataHeaders: { requestId: 'x-product-request-id' },
				adapters: adapters(),
				fetch: async () =>
					new Response('accepted', { status: 201, statusText: 'Accepted upstream', headers: upstreamHeaders }),
			});
			const result = await runtime.fetch(new Request('https://api.example.invalid/api/v1/items', { method: 'POST' }));
			expect(result.status).toBe(201);
			expect(result.statusText).toBe('Accepted upstream');
			expect(result.headers.get('connection')).toBeNull();
			expect(result.headers.get('x-private-hop')).toBeNull();
			expect(result.headers.get('x-request-id')).toBe('owned-request');
			expect(result.headers.get('x-product-request-id')).toBe('owned-request');
			expect(result.headers.get('cache-control')).toBe(mode === 'no-store' ? 'no-store' : 'public, max-age=60');
			expect(result.headers.get('pragma')).toBe(mode === 'no-store' ? 'no-cache' : 'upstream-policy');
			expect(result.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/']);
			expect(upstreamHeaders.get('x-product-request-id')).toBe('untrusted');
			expect(await result.text()).toBe('accepted');
		});
	}

	it('does not restore preserved cookies nominated by Connection', async () => {
		const compiled = gateway.compile(
			gatewayDefinition({
				credentials: gateway.credentials({ responseCookies: 'preserve' }),
			}),
			{ services: [compiledService] },
		);
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			fetch: async () =>
				new Response('accepted', { headers: { connection: 'set-cookie', 'set-cookie': 'hop=secret' } }),
		});
		const result = await runtime.fetch(new Request('https://api.example.invalid/api/v1/items', { method: 'POST' }));
		expect(result.headers.get('set-cookie')).toBeNull();
		expect(result.headers.get('cache-control')).toBe('no-store');
		expect(await result.text()).toBe('accepted');
	});

	it('rewrites internal redirect origins and can reject unapproved external redirects', async () => {
		const rewrite = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		const rewriteRuntime = gateway.create(rewrite, {
			adapters: adapters(),
			fetch: () =>
				Promise.resolve(
					new Response('decoded redirect body', {
						status: 302,
						headers: {
							Location: 'http://127.0.0.1:8787/next?ok=1',
							Connection: 'content-encoding',
							'Content-Encoding': 'gzip',
							'Content-Length': '1',
						},
					}),
				),
		});
		const rewritten = await rewriteRuntime.fetch(
			new Request('https://api.example.invalid/api/v1/items', { method: 'POST' }),
		);
		expect(await rewritten.text()).toBe('decoded redirect body');
		expect(rewritten.headers.get('location')).toBe('https://api.example.invalid/next?ok=1');
		expect(rewritten.headers.get('content-encoding')).toBeNull();
		expect(rewritten.headers.get('content-length')).toBeNull();

		const reject = gateway.compile(
			gatewayDefinition({
				redirects: gateway.redirects({ mode: 'reject-cross-origin' }),
				cache: gateway.passThroughCache(),
			}),
			{ services: [compiledService] },
		);
		let discardedRedirect = false;
		const rejectRuntime = gateway.create(reject, {
			requestId: () => 'rejected-request',
			metadataHeaders: { requestId: 'x-product-request-id' },
			adapters: adapters(),
			fetch: () =>
				Promise.resolve(
					new Response(
						new ReadableStream<Uint8Array>({
							cancel() {
								discardedRedirect = true;
							},
						}),
						{ status: 302, headers: { Location: 'https://evil.example/path' } },
					),
				),
		});
		const rejected = await rejectRuntime.fetch(
			new Request('https://api.example.invalid/api/v1/items', { method: 'POST' }),
		);
		expect(rejected.status).toBe(502);
		expect(discardedRedirect).toBe(true);
		// Problems own their no-store header even when upstream caching passes through.
		expect(rejected.headers.get('cache-control')).toBe('no-store');
		expect(rejected.headers.get('pragma')).toBeNull();
		expect(rejected.headers.get('x-request-id')).toBe('rejected-request');
		expect(rejected.headers.get('x-product-request-id')).toBe('rejected-request');
		expect((await rejected.json() as { type: string }).type).toContain('invalid-redirect');
	});

	it('rejects malformed Content-Length before contacting upstream', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		let upstreamCalls = 0;
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			fetch: () => {
				upstreamCalls += 1;
				return Promise.resolve(new Response('unexpected'));
			},
		});
		const result = await runtime.fetch(
			new Request('http://localhost/api/v1/items', {
				method: 'POST',
				headers: { 'content-length': '4.5' },
				body: '1234',
			}),
		);
		expect(result.status).toBe(400);
		expect((await result.json() as { type: string }).type).toBe('urn:utils:gateway:invalid-request');
		expect(upstreamCalls).toBe(0);
	});

	it('rejects bodies larger than the explicit gateway policy', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			fetch: () => Promise.resolve(new Response('unexpected')),
		});
		const result = await runtime.fetch(
			new Request('http://localhost/api/v1/items', {
				method: 'POST',
				body: 'this body exceeds sixteen bytes',
			}),
		);
		expect(result.status).toBe(413);
	});
});

describe('gateway host behavior', () => {
	it('mounts service definitions without acquiring listener or service-runtime ownership', () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			fetch: () => Promise.resolve(new Response('ok')),
		});

		expect(Object.keys(runtime)).toEqual(['fetch']);
		expect('listen' in runtime).toBe(false);
		expect('close' in runtime).toBe(false);
		expect(Symbol.asyncDispose in runtime).toBe(false);
	});
});

describe('gateway lifecycle', () => {
	it('propagates caller cancellation during bounded body reads without contacting upstream', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		let upstreamCalls = 0;
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			fetch: () => {
				upstreamCalls += 1;
				return Promise.resolve(new Response('unexpected'));
			},
		});
		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(stream) {
				stream.enqueue(new TextEncoder().encode('partial'));
			},
		});
		const request = new Request(
			'http://localhost/api/v1/items',
			{
				method: 'POST',
				body,
				signal: controller.signal,
				duplex: 'half',
			} as RequestInit & { duplex: 'half' },
		);
		const pending = runtime.fetch(request);
		await Promise.resolve();
		const reason = new DOMException('Caller cancelled the request.', 'AbortError');
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(upstreamCalls).toBe(0);
	});

	it('emits redacted events and waits for response-body completion', async () => {
		const definition = gatewayDefinition({
			observers: true,
			credentials: gateway.credentials({ responseCookies: 'preserve' }),
		});
		const compiled = gateway.compile(definition, { services: [compiledService] });
		const events: gateway.GatewayObserverEvent[] = [];
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			observers: [gateway.observer.handler(Observer, (event) => {
				events.push(event);
			})],
			fetch: () => Promise.resolve(new Response('streamed')),
		});
		const result = await runtime.fetch(
			new Request('http://localhost/api/v1/items?token=secret', {
				method: 'POST',
				headers: { Authorization: 'Bearer secret' },
			}),
		);
		expect(events.map((event) => event.kind)).toEqual(['forwarding', 'response']);
		expect(await result.text()).toBe('streamed');
		await Promise.resolve();
		expect(events.map((event) => event.kind)).toEqual(['forwarding', 'response', 'completed']);
		expect(events[0]).toMatchObject({
			gatewayId: 'public-gateway',
			serviceId: 'test-service',
			pathname: '/api/v1/items',
		});
		expect(events[0]?.pathname).not.toContain('secret');
		expect(events[2]?.responseBytes).toBe(8);
	});

	it('delivers a completion-only subscription after consuming the response', async () => {
		const Completed = gateway.observer.define({
			id: 'gateway.completed',
			description: 'Records only completed response delivery.',
			events: ['completed'],
		});
		const definition = gateway.define({
			id: 'completion-gateway',
			services: [gateway.mount(serviceDefinition, { origin: 'http://127.0.0.1:8787' })],
			observers: [Completed],
		});
		const completed = Promise.withResolvers<gateway.GatewayObserverEvent>();
		const events: gateway.GatewayObserverEvent[] = [];
		const runtime = gateway.create(gateway.compile(definition, { services: [compiledService] }), {
			observers: [gateway.observer.handler(Completed, (event) => {
				events.push(event);
				completed.resolve(event);
			})],
			fetch: async () => new Response('accepted'),
		});
		const result = await runtime.fetch(new Request('https://api.example.invalid/api/v1/items', { method: 'POST' }));
		expect(events).toEqual([]);
		expect(await result.text()).toBe('accepted');
		expect(await completed.promise).toMatchObject({ kind: 'completed', status: 200, responseBytes: 8 });
		expect(events).toHaveLength(1);
	});

	it('delivers exact binary bytes and metadata without a deadline or observer', async () => {
		const runtime = gateway.create(gateway.compile(gatewayDefinition(), { services: [compiledService] }), {
			adapters: adapters(),
			requestId: () => 'body-request',
			fetch: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([0, 1]));
							controller.enqueue(new Uint8Array([2, 255]));
							controller.close();
						},
					}),
					{
						status: 202,
						statusText: 'Accepted upstream',
						headers: { 'content-type': 'application/octet-stream', 'x-source': 'kept' },
					},
				),
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', { method: 'POST' }));
		expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([0, 1, 2, 255]);
		expect(result.status).toBe(202);
		expect(result.statusText).toBe('Accepted upstream');
		expect(result.headers.get('content-type')).toBe('application/octet-stream');
		expect(result.headers.get('x-source')).toBe('kept');
		expect(result.headers.get('x-request-id')).toBe('body-request');
	});

	it(
		'forwards consumer cancellation exactly once without a deadline or observer',
		{ timeout: 15_000 },
		async (test) => {
			const release = Promise.withResolvers<void>();
			const pulls: Promise<void>[] = [];
			const reason = Object.freeze({ message: 'consumer stopped' });
			let cancellations = 0;
			let cancelled: unknown;
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
			let stopping: ReturnType<typeof settle<void>> | undefined;
			let interrupted: Awaited<ReturnType<typeof settle<void>>> | undefined;
			let cleanup: Awaited<ReturnType<typeof settle<void>>> | undefined;
			const stop = () => {
				release.resolve();
				if (reader !== undefined) stopping = settle(reader.cancel(test.signal.reason));
			};
			test.signal.addEventListener('abort', stop, { once: true });
			const runtime = gateway.create(gateway.compile(gatewayDefinition(), { services: [compiledService] }), {
				adapters: adapters(),
				fetch: async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(new Uint8Array([1, 2, 3]));
							},
							pull() {
								pulls.push(release.promise);
								return release.promise;
							},
							cancel(value) {
								cancellations += 1;
								cancelled = value;
								release.resolve();
							},
						}),
					),
			});
			try {
				const result = await runtime.fetch(
					new Request('http://localhost/api/v1/items', { method: 'POST', signal: test.signal }),
				);
				reader = result.body!.getReader();
				const first = await reader.read();
				expect(first.done).toBe(false);
				expect([...(first.value ?? [])]).toEqual([1, 2, 3]);
			} finally {
				try {
					if (reader !== undefined) cleanup = await settle(reader.cancel(reason));
				} finally {
					release.resolve();
					await Promise.all(pulls);
					interrupted = await stopping;
					reader?.releaseLock();
					test.signal.removeEventListener('abort', stop);
				}
			}
			expect(cleanup?.status).toBe('fulfilled');
			if (interrupted?.status === 'rejected') expect(interrupted.reason).toBe(test.signal.reason);
			expect(cancellations).toBe(1);
			expect(cancelled).toBe(reason);
		},
	);

	it('preserves upstream stream failure identity without a deadline or observer', async () => {
		const reason = new Error('upstream stream failed');
		const runtime = gateway.create(gateway.compile(gatewayDefinition(), { services: [compiledService] }), {
			adapters: adapters(),
			fetch: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.error(reason);
						},
					}),
				),
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', { method: 'POST' }));
		const consumed = await settle(result.arrayBuffer());
		expect(consumed.status).toBe('rejected');
		if (consumed.status === 'rejected') expect(consumed.reason).toBe(reason);
	});

	for (const kind of ['failed', 'aborted'] as const) {
		it(`tracks a ${kind}-only subscription through response delivery`, { timeout: 15_000 }, async (test) => {
			const Terminal = gateway.observer.define({
				id: `gateway.${kind}.only`,
				description: 'One terminal delivery outcome.',
				events: [kind],
			});
			const definition = gateway.define({
				id: `${kind}-gateway`,
				services: [gateway.mount(serviceDefinition, { origin: 'http://127.0.0.1:8787' })],
				observers: [Terminal],
			});
			const events: gateway.GatewayObserverEvent[] = [];
			const observed = Promise.withResolvers<gateway.GatewayObserverEvent>();
			const release = Promise.withResolvers<void>();
			const stopped = Promise.withResolvers<void>();
			const pulls: Promise<void>[] = [];
			const caller = new AbortController();
			const reason = kind === 'failed'
				? new Error('upstream body failed')
				: new DOMException('Caller stopped the body.', 'AbortError');
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
			let read: ReturnType<typeof settle<ReadableStreamReadResult<Uint8Array>>> | undefined;
			let cleanup: Awaited<ReturnType<typeof settle<void>>> | undefined;
			let stopping: ReturnType<typeof settle<void>> | undefined;
			let interrupted: Awaited<ReturnType<typeof settle<void>>> | undefined;
			const stop = () => {
				caller.abort(test.signal.reason);
				release.resolve();
				stopped.resolve();
				if (reader !== undefined) stopping = settle(reader.cancel(test.signal.reason));
			};
			test.signal.addEventListener('abort', stop, { once: true });
			const runtime = gateway.create(gateway.compile(definition), {
				observers: [gateway.observer.handler(Terminal, (event) => {
					events.push(event);
					observed.resolve(event);
				})],
				fetch: async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(new Uint8Array([1, 2, 3]));
							},
							pull(controller) {
								const pending = release.promise.then(() => {
									if (kind === 'failed') controller.error(reason);
								});
								pulls.push(pending);
								return pending;
							},
							cancel() {
								release.resolve();
							},
						}),
					),
			});
			try {
				const result = await runtime.fetch(
					new Request('http://localhost/api/v1/items', { method: 'POST', signal: caller.signal }),
				);
				reader = result.body!.getReader();
				const first = await reader.read();
				expect([...(first.value ?? [])]).toEqual([1, 2, 3]);
				expect(events).toEqual([]);
				read = settle(reader.read());
				if (kind === 'failed') release.resolve();
				else caller.abort(reason);
				const failure = await read;
				expect(failure.status).toBe('rejected');
				if (failure.status === 'rejected') expect(failure.reason).toBe(reason);
				expect(await Promise.race([observed.promise, stopped.promise])).toMatchObject({
					kind,
					status: 200,
					responseBytes: 3,
					completion: { outcome: 'errored', bytes: 3 },
				});
			} finally {
				release.resolve();
				caller.abort(reason);
				if (reader !== undefined) cleanup = await settle(reader.cancel(reason));
				await read;
				await Promise.all(pulls);
				interrupted = await stopping;
				reader?.releaseLock();
				test.signal.removeEventListener('abort', stop);
				stopped.resolve();
			}
			if (interrupted?.status === 'rejected') expect(interrupted.reason).toBe(test.signal.reason);
			if (cleanup?.status === 'rejected') expect(cleanup.reason).toBe(reason);
			expect(events.map((event) => event.kind)).toEqual([kind]);
		});
	}

	it(
		'cancels a stalled upstream response after delivered bytes without a timeout or observer',
		{ timeout: 15_000 },
		async (test) => {
			const caller = new AbortController();
			const release = Promise.withResolvers<void>();
			const pulls: Promise<void>[] = [];
			const reason = new DOMException('Caller stopped response delivery.', 'AbortError');
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
			let read: ReturnType<typeof settle<ReadableStreamReadResult<Uint8Array>>> | undefined;
			let cleanup: Awaited<ReturnType<typeof settle<void>>> | undefined;
			let stopping: ReturnType<typeof settle<void>> | undefined;
			let interrupted: Awaited<ReturnType<typeof settle<void>>> | undefined;
			let cancelled: unknown;
			let cancellations = 0;
			const stop = () => {
				caller.abort(test.signal.reason);
				release.resolve();
				if (reader !== undefined) stopping = settle(reader.cancel(test.signal.reason));
			};
			test.signal.addEventListener('abort', stop, { once: true });
			const runtime = gateway.create(gateway.compile(gatewayDefinition(), { services: [compiledService] }), {
				adapters: adapters(),
				fetch: async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(new Uint8Array([1, 2, 3]));
							},
							pull() {
								pulls.push(release.promise);
								return release.promise;
							},
							cancel(value) {
								cancelled = value;
								cancellations += 1;
								release.resolve();
							},
						}),
					),
			});
			try {
				const result = await runtime.fetch(
					new Request('https://api.example.invalid/api/v1/items', { method: 'POST', signal: caller.signal }),
				);
				reader = result.body!.getReader();
				const first = await reader.read();
				expect(first.done).toBe(false);
				expect([...(first.value ?? [])]).toEqual([1, 2, 3]);
				read = settle(reader.read());
				caller.abort(reason);
				const failure = await read;
				expect(failure.status).toBe('rejected');
				if (failure.status === 'rejected') expect(failure.reason).toBe(reason);
			} finally {
				caller.abort(reason);
				release.resolve();
				if (reader !== undefined) cleanup = await settle(reader.cancel(reason));
				await read;
				await Promise.all(pulls);
				interrupted = await stopping;
				reader?.releaseLock();
				test.signal.removeEventListener('abort', stop);
			}
			if (cleanup?.status === 'rejected') expect(cleanup.reason).toBe(reason);
			if (interrupted?.status === 'rejected') expect(interrupted.reason).toBe(test.signal.reason);
			expect(cancellations).toBe(1);
			expect(cancelled).toBe(reason);
		},
	);

	it('keeps the total timeout active until the upstream body completes', { timeout: 15_000 }, async (test) => {
		const compiled = gateway.compile(
			gatewayDefinition({ timeout: Temporal.Duration.from({ milliseconds: 10 }), observers: true }),
			{ services: [compiledService] },
		);
		const release = Promise.withResolvers<void>();
		const stopped = Promise.withResolvers<void>();
		const observed = Promise.withResolvers<gateway.GatewayObserverEvent>();
		const pulls: Promise<void>[] = [];
		const cancelWork: Promise<void>[] = [];
		const caller = new AbortController();
		const events: gateway.GatewayObserverEvent[] = [];
		let cancelled: unknown;
		let cancellations = 0;
		let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		let read: ReturnType<typeof settle<ReadableStreamReadResult<Uint8Array>>> | undefined;
		let failure: Awaited<ReturnType<typeof settle<ReadableStreamReadResult<Uint8Array>>>> | undefined;
		let cleanup: Awaited<ReturnType<typeof settle<void>>> | undefined;
		const stop = () => {
			caller.abort(test.signal.reason);
			bodyController?.error(test.signal.reason);
			release.resolve();
			stopped.resolve();
		};
		test.signal.addEventListener('abort', stop, { once: true });
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			observers: [gateway.observer.handler(Observer, (event) => {
				events.push(event);
				if (event.kind === 'aborted') observed.resolve(event);
			})],
			fetch: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							bodyController = controller;
						},
						pull() {
							pulls.push(release.promise);
							return release.promise;
						},
						cancel(reason) {
							release.resolve();
							const completion = Promise.all(pulls).then(() => {
								cancellations += 1;
								cancelled = reason;
							});
							cancelWork.push(completion);
							return completion;
						},
					}),
				),
		});
		try {
			const result = await runtime.fetch(
				new Request('http://localhost/api/v1/items', { method: 'POST', signal: caller.signal }),
			);
			reader = result.body!.getReader();
			expect(result.status).toBe(200);
			read = settle(reader.read());
			failure = await read;
			expect(failure.status).toBe('rejected');
			if (failure.status !== 'rejected') throw new Error('Stalled response completed without its deadline.');
			expect(failure.reason).toBeInstanceOf(DOMException);
			if (!(failure.reason instanceof DOMException)) throw new Error('Deadline did not retain its DOMException.');
			expect(failure.reason.name).toBe('TimeoutError');
			expect(failure.reason.message).toBe('Gateway deadline exceeded.');
			expect(await Promise.race([observed.promise, stopped.promise])).toMatchObject({
				kind: 'aborted',
				responseBytes: 0,
				completion: { outcome: 'errored', bytes: 0 },
			});
		} finally {
			caller.abort();
			release.resolve();
			await read;
			// This reader owns the delivery lock. The upstream body is owned by
			// the gateway; join its registered cancellation rather than cancelling
			// a locked source stream from the test.
			if (reader !== undefined) cleanup = await settle(reader.cancel());
			await Promise.all(pulls);
			await Promise.all(cancelWork);
			reader?.releaseLock();
			test.signal.removeEventListener('abort', stop);
			stopped.resolve();
		}
		if (cleanup?.status === 'rejected' && failure?.status === 'rejected') expect(cleanup.reason).toBe(failure.reason);
		expect(cancellations).toBe(1);
		if (failure?.status === 'rejected') expect(cancelled).toBe(failure.reason);
		expect(events.map((event) => event.kind)).toEqual(['forwarding', 'response', 'aborted']);
	});

	it('emits denied without exposing query credentials', async () => {
		const definition = gatewayDefinition({ observers: true });
		const compiled = gateway.compile(definition, { services: [compiledService] });
		const events: gateway.GatewayObserverEvent[] = [];
		const runtime = gateway.create(compiled, {
			adapters: adapters(),
			observers: [gateway.observer.handler(Observer, (event) => {
				events.push(event);
			})],
		});
		const result = await runtime.fetch(new Request('https://api.example.invalid/not-mounted?api_key=secret'));
		expect(result.status).toBe(404);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: 'denied', pathname: '/not-mounted' });
	});
});
