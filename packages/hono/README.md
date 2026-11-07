# `@okikio/hono`

If your application already uses Hono routes, you can keep them while sharing HTTP behavior with a portable Utils
service. This adapter wraps Hono Fetch handling with framework-neutral middleware and can mount a compiled Utils service
in a Hono application. Use it when you want one security-header or error policy without rewriting that policy for each
host.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

```text
Caller Request -> generic Fetch middleware -> Hono application -> Response
                                              | native Hono route
                                              | mounted Utils service route
Deployment host owns the listener; each service keeps its resource ownership.
```

The wrapper runs around the Hono application. A mounted service keeps its validated endpoint handlers and cleanup model;
Hono remains responsible for selecting its registered routes. The adapter does not convert every Hono feature into a
Utils feature or make the two routers interchangeable.

Hono is a web framework: `app.get(path, callback)` connects a URL to a function that produces an HTTP answer.
**Middleware** is another function around that call. It can inspect the request before the route runs and change the
response afterward. In the example, the route still makes the JSON body; the middleware adds a browser security header.
The wrapper receives a Web `Request` and returns a Promise of a Web `Response`. `await` waits for that answer.

## Keep a normal Hono route and share its HTTP policy

Keep a familiar Hono health route and wrap its Fetch entry with the shared security-header policy. Calling it locally
shows the response body and headers without starting another server.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import { Hono } from 'hono';
import * as hono from '@okikio/hono';
import * as http from '@okikio/server/http';

// Hono owns route matching. The wrapper adds HTTP middleware around its Fetch entry.
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

The demo keeps `/health` as an ordinary Hono route. `hono.fetch()` wraps it with the generic security-header middleware.
The response JSON supplies `status: 'ok'`, and the wrapper supplies `X-Content-Type-Options: nosniff`, producing
`ok nosniff`. This shows one request passing through both owners. It does not start a listener. Add
`app.onError(hono.catchErrors())` when the host also needs the shared error policy.

## What each adapter actually does

| Call                      | Input and output                                           | One level deeper                                                                   |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `fetch(app, middleware?)` | Caller-owned Hono app → Web Fetch `Handler`                | Wraps `(request) => app.fetch(request)` using the generic middleware chain         |
| `mount(app, runtime)`     | Hono app and compiled `ServiceRuntime` → the same Hono app | Registers each runtime route and passes `ctx.req.raw` to its existing handler      |
| `catchErrors(options?)`   | Error policy → Hono `onError` callback                     | Turns other errors into safe responses and keeps Hono `HTTPException` responses intact |

The adapter neither converts your code into a different programming model nor takes ownership of the app. Hono routes
still receive Hono contexts. Mounted service handlers still receive their own validated inputs and declared resources.
`mount()` only registers handlers; it does not create or dispose the service runtime.

This narrow bridge means the security middleware in the example can also wrap a plain Fetch app, while the Hono route
keeps `ctx.json(...)`. Install only the bridge you need. If the app only needs Hono's own middleware and no shared
service, ordinary Hono code remains sufficient. See the [public source contracts](./mod.ts).

## Add shared policy to the existing Hono host

For an existing Hono API, use the adapter's Fetch wrapper to share [HTTP middleware](../server/http/README.md) with a
second service or an embedded tool. Keep Hono-native middleware where it uses Hono-specific context or routing features.
Configure logging and the network listener in the application host.

For a domain API with validated input and declared responses, build a [service](../server/service/README.md) and
register its routes with `hono.mount()`. Import the same service definition into a
[gateway](../server/gateway/README.md) when another host needs forwarding routes. Hono still owns route registration
order, so combine overlapping Hono and mounted routes deliberately. Read or cancel response bodies and dispose the
service runtime through its own owner.

[Choose related utilities by outcome](../../docs/07-outcomes.md). The
[complete mounted service](../../docs/packages/11-hono.md#give-the-same-health-route-a-portable-contract) supplies the
response definition, endpoint, implementation and owned runtime before registering any service route.

## Share HTTP policy while keeping Hono routes

A health route can stay native Hono while a larger service mounts its compiled contract. Both can share portable HTTP
policy.

Use native Hono features where they fit. Add Server when endpoints need checked contracts or another Fetch host must run
the same behavior.

Registration order matters. Keep listener startup, authentication, client construction, and shutdown with the host
application.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import         | Use it to                                                   | Exact contract       |
| -------------- | ----------------------------------------------------------- | -------------------- |
| `@okikio/hono` | Use the package entry shown in the complete examples above. | [Contract](./mod.ts) |

## Measure the adapter around Hono

The focused benchmarks measure successful and missing routes with fully consumed response bodies. The benchmark compares
against direct Hono with the same request/body work. The local comparison has no middleware. Composed security
middleware remains at root.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/hono test
deno task --cwd=packages/hono bench:check
deno task --cwd=packages/hono bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Read further

The [Hono guide](https://github.com/okikio/utils/blob/main/docs/packages/11-hono.md) explains the model, manual
alternatives, and composition.
