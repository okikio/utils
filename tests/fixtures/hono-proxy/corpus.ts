/** Pinned upstream proxy vectors. Expectations remain authored data, never another candidate's output. @module */
export const upstreamSource = Object.freeze({
	commit: '06880c4a2b04de9dd74217f26dd831209b9c01f1',
	version: '4.13.5',
	path: 'src/helper/proxy/index.test.ts',
});

export type ProxyMode =
	| 'input-request'
	| 'raw'
	| 'strict'
	| 'explicit-hop'
	| 'modify'
	| 'undefined-auth'
	| 'proxy-init-request'
	| 'custom-fetch'
	| 'none'
	| 'manual';

export interface ProxyExpectation {
	readonly status: number;
	readonly body?: string;
	readonly request:
		| null
		| Readonly<{
			readonly url: string;
			readonly headers?: Readonly<Record<string, string | null>>;
		}>;
	readonly headers?: Readonly<Record<string, string | null>>;
}

export interface ProxyVector {
	readonly id: string;
	readonly title: string;
	readonly line: number;
	readonly path: string;
	readonly mode: ProxyMode;
	readonly method?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly hono: ProxyExpectation;
	readonly utils: ProxyExpectation;
	readonly difference?: string;
}

const hopInput = Object.freeze({
	Host: 'example.com',
	Connection: 'keep-alive, custom-header',
	'Keep-Alive': 'timeout=5, max=1000',
	'Proxy-Authorization': 'Basic 123456',
	'Custom-Header': 'test',
	'Allowed-Custom-Header': 'test',
});
const compressedHeaders = Object.freeze({
	'X-Response-Id': '456',
	'Content-Encoding': null,
	'Content-Length': null,
	'Content-Range': 'bytes 0-2/1024',
});

