# Extend a small HTTP API

We will keep one application throughout: GET `/greeting?name=Sam` returns `{"message":"Hello, Sam!"}`. A missing name
returns `400`; an unknown route returns `404`. This guide adds a response header, handles unexpected errors, and makes
the same application available below `/api`.

A handler receives a Web `Request` containing the method, URL, headers, and body. It returns a Web `Response` containing
the answer. An application groups handlers into routes. Its `fetch(request)` function runs the selected handler; a
separate server listener accepts network connections and calls that function.

If you arrived directly at this page, use the Utils source checkout. From its root, review `mise.toml`, then prepare its
workspace imports and pinned tools:

```sh
mise trust
mise install
mise run prepare -- --kind deps
```

[Checkout setup](../../README.md#work-on-the-repository) includes Mise installation. The checks below run without
opening a port; the mounting section also includes a complete server entry and curl request.

The examples call the router directly with `new Request(...)`, so you can check the answer without a running
network listener. The later curl example adds the listener; it does not change
the route function.

```text
browser or fetch -> HTTP listener -> app.fetch -> matched route -> Response
local test --------------------------^                         -> read body
```

Both paths use the same routing and middleware. The local test omits sockets,
TLS and proxies, so it cannot establish their behavior. A response's status and
headers can arrive before its body finishes. `await response.text()` consumes
that body; use it only when buffering the complete text is appropriate.
For incremental results use [streaming](./10-http-streaming.md). For messages in
both directions use the [WebSocket walkthrough](./12-websocket.md).

## Add a header to the greeting response

Suppose clients need to know which API version answered their request. Add an `x-api-version` response header around the
existing greeting handler. This is a job for middleware: a function that runs before or after another function's request
handling.

Save the following complete version as `greeting.ts`. If you followed the README, it replaces
that file while keeping the same greeting and missing-name behavior:

```ts support=greeting.ts
import * as http from '@okikio/server/http';
import type { Middleware } from '@okikio/server/http';

export function greet(request: Request): Response {
	const url = new URL(request.url);
	const name = url.searchParams.get('name');
	if (name === null || name.trim() === '') {
		return Response.json({ error: 'Supply a name in ?name=Sam.' }, { status: 400 });
	}
	return Response.json({ message: `Hello, ${name.trim()}!` });
}

const version: Middleware = async (request, next) => {
	const response = await next(request);
	return http.withHeaders(response, { 'x-api-version': '1' });
};

export const app = http.create({
	routes: [http.route('GET', '/greeting', greet)],
	middleware: [http.catchErrors(), version],
});
```

`next` is the function that continues handling the request. Calling `await next(request)` waits for its response. Then
`withHeaders()` returns a response with the added header and the same status and body. It copies the headers, so the
middleware also works when wrapping a response whose original headers cannot be changed.

`async` makes `version` return a Promise, which represents its eventual response. `await` lets the function continue
when downstream handling finishes. A rejected Promise reports a failure; throwing inside an async function rejects its
Promise. The `Middleware` annotation lets TypeScript check the two arguments and the returned answer. It does not run
validation at request time.

To verify the behavior, save this as `greeting-check.ts` beside `greeting.ts`:

```ts runnable=greeting-check.ts
import { app } from './greeting.ts';

for (const path of ['/greeting?name=Sam', '/greeting', '/missing']) {
	const response = await app.fetch(new Request(`http://localhost${path}`));
	console.log(response.status, await response.text(), response.headers.get('x-api-version'));
}
```

Run it with `mise exec -- deno run greeting-check.ts`. It prints:

```text output
200 {"message":"Hello, Sam!"} 1
400 {"error":"Supply a name in ?name=Sam."} 1
404 Not found. 1
```

The header reaches all three answers because the middleware wraps the whole application, including its missing-route
handler. The greeting function still owns the decision to return `200` or `400`; `version` only changes the headers.

## Follow the request through middleware

For the middleware array `[http.catchErrors(), version]`, execution follows this order. The downward calls pass the
request; the upward returns pass the response:

```text
app.fetch(request)
  catchErrors: enter try
    version: call next(request)
      router: choose greet or the missing-route handler
      handler: return Response
    version: add x-api-version and return Response
  catchErrors: return Response, or catch a thrown error
```

This explains why code after `await next(request)` runs after the handler. Calling `next(request)` at most once prevents
the same middleware invocation from running downstream side effects twice. You can also return a response without
calling `next` to stop the request early, for example when rejecting access. There is no need to throw for a normal
rejected request.

If you know Hono, note the argument and return difference: its middleware often uses `await next()` and reads the
response through its context. Here you pass the request explicitly and receive the response from `await next(request)`.
See [Hono's middleware model](https://hono.dev/docs/guides/middleware) for that comparison. This API does not pass an
Express response object or a Hono context.

## Distinguish rejected input from unexpected failures

Our missing-name branch returns `400` deliberately. An unexpected exception is a different event: perhaps a dependency
fails or a handler contains a bug. `catchErrors()` catches downstream thrown values and rejected Promises before a
response is returned, and produces a safe error response. Without it, `app.fetch()` rejects and the caller or network
server must decide how to respond.

To see the difference without introducing a real dependency, save this separate check as `greeting-error-check.ts`. It
substitutes a failing handler for the same route; leave your application's `greet` function unchanged:

```ts runnable=greeting-error-check.ts
import * as http from '@okikio/server/http';

