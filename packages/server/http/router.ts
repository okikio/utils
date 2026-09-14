import { compareRouteSpecificity, normalizePath } from './path.ts';
import type { RoutePlan, RoutePlanInput } from './types.ts';

/** Runtime indexes derived once from an immutable route plan. */
interface RouteIndexType {
	readonly static: ReadonlyMap<string, string>;
	readonly dynamic: ReadonlyMap<string, readonly RoutePlanInput[]>;
	readonly mounts: readonly RoutePlanInput[];
}

const indexes = new WeakMap<RoutePlan, RouteIndexType>();

/**
 * Prepare route ownership before traffic starts.
 *
 * The returned value contains only inert data. It can therefore be retained by a
 * service compiler, serialized into a build artifact, or shared by a gateway
 * without retaining handler functions. Static routes are separated from dynamic
 * templates and dynamic candidates are preordered by specificity.
 */
export function prepare(input: readonly RoutePlanInput[]): RoutePlan {
	if (!Array.isArray(input)) throw new TypeError('HTTP route plan input must be an array.');
	const routes: RoutePlanInput[] = [];
	const shapes = new Set<string>();
	const mounts = new Set<string>();
	for (const value of input) {
		if (typeof value !== 'object' || value === null) throw new TypeError('HTTP route plan entries must be objects.');
		if (value.kind === 'mount') {
			const path = normalizeMountPath(value.path);
			if (mounts.has(path)) throw new TypeError(`Duplicate HTTP mount path: ${path}.`);
			mounts.add(path);
			routes.push(Object.freeze({ kind: 'mount', path }));
			continue;
		}
		if (value.kind !== 'route') throw new TypeError('HTTP route plan entry has an invalid kind.');
		const method = normalizeMethod(value.method);
		const path = normalizePath(value.path);
		const shape = path.replace(/:[^/]+/gu, ':parameter');
		const key = `${method} ${shape}`;
		if (shapes.has(key)) throw new TypeError(`Duplicate HTTP route shape: ${method} ${path}.`);
		shapes.add(key);
		routes.push(Object.freeze({ kind: 'route', method, path }));
	}
	return Object.freeze({ kind: 'http-route-plan', routes: Object.freeze(routes) });
}

/** Match one request method/path against a prepared route plan. */
export function matchRoute(plan: RoutePlan, method: string, pathname: string): string | undefined {
	const normalizedMethod = normalizeMethod(method);
	return matchMethod(plan, normalizedMethod, pathname) ??
		(normalizedMethod === 'HEAD' ? matchMethod(plan, 'GET', pathname) : undefined);
}

/** Match one concrete request path against the longest prepared mount prefix. */
export function matchMount(plan: RoutePlan, pathname: string): string | undefined {
	for (const entry of runtimeIndex(plan).mounts) {
		if (matchesMount(entry.path, pathname)) return routeKey(entry);
	}
	return undefined;
}

/** Build the stable identity used to bind inert route-plan entries to handlers. */
export function routeKey(route: RoutePlanInput): string {
	return route.kind === 'mount'
		? `mount ${normalizeMountPath(route.path)}`
		: `${normalizeMethod(route.method)} ${normalizePath(route.path)}`;
}

/** Canonicalize a mount prefix so `/api` and `/api/` cannot claim the same subtree. */
export function normalizeMountPath(path: string): string {
	const normalized = normalizePath(path);
	return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/** Rewrite one URL relative to a matched mount while preserving query and origin. */
export function stripMountPrefix(url: URL, prefix: string): URL {
	const normalized = normalizeMountPath(prefix);
	const next = new URL(url);
	if (!matchesMount(normalized, next.pathname)) throw new TypeError(`${next.pathname} is outside mount ${normalized}.`);
	if (normalized === '/') return next;
	const suffix = next.pathname.slice(normalized.length);
	next.pathname = suffix.length === 0 ? '/' : suffix;
	return next;
}

/** Build the executable maps once while keeping the public plan data-only. */
function runtimeIndex(plan: RoutePlan): RouteIndexType {
	assertPlan(plan);
	const existing = indexes.get(plan);
	if (existing) return existing;
	const staticRoutes = new Map<string, string>();
	const dynamic = new Map<string, RoutePlanInput[]>();
	const mounts: RoutePlanInput[] = [];
	for (const route of plan.routes) {
		if (route.kind === 'mount') {
			mounts.push(route);
			continue;
		}
		if (!route.path.includes('/:')) {
			staticRoutes.set(`${route.method} ${route.path}`, routeKey(route));
			continue;
		}
		const key = bucketKey(route.method, segmentCount(route.path));
		const bucket = dynamic.get(key) ?? [];
		bucket.push(route);
		dynamic.set(key, bucket);
	}
	for (const bucket of dynamic.values()) bucket.sort((a, b) => compareRouteSpecificity(b.path, a.path));
	mounts.sort((a, b) => b.path.length - a.path.length);
	const value = Object.freeze({
		static: staticRoutes,
		dynamic: new Map([...dynamic].map(([key, value]) => [key, Object.freeze(value)] as const)),
		mounts: Object.freeze(mounts),
	} satisfies RouteIndexType);
	indexes.set(plan, value);
	return value;
}

/** Match a single method without applying the HTTP HEAD-to-GET fallback. */
function matchMethod(plan: RoutePlan, method: string, pathname: string): string | undefined {
	const prepared = runtimeIndex(plan);
	const exact = prepared.static.get(`${method} ${pathname}`);
	if (exact !== undefined) return exact;
	const actual = requestParts(pathname);
	if (actual === undefined) return undefined;
	const candidates = prepared.dynamic.get(bucketKey(method, actual.length));
	if (!candidates) return undefined;
	for (const route of candidates) {
		const expected = routeParts(route.path);
		let matches = true;
		for (let part = 0; part < expected.length; part += 1) {
			const candidate = expected[part]!;
			if (!candidate.startsWith(':') && candidate !== actual[part]) {
				matches = false;
				break;
			}
		}
		if (matches) return routeKey(route);
	}
	return undefined;
}

/** Keep request-path splitting exact: duplicate and trailing slashes remain significant. */
function requestParts(pathname: string): readonly string[] | undefined {
	if (pathname === '/') return [];
	if (!pathname.startsWith('/')) return undefined;
	return pathname.slice(1).split('/');
}

/** Split a canonical authored route template. */
function routeParts(path: string): readonly string[] {
	return path === '/' ? [] : path.slice(1).split('/');
}

/** Count canonical path segments once while preparing dynamic lookup buckets. */
function segmentCount(path: string): number {
	return path === '/' ? 0 : path.slice(1).split('/').length;
}

/** Build the internal method/segment-count lookup identity. */
function bucketKey(method: string, count: number): string {
	return `${method}:${count}`;
}

/** Match one path prefix without allowing `/api` to match `/apiv2`. */
function matchesMount(prefix: string, pathname: string): boolean {
	return prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Normalize a method without accepting implicit coercion or an empty token. */
function normalizeMethod(method: string): string {
	if (typeof method !== 'string') throw new TypeError('HTTP route method must be a string.');
	const normalized = method.trim().toUpperCase();
	if (normalized.length === 0) throw new TypeError('HTTP route method cannot be empty.');
	return normalized;
}

/** Reject foreign/malformed route-plan values before populating runtime caches. */
function assertPlan(plan: RoutePlan): void {
	if (typeof plan !== 'object' || plan === null || plan.kind !== 'http-route-plan' || !Array.isArray(plan.routes)) {
		throw new TypeError('HTTP route plan is invalid.');
	}
}
