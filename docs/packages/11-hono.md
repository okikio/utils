# Hono

Keep a familiar Hono health route while sharing its HTTP policy. Then move that same route into a checked service when
other Fetch hosts need the same input and response contract. The adapter connects these owners; it creates no listener.

A route connects a method and URL to a callback. Hono supplies that callback with its own context, including
`ctx.json()` for a JSON response. A Fetch handler instead accepts a Web `Request` and returns a Web `Response`.
The adapter connects those calling conventions while keeping Hono's router in charge.

Middleware wraps that handler: it can inspect the request before the route and update the response afterward. In this
example, Hono supplies the health body and the Utils wrapper adds `X-Content-Type-Options: nosniff`. Nothing listens on
a network port until the application passes the resulting handler to its runtime's server API.

## Call the health route without opening a port

Run a real Hono route in process before integrating a service runtime. This program supplies its own local input and
uses public workspace imports. At the checkout root, review `mise.toml`, run `mise trust`, `mise install` and
`mise run prepare -- --kind deps`. Save this as `health-hono.ts` and run `mise exec -- deno run health-hono.ts`.

```ts runnable=health-hono.ts
import { Hono } from 'hono';
import * as hono from '@okikio/hono';
import * as http from '@okikio/server/http';

// Hono owns route registration and route selection.
const app = new Hono();
app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
// Wrap Hono's Fetch entry point. Hono still selects routes; this does not open a listener.
const fetch = hono.fetch(app, [http.securityHeaders()]);
// Exercise the app with an ordinary Request, then consume the response body.
const response = await fetch(new Request('https://service.invalid/health'));
console.log((await response.json()).status, response.headers.get('x-content-type-options'));
```

Expected output:

```text output
ok nosniff
```

`ok` comes from the Hono route. `nosniff` comes from the wrapper. The next example keeps the health response but
also declares its expected shape so the service can check it.

## Give the same health route a portable contract

Save this independent program as `health-service.ts` and run `mise exec -- deno run health-service.ts`. A response
schema describes the JSON, an endpoint names its method/path, and the implementation supplies the actual behavior.
Compilation checks that those declarations are connected before Hono receives requests.

```ts runnable=health-service.ts
import { Hono } from 'hono';
import * as hono from '@okikio/hono';
import * as http from '@okikio/server/http';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import * as schema from '@okikio/schema';

// Declare portable response, endpoint and service contracts.
const Healthy = response.ok(schema.object({ status: schema.string() }), {
	id: 'health.ok',
	description: 'Health status.',
});
const Health = endpoint.get({ id: 'health.get', path: '/health', responses: [Healthy] });
const Api = service.define({ id: 'health', path: '/', endpoints: [Health] });

// Bind the declared operation to application behavior.
const implementation = service.implement(Api, {
	endpoints: [endpoint.handler(Health, () => response.create(Healthy, { status: 'ok' }))],
});

// The application owns this live runtime; mount only borrows it.
await using runtime = service.create(service.compile(implementation), { host: {} });

// Hono owns route registration and route selection.
const app = new Hono();

// Mount after creating the runtime, then retain it until request work drains.
hono.mount(app, runtime);
app.onError(hono.catchErrors());
// Wrap Hono's Fetch entry point. Hono still selects routes; this does not open a listener.
const fetch = hono.fetch(app, [http.securityHeaders()]);
const result = await fetch(new Request('https://service.invalid/health'));
console.log((await result.json()).status, result.headers.get('x-content-type-options'));
```

```text output
ok nosniff
```

`mount()` registers the already compiled routes. It borrows the runtime; `await using` disposes that runtime at the
end of the program. `fetch()` wraps Hono with portable middleware. `catchErrors()` supplies Hono's error callback and
preserves native Hono HTTPException responses. None of these calls starts a socket server.

In an existing Hono application, register native middleware that must run before mounted routes **before** `mount()`.
Overlapping routes resolve in Hono registration order. Inside a service, compilation orders static and explicit HEAD
routes; mounting does not replace Hono's router or reorder unrelated registrations. Test overlaps intentionally.

To deploy, pass this `fetch` function to the host's Fetch adapter. During shutdown, stop accepting requests and
wait for the outstanding responses. Then dispose the runtime. If you dispose it when a short setup function
ends, it can close while the host still needs it. When you call the function yourself, read or cancel each
response body. Your application still sets up authentication and opens any resources the handler needs.

Use the [service guide](../../packages/server/service/README.md) when health becomes a domain API with validated
request bodies. Keep Hono context features in native routes; mounted handlers receive the service's validated inputs.
