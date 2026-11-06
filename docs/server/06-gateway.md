# Server: gateway

A gateway receives a public request and forwards it to another service. For
example, `/notes` may belong to a notes server while `/photos` belongs to a photo
server. The caller sees one public address. The gateway still needs to decide
which service owns each path and which credentials that service is allowed to
receive. This page makes those decisions explicit rather than forwarding every
incoming header to any destination.

Start with the [complete package example](../../packages/server/gateway/README.md). The sections below continue that
example.

## Run a complete task

Forward a health request through a controlled local upstream implementation. This program supplies its own local input
and uses public workspace imports. From the experimental Utils checkout, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps` at the repository root. Save each named program there and run `mise exec -- deno run <filename>.ts`, replacing `<filename>` with the name shown. These examples use workspace exports, not an assumed published registry release.

Save `complete-task.ts` and run `mise exec -- deno run complete-task.ts`.

```ts runnable=complete-task.ts
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import * as gateway from '@okikio/server/gateway';
import * as schema from '@okikio/schema';
const Healthy = response.ok(schema.object({ ok: schema.boolean() }), {
	id: 'health.ok',
	description: 'Service health.',
});
const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
const Edge = gateway.define({ id: 'edge', services: [gateway.mount(Api, { origin: 'https://upstream.invalid' })] });
const compiled = gateway.compile(Edge);
let forwarded = 0;
const runtime = gateway.create(compiled, {
	fetch: async (input, init) => {
		forwarded++;
		const incoming = new Request(input, init);
		console.log(incoming.method, new URL(incoming.url).pathname, incoming.headers.has('cookie'));
		return Response.json({ ok: true });
	},
});
const outgoing = await runtime.fetch(
	new Request('https://public.invalid/api/health', {
		headers: { cookie: 'session=private' },
	}),
);
console.log(outgoing.status, await outgoing.text());
const unmatched = await runtime.fetch(new Request('https://public.invalid/private'));
console.log('Unmatched', unmatched.status, 'upstream calls', forwarded);
await unmatched.body?.cancel();
```

Expected output:

```text output
GET /api/health false
200 {"ok":true}
Unmatched 404 upstream calls 1
```

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/server/gateway/README.md) also places this operation among adjacent capabilities.

The second request asks for `/private`, which the imported service did not declare. It returns 404 without another upstream call. Correct the caller’s URL or explicitly declare and admit the route; the gateway does not forward arbitrary paths just because an origin is configured. The rejected body is canceled because this caller only needs its status.

## What the gateway compiles and what it forwards

| Value                                        | Important contents                                                             | Meaning                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `GatewayMount` from `mount(Api, { origin })` | Exact service definition and upstream origin                                   | A route source, not a running service                                |
| `GatewayDefinition`                          | Mounts, policies, observers                                                    | Import-safe description of the public edge                           |
| `CompiledGateway`                            | Resolved routes, credential/redirect/body/timeout policy, route plan, manifest | Checked data prepared before requests arrive                         |
| `GatewayRuntime`                             | `fetch(request): Promise<Response>`                                            | Live request forwarding; starts no listener                          |
| `CreateGatewayOptions.fetch`                 | Native Fetch-compatible function                                               | Upstream transport, replaceable for local tests or a controlled host |

At runtime, the gateway matches the method/path, removes untrusted forwarding fields, evaluates declared edge adapters,
applies credential policy, rebuilds the target URL and calls the upstream Fetch function with the request signal. It
sanitizes response headers and carries cancellation through the response body. With a total timeout, the timer remains
active until that body completes, rather than ending when headers arrive.

Compilation does not verify the upstream's business logic or start it. The design shares route descriptions while
keeping a trust boundary at each hop: the gateway owns forwarding policy, and the origin owns domain validation and
authorization. Use an in-process `http.mount()` when the other Fetch handler is local and no network hop is needed. See
the [full gateway contracts](../../packages/server/README.md) for policies and injected adapters.

## Build on the example

For a public API in front of an account service and an import service, import each
[service definition](../../packages/server/service/README.md), choose its origin, and specify credentials, timeouts and
redirect rules before creating the gateway runtime. Use [request header policy](../../packages/http/request/README.md)
when deciding which credentials may cross origins; preserve separate
[response cookies](../../packages/http/cookie/README.md) when the chosen response policy allows them. The gateway's edge
authentication does not grant a domain permission inside the service.

For a local test, provide a controlled upstream Fetch function and assert both the forwarded request and the returned
response. For deployment, the host owns the network listener and the gateway runtime owns its contexts and response
lifetime. The compiler can compare an optional service manifest for drift, but imported service definitions remain the
route source.

## Choose the health route's forwarding policy

The successful example uses secure defaults. If the health response must not be cached and forwarding has a 30-second total budget, add this policy when declaring `Edge`, before compiling it. This is a replacement declaration excerpt using `Health` and `Api` from the complete program, not a second running gateway.

```ts
const HealthPolicy = gateway.policy({
	id: 'health-forwarding',
	endpoints: [Health],
	bodyLimit: 1024,
	timeout: 'PT30S',
	cache: gateway.noStore(),
	credentials: gateway.credentials({
		requestCookies: 'strip',
		requestAuthorization: 'strip',
		responseCookies: 'strip',
	}),
	redirects: gateway.redirects({ mode: 'rewrite-origin' }),
});
const Edge = gateway.define({
	id: 'edge',
	services: [gateway.mount(Api, { origin: 'https://upstream.invalid' })],
	policies: [HealthPolicy],
});
```

The origin is an application decision, not a value supplied by the incoming request. Keep credentials stripped for this public health route. A provider proxy that really needs cookies must opt in deliberately; forwarding an incoming cookie does not authenticate it or grant domain access. `bodyLimit` counts request bytes, while the total timeout also covers the returned body. Configure any required Temporal globals at the host boundary as described in the package README.

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

The observer declaration below is import-safe; the handler is a separate binding. This excerpt records only event kinds in a local array. To attach it, add `Diagnostics` to the gateway definition before compilation and pass `[DiagnosticsHandler]` as the runtime's `observers`. It does not replace the forwarding policy or produce a durable audit log.

```ts
const Diagnostics = gateway.observer.define({
	id: 'health.diagnostics',
	description: 'Observe the health forwarding lifecycle.',
});
const observed: string[] = [];
const DiagnosticsHandler = gateway.observer.handler(Diagnostics, (event) => {
	observed.push(event.kind);
});
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

