/** Direct Utils candidates. This module never imports Hono or its adapter package. @module */
import {
	memoize,
	parseForm,
	parseHeaders,
	parseParameters,
	parseQuery,
	readBody,
	RequestTransportError,
} from '@okikio/http/request';
import { appendHeaders, mergeHeaders, toHeaders } from '@okikio/http/response';
import type { ResponseHeaders } from '@okikio/http/response';
import { catchErrors, create, matchRoute, mount, prepareRoutes, route, routeKey } from '@okikio/server/http';
import type { Middleware, RouteType } from '@okikio/server/http';
import type { ApplicationType, MatchType, RequestCaseType, ResponseCaseType, RouterCaseType } from './types.ts';

/** Select one prepared route owner, then use the actual bounded parameter parser. */
export function matchUtils(
	input: Pick<RouterCaseType, 'routes' | 'method' | 'path'>,
): readonly MatchType[] | 'registration-rejected' {
	let plan: ReturnType<typeof prepareRoutes>;
	try {
		plan = prepareRoutes(input.routes.map(([method, path]) => ({ kind: 'route', method, path })));
	} catch (error) {
		if (error instanceof TypeError) return 'registration-rejected';
		throw error;
	}
	const selected = matchRoute(plan, input.method, input.path);
	if (selected === undefined) return [];
	const authored = input.routes.find(([method, path]) => routeKey({ kind: 'route', method, path }) === selected);
	if (!authored) throw new Error('A selected route must retain its authored owner.');
	return [{ handler: authored[2], params: { ...parseParameters(authored[1], input.path) } }];
}

