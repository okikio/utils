# Separate an API contract from its live host

A web server answers requests. A health check might ask only whether the program is responding. A save request
may also need to check the submitted data, decide who is allowed to write, and save a record before it can answer.

Start by calling a small request handler directly. When several routes share rules or dependencies, you can describe
their contracts separately from the functions that carry them out. Your application still decides how to accept network
connections, check access, and shut down.

## Answer a health request without opening a port

Create a Fetch handler and call it with a local Request. The returned Response demonstrates the health route without a
listener, credentials, or network. Later examples add a checked service contract when the application needs one.

After the [checkout setup](../../README.md#work-on-the-repository), save the block as `package-task.ts` at the checkout
root and run `mise exec -- deno run package-task.ts`.

```ts runnable=package-task.ts
import * as http from '@okikio/server/http';

// Construct a Fetch application; no listener starts here.
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

The first line confirms that the route answered and its body reported health. The second comes from middleware, which
ran around the route and added a header. No network request was needed to check either result.

## Follow a contract into a live request handler

Static definitions are import-safe. They do not read the environment, start a listener, configure logging, open a
database, or create a provider client.

The application's startup code, sometimes called the composition root, puts the service together:

```text
import definitions and implementations
  -> compile the selected graph
  -> reject missing or conflicting contracts
  -> create the runtime's lazy resource owner
  -> serve requests
  -> dispose the runtime
```

`service.compile()` checks that each route has the right handler, that its dependencies can be supplied, and that its
allowed answers are declared. It prepares those lookups before the first request arrives.

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

The complete version below serves the same familiar health response, this time with a reusable checked body rule.
The service owns request lifetimes and cleanup. Its dependencies supply local time and disposal implementations, so
this flow needs no global polyfill setup:

Save `declared-service.ts` and run `mise exec -- deno run declared-service.ts`.

```ts runnable=declared-service.ts
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

// Collect the declared routes before attaching their behavior.
const Api = service.define({ id: 'api', path: '/', endpoints: [Health] });

// Bind handlers to the exact definitions above. Matching text IDs alone are insufficient.
const implementation = service.implement(Api, {
	endpoints: [endpoint.handler(Health, () => response.create(Healthy, { ok: true }))],
});

// Compilation checks the bindings; the live runtime owns request resources.
await using runtime = service.create(service.compile(implementation), { host: {} });

// Exercise a matched request and consume its body.
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

Service and Gateway can report events such as the start or end of a request. Importing an observer definition does
not start reporting. Your application attaches an observer when it starts the server or uses
`@okikio/telemetry/server` to turn those events into records for its reporting system.

For a telemetry-bound host, `telemetry.create(reporter, { fields })` creates the reporting scope, and `serverTelemetry.service(Diagnostics, scope)` creates the observer handler passed in `service.create(..., { observers })`. Here the executable supplies the reporter, deployment fields and imported observer definition. Those values are not discovered by the service. The [telemetry Server adapter](../../packages/telemetry/README.md) owns its complete integration example.

The server decides when to report an HTTP event. Your application decides what to log, what to remove before
sending it, and where to send the logs and traces.

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
