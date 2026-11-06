# Separate an API contract from its live host

A manual server validates request input, authorizes the call, acquires dependencies, calls business code, validates its
result, and writes an HTTP response. Keeping declaration, binding, compilation, and serving separate makes each owner
visible.

A compiled service does not deploy itself. The application owns listeners, authentication policy, live resources,
logging configuration, readiness, and shutdown.

## Answer a health request without opening a port

Create a Fetch handler and call it with a local Request. The returned Response demonstrates the health route without a
listener, credentials, or network. Later examples add a checked service contract when the application needs one.

From the experimental Utils checkout, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps` at the repository root. Save each named program there and run `mise exec -- deno run <filename>.ts`, replacing `<filename>` with the name shown. These examples use workspace exports, not an assumed published registry release.

Save `package-task.ts` and run `mise exec -- deno run package-task.ts`.

```ts runnable=package-task.ts
import * as http from '@okikio/server/http';
const app = http.create({
	routes: [http.route('GET', '/health', () => Response.json({ ok: true }))],
	middleware: [http.securityHeaders()],
});
// Exercise routing and middleware without opening a listener; a deployment host supplies the network.
const response = await app.fetch(new Request('https://service.invalid/health'));
console.log(response.status, (await response.json()).ok);
console.log(response.headers.get('x-content-type-options'));
```

Expected output:

```text output
200 true
nosniff
```

## Follow a contract into a live request handler

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

To place a service beside host-owned routes, pass its prepared `runtime.routes` into HTTP's `create`. The service program below first constructs that runtime. The [HTTP host guide](04-http.md) then explains routing, middleware and a real listener. Keep a host liveness path separate from any service path to avoid registering the same route twice.

Hono integration lives in the separate `@okikio/hono` adapter package. A host can therefore adopt Hono without making
Hono part of the service compiler or core server runtime.

`gateway.compile()` resolves mounted service manifests and edge policies.

`gateway.create()` creates the Fetch-compatible gateway runtime.

## Larger service composition

The complete version below serves the same familiar health response, this time with a reusable checked body rule. The
two side-effect imports provide Temporal for request timestamps and `AsyncDisposableStack` for runtime ownership when
the environment lacks them. They are runtime dependencies of this service flow, not part of route definition itself:

Save `declared-service.ts` and run `mise exec -- deno run declared-service.ts`.

```ts runnable=declared-service.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';
import * as response from '@okikio/http/response';
import * as schema from '@okikio/schema';

const Healthy = response.ok(schema.object({ ok: schema.boolean() }), {
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

For a telemetry-bound host, `telemetry.create(reporter, { fields })` creates the reporting scope, and `serverTelemetry.service(Diagnostics, scope)` creates the observer handler passed in `service.create(..., { observers })`. Here the executable supplies the reporter, deployment fields and imported observer definition. Those values are not discovered by the service. The [telemetry Server adapter](../../packages/telemetry/README.md) owns its complete integration example.

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

Read [the service lifecycle guide](./03-composition.md) when you need the complete compiler, middleware and resource
ownership model.
