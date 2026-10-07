/** Independent application contract shared by correctness tests and benchmarks. @module */

/** Each candidate owns its live application and releases it after all requests finish. */
export interface ParityApiType {
	readonly fetch: (request: Request) => Promise<Response>;
	readonly close: () => Promise<void>;
}

/** One authored input and expected observable result; neither candidate constructs expectations. */
export interface CaseType {
	readonly id: string;
	readonly path: string;
	readonly method?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string | readonly string[];
	readonly expected: {
		readonly status: number;
		readonly body: unknown;
		readonly headers?: Readonly<Record<string, string | null>>;
		readonly bodyMissing?: boolean;
	};
	/** Some generic service errors have additional framework-specific details outside this shared contract. */
	readonly jsonFields?: readonly string[];
}

export const bodyLimit = 14;
export const jsonLimit = 48;

/** Explicit routing, state, error, and real streamed-input cases, including adapted upstream contracts. */
export const cases: readonly CaseType[] = [
	{
		id: 'health',
		path: '/health',
		expected: { status: 200, body: 'ready', headers: { 'x-api': 'parity', 'x-method': 'GET' } },
	},
	{
		id: 'head-fallback',
		method: 'HEAD',
		path: '/health',
		expected: { status: 200, body: '', bodyMissing: true, headers: { 'x-api': 'parity', 'x-method': 'HEAD' } },
	},
	{
		id: 'static-before-parameter',
		path: '/items/current',
		expected: { status: 200, body: { id: 'current', kind: 'static' } },
	},
	{
		id: 'parameter-and-repeated-query',
		path: '/items/42?tag=a&tag=b',
		expected: { status: 200, body: { id: '42', kind: 'dynamic', tags: ['a', 'b'] } },
	},
	{
		id: 'encoded-unicode-parameter',
		path: '/items/%C3%A7awa%20y%C3%AE%3F',
		expected: { status: 200, body: { id: 'çawa yî?', kind: 'dynamic', tags: [] } },
	},
	{
		id: 'encoded-slash-is-one-segment',
		path: '/items/item%2Fnotes',
		expected: { status: 200, body: { id: 'item/notes', kind: 'dynamic', tags: [] } },
	},
	{
		id: 'malformed-percent-parameter',
		path: '/items/%E0%A4',
		expected: { status: 400, body: { code: 'invalid-parameter' } },
	},
	{ id: 'double-slash-path', path: '/items//current', expected: { status: 404, body: 'missing' } },
	{ id: 'head-not-found', method: 'HEAD', path: '/missing', expected: { status: 404, body: '', bodyMissing: true } },
	{ id: 'head-error', method: 'HEAD', path: '/fault', expected: { status: 500, body: '', bodyMissing: true } },
	{
		id: 'head-mounted-route',
		method: 'HEAD',
		path: '/service/status',
		expected: { status: 200, body: '', bodyMissing: true },
	},
	{
		id: 'head-mounted-not-found',
		method: 'HEAD',
		path: '/service/missing',
		expected: { status: 404, body: '', bodyMissing: true },
	},
	{ id: 'empty-parameter', path: '/items/', expected: { status: 404, body: 'missing' } },
	{ id: 'double-slash-extra-segment', path: '/items//extra', expected: { status: 404, body: 'missing' } },
	{ id: 'strict-no-trailing-slash', path: '/slash', expected: { status: 200, body: 'without' } },
	{ id: 'strict-trailing-slash', path: '/slash/', expected: { status: 200, body: 'with' } },
	{ id: 'unregistered-trailing-slash', path: '/health/', expected: { status: 404, body: 'missing' } },
	{ id: 'wrong-method', path: '/health', method: 'POST', expected: { status: 404, body: 'missing' } },
	{ id: 'custom-not-found', path: '/missing', expected: { status: 404, body: 'missing' } },
	{
		id: 'owned-state-and-onion',
		path: '/state',
		headers: { 'x-actor': 'ada' },
		expected: {
			status: 200,
			body: { actor: 'ada' },
			headers: { 'x-order': 'outer:before,inner:before,handler,inner:after,outer:after' },
		},
	},
	{
		id: 'state-isolation',
		path: '/state',
		headers: { 'x-actor': 'grace' },
		expected: {
			status: 200,
			body: { actor: 'grace' },
			headers: { 'x-order': 'outer:before,inner:before,handler,inner:after,outer:after' },
		},
	},
	{ id: 'safe-error-policy', path: '/fault', expected: { status: 500, body: { code: 'internal' } } },
	{
		id: 'json-input',
		path: '/json',
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{"message":"hello"}',
		expected: { status: 200, body: { message: 'hello' } },
	},
	{
		id: 'json-malformed',
		path: '/json',
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{bad',
		expected: { status: 400, body: { code: 'invalid-json' } },
	},
	{
		id: 'json-media-type',
		path: '/json',
		method: 'POST',
		headers: { 'content-type': 'text/plain' },
		body: '{"message":"hello"}',
		expected: { status: 415, body: { code: 'unsupported-content-type' } },
	},
	{
		id: 'json-too-large',
		path: '/json',
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{"message":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"}',
		expected: { status: 413, body: { code: 'body-too-large' } },
	},
	{
		id: 'text-exact-limit',
		path: '/body',
		method: 'POST',
		body: 'hono is so hot',
		expected: { status: 200, body: 'hono is so hot' },
	},
	{
		id: 'text-over-limit',
		path: '/body',
		method: 'POST',
		body: 'hono is so hot!',
		expected: { status: 413, body: { code: 'body-too-large' } },
	},
	{
		id: 'utf8-exact-byte-limit',
		path: '/body',
		method: 'POST',
		// Each snow character is three UTF-8 bytes. The ASCII remainder fills the declared limit.
		body: '雪'.repeat(Math.floor(bodyLimit / 3)) + 'a'.repeat(bodyLimit % 3),
		expected: { status: 200, body: '雪雪雪雪aa' },
	},
	{
		id: 'utf8-over-byte-limit',
		path: '/body',
		method: 'POST',
		body: '雪'.repeat(Math.floor(bodyLimit / 3)) + 'a'.repeat(bodyLimit % 3) + '!',
		expected: { status: 413, body: { code: 'body-too-large' } },
	},
	{ id: 'streamed-text', path: '/body', method: 'POST', body: ['a', 'b', 'c'], expected: { status: 200, body: 'abc' } },
	{
		id: 'framing-bypass',
		path: '/body',
		method: 'POST',
		headers: { 'content-length': '5', 'transfer-encoding': 'chunked' },
		body: ['1234', '5678901234567890'],
		expected: { status: 413, body: { code: 'body-too-large' } },
	},
	{
		id: 'no-read-handler-still-admitted',
		path: '/body/no-read',
		method: 'POST',
		headers: { 'transfer-encoding': 'chunked' },
		body: ['1234', '5678901234567890'],
		expected: { status: 413, body: { code: 'body-too-large' } },
	},
	{
		id: 'compiled-service-json-transform',
		path: '/service/accounts',
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{"name":" Ada "}',
		expected: { status: 200, body: { name: 'Ada', saved: true } },
	},
	{
		id: 'compiled-service-validation',
		path: '/service/accounts',
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{"name":42}',
		expected: { status: 400, body: { type: 'urn:utils:server:invalid-request', status: 400 } },
		jsonFields: ['type', 'status'],
	},
];

/** The provider echoes actual forwarded wire data; literal expectations below remain independent. */
export async function upstream(request: Request): Promise<Response> {
	const url = new URL(request.url);
	return Response.json({
		method: request.method,
		origin: url.origin,
		path: url.pathname,
		query: url.search,
		body: await request.text(),
		authorization: request.headers.get('authorization'),
		cookie: request.headers.get('cookie'),
		actor: request.headers.get('x-trusted-actor'),
		trustedExtra: request.headers.get('x-trusted-extra'),
		realIp: request.headers.get('x-real-ip'),
		hopByHop: request.headers.get('x-hop'),
		forwardedFor: request.headers.get('x-forwarded-for'),
		forwardedHost: request.headers.get('x-forwarded-host'),
		forwardedProto: request.headers.get('x-forwarded-proto'),
		requestId: request.headers.get('x-request-id'),
	}, {
		headers: {
			'set-cookie': 'upstream=secret',
			connection: 'x-upstream-hop',
			'x-upstream-hop': 'local-response',
			'x-upstream': 'kept',
		},
	});
}

export const gatewayCases: readonly CaseType[] = [{
	id: 'gateway-forwarding-policy',
	path: '/service/echo?tag=a&tag=b',
	method: 'POST',
	body: 'payload',
	headers: {
		authorization: 'Bearer caller-secret',
		cookie: 'session=caller-secret',
		'x-trusted-actor': 'spoofed',
		'x-trusted-extra': 'second-spoofed-value',
		'x-forwarded-for': 'spoofed',
		'x-real-ip': 'spoofed',
		connection: 'x-hop',
		'x-hop': 'private-transport',
	},
	expected: {
		status: 200,
		body: {
			method: 'POST',
			origin: 'https://upstream.invalid',
			path: '/service/echo',
			query: '?tag=a&tag=b',
			body: 'payload',
			authorization: null,
			cookie: null,
			actor: null,
			trustedExtra: null,
			realIp: null,
			hopByHop: null,
			forwardedFor: '203.0.113.9',
			forwardedHost: 'gateway.invalid',
			forwardedProto: 'https',
			requestId: 'parity-request',
		},
		headers: {
			'set-cookie': null,
			connection: null,
			'x-upstream': 'kept',
			'x-upstream-hop': null,
			'cache-control': 'no-store',
			'x-request-id': 'parity-request',
		},
	},
}];

/** Create fresh bodies for every execution; one-shot streams are never reused across candidates. */
export function request(value: CaseType, origin = 'https://api.invalid'): Request {
	let body: BodyInit | undefined;
	if (Array.isArray(value.body)) {
		const pieces: readonly string[] = value.body;
		let index = 0;
		body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (index === pieces.length) controller.close();
				else controller.enqueue(new TextEncoder().encode(pieces[index++]!));
			},
		});
	} else if (typeof value.body === 'string') body = value.body;
	const init: RequestInit & { duplex: 'half' } = {
		method: value.method ?? 'GET',
		headers: value.headers,
		duplex: 'half',
		...(body === undefined ? {} : { body }),
	};
	return new Request(new URL(value.path, origin), init);
}

