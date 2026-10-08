# `@okikio/server`

To expose an API, you need to match requests to code, check inputs, return understandable answers and close resources
when work ends. `@okikio/server` lets you start with a small Fetch application and add declared endpoints and services
when you need those checks. Fetch is a function that accepts a Web `Request` and returns a `Response`; a network
listener is a separate host concern.

```text
Small app: Request -> HTTP routes + middleware -> Response

Declared service: endpoint descriptions + handler implementations
                    -> compile once -> service Fetch runtime -> Response

Deployment host: opens the listener and calls the chosen Fetch runtime
```

The small app uses ordinary request and response values. A declared service adds reusable input/output rules and startup
checks before requests arrive. Compilation links those declarations and implementations; it does not transpile your
TypeScript, open a port or connect to a database.

## Return JSON from a small API

```ts runnable
import * as http from '@okikio/server/http';
const app = http.create({
	routes: [http.route('GET', '/health', () => Response.json({ ok: true }))],
	middleware: [http.securityHeaders()],
});
const response = await app.fetch(new Request('https://service.invalid/health'));
console.log(response.status, (await response.json()).ok);
console.log(response.headers.get('x-content-type-options'));
```

Expected output:

```text output
200 true
nosniff
```

The demo registers one GET route at `/health` and wraps it with security-header middleware. Calling `app.fetch()`
directly selects that route and returns JSON with `ok: true`. The output `200 true` means the response succeeded and its
body has the expected flag. `nosniff` shows the configured security policy reached the response. The example reads the
body completely. It runs without opening a network listener, which also makes this shape useful for local tests.

## Start with the level your application needs

| Need                                                  | Smallest useful entry                | Function or value you work with                                 |
| ----------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| Return a response from a route                        | `server/http`                        | `(request: Request) => Response \| Promise<Response>`           |
| Check input/output and share API descriptions         | `server/endpoint` + `server/service` | Endpoint definition, typed handler binding, compiled service    |
| Check that middleware values exist in the right order | `server/middleware`                  | `requires`/`provides` declarations and ordinary async callbacks |
| Forward declared routes to other origins              | `server/gateway`                     | Compiled route/policy data and `(request) => Promise<Response>` |

There is no need to learn all four levels to use the first example. A route callback can contain familiar `if`,
`await fetch(...)` and `Response.json(...)` code. A service adds checks around the same application work.

One level deeper, `http.create()` snapshots route metadata, prepares matching tables and wraps the selected handler in
the requested middleware. A service compiler goes further: it joins imported definitions with exact handler/resource
bindings, rejects inconsistent graphs, and prepares per-operation parsing and result plans. Creating the runtime makes
an owned, lazy resource collection. The first request that borrows a resource acquires it; unused resources need not
open at all. The network listener stays with the host in both cases.

The design keeps static API descriptions independent from live database connections and from a particular router. It
costs a few more setup lines when you choose a declared service, but catches missing bindings before traffic and lets
the same descriptions feed a gateway or OpenAPI. The [full contracts](API.md) document each layer separately.

## Build on the example

For a small health endpoint or embedded tool, begin with [HTTP routes](http/README.md). Add CORS, error mapping or other
HTTP middleware only where the deployment needs it. For a records API with validated input, declared rejections and a
shared database, use [endpoint definitions](endpoint/README.md) and a [service runtime](service/README.md), with
[resources](../resource/README.md) that state who opens and closes the client.

For several independently deployed services, use a [gateway](gateway/README.md) to derive forwarding routes from their
imported definitions. An existing Hono host can use the [Hono adapter](../hono/README.md). In every case the deployment
host owns listener startup and shutdown; the chosen service runtime owns its own request and resource cleanup.

[Choose related utilities by outcome](../../docs/outcomes.md). Later examples that introduce application-owned clients
or schemas are composition sketches; supply those dependencies before running them.

## How it fits

Static definitions are import-safe. They do not read the environment, start a listener, configure logging, open a
database, or create a provider client.

A composition root follows this sequence:

```text
import definitions and implementations
  -> compile the selected graph
  -> reject missing or conflicting contracts
  -> create the runtime's lazy resource owner
  -> serve requests
  -> dispose the runtime
```

