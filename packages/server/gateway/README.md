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

## Forward a health request with a controlled upstream

Compile a forwarding route from a service declaration and call it through a supplied local upstream. The output shows
the selected method and path, followed by the upstream JSON response; no real network request is needed.

From the experimental Utils checkout, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps` at the repository root. Save each named program there and run `mise exec -- deno run <filename>.ts`, replacing `<filename>` with the name shown. These examples use workspace exports, not an assumed published registry release.

Save `example-1.ts` and run `mise exec -- deno run example-1.ts`.

```ts runnable
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
	// Replace network I/O with a local upstream response so the example can inspect forwarding.
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

The demo imports the health endpoint and its `/api` service prefix, then mounts that service at
`https://upstream.invalid`. Compilation produces `/api/health` without copying that full path into the gateway. The
injected Fetch function reports what reached it: GET for the imported route path and no caller cookie. The `false` shows
the default credential policy removed the incoming session cookie before forwarding. That local upstream answers with
the declared health body; the gateway returns it to the caller without performing origin-side schema validation. Reading
the returned body completes this request. No network connection is made; the `.invalid` origin is only route metadata in
this example.

This route has no timeout and creates no owned resource collection, so it needs no Temporal or disposal polyfill setup.
If you configure a Temporal timeout in a runtime without Temporal, install the duration polyfill at the host boundary.

The second request asks for `/private`, which the imported service did not declare. It returns 404 without another upstream call. Correct the caller’s URL or explicitly declare and admit the route; the gateway does not forward arbitrary paths just because an origin is configured. The rejected body is canceled because this caller only needs its status.

## Cancellation ends reads before source cleanup finishes

A route's timeout covers a bounded upload read as well as forwarding and the response body. A stalled upload with
`bodyLimit` returns a 504 without contacting the origin when that deadline expires. Routes without a body limit pass the
upload stream through; the Fetch adapter must respect the supplied signal. The deadline also remains active after
response headers arrive, until the returned body finishes or is canceled.

If the caller aborts while reading the response, that read rejects with the caller's exact reason. The gateway releases
its reader promptly and starts upstream cancellation once. The upstream source's cancellation hook may finish later or
fail; it does not replace the read's abort reason. An explicit consumer `body.cancel()` instead joins that cleanup and
can reject with its failure. A custom Fetch adapter that returns a response after cancellation also has that late body
discarded without delaying refusal. The gateway currently provides no public method to join cleanup after signal abort; hosts
that need that evidence must retain it in their Fetch adapter. Native Request body transfer can also retain its own
source lock until that source's cancellation finishes.

Keep deadlines within 2,147,483,647 milliseconds (about 24.9 days). Longer values are capped at that timer limit, so they
expire earlier than their authored duration. Authentication adapters and observers are awaited host callbacks: they
must settle promptly and cooperate with cancellation. Observer failures cannot replace the routing result, but a
handler that never settles can still delay it.

## Choose adjacent capabilities

Use Gateway when a host forwards an imported service contract. Service owns the upstream implementation, and HTTP owns
local handler composition. The application chooses the origin, credentials, forwarding trust, and cancellation budget.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/server/06-gateway.md) for composition,
ownership, and failure behavior.


The [real proxy drill](../../../docs/maintenance/07-recovery.md#follow-an-event-through-nginx-and-the-gateway) checks
nginx → gateway → HTTP origin with mixed-speed readers, buffering, idle timeouts, heartbeats and caller cancellation.
Its recorded plain-HTTP settings are a reproducible starting point for testing your own ingress.