const failing = http.create({
	routes: [http.route('GET', '/greeting', () => {
		throw new Error('Private dependency detail');
	})],
	middleware: [http.catchErrors()],
});
const response = await failing.fetch(new Request('http://localhost/greeting?name=Sam'));
const body = await response.text();
console.log(response.status, response.headers.get('content-type'));
console.log(body.includes('Private dependency detail'));
```

Run `mise exec -- deno run greeting-error-check.ts`. The expected output is:

```text output
500 application/problem+json
false
```

The fallback is a JSON error document with status `500`; it does not expose that exception message. Use
`catchErrors({ onError })` to report the original error to your application's logging system. A custom `map` option can
choose a different response. Check those responses for private information before returning them to a client.

A middleware only wraps the functions after it. With `[catchErrors(), version]`, a failure before `version` finishes
skips its header addition. If the fallback must carry the version header too, use `[version, http.catchErrors()]`
instead: the catcher then returns a response to `version`. The same ordering decision applies to other response-changing
middleware.

There is also a timing limit to error handling. A response can contain a body that produces bytes later. An error while
those bytes are being read happens after this middleware has returned; it cannot replace a response already being sent.
The greeting uses a small completed JSON body. For streaming responses, propagate `request.signal` to downstream work
where supported, and arrange for the producer to stop and release its resources when the reader cancels.

## Give the greeting API a prefix

Suppose the application now lives at `/api/greeting`, but you want to keep its own route written as `/greeting`. A
**mount** passes requests below a prefix to another application in the same process. It does not send a network request.

Save this complete parent application as `greeting-root.ts` beside `greeting.ts`:

```ts support=greeting-root.ts
import * as http from '@okikio/server/http';
import { app } from './greeting.ts';

export const root = http.create({
	routes: [http.mount('/api', app.fetch, { requestPath: 'strip-prefix' })],
});
```

The parent removes `/api` from the pathname before calling the child. For `/api/greeting?name=Sam`, the child sees
`/greeting?name=Sam`. The method, headers, query, body stream, and cancellation signal are preserved.

Check the mounted path with `greeting-mount-check.ts`:

```ts runnable=greeting-mount-check.ts
import { root } from './greeting-root.ts';

const response = await root.fetch(new Request('http://localhost/api/greeting?name=Sam'));
console.log(response.status, await response.text());
const missing = await root.fetch(new Request('http://localhost/greeting?name=Sam'));
console.log(missing.status, await missing.text());
```

Run `mise exec -- deno run greeting-mount-check.ts`. It prints:

```text output
200 {"message":"Hello, Sam!"}
404 Not found.
```

The unprefixed path has no route in the parent. If you omit `requestPath`, the mount defaults to `'preserve'`: the child
receives `/api/greeting` unchanged and our child router cannot find its `/greeting` route.

To let another program call the parent, save this complete server entry as `greeting-server.ts` beside the other files:

```ts
import { root } from './greeting-root.ts';

Deno.serve({ hostname: '127.0.0.1', port: 8000 }, root.fetch);
```

If an earlier greeting server is still running, stop it with Ctrl+C first. Start this version from the repository root.
Restart it after later edits; this command does not watch files:

```sh
mise exec -- deno run --allow-net=127.0.0.1:8000 greeting-server.ts
```

In another terminal, run `curl -i 'http://127.0.0.1:8000/api/greeting?name=Sam'`. The answer has status `200`, body
`{"message":"Hello, Sam!"}`, and header `x-api-version: 1`. Stop the server with Ctrl+C in its terminal. If port 8000 is
occupied, change the port in the file, permission, and curl URL together.

For forwarding to another server rather than mounting a local function, use the
[Gateway](../../packages/server/gateway/README.md).

## Know what routing does with the request

These rules apply to the greeting application as it grows:

| Request or configuration                         | Result                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| GET `/greeting?name=Sam`                         | Select GET `/greeting`; pass the query to `greet`.                                              |
| POST `/greeting` with no POST route or mount     | Return the default `404`, not an automatic `405`.                                               |
| `/greeting/` when only `/greeting` is registered | No match; trailing slashes matter. Duplicate slashes in incoming paths also remain significant. |
| HEAD `/greeting?name=Sam` with no HEAD route     | Run the matching GET handler, then return its status and headers without a body.                |
| An explicit HEAD route                           | Select that route instead of GET fallback; still suppress the final body.                       |
| A matching route and a matching mount            | Choose the route before considering prefix mounts.                                              |
| Two routes with the same method and shape        | Reject configuration; changing only `:name` to `:id` does not make a distinct shape.            |

A parameter pattern such as `/greeting/:name` can match one nonempty path segment. It does **not** add a parameter
object to the request or pass another argument to your handler. `matchPath()` only reports whether a pathname matches;
it does not extract values. For this example, the query value is intentionally read with `URL.searchParams`. If you need
declared, validated path parameters, use [Endpoint](../../packages/server/endpoint/README.md).

Literal path segments take precedence over parameter segments when both match. Register complete method/path pairs and
keep query strings out of route patterns. The [route tests](../../packages/server/http/router.test.ts) show the less
common overlap cases.

## Reuse a route description only when you need one

`create()` already prepares routes for a normal application. You do not need a separate plan to run the greeting API.

A deployment tool may need to record which method/path pairs will exist before handler functions are available.
`prepareRoutes()` creates that description without including the handlers. Later, `create()` checks that the supplied
handlers match it. This makes a missing or extra binding a startup error.

For that use case, save this complete variant as `greeting-plan.ts`:

```ts runnable=greeting-plan.ts
import * as http from '@okikio/server/http';
import { greet } from './greeting.ts';

