/**
 * Compose a portable fetch application from route and middleware values. A large if chain mixes routing, exception mapping and security headers, making it hard to mount the same service on another host.
 *
 * Start with Web Request/Response routes, then move stable schemas into endpoint definitions and bind implementations through services. A gateway composes host services; an explicit Deno or framework adapter starts the listener. Definitions do not create connections. Middleware and response bodies have real ownership and cancellation costs, so choose buffering only for bounded payloads.
 *
 * @example
 * ```ts
 * import * as http from '@okikio/server/http';
 * const app = http.create({
 *   routes: [http.route('GET', '/health', () => Response.json({ ok: true }))],
 *   middleware: [http.securityHeaders()],
 * });
 * const response = await app.fetch(new Request('https://service.invalid/health'));
 * console.log(response.status, (await response.json()).ok);
 * ```
 *
 * @module
 */
export * as http from './http/mod.ts';
export * as endpoint from './endpoint/mod.ts';
export * as middleware from './middleware/mod.ts';
export * as gateway from './gateway/mod.ts';
export * as service from './service/mod.ts';
export { GatewayProblems } from './gateway/problems.ts';
export { ServerProblems } from './problems.ts';
