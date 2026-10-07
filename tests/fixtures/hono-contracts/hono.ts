/** Pinned Hono candidates. This module never imports a production Utils package. @module */
import { Context, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { cloneRawRequest, HonoRequest } from 'hono/request';
import { TrieRouter } from 'hono/router/trie-router';
import type { ApplicationType, MatchType, RequestCaseType, ResponseCaseType, RouterCaseType } from './types.ts';

/** The upstream common suite runs TrieRouter without skips; retain its raw-path semantics. */
export function matchHono(input: Pick<RouterCaseType, 'routes' | 'method' | 'path'>): readonly MatchType[] {
	const router = new TrieRouter<string>();
	for (const [method, path, name] of input.routes) router.add(method, path, name);
	const result = router.match(input.method, input.path);
	if (result.length !== 1) throw new Error('TrieRouter must return parameter values, not an index stash.');
	const [matches] = result;
	return matches.map(([handler, params]) => ({ handler, params: { ...params } }));
}

/** Read the actual Hono request APIs, including their automatic body cache. */
export async function readHono(input: Omit<RequestCaseType, 'expected' | 'utilsExpected'>): Promise<unknown> {
	if (input.operation === 'headers-prototype' || input.operation === 'headers-prototype-injected') {
		const raw = new Request('http://localhost', {
			headers: input.operation === 'headers-prototype' ? { __proto__: 'evil' } : [['__proto__', 'evil']],
		});
		const fields = new HonoRequest(raw).header();
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
		const copy = await cloneRawRequest(new HonoRequest(raw));
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
	if (input.operation === 'raw-consumed-clone' || input.operation === 'external-cache-clone') {
		const req = new HonoRequest(
			new Request('http://localhost', {
				method: 'POST',
				body: '{"foo":"bar"}',
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		await req.raw.text();
		if (input.operation === 'external-cache-clone') {
			req.bodyCache.json = Promise.resolve({ foo: 'bar' });
			return await (await cloneRawRequest(req)).json();
		}
		try {
			await cloneRawRequest(req);
		} catch (error) {
			if (error instanceof HTTPException) return { rejected: true, status: error.status };
			throw error;
		}
		throw new Error('An uncached consumed request must be rejected.');
	}
	if (input.operation === 'multipart-clone' || input.operation === 'multipart-stale-clone') {
		const form = new FormData();
		form.append('foo', 'bar');
		form.append('file', new File(['hello'], 't.txt', { type: 'text/plain' }));
		const body = ['--boundary', 'Content-Disposition: form-data; name="foo"', '', 'bar', '--boundary--', ''].join(
			'\r\n',
		);
		const req = new HonoRequest(
			new Request('http://localhost', {
				method: 'POST',
				body: input.operation === 'multipart-clone' ? form : body,
				...(input.operation === 'multipart-stale-clone'
					? {
						headers: {
							'Content-Type': 'multipart/form-data; boundary=boundary',
							'Content-Length': String(new TextEncoder().encode(body).length),
						},
					}
					: {}),
			}),
		);
		await req.formData();
		const copy = await cloneRawRequest(req);
		if (input.operation === 'multipart-stale-clone') {
			return { hasContentLength: copy.headers.has('content-length'), foo: (await copy.formData()).get('foo') };
		}
		const boundary = copy.headers.get('content-type')?.split('boundary=')[1];
		const text = await copy.clone().text();
		const fields = await copy.formData();
		const file = fields.get('file');
		if (!(file instanceof File)) throw new Error('The cloned multipart body must retain its File value.');
		return {
			boundaryMatches: boundary !== undefined && text.startsWith(`--${boundary}`),
			foo: fields.get('foo'),
			file: { name: file.name, type: file.type, text: await file.text() },
		};
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
		const copy = await cloneRawRequest(new HonoRequest(raw));
		const text = await copy.text();
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
		const req = new HonoRequest(
			new Request('http://localhost', {
				method: 'POST',
				body: input.body,
				headers: { Authorization: 'Bearer token123' },
			}),
		);
		await req.json();
		const copy = await cloneRawRequest(req);
		return { text: await copy.text(), authorization: copy.headers.get('authorization') };
	}
	if (input.operation === 'form') {
		const form = new FormData();
		form.append('foo', 'bar');
		if (input.keys?.includes('file')) form.append('file', new File(['hello'], 't.txt', { type: 'text/plain' }));
		const req = new HonoRequest(new Request('http://localhost', { method: 'POST', body: form }));
		const fields = await req.parseBody();
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
	const req = new HonoRequest(
		new Request(input.url ?? 'http://localhost', {
			...(body === undefined ? {} : { method: 'POST', body }),
			headers: input.headers,
		}),
	);
	if (input.operation === 'query') {
		return Object.fromEntries((input.keys ?? []).map((key) => {
			const values = req.queries(key);
			return [key, values === undefined ? null : values.length === 1 ? req.query(key) : values];
		}));
	}
	if (input.operation === 'headers') {
		return Object.fromEntries((input.keys ?? []).map((key) => [key, req.header(key) ?? null]));
	}
	const view = async (kind: NonNullable<RequestCaseType['order']>[number]): Promise<unknown> => {
		if (kind === 'text') return await req.text();
		if (kind === 'json') return await req.json();
		if (kind === 'arrayBuffer') return [...new Uint8Array(await req.arrayBuffer())];
		if (kind === 'bytes') return [...await req.bytes()];
		const blob = await req.blob();
		// UTF-8 charset names are case-insensitive across native Blob implementations.
		return {
			text: await blob.text(),
			type: blob.type.replace(/(^|;)\s*charset\s*=\s*"?utf-8"?(?=\s*(?:;|$))/gi, '$1charset=utf-8'),
		};
	};
	if (input.operation === 'nonform-invalid') {
		const parsed = await req.parseBody();
		try {
			await req.formData();
		} catch (error) {
			if (error instanceof TypeError) return { parsed, rejected: true };
			throw error;
		}
		throw new Error('JSON must not be decoded as a form.');
	}
	if (input.operation === 'non-form') return { parsed: await req.parseBody(), view: await view(input.order![0]!) };
	const result: unknown[] = [];
	for (const kind of input.order ?? []) result.push(await view(kind));
	return result;
}

/** Exercise Hono's responder/header APIs independently of the Utils assembly. */
export async function respondHono(input: Omit<ResponseCaseType, 'expected'>): Promise<Response> {
	const c = new Context(new Request('http://localhost'));
	if (input.operation === 'replace-cookie') {
		c.res = new Response(null, { headers: [['set-cookie', 'foo=bar; Path=/'], ['set-cookie', 'foo2=bar2; Path=/']] });
		c.res = new Response(null, { headers: [['set-cookie', 'foo3=bar3; Path=/']] });
		return c.res;
	}
	if (input.operation === 'compose-cookie') {
		c.res.headers.append('set-cookie', 'foo=bar; Path=/');
		setCookie(c, 'foo2', 'bar2', { path: '/' });
		return c.json({ message: 'Hello' });
	}
	if (input.operation === 'init-cookie') {
		setCookie(c, 'context', '1');
		setCookie(c, 'context', '2');
		const original = new Response('', { headers: { 'set-cookie': 'response=1; Path=/' } });
		try {
			return c.body('', original);
		} finally {
			await original.body?.cancel();
		}
	}
	for (const [name, value, append] of input.before ?? []) {
		if (value === null) c.header(name, undefined);
		else if (typeof value === 'string') c.header(name, value, { append });
		else for (const [index, item] of value.entries()) c.header(name, item, { append: append || index > 0 });
	}
	const headers: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(input.headers ?? {})) {
		headers[key] = typeof value === 'string' ? value : [...value];
	}
	const text = typeof input.body === 'string' ? input.body : '';
	const status = input.status ?? 200;
	if (input.operation === 'redirect') return c.redirect(input.location!);
	if (input.operation === 'replace') {
		// The upstream case starts from c.res.headers, so materialize that prior owner.
		c.res;
		const replacement = new Headers();
		for (const [name, value] of Object.entries(headers)) {
			if (typeof value === 'string') replacement.append(name, value);
			else for (const item of value) replacement.append(name, item);
		}
		c.res = new Response(text, { headers: replacement });
		return c.res;
	}
	if (input.operation === 'response-init') {
		const original = new Response(input.original!.body, input.original!);
		try {
			if (input.id.endsWith('-json')) return c.json(input.body, original);
			if (input.id.endsWith('-html')) return await c.html(text, original);
			if (input.id.endsWith('-text')) return c.text(text, original);
			return c.body(text, original);
		} finally {
			await original.body?.cancel();
		}
	}
	if (input.operation === 'body') {
		if (input.body === null) return c.body(null, 204, headers);
		return c.body(text, status === 204 ? 200 : status, headers);
	}
	const contentStatus = status === 204 ? 200 : status;
	if (input.operation === 'json') return c.json(input.body, contentStatus, headers);
	if (input.operation === 'html') return await c.html(text, contentStatus, headers);
	if (input.operation === 'async-html') return await c.html(Promise.resolve(text), contentStatus, headers);
	return c.text(text, contentStatus, headers);
}

/** Build only application behavior; no expected observation is accessible here. */
export function createHono(kind: ApplicationType): { fetch(request: Request): Promise<Response> } {
	const app = new Hono({ strict: kind !== 'loose' });
	if (kind === 'encoded-param' || kind === 'encoded-posts') {
		app.get('/users/:id', (c) => c.text(`${kind === 'encoded-posts' ? 'posts of' : 'id is'} ${c.req.param('id')}`));
	} else if (kind === 'encoded-static') app.get('/users/static', (c) => c.text('static'));
	else if (kind === 'encoded-invalid') {
		app.get('/static/:path', (c) => c.text(`by c.req.param: ${c.req.param('path')}`));
	} else if (kind === 'parameters') {
		app.get('/entry/:id', (c) => c.text(`id is ${c.req.param('id')}`));
		app.get('/search', (c) => c.text(`name is ${c.req.query('name')}`));
		app.get(
			'/multiple-values',
			(c) =>
				c.text(`q is ${c.req.queries('q')![0]} and ${c.req.queries('q')![1]}, limit is ${c.req.queries('limit')![0]}`),
		);
		app.get('/add-header', (c) => c.text(`foo is ${c.req.header('X-Foo')}`));
	} else if (kind === 'path') app.get('*', (c) => c.text(c.req.path));
	else if (kind === 'methods') {
		app.on('PURGE', '/hello', (c) => c.text('hello'));
		app.on(['PUT', 'DELETE'], '/posts/:id', (c) => c.json({ postId: c.req.param('id'), method: c.req.method }));
		app.on('QUERY', '/query', (c) => c.text('Accepted', 202));
	} else if (kind === 'middleware') {
		app.use('*', async (c, next) => {
			await next();
			c.res.headers.append('x-custom', 'root');
		});
		app.use('/hello', async (c, next) => {
			await next();
			c.res.headers.append('x-message', 'custom-header');
		});
		app.use('/hello/*', async (c, next) => {
			await next();
			c.res.headers.append('x-message-2', 'custom-header-2');
		});
		app.get('/hello', (c) => c.text('hello'));
		app.get('/hello/:message', (c) => c.text(c.req.param('message')));
		app.get('/json', () => Response.json({ message: 'hello' }));
		app.notFound((c) => c.text('Not Found Foo', 404));
	} else if (kind === 'chained' || kind === 'multiple') {
		app.use(`/${kind}/*`, async (c, next) => {
			c.req.raw.headers.append('x-before', 'abc');
			await next();
		});
		app.use('*', async (c, next) => {
			await next();
			c.header('x-after', c.req.header('x-before'));
		});
		app.get(`/${kind}/abc`, (c) => c.text(`GET ${kind}`));
	} else if (kind === 'replacement') {
		app.use('/normal', async (c, next) => {
			await next();
			await c.res.body?.cancel();
			c.res = new Response('Middleware');
		});
		app.use('/overwrite', async (c, next) => {
			await next();
			await c.res.body?.cancel();
			c.res = undefined;
			c.res = new Response('Middleware');
		});
		app.get('*', (c) => {
			c.header('x-custom', 'foo');
			return c.text('Handler');
		});
	} else if (kind === 'missing') app.notFound((c) => c.text('Custom 404 Not Found', 404));
	else if (kind === 'missing-one' || kind === 'missing-two') {
		for (const suffix of kind === 'missing-one' ? [' + Middleware'] : [' + Middleware 1', ' + Middleware 2']) {
			app.use('*', async (c, next) => {
				await next();
				c.res = new Response(await c.res.text() + suffix, c.res);
			});
		}
	} else if (kind === 'error' || kind === 'async-error') {
		app.get('/error', () => {
			throw new Error('This is Error');
		});
		app.use('/error-middleware', () => {
			throw new Error('This is Middleware Error');
		});
		app.onError(async (error, c) => {
			c.header('x-debug', error.message);
			const suffix = kind === 'async-error' ? ` with ${await Promise.resolve('Promised')}` : '';
			return c.text(`Custom Error Message${suffix}`, 500);
		});
	} else if (kind === 'missing-error') {
		app.notFound(() => {
			throw new Error('Error in Not Found');
		});
		app.onError((error, c) => c.text(error.message, 400));
	} else if (kind.startsWith('mount')) {
		if (kind === 'mount') {
			app.use('*', async (c, next) => {
				await next();
				c.header('x-message', 'Foo');
			});
			app.get('/', (c) => c.text('Hono'));
			const child = (req: Request) => {
				const url = new URL(req.url);
				if (url.pathname === '/') return new Response('AnotherApp');
				if (url.pathname === '/hello') return new Response('Hello from AnotherApp');
				if (url.pathname === '/header') return new Response(req.headers.get('x-message'));
				if (url.pathname === '/with-query') return new Response(url.searchParams.toString());
				return new Response('Not Found from AnotherApp', { status: 404 });
			};
			app.mount('/another-app', child);
			app.mount('/another-app2/sub-slash/', child);
		} else if (kind === 'mount-api') app.mount('/api/another-app', () => new Response('AnotherApp'));
		else {app.mount(kind === 'mount-unicode' ? '/api/é' : kind === 'mount-slash' ? '/api/v1' : '/api', (req) =>
				new Response(new URL(req.url).pathname));}
	} else if (kind === 'head') {
		app.get('/page', (c) => {
			c.header('X-Message', 'Foo');
			c.header('X-Method', c.req.method);
			return c.text('/page');
		});
	} else app.get(kind === 'strict-slash' ? '/hello/' : '/hello', (c) => c.text('/hello'));
	return { fetch: async (request) => await app.fetch(request) };
}
