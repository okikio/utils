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
			cache: gateway.noStore(),
			...(options.credentials === undefined ? {} : { credentials: options.credentials }),
			...(options.redirects === undefined ? {} : { redirects: options.redirects }),
			...(options.timeout === undefined ? {} : { timeout: options.timeout }),
		})],
		observers: options.observers ? [Observer] : [],
	});
}

function concerns() {
	return {
		authenticate: () => ({ headers: { 'x-trusted-actor': 'actor_1' } }),
		assert: () => ({ headers: { 'x-trusted-assertion': 'signed' } }),
	};
}

describe('gateway request preparation', () => {
	it('rebuilds transport trust metadata for host-owned continuation routes', async () => {
		const prepared = await gateway.prepare(new Request('https://app.example.invalid/start', {
			headers: {
				authorization: 'Bearer session',
				cookie: 'session=1',
				'clerk-secret-key': 'spoofed',
				'x-forwarded-for': '198.51.100.8',
				'x-real-ip': '203.0.113.9',
				'x-product-assertion': 'spoofed',
			},
		}), {
			requestId: () => 'request-1',
			clientIp: (request) => request.headers.get('x-real-ip') ?? undefined,
			metadataHeaders: { requestId: 'x-product-request-id' },
			trustedRequestHeaders: ['clerk-secret-key'],
			trustedRequestHeaderPrefixes: ['x-product-'],
		});

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
		const manifest: service.ServiceManifest = Object.freeze({
			...compiledService.manifest,
			routes: Object.freeze(compiledService.manifest.routes.map((route) => Object.freeze({
				...route,
				operationId: `${route.operationId}.stale`,
			}))),
		});
		expect(() => gateway.compile(gatewayDefinition(), { services: [manifest] })).toThrow(gateway.GatewayCompilationError);
	});

	it('rejects conflicting credential policies for one route', () => {
		const definition = gateway.define({
			id: 'conflict-gateway',
			services: [gateway.mount(serviceDefinition, { origin: 'http://127.0.0.1:8787' })],
			policies: [
				gateway.policy({ id: 'strip', endpoints: [Public], credentials: gateway.credentials() }),
				gateway.policy({ id: 'preserve', endpoints: [Public], credentials: gateway.credentials({ requestCookies: 'preserve' }) }),
			],
		});
		expect(() => gateway.compile(definition, { services: [compiledService] })).toThrow(gateway.GatewayCompilationError);
	});
});

describe('gateway request and response policy', () => {
	it('strips caller credentials, spoofable trust fields, and replaces trace context', async () => {
		const compiled = gateway.compile(gatewayDefinition({
			credentials: gateway.credentials({
				requestCookies: 'strip',
				requestAuthorization: 'strip-after-authentication',
				responseCookies: 'preserve',
			}),
		}), { services: [compiledService] });
		let forwarded: Request | undefined;
		const runtime = gateway.create(compiled, {
			requestId: () => 'request_1',
			clientIp: () => '203.0.113.9',
			trustedRequestHeaderPrefixes: ['x-trusted-'],
			concerns: concerns(),
			fetch: async (input, init) => {
				forwarded = input instanceof Request ? input : new Request(input, init);
				const headers = new Headers({ connection: 'close', 'x-upstream': 'kept' });
				headers.append('Set-Cookie', 'first=1; Path=/');
				headers.append('Set-Cookie', 'second=2; Path=/');
				return new Response('ok', { headers });
			},
		});
		const body = new Uint8Array([0, 1, 2, 3]);
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', {
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
		}));
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
			concerns: concerns(),
			fetch: async (input, init) => {
				forwarded = input instanceof Request ? input : new Request(input, init);
				return new Response('ok');
			},
		});
		const result = await runtime.fetch(new Request('https://gateway.example.invalid/api/v1/items', {
			method: 'POST',
			headers: { 'x-product-service-id': 'spoofed' },
		}));
		expect(forwarded?.headers.get('x-product-request-id')).toBe('request-1');
		expect(forwarded?.headers.get('x-product-service-id')).toBe('test-service');
		expect(forwarded?.headers.get('x-product-route-id')).toBe(compiled.routes[0]?.id);
		expect(result.headers.get('x-product-request-id')).toBe('request-1');
	});

	it('strips response cookies by default', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		const runtime = gateway.create(compiled, {
			concerns: concerns(),
			fetch: () => Promise.resolve(new Response('ok', { headers: { 'Set-Cookie': 'secret=1' } })),
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', { method: 'POST' }));
		expect(result.headers.get('set-cookie')).toBeNull();
	});

	it('rewrites internal redirect origins and can reject unapproved external redirects', async () => {
		const rewrite = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		const rewriteRuntime = gateway.create(rewrite, {
			concerns: concerns(),
			fetch: () => Promise.resolve(new Response(null, {
				status: 302,
				headers: { Location: 'http://127.0.0.1:8787/next?ok=1' },
			})),
		});
		const rewritten = await rewriteRuntime.fetch(new Request('https://api.example.invalid/api/v1/items', { method: 'POST' }));
		expect(rewritten.headers.get('location')).toBe('https://api.example.invalid/next?ok=1');

		const reject = gateway.compile(gatewayDefinition({
			redirects: gateway.redirects({ mode: 'reject-cross-origin' }),
		}), { services: [compiledService] });
		const rejectRuntime = gateway.create(reject, {
			concerns: concerns(),
			fetch: () => Promise.resolve(new Response(null, { status: 302, headers: { Location: 'https://evil.example/path' } })),
		});
		const rejected = await rejectRuntime.fetch(new Request('https://api.example.invalid/api/v1/items', { method: 'POST' }));
		expect(rejected.status).toBe(502);
		expect((await rejected.json() as { type: string }).type).toContain('invalid-redirect');
	});

	it('rejects malformed Content-Length before contacting upstream', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		let upstreamCalls = 0;
		const runtime = gateway.create(compiled, {
			concerns: concerns(),
			fetch: () => {
				upstreamCalls += 1;
				return Promise.resolve(new Response('unexpected'));
			},
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', {
			method: 'POST',
			headers: { 'content-length': '4.5' },
			body: '1234',
		}));
		expect(result.status).toBe(400);
		expect((await result.json() as { type: string }).type).toBe('urn:utils:gateway:invalid-request');
		expect(upstreamCalls).toBe(0);
	});

	it('rejects bodies larger than the explicit gateway policy', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		const runtime = gateway.create(compiled, {
			concerns: concerns(),
			fetch: () => Promise.resolve(new Response('unexpected')),
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', {
			method: 'POST',
			body: 'this body exceeds sixteen bytes',
		}));
		expect(result.status).toBe(413);
	});
});

