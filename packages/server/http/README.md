# `@okikio/server/http`

If you already know how to return a Web `Response`, you can expose that code through routes without learning the service
compiler. This package matches methods and paths, runs HTTP middleware and mounts other Fetch applications. Use it for a
small API, a health route or an embedded application that should run through the same Fetch function in tests and a
host.

```text
Request -> outer middleware -> route or mounted Fetch handler -> Response
                           -> no match -> not-found Response
HEAD result -> remove body before returning to the caller
Host listener -> app.fetch(request)  [listener is owned by the host]
```

Read the first lines as dispatch inside the application. Middleware wraps the selected handler and can add headers or
map errors when configured. The HEAD policy applies to the final response, including misses and mounts. This package
matches requests; it does not automatically validate domain input or open a network port.

## Answer a health request without starting a server

```ts runnable
import * as http from '@okikio/server/http';
const app = http.create({
	routes: [http.route('GET', '/health', () => Response.json({ ok: true }))],
	middleware: [http.securityHeaders()],
});
const head = await app.fetch(new Request('https://service.invalid/health', { method: 'HEAD' }));
console.log(head.status, head.body === null, head.headers.get('x-content-type-options'));
console.log((await app.fetch(new Request('https://service.invalid/missing'))).status);
```

Expected output:

```text output
200 true nosniff
404
```

The demo registers GET `/health` with a JSON answer. A HEAD request can use that GET route, so its status is `200`,
while the application's final HEAD policy suppresses the body, which the `true` confirms. `nosniff` shows the selected
security-header policy reached the response. The second request has no route and receives the default `404`. These
outputs demonstrate routing and policy behavior; they do not prove that a listener is reachable or that a database is
ready.

## A handler is an ordinary JavaScript function

The two central public types are small enough to show in full:

```ts
type Handler = (request: Request) => Response | Promise<Response>;
type Middleware = (request: Request, next: Handler) => Response | Promise<Response>;
```

A route binds a method and path to a `Handler`. Middleware receives the request and a function for calling the next
step. It can inspect the answer with normal `await`, change headers, return early or throw. For example, this complete
API adds a version header with no middleware-specific expression language:

```ts runnable=http-middleware.ts
import { create, route } from '@okikio/server/http';
import type { Middleware } from '@okikio/server/http';

const version: Middleware = async (request, next) => {
	const response = await next(request);
	response.headers.set('x-api-version', '1');
	return response;
};
const app = create({
	routes: [route('GET', '/greeting', () => new Response('Hello!'))],
	middleware: [version],
});
const outgoing = await app.fetch(new Request('https://service.invalid/greeting'));
console.log(await outgoing.text(), outgoing.headers.get('x-api-version'));
```

```text output
Hello! 1
```

The middleware above can change the response because this route created mutable headers. An upstream Fetch response may
have immutable headers; use `withHeaders()` to copy them when wrapping such a response.

`create()` snapshots routes, prepares static/dynamic matching and binds the handlers once. It wraps dispatch in the
middleware array's order. The first middleware enters first and returns last; each layer may call `next(request)` at
most once. A second call rejects before a second route invocation. At request time the application selects an exact
route, then a prefix mount, then the not-found handler. Its final HEAD step cancels any unused body and returns the
status and headers without a body.

That design separates routing from business validation. Adopt this layer for normal Fetch handlers; adopt a compiled
service only when reusable input/output/resource contracts justify it. The [full contracts](../API.md#http) list routing
and optional host middleware.

## Build on the example

For an embedded application below `/tools`, use a mount and choose whether the child should see the original URL or a
URL with that prefix removed. The default preserves the URL; `requestPath: 'strip-prefix'` makes the child receive a
relative path while preserving request method, headers, query, body and cancellation signal.

For a larger API, mount a [service](../service/README.md) to add declared input and output validation. For an existing
Hono application, share Fetch middleware through the [Hono adapter](../../hono/README.md). Add `catchErrors()` when you
want safe exception responses; route creation alone does not install error handling. The host starts and stops the
listener, and callers must read or cancel streaming response bodies.

## Start with a prepared route plan

Use `prepareRoutes()` when method and path ownership are known before the host is created. The plan contains no handler
functions.

```typescript
import * as http from '@okikio/server/http';

const routes = [
	http.route('GET', '/health', () => new Response('ok')),
	http.route('GET', '/companies/:id', company),
];

const plan = http.prepareRoutes(routes);
const app = http.create({ routes, plan });
```

The host verifies that the supplied routes bind exactly to the plan before it accepts requests. A missing or extra route
is a configuration error rather than a request-time fallback.

## Route matching

Static method/path pairs use direct lookup. Dynamic routes are grouped by method and segment count, then ordered by
route specificity.

Duplicate and trailing slashes remain significant. Parameter names control parameter extraction, but two parameter-name
variants cannot claim the same method and route shape.

An explicit `HEAD` route wins. If no explicit `HEAD` route exists, a matching `GET` route supplies the status and
headers. The host discards the response body before returning the `HEAD` response.

## Mount another Fetch handler

`mount()` embeds another Fetch-compatible handler in the same process. This is useful for protocol adapters such as MCP
transports.

```typescript
http.mount('/mcp', mcpHandler, { requestPath: 'strip-prefix' });
```

`requestPath: 'preserve'` is the default. `strip-prefix` changes only the pathname presented to the child handler. The
child still receives the original method, headers, query string, body stream, and `AbortSignal`.

Use `@okikio/server/gateway` when a request is forwarded to another network service and needs forwarding-header,
credential, redirect, timeout, cache, or response-filtering policy.

## Performance contract

Route preparation moves stable matching work out of request handling. The optimized matcher must remain equivalent to
the independent linear matcher in `router.bench.ts` and the route tests.

The implementation does not use runtime source generation. See [`../../../docs/server.md`](../../../docs/server.md) for
the compiler model and [`../../../docs/benchmarks.md`](../../../docs/benchmarks.md) for benchmark requirements.