/** Thirteen ordinary upstream registrations; client disconnect has its own deterministic lifetime test. */
export const vectors: readonly ProxyVector[] = Object.freeze<ProxyVector[]>([
	{
		id: 'compressed',
		title: 'compressed',
		line: 76,
		path: '/proxy/compressed',
		mode: 'input-request',
		hono: {
			status: 200,
			body: 'ok',
			headers: compressedHeaders,
			request: { url: 'https://example.com/compressed', headers: { 'X-Request-Id': '123', 'Accept-Encoding': null } },
		},
		utils: {
			status: 200,
			body: 'ok',
			headers: compressedHeaders,
			request: { url: 'https://example.com/compressed', headers: { 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' } },
		},
		difference:
			'Hono removes explicitly supplied Accept-Encoding; gateway forwards it. Both expect Fetch-decoded response metadata.',
	},
	{
		id: 'uncompressed',
		title: 'uncompressed',
		line: 102,
		path: '/proxy/uncompressed',
		mode: 'input-request',
		hono: {
			status: 200,
			body: 'ok',
			headers: { 'X-Response-Id': '456', 'Content-Length': '2', 'Content-Range': 'bytes 0-2/1024' },
			request: { url: 'https://example.com/uncompressed', headers: { 'X-Request-Id': '123', 'Accept-Encoding': null } },
		},
		utils: {
			status: 200,
			body: 'ok',
			headers: { 'X-Response-Id': '456', 'Content-Length': '2', 'Content-Range': 'bytes 0-2/1024' },
			request: {
				url: 'https://example.com/uncompressed',
				headers: { 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' },
			},
		},
		difference: 'Request encoding negotiation differs; uncompressed response length remains valid in both.',
	},
	{
		id: 'post',
		title: 'POST request',
		line: 127,
		path: '/proxy/post',
		mode: 'raw',
		method: 'POST',
		body: 'test',
		hono: { status: 200, body: 'request body: test', request: { url: 'https://example.com/post' } },
		utils: { status: 200, body: 'request body: test', request: { url: 'https://example.com/post' } },
	},
	{
		id: 'hop-default',
		title: 'remove hop-by-hop headers',
		line: 151,
		path: '/proxy/hop-by-hop',
		mode: 'raw',
		headers: hopInput,
		hono: {
			status: 200,
			body: 'ok',
			headers: { 'Transfer-Encoding': null },
			request: {
				url: 'https://example.com/hop-by-hop',
				headers: {
					Host: 'example.com',
					Connection: null,
					'Keep-Alive': null,
					'Proxy-Authorization': null,
					'Custom-Header': 'test',
					'Allowed-Custom-Header': 'test',
				},
			},
		},
		utils: {
			status: 200,
			body: 'ok',
			headers: { 'Transfer-Encoding': null },
			request: {
				url: 'https://example.com/hop-by-hop',
				headers: {
					Host: null,
					Connection: null,
					'Keep-Alive': null,
					'Proxy-Authorization': null,
					'Custom-Header': null,
					'Allowed-Custom-Header': 'test',
				},
			},
		},
		difference:
			'Gateway strips caller Host and Connection-nominated fields; default Hono intentionally keeps the nominated Custom-Header.',
	},
	{
		id: 'hop-strict',
		title: 'remove hop-by-hop headers with strictConnectionProcessing',
		line: 177,
		path: '/proxy/hop-by-hop',
		mode: 'strict',
		headers: hopInput,
		hono: {
			status: 200,
			body: 'ok',
			headers: { 'Transfer-Encoding': null },
			request: {
				url: 'https://example.com/hop-by-hop',
				headers: {
					Host: 'example.com',
					Connection: null,
					'Keep-Alive': null,
					'Proxy-Authorization': null,
					'Custom-Header': null,
					'Allowed-Custom-Header': 'test',
				},
			},
		},
		utils: {
			status: 200,
			body: 'ok',
			headers: { 'Transfer-Encoding': null },
			request: {
				url: 'https://example.com/hop-by-hop',
				headers: {
					Host: null,
					Connection: null,
					'Keep-Alive': null,
					'Proxy-Authorization': null,
					'Custom-Header': null,
					'Allowed-Custom-Header': 'test',
				},
			},
		},
		difference: 'Strict request nomination removal agrees; gateway still removes caller-selected Host.',
	},
	{
		id: 'hop-invalid',
		title: 'invalid hop-by-hop headers with strictConnectionProcessing',
		line: 208,
		path: '/proxy/hop-by-hop',
		mode: 'strict',
		headers: {
			Host: 'example.com',
			Connection: 'keep-alive, invalid-header invalid-header',
			'Keep-Alive': 'timeout=5, max=1000',
		},
		hono: { status: 400, request: null },
		utils: {
			status: 200,
			body: 'ok',
			headers: { 'Transfer-Encoding': null },
			request: { url: 'https://example.com/hop-by-hop', headers: { Host: null, Connection: null, 'Keep-Alive': null } },
		},
		difference:
			'Hono strict mode rejects malformed nomination syntax; generic gateway forwarding ignores invalid tokens while stripping valid nominations.',
	},
	{
		id: 'hop-option',
		title: 'specify hop-by-hop header by options',
		line: 228,
		path: '/proxy/hop-by-hop',
		mode: 'explicit-hop',
		hono: {
			status: 200,
			body: 'ok',
			headers: { 'Transfer-Encoding': null },
			request: { url: 'https://example.com/hop-by-hop', headers: { 'Proxy-Authorization': 'Basic 123456' } },
		},
		utils: {
			status: 200,
			body: 'ok',
			headers: { 'Transfer-Encoding': null },
			request: { url: 'https://example.com/hop-by-hop', headers: { 'Proxy-Authorization': null } },
		},
		difference:
			'Explicit Hono init may restore a hop credential; gateway transport policy strips it and forbids trusted adapter patches from restoring it.',
	},
	{
		id: 'connection-response',
		title: 'remove response headers listed in the Connection header',
		line: 246,
		path: '/proxy/connection-listed',
		mode: 'none',
		hono: {
			status: 200,
			body: 'ok',
			headers: { Connection: null, 'X-Connection-Scoped': null, 'X-Normal': 'kept' },
			request: { url: 'https://example.com/connection-listed' },
		},
		utils: {
			status: 200,
			body: 'ok',
			headers: { Connection: null, 'X-Connection-Scoped': null, 'X-Normal': 'kept' },
			request: { url: 'https://example.com/connection-listed' },
		},
	},
	{
		id: 'modify',
		title: 'modify header',
		line: 256,
		path: '/proxy/set-cookie',
		mode: 'modify',
		hono: {
			status: 200,
			body: 'ok',
			headers: { 'Set-Cookie': null, 'X-Response-Id': '456' },
			request: { url: 'https://example.com/set-cookie' },
		},
		utils: {
			status: 200,
			body: 'ok',
			headers: { 'Set-Cookie': null, 'X-Response-Id': '456' },
			request: { url: 'https://example.com/set-cookie' },
		},
	},
	{
		id: 'undefined-auth',
		title: 'does not propagate undefined request headers',
		line: 274,
		path: '/proxy/ok',
		mode: 'undefined-auth',
		headers: { Authorization: 'Bearer 123' },
		hono: { status: 200, body: 'ok', request: { url: 'https://example.com/ok', headers: { Authorization: null } } },
		utils: { status: 200, body: 'ok', request: { url: 'https://example.com/ok', headers: { Authorization: null } } },
		difference:
			'Hono deletes an explicit undefined override; gateway uses its declared default credential stripping policy instead of accepting undefined Headers values.',
	},
	{
		id: 'not-found',
		title: 'not found',
		line: 307,
		path: '/proxy/404',
		mode: 'none',
		hono: { status: 404, body: 'not found', request: { url: 'https://example.com/404' } },
		utils: { status: 404, body: 'not found', request: { url: 'https://example.com/404' } },
	},
	{
		id: 'request-init',
		title: 'pass a Request object to proxyInit',
		line: 314,
		path: '/proxy/compressed',
		mode: 'proxy-init-request',
		hono: {
			status: 200,
			body: 'ok',
			request: { url: 'https://example.com/compressed', headers: { 'X-Request-Id': '123', 'Accept-Encoding': null } },
		},
		utils: {
			status: 200,
			body: 'ok',
			request: { url: 'https://example.com/compressed', headers: { 'X-Request-Id': '123', 'Accept-Encoding': 'gzip' } },
		},
		difference:
			'Hono accepts Request as its init overload; gateway accepts a native Request through its Fetch handler. Encoding negotiation differs.',
	},
	{
		id: 'custom-fetch',
		title: 'Should call the custom fetch method when specified',
		line: 336,
		path: '/',
		mode: 'custom-fetch',
		method: 'POST',
		body: 'hi',
		hono: { status: 200, body: 'custom fetch response. message:hi', request: { url: 'https://example.com/' } },
		utils: { status: 200, body: 'custom fetch response. message:hi', request: { url: 'https://example.com/' } },
	},
]);
