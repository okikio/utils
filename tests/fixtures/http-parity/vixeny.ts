/** Independent Vixeny 0.1.53 compiled Fetch routes; no Utils production imports. @module */
import { bodyLimit, jsonLimit } from './corpus.ts';
import type { ParityApiType } from './corpus.ts';
import { loadVixeny } from './vixeny-runtime.ts';
import type { Vixeny, VixenyRouteType } from './vixeny-runtime.ts';

type RouteType = VixenyRouteType;
type FetchType = (request: Request) => Response | Promise<Response>;

/** Exact upstream identity and deliberately authored adaptations, rather than native-feature claims. */
export const vixenyContract = Object.freeze({
	version: '0.1.53',
	gitHead: 'eec3775328ea88df8d821384e2382b2f55ff20b8',
	registry: 'https://registry.npmjs.org/vixeny/0.1.53',
	api: 'composeResponse(options)(petitions.response routes), components.param()(petition)',
	adaptations: Object.freeze([
		'Percent-decoding and rejection of empty or malformed parameters happen in the selected route callback; Vixeny supplies the encoded parameter.',
		'HEAD endpoints are registered explicitly, and an application response policy removes their bodies; this is not native GET fallback.',
		'404 and 405 hooks both select the authored missing response; native method rejection normally has a different policy.',
		'Two application middleware layers own request-local actor/step state and selected response headers; Vixeny does not supply Hono-style onion middleware.',
		'Web stream reads enforce byte admission before the selected body handler, including handlers that do not read the admitted body.',
		'Repeated query values use URLSearchParams; the native query component exposes scalar values.',
		'The service routes implement the selected field transform and rejection contract only; they do not implement compiled Utils service schemas/resources.',
	]),
	gaps: Object.freeze([
		'No gateway, proxy lifecycle, deadline, descendant cancellation, or resource-owner parity is claimed by this fixture.',
		'The archive ships TypeScript as main.ts; tools/challenger-build.mjs must emit the exact-source ESM artifact before this fixture runs on Deno, Node or Bun.',
		'The selected factory signatures are explicitly modeled and checked at artifact loading; upstream strict TypeScript 6/7 compatibility is not claimed.',
	]),
});

/** Construct direct response routes, avoiding the optional context composer on the native matcher path. */
function responseRoute(native: Vixeny, path: string, method: 'GET' | 'POST' | 'HEAD', fetch: FetchType): RouteType {
	return native.petitions.response()({ path, method, r: fetch });
}

/** Let Vixeny extract the parameter; application decoding supplies the authored decoded-value contract. */
function parameterRoute(native: Vixeny, path: string, fetch: (request: Request, id: string) => Response): RouteType {
	const definition = responseRoute(native, path, 'GET', (request) => {
		const found = read(request.url);
		const encoded = typeof found === 'object' && found !== null ? found.id : found;
		if (typeof encoded !== 'string' || encoded === '') return missing();
		try {
			return fetch(request, decodeURIComponent(encoded));
		} catch (error) {
			if (!(error instanceof URIError)) throw error;
			return Response.json({ code: 'invalid-parameter' }, { status: 400 });
		}
	});
	const read = native.components.param()(definition);
	return definition;
}

/** Bind each fresh fixture to the loaded native factories; no routing is implemented by this closure. */
function factories(native: Vixeny) {
	return {
		route: (path: string, method: 'GET' | 'POST' | 'HEAD', fetch: FetchType) =>
			responseRoute(native, path, method, fetch),
		parameter: (path: string, fetch: (request: Request, id: string) => Response) => parameterRoute(native, path, fetch),
	};
}

/** These routes have no acquired live handles. Callers consume or cancel every returned body before close. */
function application(fetch: FetchType): ParityApiType {
	return { fetch: async (request) => await fetch(request), close: async () => {} };
}

function missing(): Response {
	return new Response('missing', { status: 404 });
}

