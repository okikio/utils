/** Pure Hono application and independently authored edge policy; no production Utils imports. @module */
import { Hono } from 'hono';
import { bodyLimit as bounded } from 'hono/body-limit';
import { bodyLimit, jsonLimit, upstream } from './corpus.ts';
import type { ParityApiType } from './corpus.ts';

/** Implement the corpus as native Hono routes, context variables, and Hono middleware. */
export function createHonoApi(): ParityApiType {
	const app = new Hono<{ Variables: { actor: string; steps: string[] } }>({ strict: true });
	app.use('*', async (ctx, next) => {
		ctx.set('actor', ctx.req.header('x-actor') ?? 'anonymous');
		ctx.set('steps', ['outer:before']);
		await next();
		ctx.get('steps').push('outer:after');
		ctx.header('x-api', 'parity');
		ctx.header('x-order', ctx.get('steps').join(','));
	});
	app.use('*', async (ctx, next) => {
		ctx.get('steps').push('inner:before');
		await next();
		ctx.get('steps').push('inner:after');
	});
	app.onError(() => Response.json({ code: 'internal' }, { status: 500 }));
	app.notFound((ctx) => ctx.text('missing', 404));
	app.get('/health', (ctx) => {
		ctx.header('x-method', ctx.req.method);
		return ctx.text('ready');
	});
	app.get('/items/current', (ctx) => ctx.json({ id: 'current', kind: 'static' }));
	app.get(
		'/items/:id',
		(ctx) => {
			try {
				decodeURIComponent(new URL(ctx.req.url).pathname);
			} catch {
				return ctx.json({ code: 'invalid-parameter' }, 400);
			}
			return ctx.json({ id: ctx.req.param('id'), kind: 'dynamic', tags: ctx.req.queries('tag') ?? [] });
		},
	);
	app.get('/priority/:id', (ctx) => ctx.json({ selected: 'parameter' }));
	app.get('/priority/current', (ctx) => ctx.json({ selected: 'static' }));
	app.get('/slash', (ctx) => ctx.text('without'));
	app.get('/slash/', (ctx) => ctx.text('with'));
	app.get('/state', (ctx) => {
		ctx.get('steps').push('handler');
		return ctx.json({ actor: ctx.get('actor') });
	});
	app.get('/fault', () => {
		throw new Error('private upstream credential');
	});
	app.post(
		'/json',
		bounded({ maxSize: jsonLimit, onError: () => Response.json({ code: 'body-too-large' }, { status: 413 }) }),
		async (ctx) => {
			if (ctx.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
				return ctx.json({
					code: 'unsupported-content-type',
				}, 415);
			}
			try {
				return ctx.json(await ctx.req.json());
			} catch {
				return ctx.json({ code: 'invalid-json' }, 400);
			}
		},
	);
	app.post(
		'/body',
		bounded({ maxSize: bodyLimit, onError: () => Response.json({ code: 'body-too-large' }, { status: 413 }) }),
		async (ctx) => ctx.text(await ctx.req.text()),
	);
	app.post(
		'/body/no-read',
		bounded({ maxSize: bodyLimit, onError: () => Response.json({ code: 'body-too-large' }, { status: 413 }) }),
		(ctx) => ctx.text('accepted'),
	);
	app.get('/service/status', (ctx) => ctx.json({ name: 'ready', saved: true }));
	app.post('/service/accounts', async (ctx) => {
		const value: unknown = await ctx.req.json();
		if (
			typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string' ||
			value.name.trim() === ''
		) return ctx.json({ type: 'urn:utils:server:invalid-request', status: 400 }, 400);
		return ctx.json({ name: value.name.trim(), saved: true });
	});
	return { fetch: async (request) => await app.fetch(request), close: async () => {} };
}

/** Independently implement the selected trust/cookie/cache policy with native Hono and Fetch. */
export function createHonoGateway(): ParityApiType {
	const app = new Hono();
	app.post('/service/echo', async (ctx) => {
		const source = ctx.req.raw;
		const from = new URL(source.url);
		const target = new URL(`${from.pathname}${from.search}`, 'https://upstream.invalid');
		const headers = new Headers(source.headers);
		for (const key of (headers.get('connection') ?? '').split(',')) {
			if (key.trim()) headers.delete(key.trim());
		}
		headers.delete('connection');
		for (
			const key of [
				'authorization',
				'cookie',
				'x-trusted-actor',
				'x-trusted-extra',
				'x-real-ip',
				'x-forwarded-for',
				'x-forwarded-host',
				'x-forwarded-proto',
			]
		) headers.delete(key);
		headers.set('x-forwarded-for', '203.0.113.9');
		headers.set('x-forwarded-host', from.host);
		headers.set('x-forwarded-proto', from.protocol.slice(0, -1));
		headers.set('x-request-id', 'parity-request');
		const forwarded = new Request(target, {
			method: source.method,
			headers,
			body: await source.arrayBuffer(),
			signal: source.signal,
		});
		const result = await upstream(forwarded);
		const outgoing = new Headers(result.headers);
		for (const key of (outgoing.get('connection') ?? '').split(',')) {
			if (key.trim()) outgoing.delete(key.trim());
		}
		outgoing.delete('set-cookie');
		outgoing.delete('connection');
		outgoing.set('cache-control', 'no-store');
		outgoing.set('x-request-id', 'parity-request');
		return new Response(result.body, { status: result.status, headers: outgoing });
	});
	return { fetch: async (request) => await app.fetch(request), close: async () => {} };
}

/** Register exactly routeCount routes independently, half static and half parameterized. */
export function createHonoRouting(routeCount: number): ParityApiType {
	if (!Number.isSafeInteger(routeCount) || routeCount < 2 || routeCount % 2 !== 0) {
		throw new TypeError('Route count must be a positive even table size.');
	}
	const app = new Hono({ strict: true });
	for (let slot = 0; slot < routeCount / 2; slot++) {
		app.get(`/fixed/${slot}`, (ctx) => ctx.json({ kind: 'static', slot }));
		app.get(`/groups/${slot}/:id`, (ctx) => ctx.json({ kind: 'dynamic', slot, id: ctx.req.param('id') }));
	}
	app.notFound((ctx) => ctx.json({ code: 'missing' }, 404));
	return { fetch: async (request) => await app.fetch(request), close: async () => {} };
}
