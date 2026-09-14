import * as httpResponse from '@okikio/http/response';
import * as recordCore from '@okikio/record';
import type { App, CreateOptionsType, Handler, Middleware, MountOptions, RoutePlanInput, RouteType } from './types.ts';
import { normalizePath } from './path.ts';
import { matchMount, matchRoute, normalizeMountPath, prepare, routeKey, stripMountPrefix } from './router.ts';

/** Create one exact method/path route using native Request and Response values. */
export function route(method: string, path: string, handler: Handler): RouteType {
	if (typeof method !== 'string') throw new TypeError('HTTP route method must be a string.');
	if (typeof path !== 'string') throw new TypeError('HTTP route path must be a string.');
	const normalizedMethod = method.trim().toUpperCase();
	if (normalizedMethod.length === 0) throw new TypeError('HTTP route method cannot be empty.');
	if (typeof handler !== 'function') throw new TypeError('HTTP route handler must be a function.');
	return Object.freeze({ kind: 'route', method: normalizedMethod, path: normalizePath(path), handler });
}

/**
 * Mount one Fetch handler below a path prefix.
 *
 * `preserve` leaves the original URL untouched. `strip-prefix` presents the
 * child with a URL relative to the mount, which is useful for embedded Fetch
 * applications and transports such as MCP while preserving method, headers,
 * query, body stream, and abort signal.
 */
export function mount(path: string, handler: Handler, options: MountOptions = {}): RouteType {
	if (typeof path !== 'string') throw new TypeError('HTTP mount path must be a string.');
	if (typeof handler !== 'function') throw new TypeError('HTTP mount handler must be a function.');
	recordCore.assert(options, 'HTTP mount options');
	const requestPath = options.requestPath ?? 'preserve';
	if (requestPath !== 'preserve' && requestPath !== 'strip-prefix') throw new TypeError('HTTP mount requestPath must be preserve or strip-prefix.');
	return Object.freeze({ kind: 'mount', path: normalizeMountPath(path), handler, requestPath });
}

/** Compose Fetch-compatible middleware around one terminal handler in authored order. */
export function compose(handler: Handler, middleware: readonly Middleware[] = []): Handler {
	if (typeof handler !== 'function') throw new TypeError('HTTP handler must be a function.');
	const layers = middlewareList(middleware);
	let current = handler;
	for (let index = layers.length - 1; index >= 0; index -= 1) {
		const next = current;
		const layer = layers[index]!;
		current = (request) => layer(request, next);
	}
	return current;
}

/** Create a framework-neutral HTTP application from a prepared route plan and exact handlers. */
export function create(options: CreateOptionsType = {}): App {
	recordCore.assert(options, 'HTTP application options');
	const routes = routeList(options.routes ?? []);
	const plan = options.plan ?? prepare(routes.map(routeDescriptor));
	const handlers = bind(plan, routes);
	const notFound = options.notFound ?? (() => new Response('Not found.', { status: 404 }));
	if (typeof notFound !== 'function') throw new TypeError('HTTP notFound handler must be a function when provided.');
	const middleware = middlewareList(options.middleware ?? []);
	const dispatch: Handler = async (request) => {
		const url = new URL(request.url);
		const method = request.method.toUpperCase();
		const key = matchRoute(plan, method, url.pathname);
		if (key !== undefined) {
			const selected = handlers.get(key)!;
			const response = await selected.handler(request);
			return method === 'HEAD' ? await withoutBody(response) : response;
		}
		const mountKey = matchMount(plan, url.pathname);
		if (mountKey !== undefined) {
			const selected = handlers.get(mountKey)!;
			const mountedRequest = selected.kind === 'mount' && selected.requestPath === 'strip-prefix'
				? new Request(stripMountPrefix(url, selected.path), request)
				: request;
			return await selected.handler(mountedRequest);
		}
		return await notFound(request);
	};
	return Object.freeze({ routes, fetch: compose(dispatch, middleware) });
}

/** Bind exact handlers to an inert compiler route plan and reject plan drift. */
function bind(plan: import('./types.ts').RoutePlan, routes: readonly RouteType[]): ReadonlyMap<string, RouteType> {
	const actual = new Map(routes.map((entry) => [routeKey(routeDescriptor(entry)), entry] as const));
	const expected = new Set(plan.routes.map(routeKey));
	for (const key of expected) if (!actual.has(key)) throw new TypeError(`Prepared HTTP route ${key} has no bound handler.`);
	for (const key of actual.keys()) if (!expected.has(key)) throw new TypeError(`Bound HTTP route ${key} is absent from the prepared plan.`);
	return actual;
}

function routeDescriptor(value: RouteType): RoutePlanInput {
	return value.kind === 'mount'
		? Object.freeze({ kind: 'mount', path: value.path })
		: Object.freeze({ kind: 'route', method: value.method, path: value.path });
}

/** Snapshot one dense middleware list without invoking accessor-backed array entries. */
function middlewareList(values: readonly Middleware[]): readonly Middleware[] {
	if (!Array.isArray(values)) throw new TypeError('HTTP middleware must be an array of functions.');
	const result: Middleware[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'function') {
			throw new TypeError('HTTP middleware must contain dense function data elements.');
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

/** Snapshot route definitions so later caller mutation cannot change dispatch ownership. */
function routeList(values: readonly RouteType[]): readonly RouteType[] {
	if (!Array.isArray(values)) throw new TypeError('HTTP routes must be an array.');
	const result: RouteType[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor)) throw new TypeError('HTTP routes must contain dense data elements.');
		const value = descriptor.value as unknown;
		recordCore.assert(value, `HTTP route at index ${index}`);
		if (value.kind === 'route') result.push(route(value.method as string, value.path as string, value.handler as Handler));
		else if (value.kind === 'mount') result.push(mount(value.path as string, value.handler as Handler, { requestPath: value.requestPath as MountOptions['requestPath'] }));
		else throw new TypeError(`HTTP route at index ${index} has an invalid kind.`);
	}
	return Object.freeze(result);
}

/** Preserve GET response metadata while cancelling the body that HEAD will never transmit. */
async function withoutBody(response: Response): Promise<Response> {
	await httpResponse.discard(response);
	return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}