/** Count actual UTF-8 bytes, never treating a caller-supplied Content-Length as admission authority. */
async function admitted(request: Request, maximumBytes: number): Promise<string | Response> {
	if (request.body === null) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			length += next.value.byteLength;
			if (length > maximumBytes) {
				await reader.cancel(new RangeError('Body exceeds the authored admission limit.'));
				return Response.json({ code: 'body-too-large' }, { status: 413 });
			}
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

/** Application middleware passes the same Request through the compiled Vixeny matcher; it never selects routes. */
function policies(compiled: FetchType, states: WeakMap<Request, { actor: string; steps: string[] }>): FetchType {
	const inner: FetchType = async (request) => {
		const state = states.get(request);
		if (state === undefined) throw new Error('Request state was not initialized.');
		state.steps.push('inner:before');
		let response: Response;
		try {
			response = await compiled(request);
		} catch {
			response = Response.json({ code: 'internal' }, { status: 500 });
		}
		state.steps.push('inner:after');
		return response;
	};
	return async (request) => {
		const state = { actor: request.headers.get('x-actor') ?? 'anonymous', steps: ['outer:before'] };
		states.set(request, state);
		try {
			const response = await inner(request);
			state.steps.push('outer:after');
			// Every fixture route creates a fresh mutable Response. Mutate its
			// selected headers directly, matching the Hono/Utils fixture policy.
			const headers = response.headers;
			headers.set('x-api', 'parity');
			headers.set('x-order', state.steps.join(','));
			if (request.method === 'HEAD') {
				await response.body?.cancel();
				return new Response(null, { status: response.status, statusText: response.statusText, headers });
			}
			return response;
		} finally {
			states.delete(request);
		}
	};
}

/** Compile once before requests; native Vixeny routing carries all route selection costs. */
export async function createVixenyApi(): Promise<ParityApiType> {
	const native = await loadVixeny();
	const { route, parameter } = factories(native);
	const states = new WeakMap<Request, { actor: string; steps: string[] }>();
	const health = (request: Request) => new Response('ready', { headers: { 'x-method': request.method } });
	const fault = () => {
		throw new Error('private upstream credential');
	};
	const status = () => Response.json({ name: 'ready', saved: true });
	const routes = [
		route('/health', 'GET', health),
		route('/health', 'HEAD', health),
		route('/items/current', 'GET', () => Response.json({ id: 'current', kind: 'static' })),
		parameter(
			'/items/:id',
			(request, id) => Response.json({ id, kind: 'dynamic', tags: new URL(request.url).searchParams.getAll('tag') }),
		),
		parameter('/priority/:id', () => Response.json({ selected: 'parameter' })),
		route('/priority/current', 'GET', () => Response.json({ selected: 'static' })),
		route('/slash', 'GET', () => new Response('without')),
		route('/slash/', 'GET', () => new Response('with')),
		route('/state', 'GET', (request) => {
			const state = states.get(request);
			if (state === undefined) throw new Error('Request state was not initialized.');
			state.steps.push('handler');
			return Response.json({ actor: state.actor });
		}),
		route('/fault', 'GET', fault),
		route('/fault', 'HEAD', fault),
		route('/json', 'POST', async (request) => {
			const body = await admitted(request, jsonLimit);
			if (body instanceof Response) return body;
			if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
				return Response.json({ code: 'unsupported-content-type' }, { status: 415 });
			}
			try {
				return Response.json(JSON.parse(body));
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				return Response.json({ code: 'invalid-json' }, { status: 400 });
			}
		}),
		route('/body', 'POST', async (request) => {
			const body = await admitted(request, bodyLimit);
			return body instanceof Response ? body : new Response(body);
		}),
		route('/body/no-read', 'POST', async (request) => {
			const body = await admitted(request, bodyLimit);
			return body instanceof Response ? body : new Response('accepted');
		}),
		route('/service/status', 'GET', status),
		route('/service/status', 'HEAD', status),
		route('/service/accounts', 'POST', async (request) => {
			const value: unknown = await request.json();
			if (
				typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string' ||
				value.name.trim() === ''
			) {
				return Response.json({ type: 'urn:utils:server:invalid-request', status: 400 }, { status: 400 });
			}
			return Response.json({ name: value.name.trim(), saved: true });
		}),
	];
	const compiled = await native.composeResponse({ 404: missing, 405: missing })(routes);
	return application(policies(compiled, states));
}

/** Register exactly routeCount native routes, half static and half parameterized; no global middleware is timed. */
export async function createVixenyRouting(routeCount: number): Promise<ParityApiType> {
	if (!Number.isSafeInteger(routeCount) || routeCount < 2 || routeCount % 2 !== 0) {
		throw new TypeError('Route count must be a positive even table size.');
	}
	const native = await loadVixeny();
	const { route, parameter } = factories(native);
	const routes: RouteType[] = [];
	for (let slot = 0; slot < routeCount / 2; slot++) {
		routes.push(route(`/fixed/${slot}`, 'GET', () => Response.json({ kind: 'static', slot })));
		routes.push(parameter(`/groups/${slot}/:id`, (_request, id) => Response.json({ kind: 'dynamic', slot, id })));
	}
	const notFound = () => Response.json({ code: 'missing' }, { status: 404 });
	return application(await native.composeResponse({ 404: notFound, 405: notFound })(routes));
}