describe('gateway lifecycle', () => {
	it('propagates caller cancellation during bounded body reads without contacting upstream', async () => {
		const compiled = gateway.compile(gatewayDefinition(), { services: [compiledService] });
		let upstreamCalls = 0;
		const runtime = gateway.create(compiled, {
			concerns: concerns(),
			fetch: () => {
				upstreamCalls += 1;
				return Promise.resolve(new Response('unexpected'));
			},
		});
		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(stream) { stream.enqueue(new TextEncoder().encode('partial')); },
		});
		const request = new Request('http://localhost/api/v1/items', {
			method: 'POST',
			body,
			signal: controller.signal,
			duplex: 'half',
		} as RequestInit & { duplex: 'half' });
		const pending = runtime.fetch(request);
		await Promise.resolve();
		const reason = new DOMException('Caller cancelled the request.', 'AbortError');
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(upstreamCalls).toBe(0);
	});

	it('emits redacted events and waits for response-body completion', async () => {
		const definition = gatewayDefinition({ observers: true, credentials: gateway.credentials({ responseCookies: 'preserve' }) });
		const compiled = gateway.compile(definition, { services: [compiledService] });
		const events: gateway.GatewayObserverEvent[] = [];
		const runtime = gateway.create(compiled, {
			concerns: concerns(),
			observers: [gateway.observer.handler(Observer, (event) => { events.push(event); })],
			fetch: () => Promise.resolve(new Response('streamed')),
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items?token=secret', {
			method: 'POST',
			headers: { Authorization: 'Bearer secret' },
		}));
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

	it('keeps the total timeout active until the upstream body completes', async () => {
		const compiled = gateway.compile(gatewayDefinition({
			timeout: Temporal.Duration.from({ milliseconds: 10 }),
			observers: true,
		}), { services: [compiledService] });
		const events: gateway.GatewayObserverEvent[] = [];
		const runtime = gateway.create(compiled, {
			concerns: concerns(),
			observers: [gateway.observer.handler(Observer, (event) => { events.push(event); })],
			fetch: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
				pull() { return new Promise<void>(() => undefined); },
			}))),
		});
		const result = await runtime.fetch(new Request('http://localhost/api/v1/items', { method: 'POST' }));
		await expect(result.arrayBuffer()).rejects.toBeDefined();
		await Promise.resolve();
		expect(events.some((event) => event.kind === 'aborted')).toBe(true);
	});

	it('emits denied without exposing query credentials', async () => {
		const definition = gatewayDefinition({ observers: true });
		const compiled = gateway.compile(definition, { services: [compiledService] });
		const events: gateway.GatewayObserverEvent[] = [];
		const runtime = gateway.create(compiled, {
			concerns: concerns(),
			observers: [gateway.observer.handler(Observer, (event) => { events.push(event); })],
		});
		const result = await runtime.fetch(new Request('https://api.example.invalid/not-mounted?api_key=secret'));
		expect(result.status).toBe(404);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: 'denied', pathname: '/not-mounted' });
	});
});