`service.compile()` verifies the imported service graph and derives its route, resource, response, problem, and policy
plans.

`service.create()` creates a resource owner and a framework-neutral Fetch runtime for a compiled service. The runtime
exposes its exact routes plus a native `Request -> Response` entry point. It does not import Hono.

`@okikio/server/http` owns optional host behavior such as routing, liveness, readiness, safe error completion, request
correlation, CORS, security headers, timing, trailing-slash redirects, pretty JSON, and request observation. Each
capability is enabled separately.

```ts
const runtime = service.create(compiled, options);
const app = http.create({
	routes: [
		http.route('GET', '/health', http.health({ service: 'example' })),
		...runtime.routes.map((route) => http.route(route.method, route.path, route.handler)),
	],
	middleware: [http.catchErrors(), http.requestId(), http.securityHeaders()],
});
```

Hono integration lives in the separate `@okikio/hono` adapter package. A host can therefore adopt Hono without making
Hono part of the service compiler or core server runtime.

`gateway.compile()` resolves mounted service manifests and edge policies.

`gateway.create()` creates the Fetch-compatible gateway runtime.

## Larger service composition

The complete version below serves the same familiar health response, this time with a reusable checked body rule. The
two side-effect imports provide Temporal for request timestamps and `AsyncDisposableStack` for runtime ownership when
the environment lacks them. They are runtime dependencies of this service flow, not part of route definition itself:

```ts runnable=declared-service.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';
import * as response from '@okikio/http/response';
import { z } from 'zod';

const Healthy = response.ok(z.object({ ok: z.boolean() }), {
	id: 'health.ok',
	description: 'Service health.',
});
const Health = endpoint.get({
	id: 'health.read',
	path: '/health',
	responses: [Healthy],
});
const Api = service.define({ id: 'api', path: '/', endpoints: [Health] });
const implementation = service.implement(Api, {
	endpoints: [endpoint.handler(Health, () => response.create(Healthy, { ok: true }))],
});
await using runtime = service.create(service.compile(implementation), { host: {} });
const outgoing = await runtime.fetch(new Request('https://service.invalid/health'));
console.log(outgoing.status, await outgoing.text());
```

```text output
200 {"ok":true}
```

Definitions remain import-safe. Runtime construction is where resources and host behavior are supplied. Generic built-in
server/gateway failures use stable `urn:utils:...` problem types. Product APIs can define their own HTTP problem
namespaces with `@okikio/http/problem.url()`.

## Observability remains host policy

Service and Gateway can declare import-safe observer definitions. Their runtimes emit lifecycle metadata but do not
configure a logging backend. Applications can bind those observers directly or use `@okikio/telemetry/server` to
translate them into portable telemetry records.

```ts
const scope = telemetry.create(reporter, { fields: { deployment_id: 'blue' } });
const runtime = service.create(compiled, {
	host,
	observers: [serverTelemetry.service(Diagnostics, scope)],
});
```

This preserves the same ownership rule as the listener: reusable server code owns HTTP lifecycle semantics; the
executable host owns logging, tracing, redaction, exporters, and vendor configuration.

## HTTP relationship

Use these packages for protocol values:

- `@okikio/http/request`
- `@okikio/http/cookie`
- `@okikio/http/response`
- `@okikio/http/problem`

The server package consumes those values. It does not redefine them.

## Security-header configuration is ordinary data

`server.http.securityHeaders()` accepts a plain/null-prototype options record. Accessor, hidden, inherited, and
symbol-backed configuration is rejected before header values are read, including the `additional` header map. This keeps
static security policy deterministic and visible in the object being reviewed.

## Framework problem catalogs

The root module exports two neutral framework problem sets:

- `ServerProblems` contains service-runtime problems such as malformed framework input.
- `GatewayProblems` contains failures owned by the gateway before an origin service handles the request.

Product-specific problem namespaces remain application composition, not generic server defaults.

Read [the service lifecycle guide](../../docs/server.md) when you need the complete compiler, middleware and resource
ownership model.
