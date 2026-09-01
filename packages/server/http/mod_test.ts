import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import {
	access,
	catchErrors,
	compose,
	correlation,
	cors,
	create,
	health,
	mount,
	prettyJson,
	ready,
	requestId,
	route,
	securityHeaders,
	timing,
	trailingSlash,
	withHeaders,
} from './mod.ts';

describe('framework-neutral HTTP host', () => {
	it('dispatches exact and parameterized routes without a framework', async () => {
		const app = create({
			routes: [
				route('GET', '/health', () => new Response('ok')),
				route('GET', '/users/:id', (request) => new Response(new URL(request.url).pathname)),
				mount('/api', () => new Response('mounted')),
			],
		});
		expect(await (await app.fetch(new Request('http://localhost/health'))).text()).toBe('ok');
		expect(await (await app.fetch(new Request('http://localhost/users/123'))).text()).toBe('/users/123');
		expect(await (await app.fetch(new Request('http://localhost/api/v1/ping'))).text()).toBe('mounted');
		expect((await app.fetch(new Request('http://localhost/missing'))).status).toBe(404);
	});

	it('uses GET metadata for HEAD and rejects duplicate route ownership', async () => {
		const app = create({
			routes: [route('GET', '/health', () => new Response('alive', { headers: { 'X-Probe': 'yes' } }))],
		});
		const head = await app.fetch(new Request('http://localhost/health', { method: 'HEAD' }));
		expect(head.status).toBe(200);
		expect(head.headers.get('x-probe')).toBe('yes');
		expect(await head.text()).toBe('');
		expect(() => create({
			routes: [
				route('GET', '/same', () => new Response('first')),
				route('GET', '/same', () => new Response('second')),
			],
		})).toThrow(/Duplicate HTTP route shape/u);
	});

	it('rejects parameter-name-only route duplicates', () => {
		expect(() => create({
			routes: [
				route('GET', '/items/:id', () => new Response('id')),
				route('GET', '/items/:slug', () => new Response('slug')),
			],
		})).toThrow(/Duplicate HTTP route shape/u);
	});


	it('keeps trailing-slash routes distinct so append policy has a reachable target', async () => {
		const app = create({
			routes: [route('GET', '/docs/', () => new Response('docs'))],
			middleware: [trailingSlash('append')],
		});
		const redirect = await app.fetch(new Request('http://localhost/docs'));
		expect(redirect.status).toBe(301);
		expect(redirect.headers.get('location')).toBe('http://localhost/docs/');
		expect(await (await app.fetch(new Request('http://localhost/docs/'))).text()).toBe('docs');
	});

	it('cancels a discarded GET body when HEAD uses GET fallback metadata', async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() { cancelled = true; },
		});
		const app = create({
			routes: [route('GET', '/stream', () => new Response(body, { headers: { 'X-Route': 'get' } }))],
		});
		const result = await app.fetch(new Request('http://localhost/stream', { method: 'HEAD' }));
		expect(result.headers.get('x-route')).toBe('get');
		expect(result.body).toBeNull();
		expect(cancelled).toBe(true);
	});

	it('prefers an explicit HEAD route over GET fallback', async () => {
		const app = create({
			routes: [
				route('GET', '/health', () => new Response('get', { headers: { 'X-Route': 'get' } })),
				route('HEAD', '/health', () => new Response(null, { headers: { 'X-Route': 'head' } })),
			],
		});
		const result = await app.fetch(new Request('http://localhost/health', { method: 'HEAD' }));
		expect(result.headers.get('x-route')).toBe('head');
	});

	it('rejects route templates that URL parsing would rewrite before matching', () => {
		expect(() => route('GET', '/items?mode=all', () => new Response('bad'))).toThrow('must not contain a query');
		expect(() => route('GET', '/items/%2e%2e/admin', () => new Response('bad'))).toThrow('dot segments');
		expect(() => route('GET', '/items/:', () => new Response('bad'))).toThrow('route parameter');
		expect(() => route('GET', '/items/:item-id', () => new Response('bad'))).toThrow('route parameter');
	});

	it('prefers a static route over a matching parameter route regardless of authored order', async () => {
		const app = create({
			routes: [
				route('GET', '/items/:id', () => new Response('dynamic')),
				route('GET', '/items/me', () => new Response('static')),
			],
		});
		expect(await (await app.fetch(new Request('http://localhost/items/me'))).text()).toBe('static');
		expect(await (await app.fetch(new Request('http://localhost/items/123'))).text()).toBe('dynamic');
	});

	it('prefers the longest matching mount and rejects duplicate mount ownership', async () => {
		const app = create({
			routes: [
				mount('/api', () => new Response('api')),
				mount('/api/admin', () => new Response('admin')),
			],
		});
		expect(await (await app.fetch(new Request('http://localhost/api/admin/users'))).text()).toBe('admin');
		expect(() => create({
			routes: [
				mount('/api', () => new Response('first')),
				mount('/api', () => new Response('second')),
			],
		})).toThrow(/Duplicate HTTP mount path/u);
	});

	it('preserves onion ordering in authored middleware order', async () => {
		const observed: string[] = [];
		const handler = compose(
			() => {
				observed.push('handler');
				return new Response('ok');
			},
			[
				async (request, next) => {
					observed.push('a:before');
					const result = await next(request);
					observed.push('a:after');
					return result;
				},
				async (request, next) => {
					observed.push('b:before');
					const result = await next(request);
					observed.push('b:after');
					return result;
				},
			],
		);
		await handler(new Request('http://localhost/'));
		expect(observed).toEqual(['a:before', 'b:before', 'handler', 'b:after', 'a:after']);
	});

	it('catches unexpected values and returns a safe RFC 9457 problem', async () => {
		let observed: Error | undefined;
		const handler = compose(
			() => { throw new Error('database password leaked'); },
			[catchErrors({ onError(error) { observed = error; } })],
		);
		const result = await handler(new Request('http://localhost/fault'));
		expect(result.status).toBe(500);
		expect(await result.json()).toEqual({
			type: 'https://api.example.invalid/problems/internal',
			title: 'Internal server error',
			status: 500,
			instance: '/fault',
		});
		expect(observed?.message).toBe('database password leaked');
	});

	it('keeps the safe fallback when a custom error mapper also fails', async () => {
		let observed: Error | undefined;
		const handler = compose(
			() => { throw new Error('operation failed'); },
			[catchErrors({
				map() { throw new Error('mapper failed'); },
				onError(error) { observed = error; },
			})],
		);
		const result = await handler(new Request('http://localhost/fault'));
		expect(result.status).toBe(500);
		expect(observed).toBeInstanceOf(AggregateError);
		expect(await result.json()).toEqual({
			type: 'https://api.example.invalid/problems/internal',
			title: 'Internal server error',
			status: 500,
			instance: '/fault',
		});
	});

	it('adds the default security headers without changing the body', async () => {
		const handler = compose(() => new Response('ok', { headers: { 'X-Powered-By': 'old' } }), [securityHeaders()]);
		const result = await handler(new Request('http://localhost/'));
		expect(await result.text()).toBe('ok');
		expect(result.headers.get('x-content-type-options')).toBe('nosniff');
		expect(result.headers.get('x-frame-options')).toBe('SAMEORIGIN');
		expect(result.headers.has('x-powered-by')).toBe(false);
	});

	it('rejects exotic security-header options without invoking accessors', () => {
		let reads = 0;
		const options = Object.create(null) as Parameters<typeof securityHeaders>[0];
		Object.defineProperty(options, 'xFrameOptions', {
			enumerable: true,
			get() { reads += 1; return 'DENY'; },
		});
		expect(() => securityHeaders(options)).toThrow('enumerable data property');
		expect(reads).toBe(0);
	});

	it('rejects invalid security-header values instead of coercing them', () => {
		expect(() => Reflect.apply(securityHeaders, undefined, [{ xFrameOptions: 1 }]))
			.toThrow('xFrameOptions must be a string or false');
		expect(() => Reflect.apply(securityHeaders, undefined, [{ additional: { 'X-Test': 1 } }]))
			.toThrow('additional security header');
	});

	it('snapshots CORS configuration and rejects accessor-backed lists without invoking them', async () => {
		let reads = 0;
		const methods: string[] = [];
		Object.defineProperty(methods, '0', {
			configurable: true,
			enumerable: true,
			get() { reads += 1; return 'GET'; },
		});
		methods.length = 1;
		expect(() => cors({ allowMethods: methods })).toThrow('dense string data elements');
		expect(reads).toBe(0);

		const options = { allowMethods: ['GET'] };
		const middleware = cors(options);
		options.allowMethods.push('POST');
		const handler = compose(() => new Response('ok'), [middleware]);
		const response = await handler(new Request('http://localhost/api', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://app.example',
				'Access-Control-Request-Method': 'POST',
			},
		}));
		expect(response.headers.get('access-control-allow-methods')).toBe('GET');
	});

	it('completes CORS preflight and reflects requested headers', async () => {
		const handler = compose(() => new Response('should not run'), [cors({ origin: ['https://app.example'] })]);
		const result = await handler(new Request('http://localhost/api', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://app.example',
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'content-type, x-request-id',
			},
		}));
		expect(result.status).toBe(204);
		expect(result.headers.get('access-control-allow-origin')).toBe('https://app.example');
		expect(result.headers.get('access-control-allow-headers')).toBe('content-type, x-request-id');
		expect(result.headers.get('vary')).toBe('Origin, Access-Control-Request-Headers');
	});

	it('rejects invalid credentialed wildcard and max-age CORS configuration', async () => {
		expect(() => cors({ origin: '*', credentials: true })).toThrow(/wildcard origin/u);
		expect(() => cors({ maxAge: -1 })).toThrow(/non-negative integer/u);
		const dynamic = cors({ credentials: true, origin: () => '*' });
		const handler = compose(() => new Response('ok'), [dynamic]);
		await expect(handler(new Request('http://localhost/', {
			headers: { Origin: 'https://app.example' },
		}))).rejects.toThrow(/origin resolver returned a wildcard/u);
	});

	it('merges Origin into an existing Vary field', async () => {
		const handler = compose(
			() => new Response('ok', { headers: { Vary: 'Accept-Encoding' } }),
			[cors({ origin: ['https://app.example'] })],
		);
		const result = await handler(new Request('http://localhost/api', { headers: { Origin: 'https://app.example' } }));
		expect(result.headers.get('vary')).toBe('Accept-Encoding, Origin');
	});

	it('propagates one request ID through a replaced POST request and response', async () => {
		const handler = compose(async (request) => new Response(JSON.stringify({
			id: request.headers.get('x-request-id'),
			body: await request.text(),
		})), [requestId({ generate: () => 'request-123' })]);
		const result = await handler(new Request('http://localhost/echo', { method: 'POST', body: 'hello' }));
		expect(result.headers.get('x-request-id')).toBe('request-123');
		expect(await result.json()).toEqual({ id: 'request-123', body: 'hello' });
	});

	it('validates caller-generated request IDs before forwarding them', async () => {
		const handler = compose((request) => new Response(request.headers.get('x-request-id')), [
			requestId({ generate: () => 'invalid id with spaces' }),
		]);
		const result = await handler(new Request('http://localhost/'));
		expect(await result.text()).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it('establishes one memoized correlation value without selecting a tracing provider', async () => {
		let traceId: string | undefined;
		const handler = compose(() => new Response('ok'), [correlation({
			async observe(value) { traceId = value.traceId; },
		})]);
		const request = new Request('http://localhost/');
		await handler(request);
		expect(traceId).toMatch(/^[0-9a-f]{32}$/);
	});

	it('records total handler duration with Server-Timing', async () => {
		const handler = compose(() => new Response('ok'), [timing()]);
		const result = await handler(new Request('http://localhost/'));
		expect(result.headers.get('server-timing')).toContain('total;dur=');
	});

	it('pretty-prints JSON without consuming invalid JSON responses', async () => {
		const valid = compose(
			() => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
			[prettyJson()],
		);
		const formatted = await valid(new Request('http://localhost/?pretty'));
		expect(await formatted.text()).toBe('{\n  "ok": true\n}');

		const invalid = compose(
			() => new Response('{oops', { headers: { 'Content-Type': 'application/json' } }),
			[prettyJson({ force: true })],
		);
		const untouched = await invalid(new Request('http://localhost/'));
		expect(await untouched.text()).toBe('{oops');
	});

	it('redirects only a missing GET route to its canonical trailing-slash form', async () => {
		const app = create({
			routes: [route('GET', '/health', () => new Response('ok'))],
			middleware: [trailingSlash('trim')],
		});
		const redirect = await app.fetch(new Request('http://localhost/health/'));
		expect(redirect.status).toBe(301);
		expect(redirect.headers.get('location')).toBe('http://localhost/health');
		const missing = await app.fetch(new Request('http://localhost/missing/'));
		expect(missing.headers.get('location')).toBe('http://localhost/missing');
	});

	it('separates liveness from readiness', async () => {
		const clock = () => new Date('2026-08-19T22:00:05.000Z');
		const alive = health({ service: 'smoke', startedAt: Date.parse('2026-08-19T22:00:00.000Z'), now: clock });
		const waiting = ready(
			() => ({ ready: false, detail: 'database unavailable', checks: { database: false } }),
			{ service: 'smoke' },
		);
		const healthResponse = await alive(new Request('http://localhost/health'));
		const readyResponse = await waiting(new Request('http://localhost/ready'));
		expect(await healthResponse.json()).toEqual({
			status: 'ok', service: 'smoke', timestamp: '2026-08-19T22:00:05.000Z', uptimeMs: 5000,
		});
		expect(readyResponse.status).toBe(503);
		expect(await readyResponse.json()).toEqual({
			status: 'not-ready', service: 'smoke', detail: 'database unavailable', checks: { database: false },
		});
	});

	it('rejects invalid access observers at middleware creation', () => {
		expect(() => Reflect.apply(access, undefined, [undefined])).toThrow('access observer must be a function');
	});

	it('validates and snapshots response header replacement input', async () => {
		let reads = 0;
		const set = Object.create(null) as Record<string, string>;
		Object.defineProperty(set, 'X-Test', {
			enumerable: true,
			get() { reads += 1; return 'bad'; },
		});
		expect(() => withHeaders(new Response('ok'), set)).toThrow('enumerable data property');
		expect(reads).toBe(0);

		const remove: string[] = [];
		Object.defineProperty(remove, '0', {
			configurable: true,
			enumerable: true,
			get() { reads += 1; return 'X-Old'; },
		});
		remove.length = 1;
		expect(() => withHeaders(new Response('ok'), {}, remove)).toThrow('dense string data elements');
		expect(reads).toBe(0);

		const result = withHeaders(
			new Response('ok', { headers: { 'X-Old': 'remove', 'X-Keep': 'yes' } }),
			[['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2'], ['X-New', 'value']],
			['X-Old'],
		);
		expect(result.headers.has('x-old')).toBe(false);
		expect(result.headers.get('x-keep')).toBe('yes');
		expect(result.headers.get('x-new')).toBe('value');
		const cookies = (result.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
		if (cookies !== undefined) expect(cookies).toEqual(['a=1', 'b=2']);
	});

	it('observes request completion without making the observer authoritative', async () => {
		const events: string[] = [];
		const handler = compose(() => new Response('ok'), [access((event) => {
			events.push(event.kind);
			throw new Error('observer failed');
		})]);
		const result = await handler(new Request('http://localhost/'));
		expect(result.status).toBe(200);
		expect(events).toEqual(['start', 'response']);
	});
});
