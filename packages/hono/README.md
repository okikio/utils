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

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

## Run a complete example

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

## Purpose

This package adapts framework-neutral HTTP and service runtimes to Hono. The service compiler and `service.create()` do
not require Hono. Import this package only when a host wants Hono routing, Hono-native middleware, or Hono context
features.

## Start here

Wrap an ordinary Hono application with generic Fetch middleware:

```ts
import { Hono } from 'hono';
import * as hono from '@okikio/hono';
import * as http from '@okikio/server/http';

const app = new Hono();
app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
app.onError(hono.catchErrors());

const handler = hono.fetch(app, [http.securityHeaders()]);
const response = await handler(new Request('https://service.invalid/health'));
```

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

## Convenience and the manual equivalent

| Convenience    | Manual equivalent                                                                                      | Concrete value                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `hono.mount()` | translate one service runtime into Hono routes and adapt request/response/context behavior manually    | reuse service contracts without making Hono the contract owner |
| `hono.fetch()` | compose middleware around Hono fetch handling and preserve Web `Request`/`Response` semantics yourself | one Web-standard handler contract                              |

`@okikio/hono` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics by registering each
Fetch handler on Hono and translating thrown server failures by hand.

The adapter mounts the framework-neutral server runtime without moving service semantics into Hono.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.

## Hono adapter role

Hono is a host adapter, not the owner of endpoint, webhook, OpenAPI, or service compiler semantics. Keep reusable
protocol behavior in `@okikio/http` and service behavior in `@okikio/server`. This package should translate those
contracts into Hono concepts only where a Hono application needs that bridge.

The same compiled service can therefore run through the framework-neutral Fetch host, a Hono adapter, a gateway, or an
embedded protocol handler without changing its endpoint definitions.
