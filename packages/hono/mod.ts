/**
 * Reuse framework-neutral HTTP middleware around a Hono application. Reimplementing request correlation and response headers inside each framework makes the host contracts drift.
 *
 * Start with the adapter around an existing Hono app, then share middleware with a portable service or gateway. Hono still owns its route handlers; the utility adapter owns the surrounding fetch composition. Host code starts the network listener and configures logging. Read or cancel response bodies so tests and callers release stream ownership.
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

/** Register every compiled service route on one caller-owned Hono application. */
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

/** Create a Hono `onError` callback backed by the generic safe error materializer. */
export function catchErrors(
	options: http.ErrorOptions = {},
): (error: Error, ctx: HonoContext) => Promise<Response> {
	return async (error: Error, ctx: HonoContext): Promise<Response> =>
		await http.errorResponse(error, ctx.req.raw, {
			...options,
			async map(normalized, request) {
				if (error instanceof HTTPException) return error.getResponse();
				return await options.map?.(normalized, request);
			},
		});
}