const plan = http.prepareRoutes([{ kind: 'route', method: 'GET', path: '/greeting' }]);
const app = http.create({ routes: [http.route('GET', '/greeting', greet)], plan });
const response = await app.fetch(new Request('http://localhost/greeting?name=Sam'));
console.log(response.status, await response.text());
```

Run `mise exec -- deno run greeting-plan.ts`. It prints:

```text output
200 {"message":"Hello, Sam!"}
```

The greeting function is unchanged. The plan supplies route metadata; it does not open a listener or remove input
checks. Route preparation uses ordinary data and functions, not generated source code. See the
[composition guide](./03-composition.md) for the larger service compiler and the
[benchmark protocol](../benchmarks/01-running.md) for routing comparisons.

## Add operational checks when the application needs them

A greeting response does not require a health route. When a deployment needs one, `http.health()` creates a handler that
reports process liveness with a wall timestamp and elapsed `uptimeMs`. Its default clock uses whole milliseconds. It
does not test a database or other dependency. Use `http.ready(probe)` when you need your own checks to decide whether
the application can accept useful work.

<details>
<summary>If you supply a clock for health checks</summary>

With the default clock, health uptime advances using `performance.now()` so a wall-clock correction cannot move it
backward or jump it forward. An explicit historical `startedAt` seeds the age once at handler creation. If you supply
`now(): Date`, both timestamp and uptime instead follow that Date clock and the epoch-millisecond `startedAt`. Negative
ages clamp to zero. The [health options](../../packages/server/http/health.ts) document these choices.

</details>

## Choose other HTTP behavior when a concrete need appears

The greeting needs only a few exports. The module also supplies the following optional behavior; follow each link for
its options before adding it to the same application's middleware array.

| You need                                                     | Capability and limit                                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Let a browser call the API from another origin               | [cors()](../../packages/server/http/cors.ts) applies your cross-origin policy. It does not authenticate the caller.                                          |
| Put a request identifier on forwarded requests and responses | [requestId()](../../packages/server/http/request.ts) chooses or validates identifiers; decide explicitly whether to trust inbound values.                    |
| Reuse request and trace correlation data                     | [correlation()](../../packages/server/http/correlation.ts) establishes a memoized value without configuring a tracing provider.                              |
| Observe request start, response creation or failure          | [access()](../../packages/server/http/access.ts) calls your observer. A response-created event does not mean its body has finished streaming.                |
| Report handler duration in a response header                 | [timing()](../../packages/server/http/timing.ts) adds Server-Timing; it does not measure a later streamed body's full delivery.                              |
| Add static response headers                                  | [headers() and securityHeaders()](../../packages/server/http/headers.ts) apply configured values; error-response coverage still depends on middleware order. |
| Inspect JSON more easily during development                  | [prettyJson()](../../packages/server/http/json.ts) reformats supported JSON when requested, rather than changing the greeting data.                          |
| Redirect a missing GET path to a chosen trailing-slash form  | [trailingSlash()](../../packages/server/http/path.ts) adds an explicit policy; ordinary routing still distinguishes slashes.                                 |

The [public export list](../../packages/server/http/mod.ts) also links the types and lower-level response, path and
route-plan functions. Prefer those focused contracts when composing an existing handler; a helper's availability alone
does not make it necessary for this API.

You now have one greeting handler that can run in a local check, behind a listener, under middleware, or below a mount.
When repeated validation and response rules become difficult to keep consistent across handlers, consider
[Endpoint](../../packages/server/endpoint/README.md) and [Service](../../packages/server/service/README.md). Those
modules add declared input/output contracts around application work; they are optional for the request handling shown
here.

## Continue the greeting in a larger workflow

| Your next task | Complete workflow |
| --- | --- |
| Receive JSON or form data, authenticate a callback, report readiness | [POST, forms and signed webhooks](./09-http-input.md) |
| Send records as they arrive, cancel work and handle replay cursors | [NDJSON and retained SSE](./10-http-streaming.md) |
| Let an AI client discover and call the greeting | [MCP tool with a pinned SDK](./11-mcp.md) |

These examples keep the same greeting result while adding input, transport and lifetime decisions. Each states what is
local demonstration, what is tested, and which durable storage, authorization or deployment behavior the application
must supply.