/** Explicit byte caching is an application composition, not an implicit readBody contract. */
export async function readUtils(input: Omit<RequestCaseType, 'expected' | 'utilsExpected'>): Promise<unknown> {
	if (input.operation === 'headers-prototype' || input.operation === 'headers-prototype-injected') {
		const raw = new Request('http://localhost', {
			headers: input.operation === 'headers-prototype' ? { __proto__: 'evil' } : [['__proto__', 'evil']],
		});
		const fields = parseHeaders(raw.headers);
		return {
			prototypeNull: Object.getPrototypeOf(fields) === null,
			...(input.operation === 'headers-prototype-injected' ? { value: fields['__proto__'] } : {}),
		};
	}
	if (input.operation === 'clone-get') {
		const raw = new Request('http://localhost', {
			headers: { 'User-Agent': 'test-agent' },
			cache: 'default',
			redirect: 'manual',
			referrerPolicy: 'no-referrer',
		});
		const copy = raw.clone();
		return {
			method: copy.method,
			url: copy.url,
			agent: copy.headers.get('user-agent'),
			cache: copy.cache,
			redirect: copy.redirect,
			referrerPolicy: copy.referrerPolicy,
			different: copy !== raw,
		};
	}
	if (
		input.operation === 'raw-consumed-clone' || input.operation === 'external-cache-clone' ||
		input.operation === 'multipart-clone' || input.operation === 'multipart-stale-clone'
	) {
		const form = new FormData();
		form.append('foo', 'bar');
		form.append('file', new File(['hello'], 't.txt', { type: 'text/plain' }));
		const body = ['--boundary', 'Content-Disposition: form-data; name="foo"', '', 'bar', '--boundary--', ''].join(
			'\r\n',
		);
		const raw = new Request('http://localhost', {
			method: 'POST',
			body: input.operation === 'multipart-clone'
				? form
				: input.operation === 'multipart-stale-clone'
				? body
				: '{"foo":"bar"}',
			...(input.operation === 'multipart-stale-clone'
				? {
					headers: {
						'Content-Type': 'multipart/form-data; boundary=boundary',
						'Content-Length': String(new TextEncoder().encode(body).length),
					},
				}
				: {}),
		});
		if (input.operation.startsWith('multipart')) await parseForm(raw, { maximumBodyBytes: 4096 });
		else await readBody(raw, { maximumBodyBytes: 1024 });
		try {
			raw.clone();
		} catch (error) {
			if (error instanceof TypeError) {
				return { rejected: true, ...(input.operation === 'raw-consumed-clone' ? { kind: 'TypeError' } : {}) };
			}
			throw error;
		}
		throw new Error('A consumed native request must not be silently reconstructed.');
	}
	if (input.operation === 'clone') {
		const raw = new Request('http://localhost', {
			method: 'POST',
			body: input.body,
			headers: { 'Content-Type': 'application/json', 'X-Custom-Header': 'custom-value' },
			cache: 'no-cache',
			credentials: 'include',
			integrity: 'sha256-test',
			mode: 'cors',
			redirect: 'follow',
			referrer: 'http://example.com',
			referrerPolicy: 'origin',
		});
		const copy = raw.clone();
		const text = new TextDecoder().decode(await readBody(copy, { maximumBodyBytes: 1024 }));
		await raw.body?.cancel();
		return {
			method: copy.method,
			url: copy.url,
			text,
			headers: Object.fromEntries(copy.headers),
			cache: copy.cache,
			credentials: copy.credentials,
			integrity: copy.integrity,
			mode: copy.mode,
			redirect: copy.redirect,
			referrer: copy.referrer,
			referrerPolicy: copy.referrerPolicy,
			different: copy !== raw,
		};
	}
	if (input.operation === 'consumed-clone') {
		const raw = new Request('http://localhost', { method: 'POST', body: input.body });
		await readBody(raw, { maximumBodyBytes: 1024 });
		try {
			raw.clone();
		} catch (error) {
			if (error instanceof TypeError) return { rejected: true };
			throw error;
		}
		throw new Error('A consumed native request must not be silently reconstructed.');
	}
	if (input.operation === 'form') {
		const form = new FormData();
		form.append('foo', 'bar');
		if (input.keys?.includes('file')) form.append('file', new File(['hello'], 't.txt', { type: 'text/plain' }));
		const fields = await parseForm(new Request('http://localhost', { method: 'POST', body: form }), {
			maximumBodyBytes: 4096,
		});
		const result: Record<string, unknown> = {};
		for (const key of input.keys ?? []) {
			const value = fields[key];
			result[key] = value instanceof File ? { name: value.name, type: value.type, text: await value.text() } : value;
		}
		return result;
	}
	const body = input.body === undefined
		? undefined
		: input.bodyKind === 'bytes'
		? new TextEncoder().encode(input.body)
		: input.bodyKind === 'blob'
		? new Blob([input.body], { type: 'application/json' })
		: input.body;
	const req = new Request(input.url ?? 'http://localhost', {
		...(body === undefined ? {} : { method: 'POST', body }),
		headers: input.headers,
	});
	if (input.operation === 'query') {
		const query = parseQuery(new URL(req.url).search);
		return Object.fromEntries((input.keys ?? []).map((key) => [key, query[key] ?? null]));
	}
	if (input.operation === 'headers') {
		const headers = parseHeaders(req.headers);
		return Object.fromEntries((input.keys ?? []).map((key) => [key, headers[key.toLowerCase()] ?? null]));
	}
	const key = Symbol('bounded body');
	const view = async (kind: NonNullable<RequestCaseType['order']>[number]): Promise<unknown> => {
		const bytes = await memoize(req, key, () => readBody(req, { maximumBodyBytes: 1024 }));
		if (kind === 'bytes' || kind === 'arrayBuffer') return [...bytes];
		const text = new TextDecoder().decode(bytes);
		if (kind === 'text') return text;
		if (kind === 'json') return JSON.parse(text);
		// Compare the charset token semantically without weakening the cached text/byte observations.
		return {
			text,
			type: (req.headers.get('content-type') ?? '').replace(
				/(^|;)\s*charset\s*=\s*"?utf-8"?(?=\s*(?:;|$))/gi,
				'$1charset=utf-8',
			),
		};
	};
	if (input.operation === 'non-form' || input.operation === 'nonform-invalid') {
		try {
			await parseForm(req);
		} catch (error) {
			if (!(error instanceof RequestTransportError)) throw error;
			if (input.operation === 'nonform-invalid') {
				try {
					await req.formData();
				} catch (formError) {
					if (formError instanceof TypeError) return { code: error.issues[0]!.code, rejected: true };
					throw formError;
				}
				throw new Error('JSON must not be decoded as a form.');
			}
			return { code: error.issues[0]!.code, view: await view(input.order![0]!) };
		}
		throw new Error('A JSON request must not be accepted as a form.');
	}
	const result: unknown[] = [];
	for (const kind of input.order ?? []) result.push(await view(kind));
	return result;
}