## Upload cancellation and response body retirement

Bounded upload reads also belong to the gateway deadline. If a caller stalls before sending any bytes or after a
partial chunk, the gateway returns 504 without contacting the origin and initiates cancellation of the original upload
source. Adding the deadline uses an explicit body reference rather than an implicit native Request body transfer;
some hosts otherwise reject the wrapper read without forwarding source cancellation. Source cleanup may finish later
and does not delay the timeout response. The [cancellation tests](../../packages/server/gateway/cancellation.test.ts)
observe source cancellation separately from eventual cleanup, without assuming they happen in the same turn.

Caller abort and the route deadline actively cancel an acquired upstream body even when the downstream caller has not
started reading. The gateway removes its abort listener and releases the native reader on EOF, source failure, or
cancellation. Completion tracking also releases its reader. A slow consumer cannot keep an unread upstream resource
alive after the request stops. Independently failed cancellation and reader release remain observable failures.

## Portable owner contracts

An independently published service can export its compiled manifest and OpenAPI without loading handlers or resource
implementations. The edge admits only named routes and supplies its own origin and caller authentication contract.

The same public health contract can cross this boundary as data. This complete program creates the owner's manifest and OpenAPI document locally, then admits only its GET health route into an artifact mount. It generates documentation; it does not start the owner service or contact its origin.

Save `health-artifact.ts` and run `mise exec -- deno run health-artifact.ts` after the same checkout setup.

```ts runnable=health-artifact.ts
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import * as gateway from '@okikio/server/gateway';
import * as schema from '@okikio/schema';
const Healthy = response.ok(schema.object({ ok: schema.boolean() }), {
	id: 'health.ok',
	description: 'Service health.',
});
const Health = endpoint.get({ id: 'health.read', path: '/health', responses: [Healthy] });
const Api = service.define({ id: 'health-api', path: '/api', endpoints: [Health] });
const owner = service.compileDefinition(Api);
const document = await service.openapi(owner, { title: 'Health owner', version: '1' });
const route = owner.manifest.routes.find((candidate) => candidate.method === 'GET' && candidate.path === '/api/health');
if (route === undefined) throw new Error('The owner must publish GET /api/health.');
const remote = gateway.mountArtifact({ manifest: owner.manifest, document }, {
	origin: 'https://upstream.invalid',
	routes: [route.id],
	authentication: {},
	security: {},
	bodyLimit: 1024,
});
const edge = gateway.compile(gateway.define({ id: 'edge', services: [], artifacts: [remote] }));
const publicDocument = await gateway.openapi(edge, { title: 'Health edge', version: '1' });
console.log(Object.keys(publicDocument.paths).join(','));
```

```text output
/api/health
```

The health operation is public, so both authentication and security mappings are explicitly empty. A protected owner requires canonical host authentication definitions and downstream scheme mappings that match its artifact IDs. Those mappings describe caller credentials; they do not inject upstream credentials or grant service permissions. The application must bind its authentication and assertion adapters before serving protected requests. Importing a new owner document should not silently admit new routes: keep the route allowlist deliberate.

Admission snapshots plain JSON data, rejects accessors, remote/dangling references and route/document drift, then
namespaces reusable components. Resource, requirement and workflow metadata cannot yet cross this data-only boundary:
nonempty opaque metadata rejects instead of acquiring local authority. Public operations still require explicit empty
`authentication` and `security` mappings. Owner `servers` never choose a forwarding origin or public server URL.

Use `internal` on a local mount to admit exact internal endpoint definitions already included in that mount. OpenAPI
includes admitted reachable internal routes by default; `includeInternal: false` can create a narrower audience view. An
OpenAPI 3.2 artifact requires `specVersion: '3.2.0'`; the emitter refuses an implicit downgrade.


## Verify the real proxy hop

The [streaming checks drill](../maintenance/07-recovery.md#follow-an-event-through-nginx-and-the-gateway)
sends eight mixed-speed readers through nginx, this gateway's native Fetch transport and a real HTTP origin. It checks
complete events, early delivery, idle expiry, heartbeat comments and cancellation reaching the origin. It also keeps a
buffered negative control so a passing test cannot confuse eventual completion with streaming delivery. Run the same
checks against your ingress before promising its behavior; TLS, compression and HTTP/2 are outside this fixture.
