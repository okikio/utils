/** Pure Utils HTTP, compiled service, and gateway implementation; no Hono dependency. @module */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { limits, parseJson, readBody, RequestTransportError } from '@okikio/http/request';
import { create as createResponse, ok } from '@okikio/http/response';
import { get, handler, post } from '@okikio/server/endpoint';
import {
	compile as compileGateway,
	create as createGateway,
	define as defineGateway,
	mount as mountService,
	noStore,
	policy,
} from '@okikio/server/gateway';
import { catchErrors, create as createHttp, mount, route } from '@okikio/server/http';
import type { Middleware, RouteType } from '@okikio/server/http';
import {
	compile as compileService,
	create as createService,
	define as defineService,
	implement,
} from '@okikio/server/service';
import { implementations } from '@okikio/resource';
import { bodyLimit, jsonLimit, upstream } from './corpus.ts';
import type { ParityApiType } from './corpus.ts';

const NameSchema: StandardSchemaV1<unknown, { readonly name: string }> = {
	'~standard': {
		version: 1,
		vendor: 'parity',
		validate(value) {
			if (
				typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string' ||
				value.name.trim() === ''
			) return { issues: [{ message: 'Expected a nonempty name.' }] };
			return { value: { name: value.name.trim() } };
		},
	},
};
const SavedSchema: StandardSchemaV1<unknown, { readonly name: string; readonly saved: boolean }> = {
	'~standard': {
		version: 1,
		vendor: 'parity',
		validate(value) {
			return typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string' &&
					'saved' in value && value.saved === true
				? { value: { name: value.name, saved: true } }
				: { issues: [{ message: 'Expected a saved account.' }] };
		},
	},
};

/** Compose the same public application with low-level HTTP and a real compiled service owner. */
export function createUtilsApi(): ParityApiType {
	const Saved = ok(SavedSchema, { id: 'parity.saved', description: 'One accepted account.' });
	const Create = post({ id: 'parity.create', path: '/accounts', json: NameSchema, responses: [Saved] });
	const Status = get({ id: 'parity.status', path: '/status', responses: [Saved] });
	const Definition = defineService({ id: 'parity.accounts', path: '/service', endpoints: [Create, Status] });
	const runtime = createService(
		compileService(implement(Definition, {
			endpoints: [
				handler(Status, async () => createResponse(Saved, { name: 'ready', saved: true })),
				handler(
					Create,
					async ({ input }) => createResponse(Saved, { name: input.json.name, saved: true }),
				),
			],
			resources: implementations(),
		})),
		{ host: {} },
	);
	const states = new WeakMap<Request, { actor: string; steps: string[] }>();
	const outer: Middleware = async (request, next) => {
		const state = { actor: request.headers.get('x-actor') ?? 'anonymous', steps: ['outer:before'] };
		states.set(request, state);
		try {
			const result = await next(request);
			state.steps.push('outer:after');
			// Every fixture handler returns a fresh local Response with mutable headers.
			// Add middleware output directly, as the Hono fixture does, without copying its body owner.
			result.headers.set('x-api', 'parity');
			result.headers.set('x-order', state.steps.join(','));
			return result;
		} finally {
			states.delete(request);
		}
	};
	const inner: Middleware = async (request, next) => {
		const state = states.get(request)!;
		state.steps.push('inner:before');
		const result = await next(request);
		state.steps.push('inner:after');
		return result;
	};
	// Factory setup owns policy validation, as the challenger middleware factories
	// do. Every request still enforces actual bytes against the immutable budget.
	const jsonPolicy = limits({ maximumBodyBytes: jsonLimit });
	const bodyPolicy = limits({ maximumBodyBytes: bodyLimit });
	const read = async (request: Request, json: boolean, noRead = false): Promise<Response> => {
		try {
			if (json) return Response.json(await parseJson(request, jsonPolicy));
			const body = await readBody(request, bodyPolicy);
			return new Response(noRead ? 'accepted' : new TextDecoder().decode(body));
		} catch (error) {
			if (!(error instanceof RequestTransportError)) throw error;
			const code = error.issues[0]!.code;
			return Response.json({ code }, {
				status: code === 'body-too-large' ? 413 : code === 'unsupported-content-type' ? 415 : 400,
			});
		}
	};
	const app = createHttp({
		routes: [
			route('GET', '/health', (request) => new Response('ready', { headers: { 'x-method': request.method } })),
			route('GET', '/items/current', () => Response.json({ id: 'current', kind: 'static' })),
			route('GET', '/items/:id', (request) => {
				const url = new URL(request.url);
				try {
					decodeURIComponent(url.pathname);
				} catch {
					return Response.json({ code: 'invalid-parameter' }, { status: 400 });
				}
				return Response.json({
					id: decodeURIComponent(url.pathname.slice('/items/'.length)),
					kind: 'dynamic',
					tags: url.searchParams.getAll('tag'),
				});
			}),
			route('GET', '/priority/:id', () => Response.json({ selected: 'parameter' })),
			route('GET', '/priority/current', () => Response.json({ selected: 'static' })),
			route('GET', '/slash', () => new Response('without')),
			route('GET', '/slash/', () => new Response('with')),
			route('GET', '/state', (request) => {
				const state = states.get(request)!;
				state.steps.push('handler');
				return Response.json({ actor: state.actor });
			}),
			route('GET', '/fault', () => {
				throw new Error('private upstream credential');
			}),
			route('POST', '/json', (request) => read(request, true)),
			route('POST', '/body', (request) => read(request, false)),
			route('POST', '/body/no-read', (request) => read(request, false, true)),
			mount('/service', runtime.fetch),
		],
		middleware: [outer, inner, catchErrors({ map: () => Response.json({ code: 'internal' }, { status: 500 }) })],
		notFound: () => new Response('missing', { status: 404 }),
	});
	return {
		fetch: async (request) => await app.fetch(request),
		close: async () => {
			await runtime[Symbol.asyncDispose]();
		},
	};
}

