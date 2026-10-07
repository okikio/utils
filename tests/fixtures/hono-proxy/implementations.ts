/** Independent Hono helper and compiled Utils gateway adapters for the proxy corpus. @module */
import { Hono } from 'hono';
import { proxy } from 'hono/proxy';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { get, head, post } from '@okikio/server/endpoint';
import { ok } from '@okikio/http/response';
import { define as defineService } from '@okikio/server/service';
import {
	compile,
	create,
	credentials,
	define,
	mount as mountService,
	passThroughCache,
	policy,
	redirects,
} from '@okikio/server/gateway';
import { create as createHttp, mount, route } from '@okikio/server/http';
import type { ProxyMode } from './corpus.ts';

export type Transport = (request: Request) => Promise<Response>;
export interface ProxyApi {
	readonly fetch: (request: Request) => Promise<Response>;
}

/** Reproduce original overloads using customFetch in place of process-global vi mocks. */
export function createHonoProxy(mode: ProxyMode, fetch: Transport): ProxyApi {
	const app = new Hono();
	const invoke = async (source: Request, path: string): Promise<Response> => {
		const target = `https://example.com/${path}`;
		let result: Response;
		if (mode === 'input-request') {
			result = await proxy(new Request(target, { headers: { 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' } }), {
				customFetch: fetch,
			});
		} else if (mode === 'proxy-init-request') {
			const input = new Request(source, { headers: { 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' } });
			result = await proxy(target, input);
		} else if (mode === 'explicit-hop') {
			result = await proxy(target, { customFetch: fetch, headers: { 'Proxy-Authorization': 'Basic 123456' } });
		} else if (mode === 'modify') {
			result = await proxy(target, { customFetch: fetch, headers: { 'Set-Cookie': 'test=123' } });
		} else if (mode === 'undefined-auth') {
			result = await proxy(target, {
				customFetch: fetch,
				headers: { ...Object.fromEntries(source.headers), Authorization: undefined },
			});
		} else if (mode === 'none') {
			result = await proxy(target, { customFetch: fetch });
		} else {
			result = await proxy(target, {
				customFetch: fetch,
				raw: source,
				...(mode === 'strict' ? { strictConnectionProcessing: true } : {}),
				...(mode === 'manual' ? { redirect: 'manual' } : {}),
				...(path === 'post'
					? { headers: { ...Object.fromEntries(source.headers), 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' } }
					: {}),
			});
		}
		if (mode === 'modify') {
			result.headers.delete('Set-Cookie');
			result.headers.set('X-Response-Id', '456');
		}
		return result;
	};
	app.all('/proxy/:path', (ctx) => invoke(ctx.req.raw, ctx.req.param('path')));
	app.post('/', (ctx) => invoke(ctx.req.raw, ''));
	return {
		async fetch(request) {
			if (mode !== 'proxy-init-request') return await app.fetch(request);
			// This exact upstream Request overload has no customFetch parameter.
			// Tests run serially in their isolated realm and restore the borrowed
			// global in finally, including when request construction/fetch fails.
			const previous = globalThis.fetch;
			globalThis.fetch = async (input, init) =>
				await fetch(input instanceof Request ? input : new Request(input, init));
			try {
				return await app.fetch(request);
			} finally {
				globalThis.fetch = previous;
			}
		},
	};
}

const AnySchema: StandardSchemaV1<unknown, unknown> = {
	'~standard': { version: 1, vendor: 'proxy-corpus', validate: (value) => ({ value }) },
};

/** Use real public declarations and gateway policy; never imitate gateway header/cancellation code in the fixture. */
export function createUtilsProxy(mode: ProxyMode, fetch: Transport, preserveCredentials = false): ProxyApi {
	const Reply = ok(AnySchema, { id: 'proxy.reply', description: 'Forwarded upstream reply.' });
	const reads = [
		'ok',
		'compressed',
		'uncompressed',
		'hop-by-hop',
		'connection-listed',
		'set-cookie',
		'404',
		'redirect',
		'stream',
		'status',
	].map((path) => get({ id: `proxy.${path}`, path: `/${path}`, responses: [Reply] }));
	const writes = ['post', 'disconnect', 'stream', 'body'].map((path) =>
		post({ id: `proxy.write.${path}`, path: `/${path}`, raw: AnySchema, responses: [Reply] })
	);
	const root = post({ id: 'proxy.root', path: '/', raw: AnySchema, responses: [Reply] });
	// Declare HEAD explicitly so this transport fixture does not depend on a
	// runtime's implicit GET fallback when checking representation metadata.
	const metadata = head({ id: 'proxy.compressed.head', path: '/compressed', responses: [Reply] });
	const endpoints = [...reads, ...writes, metadata, root];
	const Service = defineService({ id: 'proxy.service', path: '/', endpoints });
	const Edge = define({
		id: 'proxy.edge',
		services: [mountService(Service, { origin: 'https://example.com' })],
		policies: [policy({
			id: 'proxy.policy',
			endpoints,
			cache: passThroughCache(),
			redirects: redirects({ mode: 'preserve' }),
			credentials: credentials({
				requestCookies: preserveCredentials ? 'preserve' : 'strip',
				requestAuthorization: preserveCredentials ? 'preserve' : 'strip',
				responseCookies: 'preserve',
			}),
		})],
	});
	const runtime = create(compile(Edge), {
		requestId: () => '123',
		fetch: async (input, init) => await fetch(input instanceof Request ? input : new Request(input, init)),
	});
	const forwarded = async (request: Request): Promise<Response> => {
		let input = request;
		if (mode === 'input-request' || mode === 'proxy-init-request') {
			input = new Request(request, { headers: { 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' } });
		}
		if (mode === 'explicit-hop') input = new Request(request, { headers: { 'Proxy-Authorization': 'Basic 123456' } });
		if (mode === 'modify') input = new Request(request, { headers: { 'Set-Cookie': 'test=123' } });
		if (new URL(request.url).pathname === '/post') {
			input = new Request(request, {
				headers: { ...Object.fromEntries(request.headers), 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' },
			});
		}
		const result = await runtime.fetch(input);
		if (mode === 'modify') {
			result.headers.delete('Set-Cookie');
			result.headers.set('X-Response-Id', '456');
		}
		return result;
	};
	const app = createHttp({
		routes: [mount('/proxy', forwarded, { requestPath: 'strip-prefix' }), route('POST', '/', forwarded)],
	});
	return { fetch: async (request) => await app.fetch(request) };
}