/** Assemble the selected output contract with explicit Utils header ownership and native Responses. */
export async function respondUtils(input: Omit<ResponseCaseType, 'expected'>): Promise<Response> {
	if (input.operation === 'replace-cookie') {
		return new Response(null, {
			headers: toHeaders(mergeHeaders(
				{ 'set-cookie': 'foo3=bar3; Path=/' },
				{ 'set-cookie': ['foo=bar; Path=/', 'foo2=bar2; Path=/'] },
			)),
		});
	}
	if (input.operation === 'compose-cookie') {
		return new Response('{"message":"Hello"}', {
			headers: toHeaders(appendHeaders(
				{ 'set-cookie': 'foo=bar; Path=/' },
				{ 'set-cookie': 'foo2=bar2; Path=/' },
			)),
		});
	}
	if (input.operation === 'init-cookie') {
		return new Response('', {
			headers: toHeaders(appendHeaders(
				{ 'set-cookie': ['context=1; Path=/', 'context=2; Path=/'] },
				{ 'set-cookie': 'response=1; Path=/' },
			)),
		});
	}
	let fields: ResponseHeaders = {};
	for (const [name, value, append] of input.before ?? []) {
		if (value === null) {
			fields = mergeHeaders(
				Object.fromEntries(Object.entries(fields).filter(([key]) => key.toLowerCase() !== name.toLowerCase())),
			);
		} else fields = append ? appendHeaders(fields, { [name]: value }) : mergeHeaders(fields, { [name]: value });
	}
	if (input.operation === 'redirect') {
		const location = input.location!;
		return new Response(null, {
			status: 302,
			headers: toHeaders({ Location: location.startsWith('/') ? location : new URL(location).href }),
		});
	}
	let render = input.operation;
	let status: number = input.status ?? 200;
	if (input.operation === 'response-init') {
		fields = mergeHeaders(fields, input.original!.headers);
		status = input.original!.status;
		render = input.id.endsWith('-json')
			? 'json'
			: input.id.endsWith('-html')
			? 'html'
			: input.id.endsWith('-text')
			? 'text'
			: 'body';
	}
	if (render === 'text') fields = mergeHeaders(fields, { 'Content-Type': 'text/plain; charset=UTF-8' });
	if (render === 'html' || render === 'async-html') {
		fields = mergeHeaders(fields, { 'Content-Type': 'text/html; charset=UTF-8' });
	}
	if (render === 'json') fields = mergeHeaders(fields, { 'Content-Type': 'application/json' });
	// A Hono record processes case variants in order and uses [] as deletion.
	// Utils exposes replacement/append separately, so the application states those operations explicitly.
	for (const [name, value] of Object.entries(input.headers ?? {})) {
		fields = typeof value !== 'string' && value.length === 0
			? mergeHeaders(
				Object.fromEntries(Object.entries(fields).filter(([key]) => key.toLowerCase() !== name.toLowerCase())),
			)
			: mergeHeaders(fields, { [name]: value });
	}
	const body = render === 'json'
		? JSON.stringify(input.body)
		: render === 'async-html'
		? await Promise.resolve(typeof input.body === 'string' ? input.body : '')
		: typeof input.body === 'string'
		? input.body
		: null;
	return new Response(body, { status, headers: toHeaders(fields) });
}