/** Consume actual output and select only the explicitly authored shared header/error contract. */
export async function observe(response: Response, value: CaseType): Promise<CaseType['expected']> {
	const bodyMissing = response.body === null;
	const text = await response.text();
	let body: unknown = typeof value.expected.body === 'string' ? text : JSON.parse(text);
	if (value.jsonFields !== undefined) {
		if (typeof body !== 'object' || body === null) throw new TypeError('Expected an object error response.');
		body = Object.fromEntries(value.jsonFields.map((key) => [key, (body as Readonly<Record<string, unknown>>)[key]]));
	}
	return {
		status: response.status,
		body,
		...(value.expected.bodyMissing === undefined ? {} : { bodyMissing }),
		...(value.expected.headers === undefined ? {} : {
			headers: Object.fromEntries(Object.keys(value.expected.headers).map((key) => [key, response.headers.get(key)])),
		}),
	};
}

/** Separate route-table workload; its generated positions never alter the application corpus. */
export function routingCases(routeCount: number): readonly CaseType[] {
	if (!Number.isSafeInteger(routeCount) || routeCount < 2 || routeCount % 2 !== 0) {
		throw new TypeError('Route count must be a positive even table size.');
	}
	const half = routeCount / 2;
	const middle = Math.floor(half / 2);
	return [
		{ id: 'static-first', path: '/fixed/0', expected: { status: 200, body: { kind: 'static', slot: 0 } } },
		{
			id: 'static-middle',
			path: `/fixed/${middle}`,
			expected: { status: 200, body: { kind: 'static', slot: middle } },
		},
		{
			id: 'static-last',
			path: `/fixed/${half - 1}`,
			expected: { status: 200, body: { kind: 'static', slot: half - 1 } },
		},
		{
			id: 'dynamic-first',
			path: '/groups/0/work',
			expected: { status: 200, body: { kind: 'dynamic', slot: 0, id: 'work' } },
		},
		{
			id: 'dynamic-middle',
			path: `/groups/${middle}/work%2Fitem`,
			expected: { status: 200, body: { kind: 'dynamic', slot: middle, id: 'work/item' } },
		},
		{
			id: 'dynamic-last',
			path: `/groups/${half - 1}/work`,
			expected: { status: 200, body: { kind: 'dynamic', slot: half - 1, id: 'work' } },
		},
		{ id: 'static-miss', path: `/fixed/${half}`, expected: { status: 404, body: { code: 'missing' } } },
		{ id: 'dynamic-miss', path: `/groups/${half}/work`, expected: { status: 404, body: { code: 'missing' } } },
	];
}
