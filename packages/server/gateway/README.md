# `@okikio/server/gateway`

When one public address forwards to several services, copied path lists become stale and incoming cookies can reach an
unintended origin. This gateway derives its routes from imported service definitions and applies explicit forwarding
policy. The outcome is one edge Fetch application whose route ownership and credential decisions can be checked before
traffic starts.

```text
Imported service /api + endpoint /health -> compile route /api/health
Caller Request -> gateway route + forwarding policy -> upstream service
Caller Response <- sanitized upstream response      <- upstream service
```

The upper line prepares the route without contacting the upstream. The lower lines show request and response forwarding
after a runtime is created. The gateway controls what crosses that network hop. The upstream service still validates
domain input and decides whether the actor may perform the operation.

For shared terms such as `await` and `await using`, see
[the short glossary](../../../docs/learn.md#read-the-small-amount-of-code-you-need).

## Run a complete example

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import { z } from 'zod';
const Healthy = response.ok(z.object({ ok: z.boolean() }), { id: 'health.ok', description: 'Service health.' });
const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
import * as gateway from '@okikio/server/gateway';
const Edge = gateway.define({ id: 'edge', services: [gateway.mount(Api, { origin: 'https://upstream.invalid' })] });
const compiled = gateway.compile(Edge);
console.log(compiled.routes[0]?.path, compiled.routes[0]?.credentials.requestCookies);
```

Expected output:

```text output
/api/health strip
```

The demo imports the health endpoint and its `/api` service prefix, then mounts that service at
`https://upstream.invalid`. Compilation produces `/api/health` without copying that full path into the gateway. The
output `strip` is the request-cookie policy on the compiled route: incoming browser cookies are not blindly forwarded.
No upstream request is made in this demo; the `.invalid` origin is an illustrative address, not a deployed service.

## Build on the example

For a public API in front of an account service and an import service, import each
[service definition](../service/README.md), choose its origin, and specify credentials, timeouts and redirect rules
before creating the gateway runtime. Use [request header policy](../../http/request/README.md) when deciding which
credentials may cross origins; preserve separate [response cookies](../../http/cookie/README.md) when the chosen
response policy allows them. The gateway's edge authentication does not grant a domain permission inside the service.

For a local test, provide a controlled upstream Fetch function and assert both the forwarded request and the returned
response. For deployment, the host owns the network listener and the gateway runtime owns its contexts and response
lifetime. The compiler can compare an optional service manifest for drift, but imported service definitions remain the
route source.

## Definition

```ts
const DashboardCredentials = gateway.credentials({
	requestCookies: 'preserve',
	requestAuthorization: 'strip',
	responseCookies: 'preserve',
});

const DashboardPolicy = gateway.policy({
	id: 'dashboard',
	endpoints: [DashboardApi],
	bodyLimit: 5_000_000,
	timeout: Temporal.Duration.from({ seconds: 30 }),
	cache: gateway.noStore(),
	credentials: DashboardCredentials,
	redirects: gateway.redirects({ mode: 'rewrite-origin' }),
});

const PublicGateway = gateway.define({
	id: 'public',
	services: [
		gateway.mount(DashboardService, {
			origin: DashboardOrigin,
		}),
	],
	policies: [DashboardPolicy],
});
```

The compiler resolves exact method/path ownership directly from the mounted service definitions, then resolves origins,
policy conflicts, credential treatment, redirect behavior, observers, and manifests before a runtime is created. Hosts
may additionally pass compiled service manifests to `gateway.compile()` when deployment validation should reject
definition/runtime drift. The manifests never become the route source of truth.

## Host ownership

A mount is **route metadata**, not service startup. `gateway.mount(Service, {
origin })` reads an import-safe service
definition so compilation can determine which upstream owns each method/path. It does not instantiate that service, open
its resources, spawn a process, or bind its origin.

`gateway.create()` returns one Fetch-compatible handler. The surrounding host owns the listener and its restart
lifecycle:

```text
service definition --import--> gateway.compile()
                              |
                              v
                       gateway.create()
                              |
                              v
                         { fetch }
                              |
                 transport host owns socket
```

For example, a Deno application can export the handler to `deno serve`; Deno then owns the TCP listener. Adding
`Deno.serve()`, `Deno.listen()`, or a process supervisor inside this package would create competing transport ownership
and is intentionally outside the gateway contract.

## Secure defaults

Unless an imported policy says otherwise, the gateway strips:

- caller `Cookie`;
- caller `Authorization`;
- response `Set-Cookie`;
- request and response hop-by-hop headers;
- caller-supplied `Forwarded`, `X-Forwarded-*`, and `X-Real-IP`;
- caller-supplied application trust headers.

A host that knows the connected client address can provide `clientIp` to `gateway.create()`. The runtime reconstructs
`X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-For` only after the caller-supplied trust headers have been
removed.

Authentication-provider proxy routes must opt into provider cookie pass-through. Programmatic routes normally verify the
incoming API credential, strip it, and add a signed internal assertion through an explicit runtime adapter.

Hosts that own a reserved provider path or an unmatched frontend continuation can call `gateway.prepare()` before their
own transport step. Preparation reuses the same trust-header removal, correlation, and reconstructed forwarding metadata
as compiled service forwarding, while preserving `Cookie` and `Authorization` because no service credential policy has
been selected yet. The host still owns the provider-specific target, credentials, and response semantics.

Redirects use `redirect: 'manual'`. Policies may preserve the `Location`, rewrite an internal origin to the public
gateway origin, or reject cross-origin locations outside an allowlist.

## Streaming lifetime

The gateway does not buffer a body unless a declared policy needs bounded inspection. The request body is forwarded as a
stream. Caller cancellation remains connected to the response body until it drains, cancels, aborts, or errors. A
configured total timeout remains active for that lifetime too. Completion tracking runs when the timeout or a terminal
observer needs it; a gateway with neither avoids that tracking layer while preserving abort propagation.

Forwarding sanitizes both fixed hop-by-hop fields and valid field names nominated by `Connection`. Other content codings
pass through normal sanitization without compression-specific normalization. When a Fetch response has a body, its wire
length is not `0`, and its coding is exactly `gzip` or `br`, the gateway removes the stale `Content-Encoding` and
`Content-Length`. Null-body responses, including native HEAD responses, retain that representation metadata unless
normal sanitization removes it. A custom fetch adapter must follow the same decoding behavior for these supported
codings; raw compressed bytes require a different transport contract.

## Observers

Observer definitions are import-safe and handlers are bound by direct identity. Events contain redacted identifiers and
metrics, not cloned request/response bodies or credential-bearing URLs:

```ts
const GatewayTelemetry = gateway.observer.define({
	id: 'gateway.telemetry',
	description: 'Records gateway lifecycle metrics.',
});

const GatewayTelemetryHandler = gateway.observer.handler(
	GatewayTelemetry,
	(event) => logger.info(event.kind, event),
);
```

Supported stages are `denied`, `forwarding`, `response`, `completed`, `failed`, and `aborted`.

An observer answers a different question from middleware or a policy:

```text
policy
  decides what the gateway is allowed to do

observer
  records what the gateway actually did
```

Typical uses are route-denial audits, origin latency, bytes transferred, upstream failure rates, client cancellation,
and proving whether a streamed response completed after its headers were sent. Observers are not mandatory for a gateway
to route traffic. They become required only when the gateway definition imports an observer definition; the runtime then
needs the matching handler.

```text
forwarding
  sanitized request is about to leave the gateway

response
  upstream status and headers arrived

completed
  downstream body fully drained

aborted
  client or deadline cancelled the body

failed
  forwarding or the body stream failed
```

Durable security audits should still be written through an outbox rather than relying on best-effort logging.

## Prepared routing

Gateway compilation now prepares the same handler-free route plan used by the framework-neutral HTTP host. Runtime
matching therefore does not choose between `URLPattern` and a separate fallback algorithm based on host capabilities.
Deno, Node, Bun, and edge runtimes use the same route-template semantics.

The gateway remains the owner of network forwarding and trust decisions rather than an in-process mount. It still owns
forwarding-header reconstruction, correlation, credential policy, body admission, timeouts, redirects, response
filtering, and body-completion observation after a route has been selected.