/** Derive the shared forwarding contract from an actual service definition and gateway policy. */
export function createUtilsGateway(): ParityApiType {
	const RawSchema: StandardSchemaV1<unknown, Request> = {
		'~standard': {
			version: 1,
			vendor: 'parity',
			validate(value) {
				return value instanceof Request ? { value } : { issues: [{ message: 'Expected a Request.' }] };
			},
		},
	};
	const AnySchema: StandardSchemaV1<unknown, unknown> = {
		'~standard': {
			version: 1,
			vendor: 'parity',
			validate(value) {
				return { value };
			},
		},
	};
	const Echoed = ok(AnySchema, { id: 'parity.echoed', description: 'Inspected wire forwarding.' });
	const Echo = post({ id: 'parity.echo', path: '/echo', raw: RawSchema, responses: [Echoed] });
	const Definition = defineService({ id: 'parity.echo-service', path: '/service', endpoints: [Echo] });
	const Edge = defineGateway({
		id: 'parity.edge',
		services: [mountService(Definition, { origin: 'https://upstream.invalid' })],
		policies: [policy({ id: 'parity.edge-policy', endpoints: [Echo], cache: noStore() })],
	});
	const app = createGateway(compileGateway(Edge), {
		requestId: () => 'parity-request',
		clientIp: () => '203.0.113.9',
		trustedRequestHeaderPrefixes: ['x-trusted-'],
		fetch: async (input, init) => await upstream(input instanceof Request ? input : new Request(input, init)),
	});
	return { fetch: app.fetch, close: async () => {} };
}

/** Register the independently authored Utils route table without changing the application corpus. */
export function createUtilsRouting(routeCount: number): ParityApiType {
	if (!Number.isSafeInteger(routeCount) || routeCount < 2 || routeCount % 2 !== 0) {
		throw new TypeError('Route count must be a positive even table size.');
	}
	const routes: RouteType[] = [];
	for (let slot = 0; slot < routeCount / 2; slot++) {
		routes.push(route('GET', `/fixed/${slot}`, () => Response.json({ kind: 'static', slot })));
		routes.push(
			route('GET', `/groups/${slot}/:id`, (request) =>
				Response.json({
					kind: 'dynamic',
					slot,
					id: decodeURIComponent(new URL(request.url).pathname.split('/').at(-1)!),
				})),
		);
	}
	const app = createHttp({ routes, notFound: () => Response.json({ code: 'missing' }, { status: 404 }) });
	return { fetch: async (request) => await app.fetch(request), close: async () => {} };
}

/** Compile-only controls preserve transformed input and declared response value inference. */
export function inference(): void {
	const Saved = ok(SavedSchema, { id: 'parity.type.saved', description: 'Typed saved account.' });
	const Create = post({ id: 'parity.type.create', path: '/accounts', json: NameSchema, responses: [Saved] });
	handler(Create, async ({ input }) => {
		const name: string = input.json.name;
		// @ts-expect-error The transformed input exposes no missing field.
		const absent: string = input.json.absent;
		// @ts-expect-error The transformed name is a string.
		const numeric: number = input.json.name;
		void absent;
		void numeric;
		// @ts-expect-error Declared response values require a string name.
		createResponse(Saved, { name: 42, saved: true });
		// @ts-expect-error Declared response values require saved state.
		createResponse(Saved, { name });
		return createResponse(Saved, { name, saved: true });
	});
}
