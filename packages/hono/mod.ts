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
	return async (error: Error, ctx: HonoContext): Promise<Response> => await http.errorResponse(error, ctx.req.raw, {
		...options,
		async map(normalized, request) {
			if (error instanceof HTTPException) return error.getResponse();
			return await options.map?.(normalized, request);
		},
	});
}
