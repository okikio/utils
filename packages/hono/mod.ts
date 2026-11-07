/**
 * Wrap a Hono Fetch application with the same HTTP middleware used by other hosts. For example, add
 * security headers around existing Hono routes without moving those routes into another router.
 *
 * Hono owns route selection. This adapter wraps app.fetch and starts no listener. The executable starts
 * the network listener and configures logging. Consumers must read or cancel response bodies to release
 * their streams.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import * as hono from '@okikio/hono';
 * import * as http from '@okikio/server/http';
 * const app = new Hono();
 * app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
 * app.onError(hono.catchErrors());
 * const fetch = hono.fetch(app, [http.securityHeaders()]);
 * const response = await fetch(new Request('https://service.invalid/health'));
 * console.log((await response.json()).status, response.headers.get('x-content-type-options'));
 * ```
 *
 * @module
 */
import type { Context as HonoContext } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import * as http from '@okikio/server/http';
import type * as service from '@okikio/server/service';

/**
 * Register an existing service runtime's routes on a Hono application.
 *
 * This borrows both values and returns the same app. It does not create the
 * service, open a listener or arrange disposal. Keep the runtime alive while
 * Hono can call its routes, then dispose it after serving has stopped. Hono's
 * registration order still decides how these routes interact with native routes.
 */
export function mount(app: Hono, runtime: service.ServiceRuntime): Hono {
	for (const route of runtime.routes) {
		app.on(route.method, route.path, (ctx) => route.handler(ctx.req.raw));
	}
	return app;
}

/** Wrap one Hono application with framework-neutral Fetch middleware. */
export function fetch(app: Hono, middleware: readonly http.Middleware[] = []): http.Handler {
	return http.compose((request) => app.fetch(request), middleware);
}

/**
 * Create a Hono `onError` callback. An HTTPException keeps its authored status,
 * headers and body without invoking the optional mapper. Other errors use the
 * shared mapper and safe fallback. The observer sees the resulting response
 * in either case; its failure cannot replace that response.
 */
export function catchErrors(
	options: http.ErrorOptions = {},
): (error: Error, ctx: HonoContext) => Promise<Response> {
	return async (error: Error, ctx: HonoContext): Promise<Response> =>
		await http.errorResponse(error, ctx.req.raw, {
			...options,
			async map(normalized, request) {
				// Preserve Hono's authored HTTP response before consulting the optional generic error map.
				if (error instanceof HTTPException) return error.getResponse();
				return await options.map?.(normalized, request);
			},
		});
}
