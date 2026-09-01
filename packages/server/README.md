`@okikio/server`
===============

Purpose
-------

`@okikio/server` composes HTTP application definitions into executable services
and gateways.

It owns endpoint, middleware, service, and gateway composition.  HTTP protocol
parsing and representation live in `@okikio/http`. Framework adapters are separate
utilities, so core server consumers do not import or install a routing framework.


Start here
----------

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

Keep that model in mind. `@okikio/server` does not replace Fetch. It removes the
repeated work around declared routes, Standard Schema input, resources, expected
problems, middleware concerns, OpenAPI projection, and deterministic gateway
composition.

How it fits
-----------

Static definitions are import-safe.  They do not read the environment, start a
listener, configure logging, open a database, or create a provider client.

A composition root follows this sequence:

~~~~ text
import definitions and implementations
  -> compile the selected graph
  -> reject missing or conflicting contracts
  -> create owned runtime resources
  -> handle requests
  -> dispose the runtime
~~~~

`service.compile()` verifies the imported service graph and derives its route,
resource, response, problem, and policy plans.

`service.create()` creates owned resources and a framework-neutral Fetch runtime
for a compiled service. The runtime exposes its exact routes plus a native
`Request -> Response` entry point. It does not import Hono.

`@okikio/server/http` owns optional host behavior such as routing, liveness,
readiness, safe error completion, request correlation, CORS, security headers,
timing, trailing-slash redirects, pretty JSON, and request observation. Each
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

Hono integration lives in the separate `@okikio/hono` adapter package. A host can
therefore adopt Hono without making Hono part of the service compiler or core
server runtime.

`gateway.compile()` resolves mounted service manifests and edge policies.

`gateway.create()` creates the Fetch-compatible gateway runtime.


Larger service composition
--------------------------

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

Definitions remain import-safe. Runtime construction is where resources and host
behavior are supplied. Generic built-in server/gateway failures use stable
`urn:utils:...` problem types. Product APIs can define their own HTTP problem
namespaces with `@okikio/http/problem.url()`.

HTTP relationship
-----------------

Use these packages for protocol values:

 -  `@okikio/http/request`
 -  `@okikio/http/cookie`
 -  `@okikio/http/response`
 -  `@okikio/http/problem`

The server package consumes those values.  It does not redefine them.

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.

Security-header configuration is ordinary data
----------------------------------------------

`server.http.securityHeaders()` accepts a plain/null-prototype options record.
Accessor, hidden, inherited, and symbol-backed configuration is rejected before
header values are read, including the `additional` header map. This keeps static
security policy deterministic and visible in the object being reviewed.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `endpoint.define()` + `service.compile()` | validate endpoint authoring records, compile routes, inputs, resources, problems, and handlers into one immutable runtime model yourself | definitions and runtime wiring cannot silently drift |
| `server.http.*` middleware | write request IDs, CORS, timing, security headers, access logs, completion hooks, and option snapshotting independently | one Web `Request`/`Response` policy layer |
| `gateway.create()` | match routes, bound request bodies, rebuild trusted forwarding metadata, proxy, and normalize faults manually | one generic service gateway without product-specific headers baked in |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/server` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with match routes, parse Request values, validate schemas, acquire resources, call handlers, map problems, and construct Response values yourself.

The utility compiles those generic contracts into a Fetch runtime. Framework adapters remain separate, and service definitions remain import-safe.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Framework problem catalogs
--------------------------

The root module exports two neutral framework problem sets:

- `ServerProblems` contains service-runtime problems such as malformed framework input.
- `GatewayProblems` contains failures owned by the gateway before an origin service handles the request.

Product-specific problem namespaces remain application composition, not generic server defaults.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
