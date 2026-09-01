import * as httpResponse from '@okikio/http/response';
import * as recordCore from '@okikio/record';
import type { App, CreateOptionsType, Handler, Middleware, RouteType } from './types.ts';
import { compareRouteSpecificity, matchPath, normalizePath } from './path.ts';

/** Create one exact method/path route using native Request and Response values. */
export function route(method: string, path: string, handler: Handler): RouteType {
	if (typeof method !== 'string') throw new TypeError('HTTP route method must be a string.');
	if (typeof path !== 'string') throw new TypeError('HTTP route path must be a string.');
	const normalizedMethod = method.trim().toUpperCase();
	if (normalizedMethod.length === 0) throw new TypeError('HTTP route method cannot be empty.');
	if (typeof handler !== 'function') throw new TypeError('HTTP route handler must be a function.');
	return Object.freeze({ kind: 'route', method: normalizedMethod, path: normalizePath(path), handler });
}

/** Mount one fetch handler below a path prefix without rewriting the request URL. */
export function mount(path: string, handler: Handler): RouteType {
	if (typeof path !== 'string') throw new TypeError('HTTP mount path must be a string.');
	if (typeof handler !== 'function') throw new TypeError('HTTP mount handler must be a function.');
	return Object.freeze({ kind: 'mount', path: normalizeMountPath(path), handler });
}


/** Canonicalize a mount prefix so `/api` and `/api/` cannot claim the same subtree. @internal */
function normalizeMountPath(path: string): string {
	const normalized = normalizePath(path);
	return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
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

/** Create a small framework-neutral HTTP application with deterministic route ownership. */
export function create(options: CreateOptionsType = {}): App {
	recordCore.assert(options, 'HTTP application options');
	const routes = routeList(options.routes ?? []);
	validateRoutes(routes);
	const notFound = options.notFound ?? (() => new Response('Not found.', { status: 404 }));
	if (typeof notFound !== 'function') throw new TypeError('HTTP notFound handler must be a function when provided.');
	const middleware = middlewareList(options.middleware ?? []);
	const dispatch: Handler = async (request) => {
		const url = new URL(request.url);
		const method = request.method.toUpperCase();
		const route = selectRoute(routes, method, url.pathname);
		if (route !== undefined) {
			const response = await route.handler(request);
			return method === 'HEAD' ? await withoutBody(response) : response;
		}
		const mounted = selectMount(routes, url.pathname);
		if (mounted !== undefined) return await mounted.handler(request);
		return await notFound(request);
	};
	return Object.freeze({ routes, fetch: compose(dispatch, middleware) });
}

/** Snapshot one dense middleware list without invoking accessor-backed array entries. @internal */
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

/** Snapshot route definitions so later caller mutation cannot change dispatch ownership. @internal */
function routeList(values: readonly RouteType[]): readonly RouteType[] {
	if (!Array.isArray(values)) throw new TypeError('HTTP routes must be an array.');
	const result: RouteType[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor)) throw new TypeError('HTTP routes must contain dense data elements.');
		const value = descriptor.value as unknown;
		recordCore.assert(value, `HTTP route at index ${index}`);
		if (value.kind === 'route') result.push(route(value.method as string, value.path as string, value.handler as Handler));
		else if (value.kind === 'mount') result.push(mount(value.path as string, value.handler as Handler));
		else throw new TypeError(`HTTP route at index ${index} has an invalid kind.`);
	}
	return Object.freeze(result);
}

/** Select the most specific matching route independently of authored order. @internal */
function selectRoute(routes: readonly RouteType[], method: string, pathname: string): RouteType | undefined {
	let selected: RouteType | undefined;
	let selectedMethodRank = 0;
	for (const entry of routes) {
		if (entry.kind !== 'route') continue;
		let methodRank = 0;
		if (entry.method === method) methodRank = 2;
		else if (method === 'HEAD' && entry.method === 'GET') methodRank = 1;
		if (methodRank === 0 || !matchPath(entry.path, pathname)) continue;
		if (
			selected === undefined ||
			methodRank > selectedMethodRank ||
			(methodRank === selectedMethodRank && compareRouteSpecificity(entry.path, selected.path) > 0)
		) {
			selected = entry;
			selectedMethodRank = methodRank;
		}
	}
	return selected;
}

/** Select the longest matching mount path independently of authored order. @internal */
function selectMount(routes: readonly RouteType[], pathname: string): RouteType | undefined {
	let selected: RouteType | undefined;
	for (const entry of routes) {
		if (entry.kind !== 'mount' || !matchesMount(entry.path, pathname)) continue;
		if (selected === undefined || entry.path.length > selected.path.length) selected = entry;
	}
	return selected;
}

/** Match one path prefix without allowing `/api` to match `/apiv2`. */
function matchesMount(prefix: string, pathname: string): boolean {
	if (prefix === '/') return true;
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Reject exact duplicate route ownership before traffic starts. @internal */
function validateRoutes(routes: readonly RouteType[]): void {
	const exact = new Set<string>();
	const mounts = new Set<string>();
	for (const entry of routes) {
		if (entry.kind === 'mount') {
			if (mounts.has(entry.path)) throw new TypeError(`Duplicate HTTP mount path: ${entry.path}.`);
			mounts.add(entry.path);
			continue;
		}
		const shape = entry.path.replace(/:[^/]+/gu, ':parameter');
		const key = `${entry.method} ${shape}`;
		if (exact.has(key)) throw new TypeError(`Duplicate HTTP route shape: ${entry.method} ${entry.path}.`);
		exact.add(key);
	}
}

/** Preserve GET response metadata while cancelling the body that HEAD will never transmit. @internal */
async function withoutBody(response: Response): Promise<Response> {
	await httpResponse.discard(response);
	return new Response(null, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
