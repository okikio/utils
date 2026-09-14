`@okikio/server/http`
=====================

This package provides the Fetch host used by compiled services and manually
authored routes. It prepares route matching, binds handlers, composes HTTP
middleware, and mounts other Fetch handlers.

Start with a prepared route plan
--------------------------------

Use `prepareRoutes()` when method and path ownership are known before the host is
created. The plan contains no handler functions.

~~~~ typescript
import * as http from '@okikio/server/http';

const routes = [
  http.route('GET', '/health', () => new Response('ok')),
  http.route('GET', '/companies/:id', company),
];

const plan = http.prepareRoutes(routes);
const app = http.create({ routes, plan });
~~~~

The host verifies that the supplied routes bind exactly to the plan before it
accepts requests. A missing or extra route is a configuration error rather than
a request-time fallback.

Route matching
--------------

Static method/path pairs use direct lookup. Dynamic routes are grouped by method
and segment count, then ordered by route specificity.

Duplicate and trailing slashes remain significant. Parameter names control
parameter extraction, but two parameter-name variants cannot claim the same
method and route shape.

An explicit `HEAD` route wins. If no explicit `HEAD` route exists, a matching
`GET` route supplies the status and headers. The host discards the response body
before returning the `HEAD` response.

Mount another Fetch handler
---------------------------

`mount()` embeds another Fetch-compatible handler in the same process. This is
useful for protocol adapters such as MCP transports.

~~~~ typescript
http.mount('/mcp', mcpHandler, { requestPath: 'strip-prefix' });
~~~~

`requestPath: 'preserve'` is the default. `strip-prefix` changes only the
pathname presented to the child handler. The child still receives the original
method, headers, query string, body stream, and `AbortSignal`.

Use `@okikio/server/gateway` when a request is forwarded to another network
service and needs forwarding-header, credential, redirect, timeout, cache, or
response-filtering policy.

Performance contract
--------------------

Route preparation moves stable matching work out of request handling. The
optimized matcher must remain equivalent to the independent linear matcher in
`router.bench.ts` and the route tests.

The implementation does not use runtime source generation. See
[`../../../docs/server.md`](../../../docs/server.md) for the compiler model and
[`../../../docs/benchmarks.md`](../../../docs/benchmarks.md) for benchmark
requirements.
