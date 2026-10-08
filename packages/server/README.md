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

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

## Run a complete example

```ts runnable
import * as http from '@okikio/server/http';
const app = http.create({
	routes: [http.route('GET', '/health', () => Response.json({ ok: true }))],
	middleware: [http.securityHeaders()],
});
const response = await app.fetch(new Request('https://service.invalid/health'));
console.log(response.status, (await response.json()).ok);
```

Expected output:

```text output
200 true
```

The demo registers one GET route at `/health` and wraps it with security-header middleware. Calling `app.fetch()`
directly selects that route and returns JSON with `ok: true`. The output `200 true` means the response succeeded and its
body has the expected flag. The example reads the body completely. It runs without opening a network listener, which
also makes this shape useful for local tests.

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

## Purpose

`@okikio/server` composes HTTP application definitions into executable services and gateways.

It owns endpoint, middleware, service, and gateway composition. HTTP protocol parsing and representation live in
`@okikio/http`. Framework adapters are separate utilities, so core server consumers do not import or install a routing
framework.

## Start here

A Fetch service can always be written manually:

```ts
const fetch = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	if (request.method === 'GET' && url.pathname === '/health') {
		return Response.json({ ok: true });
	}
	return new Response('Not found', { status: 404 });
};
```

Keep that model in mind. `@okikio/server` does not replace Fetch. It removes the repeated work around declared routes,
Standard Schema input, resources, expected problems, middleware behavior, OpenAPI projection, and deterministic gateway
composition.

## How it fits

Static definitions are import-safe. They do not read the environment, start a listener, configure logging, open a
database, or create a provider client.

A composition root follows this sequence:

```text
import definitions and implementations
  -> compile the selected graph
  -> reject missing or conflicting contracts
  -> create owned runtime resources
  -> serve requests
  -> dispose the runtime
```

`service.compile()` verifies the imported service graph and derives its route, resource, response, problem, and policy
plans.

`service.create()` creates owned resources and a framework-neutral Fetch runtime for a compiled service. The runtime
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

```ts
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';

const Health = endpoint.define({
	id: 'health',
	path: '/health',
	operations: {
		get: endpoint.operation({
			operationId: 'health.get',
			responses: [OkResponse],
		}),
	},
});

const Api = service.define({ id: 'api', endpoints: [Health] });
const compiled = service.compile(Api);
const runtime = await service.create(compiled, { implementations });

const response = await runtime.fetch(new Request('https://service.invalid/health'));
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

## Progressive usage

Read [complete compositions](../../docs/composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../../docs/outcomes.md) to
choose additional mechanisms when the application needs them.

## Security-header configuration is ordinary data

`server.http.securityHeaders()` accepts a plain/null-prototype options record. Accessor, hidden, inherited, and
symbol-backed configuration is rejected before header values are read, including the `additional` header map. This keeps
static security policy deterministic and visible in the object being reviewed.

## Convenience and the manual equivalent

| Convenience                               | Manual equivalent                                                                                                                        | Concrete value                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `endpoint.define()` + `service.compile()` | validate endpoint authoring records, compile routes, inputs, resources, problems, and handlers into one immutable runtime model yourself | definitions and runtime wiring cannot silently drift                  |
| `server.http.*` middleware                | write request IDs, CORS, timing, security headers, access logs, completion hooks, and option snapshotting independently                  | one Web `Request`/`Response` policy layer                             |
| `gateway.create()`                        | match routes, bound request bodies, rebuild trusted forwarding metadata, proxy, and normalize faults manually                            | one generic service gateway without product-specific headers baked in |

`@okikio/server` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics by matching routes,
parsing Request values, validating schemas, acquiring resources, calling handlers, mapping problems and constructing
Response values.

The utility compiles those generic contracts into a Fetch runtime. Framework adapters remain separate, and service
definitions remain import-safe.

## Framework problem catalogs

The root module exports two neutral framework problem sets:

- `ServerProblems` contains service-runtime problems such as malformed framework input.
- `GatewayProblems` contains failures owned by the gateway before an origin service handles the request.

Product-specific problem namespaces remain application composition, not generic server defaults.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.

## Compiled service

`service.compile()` prepares the stable information that request handling needs: effective operations, a handler-free
route plan, operation execution plans, resource and requirement information, and a JSON-safe manifest. The Fetch runtime
reads this prepared state instead of rebuilding the same route and policy information for every request.

The compiler remains independent of Hono and MCP. Request-local mutable values belong to `middleware.context()`.
Longer-lived session and provider capabilities belong to explicit resources. Read
[`../../docs/server.md`](../../docs/server.md) for the compiler and request-lifecycle model.
