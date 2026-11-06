# Build a small HTTP API with `@okikio/server/http`

An HTTP API receives a request and sends back a response. For example, a client asks for `/greeting?name=Sam`, and your
application returns `{"message":"Hello, Sam!"}`. This module connects methods and URL paths to the JavaScript functions
that produce those answers.

Use it when you want a small API or want to combine existing request handlers. You can use this module on its own. You
do not need the endpoint definitions or service compiler provided by other parts of `@okikio/server`.

If you have used Express or Hono, the job is familiar: register a route, read input, and return an answer. Here, a
**handler** is a function that receives a Web `Request` and returns a Web `Response`:

- `Request` holds the incoming method, URL, headers, and body.
- `Response` holds the outgoing status, headers, and body.
- Returning a `Response` supplies the answer. There is no separate response object that you call `send()` on.

## Run a greeting request

The commands below use this Utils source checkout and its workspace imports. They do not require a published package.
From the `utils` repository root, review `mise.toml`, then trust that configuration and prepare the tools and
dependencies:

```sh
mise trust
mise install
mise run prepare -- --kind deps
```

[Mise installation and checkout setup](../../../README.md#work-on-the-repository) explains the prerequisites for a fresh
checkout, including installing Mise if it is not available. Deno runs the TypeScript examples; the request handler
itself uses Web APIs.

Save this complete application as `greeting.ts`:

```ts support=greeting.ts
import * as http from '@okikio/server/http';

/** Validate this route's query before building a greeting; route selection itself does not validate the name. */
export function greet(request: Request): Response {
	const url = new URL(request.url);
	const name = url.searchParams.get('name');
	if (name === null || name.trim() === '') {
		return Response.json({ error: 'Supply a name in ?name=Sam.' }, { status: 400 });
	}
	return Response.json({ message: `Hello, ${name.trim()}!` });
}

export const app = http.create({
	routes: [http.route('GET', '/greeting', greet)],
});
```

`http.route()` associates GET `/greeting` with `greet`. GET is the request method used to retrieve an answer.
`http.create()` combines the routes into an application. Its `app.fetch(request)` function selects a handler and returns
its response.

To try it without a running server, save this second file beside it as `greeting-check.ts`:

```ts runnable=greeting-check.ts
import { app } from './greeting.ts';

const response = await app.fetch(new Request('http://localhost/greeting?name=Sam'));
console.log(response.status, await response.text());

const invalid = await app.fetch(new Request('http://localhost/greeting'));
console.log(invalid.status, await invalid.text());

const missing = await app.fetch(new Request('http://localhost/missing'));
console.log(missing.status, await missing.text());
```

Run the check from the same directory:

```sh
mise exec -- deno run greeting-check.ts
```

It prints these three answers:

```text output
200 {"message":"Hello, Sam!"}
400 {"error":"Supply a name in ?name=Sam."}
404 Not found.
```

The first request succeeds. The second reaches `greet`, which rejects the missing name. The third has no matching route,
so the application returns its default missing-route response.

`app.fetch()` returns a **Promise**: a value representing work that will finish later. `await` waits for that result
before continuing. The response body is read separately; `await response.text()` waits for its text. You may instead use
`await response.json()` to read JSON as a JavaScript value. Read each body once.

The URL is input to the application here. Calling `app.fetch()` directly does not make a network connection to
localhost. This is different from calling the global `fetch(url)`, which sends a request to a server.

## Read input and return an answer

In `greet`, `new URL(request.url)` separates the URL into its parts. `searchParams.get('name')` reads the query value
after `?name=` and returns `null` if it is absent. The route path remains `/greeting`; the query string is input to the
handler, not part of the route definition.

`Response.json()` converts the supplied value into JSON and sets the JSON content type. Its default status is `200`,
meaning success. We explicitly return `400`, meaning invalid request input, when the name is missing or blank. The
router's `404` means it could not select a route for the method and path.

The checks in `greet` are application code. Registering a route does not add input validation automatically. If your
next handler reads a JSON request body, `await request.json()` parses the text as JSON; you still need to check that the
result has the fields and values your application accepts.

## Let another program call the API

A server **listener** accepts network connections and passes their requests to your application. Creating `app` does not
start one. Keeping this step separate lets the same application run in the local check and behind a real server.

Save `greeting-server.ts` beside the two files above:

```ts
import { app } from './greeting.ts';

Deno.serve({ hostname: '127.0.0.1', port: 8000 }, app.fetch);
```

Start the listener and allow Deno to use that local address:

```sh
mise exec -- deno run --allow-net=127.0.0.1:8000 greeting-server.ts
```

Keep that terminal open. In another terminal, request the greeting:

```sh
curl -i 'http://127.0.0.1:8000/greeting?name=Sam'
```

The response has status `200`, a JSON content type, and body `{"message":"Hello, Sam!"}`. Remove `?name=Sam` to see the
`400` answer. Stop the example server with Ctrl+C in its terminal. If port 8000 is already occupied, choose another port
in the server file, the command's permission, and the curl URL.

[Deno's HTTP server reference](https://docs.deno.com/api/deno/http-server/) explains the listener options.
`Deno.serve()` belongs in this server entry file; it does not belong inside `greet` or run when `greeting.ts` is
imported.

## Add behavior around the handler

**Middleware** is a function that runs around request handling. It can inspect a request, call the next function, and
inspect or replace the returned response. For example, you may want every answer to include security headers, and want
an unexpected exception to become an HTTP error response.

Keep `greet` unchanged. Replace only the final `app` declaration in `greeting.ts` with this one:

```ts
export const app = http.create({
	routes: [http.route('GET', '/greeting', greet)],
	middleware: [http.catchErrors(), http.securityHeaders()],
});
```

`securityHeaders()` adds its configured headers to downstream responses. `catchErrors()` catches exceptions thrown by
the functions after it and returns a safe error response, normally status `500`. That status means the server failed
unexpectedly. Our deliberate `400` answer is already a response and passes through unchanged.

Stop any running example server with Ctrl+C, then run the same listener command again. The command does not watch files
for changes. Repeat the curl request: it now includes `X-Content-Type-Options: nosniff`, which tells browsers to respect
the declared content type rather than guess from the body. The greeting status and JSON stay the same.

Order matters: the first function in the middleware array runs first and receives the downstream response last. Here,
`catchErrors()` wraps the header middleware and route. If an error skips the header middleware's return path, its
headers are not automatically added to the fallback error response.

The [HTTP guide](../../../docs/server/04-http.md) extends this same greeting API with custom middleware, error checks,
and a mounted URL prefix. It includes a complete version of every file needed for that workflow.

## Choose the next capability for a concrete need

| Your next task                                                       | Where to go                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reuse input/output rules and validate requests against schemas       | [Endpoint](../endpoint/README.md) and [Service](../service/README.md)                        |
| Keep an existing Hono application and reuse compatible HTTP behavior | [Hono adapter](../../hono/README.md)                                                         |
| Forward requests to a different network service                      | [Gateway](../gateway/README.md)                                                              |
| Reuse this application below a URL prefix in the same process        | [Mounting in the HTTP guide](../../../docs/server/04-http.md#give-the-greeting-api-a-prefix) |

For CORS, request identifiers, access observation, timing, and response/path helpers, use the guide’s
[HTTP helper choices](../../../docs/server/04-http.md#choose-other-http-behavior-when-a-concrete-need-appears). The
[public export list](./mod.ts) links every exported helper and its source documentation.

Continue with this module while ordinary request handlers solve the task. Add another capability when its specific
contract is needed; routing a greeting does not require learning the rest of the utility system.

## Continue the greeting in a larger workflow

| Your next task | Complete workflow |
| --- | --- |
| Receive JSON or form data, authenticate a callback, report readiness | [POST, forms and signed webhooks](../../../docs/server/09-http-input.md) |
| Send records as they arrive, cancel work and handle replay cursors | [NDJSON and retained SSE](../../../docs/server/10-http-streaming.md) |
| Let an AI client discover and call the greeting | [MCP tool with a pinned SDK](../../../docs/server/11-mcp.md) |

These examples keep the same greeting result while adding input, transport and lifetime decisions. Each states what is
local demonstration, what is tested, and which durable storage, authorization or deployment behavior the application
must supply.

For a long-lived two-way connection, the [WebSocket greeting](../../../examples/websocket/README.md)
shows the runtime's upgrade step alongside the Utils HTTP router. For an AI
application calling named operations, the [MCP walkthrough](../../../docs/server/11-mcp.md)
explains tools, discovery, versions and authorization before extending its checked greeting.
