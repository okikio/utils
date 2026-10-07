/**
 * Independent Elysia AOT applications for the authored Fetch contract.
 *
 * Bun uses Elysia's default adapter; other runtimes select its public Web Standard
 * adapter. These fixtures call compiled Fetch handlers without opening a listener.
 * The shared corpus supplies inputs and observations, never routing or expected
 * responses. Lifecycle hooks reproduce the selected ordering observations; they
 * do not claim Elysia implements onion middleware with a delegated `next()`.
 * @module
 */
import { Elysia, t } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';
import { bodyLimit, jsonLimit } from './corpus.ts';
import type { ParityApiType } from './corpus.ts';

/** Actual challenger configuration; native listener routing remains outside this Fetch boundary. */
export const elysiaConfiguration = Object.freeze({
	adapter: 'Bun' in globalThis ? 'bun' : 'web-standard',
	aot: true,
	precompile: true,
	strictPath: true,
	boundary: 'compiled-fetch',
});

/** Keep adapter selection native on Bun and explicit for portable Fetch consumers. */
function options() {
	return {
		aot: elysiaConfiguration.aot,
		precompile: elysiaConfiguration.precompile,
		strictPath: elysiaConfiguration.strictPath,
		...(elysiaConfiguration.adapter === 'bun' ? {} : { adapter: WebStandardAdapter }),
	};
}

/**
 * Read the actual stream with a byte budget before accepting an endpoint input.
 * This is authored application policy, not an Elysia core body-limit feature.
 * Framing headers cannot bypass admission. Overflow cancels the owned reader;
 * each route pays for the complete read even when its handler ignores the body.
 */
async function text(request: Request, maximum: number): Promise<
	{ readonly accepted: true; readonly text: string } | { readonly accepted: false; readonly response: Response }
> {
	if (request.body === null) return { accepted: true, text: '' };
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let value = '';
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) return { accepted: true, text: value + decoder.decode() };
			bytes += next.value.byteLength;
			if (bytes > maximum) {
				await reader.cancel(new RangeError('Authored Elysia endpoint byte budget exceeded.'));
				return { accepted: false, response: Response.json({ code: 'body-too-large' }, { status: 413 }) };
			}
			value += decoder.decode(next.value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * Compile native Elysia routes, request-local derived values and lifecycle hooks.
 * Service input validation uses Elysia's TypeBox integration. JSON/text admission
 * uses the explicit reader policy above; global errors hide exception messages.
 * No listener or background resource is acquired, so close is a joined no-op.
 */
export function createElysiaApi(): ParityApiType {
	const app = new Elysia(options())
		.derive(({ request }): { actor: string; steps: string[] } => ({
			actor: request.headers.get('x-actor') ?? 'anonymous',
			steps: ['outer:before'],
		}))
		.onBeforeHandle(({ steps }) => {
			steps.push('inner:before');
		})
		.onAfterHandle(({ steps }) => {
			steps.push('inner:after');
		})
		.onAfterHandle(({ steps, set }) => {
			steps.push('outer:after');
			set.headers['x-api'] = 'parity';
			set.headers['x-order'] = steps.join(',');
		})
		.onError(({ code, request }) => {
			if (code === 'NOT_FOUND') {
				return new Response(request.method === 'HEAD' ? null : 'missing', { status: 404 });
			}
			if (code === 'VALIDATION') {
				return Response.json({ type: 'urn:utils:server:invalid-request', status: 400 }, { status: 400 });
			}
			if (code === 'PARSE') return Response.json({ code: 'invalid-json' }, { status: 400 });
			return request.method === 'HEAD'
				? new Response(null, { status: 500 })
				: Response.json({ code: 'internal' }, { status: 500 });
		});
	app.get('/health', ({ request, set }) => {
		set.headers['x-method'] = request.method;
		return 'ready';
	});
	app.get('/items/current', () => ({ id: 'current', kind: 'static' }));
	app.get('/items/:id', ({ params, request }) => {
		try {
			// Elysia's router already decodes parameters. Validate the raw pathname
			// to reject malformed escapes without decoding legitimate percent data twice.
			const url = new URL(request.url);
			decodeURIComponent(url.pathname);
			return { id: params.id, kind: 'dynamic', tags: url.searchParams.getAll('tag') };
		} catch (error) {
			if (!(error instanceof URIError)) throw error;
			return Response.json({ code: 'invalid-parameter' }, { status: 400 });
		}
	});
	app.get('/priority/:id', () => ({ selected: 'parameter' }));
	app.get('/priority/current', () => ({ selected: 'static' }));
	app.get('/slash', () => 'without');
	app.get('/slash/', () => 'with');
	app.get('/state', ({ actor, steps }) => {
		steps.push('handler');
		return { actor };
	});
	app.get('/fault', () => {
		throw new Error('private upstream credential');
	});
	app.post('/json', async ({ request }) => {
		const body = await text(request, jsonLimit);
		if (!body.accepted) return body.response;
		if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
			return Response.json({ code: 'unsupported-content-type' }, { status: 415 });
		}
		try {
			const value: unknown = JSON.parse(body.text);
			return Response.json(value);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			return Response.json({ code: 'invalid-json' }, { status: 400 });
		}
	}, { parse: 'none' });
	app.post('/body', async ({ request }) => {
		const body = await text(request, bodyLimit);
		return body.accepted ? body.text : body.response;
	}, { parse: 'none' });
	app.post('/body/no-read', () => 'accepted', {
		parse: 'none',
		beforeHandle: async ({ request }) => {
			const body = await text(request, bodyLimit);
			if (!body.accepted) return body.response;
		},
	});
	app.get('/service/status', () => ({ name: 'ready', saved: true }));
	app.post('/service/accounts', ({ body }) => ({ name: body.name.trim(), saved: true }), {
		body: t.Object({ name: t.String({ minLength: 1, pattern: '\\S' }) }),
	});
	app.compile();
	return { fetch: async (request) => await app.fetch(request), close: async () => {} };
}

/**
 * Compile exactly routeCount Elysia routes, half static and half parameterized.
 * Elysia owns route selection and compilation; the fixture does not scan or
 * emulate a route table. Construction and first-use costs are separate from warm
 * Fetch dispatch. Elysia's router supplies the decoded parameter output.
 */
export function createElysiaRouting(routeCount: number): ParityApiType {
	if (!Number.isSafeInteger(routeCount) || routeCount < 2 || routeCount % 2 !== 0) {
		throw new TypeError('Route count must be a positive even table size.');
	}
	const app = new Elysia(options());
	for (let slot = 0; slot < routeCount / 2; slot++) {
		app.get(`/fixed/${slot}`, () => ({ kind: 'static', slot }));
		app.get(`/groups/${slot}/:id`, ({ params }) => ({
			kind: 'dynamic',
			slot,
			id: params.id,
		}));
	}
	app.onError(({ code }) => {
		if (code === 'NOT_FOUND') return Response.json({ code: 'missing' }, { status: 404 });
	});
	app.compile();
	return { fetch: async (request) => await app.fetch(request), close: async () => {} };
}
