# `@okikio/hono`

If your application already uses Hono routes, you can keep them while sharing HTTP behavior with a portable Utils
service. This adapter wraps Hono Fetch handling with framework-neutral middleware and can mount a compiled Utils service
in a Hono application. Use it when you want one security-header or error policy without rewriting that policy for each
host.

```text
Caller Request -> generic Fetch middleware -> Hono application -> Response
                                              | native Hono route
                                              | mounted Utils service route
Deployment host owns the listener; each service keeps its resource ownership.
```

The wrapper runs around the Hono application. A mounted service keeps its validated endpoint handlers and cleanup model;
Hono remains responsible for selecting its registered routes. The adapter does not convert every Hono feature into a
Utils feature or make the two routers interchangeable.

## Keep a normal Hono route and share its HTTP policy

```ts runnable
import { Hono } from 'hono';
import * as hono from '@okikio/hono';
import * as http from '@okikio/server/http';
const app = new Hono();
app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
app.onError(hono.catchErrors());
const fetch = hono.fetch(app, [http.securityHeaders()]);
const response = await fetch(new Request('https://service.invalid/health'));
console.log((await response.json()).status, response.headers.get('x-content-type-options'));
```

Expected output:

```text output
ok nosniff
```

The demo keeps `/health` as an ordinary Hono route and installs the adapter's error callback on that app. `hono.fetch()`
then wraps it with the generic security-header middleware. The response JSON supplies `status: 'ok'`, and the wrapper
supplies `X-Content-Type-Options: nosniff`, producing `ok nosniff`. This shows one request passing through both owners.
It does not start a listener or exercise the error path.

## What each adapter actually does

| Call                      | Input and output                                           | One level deeper                                                                   |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `fetch(app, middleware?)` | Caller-owned Hono app → Web Fetch `Handler`                | Wraps `(request) => app.fetch(request)` using the generic middleware chain         |
| `mount(app, runtime)`     | Hono app and compiled `ServiceRuntime` → the same Hono app | Registers each runtime route and passes `ctx.req.raw` to its existing handler      |
| `catchErrors(options?)`   | Error policy → Hono `onError` callback                     | Uses the generic safe error materializer; preserves Hono `HTTPException` responses |

The adapter neither converts your code into a different programming model nor takes ownership of the app. Hono routes
still receive Hono contexts. Mounted service handlers still receive their own validated inputs and declared resources.
`mount()` only registers handlers; it does not create or dispose the service runtime.

This narrow bridge means the security middleware in the example can also wrap a plain Fetch app, while the Hono route
keeps `ctx.json(...)`. Install only the bridge you need. If the app only needs Hono's own middleware and no shared
service, ordinary Hono code remains sufficient. See the [full adapter signatures](API.md).

## Build on the example

For an existing Hono API, use the adapter's Fetch wrapper to share [HTTP middleware](../server/http/README.md) with a
second service or an embedded tool. Keep Hono-native middleware where it uses Hono-specific context or routing features.
Configure logging and the network listener in the application host.

For a domain API with validated input and declared responses, build a [service](../server/service/README.md) and
register its routes with `hono.mount()`. Import the same service definition into a
[gateway](../server/gateway/README.md) when another host needs forwarding routes. Hono still owns route registration
order, so combine overlapping Hono and mounted routes deliberately. Read or cancel response bodies and dispose the
service runtime through its own owner.

[Choose related utilities by outcome](../../docs/outcomes.md). Later code with application-owned runtime or middleware
values is a composition sketch; provide those values before running it.

## Mount a compiled service runtime

```ts
import { Hono } from 'hono';
import * as http from '@okikio/server/http';
import * as hono from '@okikio/hono';

const app = new Hono();
hono.mount(app, serviceRuntime);
app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
app.onError(hono.catchErrors());

export default {
	fetch: hono.fetch(app, [
		http.securityHeaders(),
		http.cors(),
	]),
};
```

`hono.mount()` registers `ServiceRuntime.routes` in the canonical order produced by the service runtime. This matters
because Hono resolves matching handlers in registration order, while the framework-neutral runtime explicitly prefers
more specific static routes and explicit `HEAD` routes.

Hono-specific middleware remains valid. The generic HTTP middleware is useful when the same behavior must also work with
`Deno.serve`, Node fetch adapters, workers, tests, or another framework.

## Framework ownership

Keep endpoint definitions, validation, resources, and business behavior in the framework-neutral server packages. Use
Hono for the host features that are actually Hono-specific, such as its router, context helpers, or native middleware.

```ts
const app = new Hono();
hono.mount(app, serviceRuntime);

app.use('/admin/*', honoNativeAdminMiddleware);
app.onError(hono.catchErrors({ expose: false }));

export default { fetch: hono.fetch(app, genericHttpMiddleware) };
```

This direction matters for tests and alternate runtimes: the same `serviceRuntime` can still be called directly as a
Fetch handler without Hono.
