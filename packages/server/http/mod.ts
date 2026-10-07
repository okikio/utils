/**
 * Mount a portable Fetch app while keeping listener ownership with the host.
 *
 * Add mounts, request correlation, CORS or safe exception responses deliberately. HEAD fallback selects GET behavior while the runtime suppresses its response body. A Deno or framework adapter owns the network listener.
 *
 * @example
 * ```ts
 * import * as http from '@okikio/server/http';
 * const app = http.create({ routes: [http.route('GET', '/health', () => Response.json({ ok: true }))], middleware: [http.securityHeaders()] });
 * console.log((await app.fetch(new Request('https://service.invalid/health', { method: 'HEAD' }))).status);
 * console.log((await app.fetch(new Request('https://service.invalid/missing'))).status);
 * ```
 *
 * @module
 */
export { compose, create, mount, route } from './app.ts';
export { access } from './access.ts';
export { correlation } from './correlation.ts';
export { cors } from './cors.ts';
export { catchErrors, errorResponse } from './errors.ts';
export { health, ready } from './health.ts';
export { headers, securityHeaders } from './headers.ts';
export { prettyJson } from './json.ts';
export { compareRouteSpecificity, matchPath, normalizePath, trailingSlash } from './path.ts';
export { requestId } from './request.ts';
export { problemResponse, withHeaders } from './response.ts';
export { timing } from './timing.ts';
export type {
	AccessEventType,
	App,
	CreateOptionsType,
	Handler,
	Middleware,
	Next,
	ReadinessType,
	RouteType,
} from './types.ts';
export type { CorrelationOptions } from './correlation.ts';
export type { CorsOptionsType } from './cors.ts';
export type { ErrorOptions, ErrorResultType } from './errors.ts';
export type { HealthOptions } from './health.ts';
export type { SecurityHeadersOptionsType } from './headers.ts';
export type { PrettyJsonOptionsType } from './json.ts';
export type { TrailingSlashOptions } from './path.ts';
export type { RequestIdOptions } from './request.ts';
export type { TimingOptions } from './timing.ts';

export { matchMount, matchRoute, prepare as prepareRoutes, routeKey } from './router.ts';
export type { MountOptions, RoutePlan, RoutePlanInput } from './types.ts';