/** Real Fetch routing/middleware/mounts, independent of the Hono implementation. */
export function createUtils(kind: ApplicationType): { fetch(request: Request): Promise<Response> } {
	const routes: RouteType[] = [];
	const middleware: Middleware[] = [];
	let notFound = () => new Response('404 Not Found', { status: 404 });
	const param = (request: Request, template: string, key: string) =>
		parseParameters(template, new URL(request.url).pathname)[key];
	if (kind === 'encoded-param' || kind === 'encoded-posts') {
		routes.push(
			route(
				'GET',
				'/users/:id',
				(request) =>
					new Response(`${kind === 'encoded-posts' ? 'posts of' : 'id is'} ${param(request, '/users/:id', 'id')}`),
			),
		);
	} else if (kind === 'encoded-static') routes.push(route('GET', '/users/static', () => new Response('static')));
	else if (kind === 'encoded-invalid') {
		routes.push(
			route(
				'GET',
				'/static/:path',
				(request) => new Response(`by c.req.param: ${param(request, '/static/:path', 'path')}`),
			),
		);
	} else if (kind === 'parameters') {
		routes.push(route('GET', '/entry/:id', (request) => new Response(`id is ${param(request, '/entry/:id', 'id')}`)));
		routes.push(route('GET', '/search', (request) => {
			const value = parseQuery(new URL(request.url).search).name;
			return new Response(`name is ${typeof value === 'string' ? value : value?.[0]}`);
		}));
		routes.push(route('GET', '/multiple-values', (request) => {
			const values = parseQuery(new URL(request.url).search);
			return new Response(
				`q is ${values.q![0]} and ${values.q![1]}, limit is ${
					typeof values.limit === 'string' ? values.limit : values.limit![0]
				}`,
			);
		}));
		routes.push(
			route('GET', '/add-header', (request) => new Response(`foo is ${parseHeaders(request.headers)['x-foo']}`)),
		);
	} else if (kind === 'path') {
		for (const path of ['/', '/search']) {
			routes.push(route('GET', path, (request) => new Response(new URL(request.url).pathname)));
		}
	} else if (kind === 'methods') {
		routes.push(route('PURGE', '/hello', () => new Response('hello')));
		for (const method of ['PUT', 'DELETE']) {
			routes.push(
				route(
					method,
					'/posts/:id',
					(request) => Response.json({ postId: param(request, '/posts/:id', 'id'), method: request.method }),
				),
			);
		}
		routes.push(route('QUERY', '/query', () => new Response('Accepted', { status: 202 })));
	} else if (kind === 'middleware') {
		middleware.push(async (request, next) => {
			const response = await next(request);
			response.headers.append('x-custom', 'root');
			return response;
		});
		middleware.push(async (request, next) => {
			const response = await next(request);
			if (new URL(request.url).pathname === '/hello') response.headers.append('x-message', 'custom-header');
			return response;
		});
		middleware.push(async (request, next) => {
			const response = await next(request);
			const path = new URL(request.url).pathname;
			if (path === '/hello' || path.startsWith('/hello/')) response.headers.append('x-message-2', 'custom-header-2');
			return response;
		});
		routes.push(
			route('GET', '/hello', () => new Response('hello')),
			route('GET', '/hello/:message', (request) => new Response(param(request, '/hello/:message', 'message'))),
			route('GET', '/json', () => Response.json({ message: 'hello' })),
		);
		notFound = () => new Response('Not Found Foo', { status: 404 });
	} else if (kind === 'chained' || kind === 'multiple') {
		middleware.push(async (request, next) => {
			request.headers.append('x-before', 'abc');
			return await next(request);
		});
		middleware.push(async (request, next) => {
			const response = await next(request);
			response.headers.set('x-after', request.headers.get('x-before')!);
			return response;
		});
		routes.push(route('GET', `/${kind}/abc`, () => new Response(`GET ${kind}`)));
	} else if (kind === 'replacement') {
		middleware.push(async (request, next) => {
			const response = await next(request);
			await response.body?.cancel();
			return new Response('Middleware', {
				headers: new URL(request.url).pathname === '/normal' ? toHeaders(mergeHeaders(response.headers)) : undefined,
			});
		});
		for (const path of ['/normal', '/overwrite']) {
			routes.push(route('GET', path, () => new Response('Handler', { headers: { 'x-custom': 'foo' } })));
		}
	} else if (kind === 'missing') notFound = () => new Response('Custom 404 Not Found', { status: 404 });
	else if (kind === 'missing-one' || kind === 'missing-two') {
		for (const suffix of kind === 'missing-one' ? [' + Middleware'] : [' + Middleware 1', ' + Middleware 2']) {
			middleware.push(async (request, next) => {
				const response = await next(request);
				return new Response(await response.text() + suffix, response);
			});
		}
	} else if (kind === 'error' || kind === 'async-error') {
		middleware.push(catchErrors({
			map: async (error) => {
				const suffix = kind === 'async-error' ? ` with ${await Promise.resolve('Promised')}` : '';
				return new Response(`Custom Error Message${suffix}`, {
					status: 500,
					headers: { 'x-debug': error instanceof Error ? error.message : 'Unexpected error' },
				});
			},
		}));
		middleware.push(async (request, next) => {
			if (new URL(request.url).pathname === '/error-middleware') throw new Error('This is Middleware Error');
			return await next(request);
		});
		routes.push(route('GET', '/error', () => {
			throw new Error('This is Error');
		}));
	} else if (kind === 'missing-error') {
		notFound = () => {
			throw new Error('Error in Not Found');
		};
		middleware.push(
			catchErrors({
				map: (error) => new Response(error instanceof Error ? error.message : 'Unexpected error', { status: 400 }),
			}),
		);
	} else if (kind.startsWith('mount')) {
		if (kind === 'mount') {
			middleware.push(async (request, next) => {
				const response = await next(request);
				response.headers.set('x-message', 'Foo');
				return response;
			});
			routes.push(route('GET', '/', () => new Response('Hono')));
			const child = (request: Request) => {
				const url = new URL(request.url);
				if (url.pathname === '/') return new Response('AnotherApp');
				if (url.pathname === '/hello') return new Response('Hello from AnotherApp');
				if (url.pathname === '/header') return new Response(request.headers.get('x-message'));
				if (url.pathname === '/with-query') return new Response(url.searchParams.toString());
				return new Response('Not Found from AnotherApp', { status: 404 });
			};
			routes.push(
				mount('/another-app', child, { requestPath: 'strip-prefix' }),
				mount('/another-app2/sub-slash/', child, { requestPath: 'strip-prefix' }),
			);
		} else if (kind === 'mount-api') {
			routes.push(mount('/api/another-app', () => new Response('AnotherApp'), { requestPath: 'strip-prefix' }));
		} else {routes.push(
				mount(
					kind === 'mount-unicode' ? '/api/é' : kind === 'mount-slash' ? '/api/v1' : '/api',
					(request) => new Response(new URL(request.url).pathname),
					{ requestPath: 'strip-prefix' },
				),
			);}
	} else if (kind === 'head') {
		routes.push(
			route(
				'GET',
				'/page',
				(request) => new Response('/page', { headers: { 'X-Message': 'Foo', 'X-Method': request.method } }),
			),
		);
	} else {
		routes.push(route('GET', kind === 'strict-slash' ? '/hello/' : '/hello', () => new Response('/hello')));
		if (kind === 'loose') routes.push(route('GET', '/hello/', () => new Response('/hello')));
	}
	const app = create({ routes, middleware, notFound });
	return { fetch: async (request) => await app.fetch(request) };
}
