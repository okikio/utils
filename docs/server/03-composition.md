# Server compiler and HTTP runtime

This guide helps maintainers understand how `@okikio/server` turns authored service definitions into request handling.
It focuses on the compiler, the Fetch runtime, and the information that other adapters can reuse.

The package compiles stable service structure before traffic starts. The request path then uses the compiled route and
execution plans instead of scanning the service definition again.

## Run a complete task

Compose an endpoint implementation and call its Fetch runtime without a listener. This program supplies its own local
input and uses public workspace imports. From the Utils checkout root, run `mise run prepare -- --kind deps`.
Save the block as `complete-task.ts` at that root and run `mise exec -- deno run complete-task.ts`.

A **compiler** here checks the declarations and prepares lookup tables; it does not produce another JavaScript file.
A **runtime** is the live service object that receives Requests. `await using runtime` closes that object's owned
resources when the module ends, including after an error. Calling `runtime.fetch()` directly uses no network listener.

```ts runnable=complete-task.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import * as schema from '@okikio/schema';

const Saved = response.ok(schema.object({ title: schema.string() }), {
	id: 'note.saved',
	description: 'Saved note title.',
});
const Save = endpoint.post({
	id: 'note.save',
	path: '/notes',
	json: schema.object({ title: schema.string({ minLength: 1 }) }),
	responses: [Saved],
});
const Api = service.define({ id: 'notes', path: '/', endpoints: [Save] });
const notes: string[] = [];
const implementation = service.implement(Api, {
	endpoints: [endpoint.handler(Save, ({ input }) => {
		const title = input.json.title.trim();
		notes.push(title);
		return response.create(Saved, { title });
	})],
});
await using runtime = service.create(service.compile(implementation), { host: {} });
for (const title of [' First note ', 42]) {
	const outgoing = await runtime.fetch(
		new Request('https://service.invalid/notes', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title }),
		}),
	);
	const body = await outgoing.json();
	console.log(outgoing.status, body.title);
}
console.log(notes.length);
```

Expected output:

```text output
200 First note
400 Invalid request
1
```

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/server/service/README.md) also places this operation among adjacent capabilities.

## Service compilation

`service.compile()` reads the service definition and implementation together. It validates their relationships and
returns one immutable `CompiledService`.

The compiled value contains the information needed by the Fetch runtime and by other projections:

- effective operations and their complete method/path pairs
- a handler-free `RoutePlan`
- one prepared execution plan for each operation
- middleware order
- reachable resource definitions
- requirements and resilience policies
- declared responses and problems
- the JSON-safe service manifest

The following flow shows which work happens before requests arrive:

```text
authored definitions + implementations
                 |
                 v
          service.compile()
                 |
                 v
          CompiledService
           /     |      \
          /      |       \
         v       v        v
 Fetch runtime  OpenAPI   other adapters and generators
```

Compilation does work once that would otherwise repeat for each request. For example, it resolves middleware order
before traffic starts. This preparation of stable information is called partial evaluation. It
does not generate JavaScript source and it does not remove declared security or validation work.

### Operation execution plans

Each effective operation has a prepared execution plan. The plan records the request input slots, body limit, timeout,
and resilience policies for that operation. The runtime reads these values directly.

The plan does not infer behavior from `Function#toString()`. The service definition remains authoritative. A handler
that ignores a validated value does not disable validation, authentication, requirements, middleware, or resilience.
Those declarations are observable parts of the service contract.

## Prepared routing

`@okikio/server/http` prepares method and path information separately from handlers. This lets the service compiler and
gateway retain route ownership without serializing executable functions.

The common path looks like this:

```typescript
import * as http from '@okikio/server/http';

const plan = http.prepareRoutes([
	{ kind: 'route', method: 'GET', path: '/companies/:id' },
	{ kind: 'route', method: 'GET', path: '/health' },
]);
```

Static routes use a direct lookup. Dynamic routes are grouped by method and segment count, then ordered by specificity.
An explicit `HEAD` route wins. If no `HEAD` route exists, the host can use a matching `GET` route and discard its body.

The optimized matcher must produce the same result as the reference route semantics. `packages/server/router.bench.ts`
therefore compares it with an independent linear matcher.

## Request lifecycle

The service runtime owns one explicit request order. This order matters because some stages must run before the service
reads or transforms the body.

```text
route selection
    |
    v
wholeRequest middleware
    |
    v
beforeValidation middleware
    |
    v
authentication
    |
    v
body admission and parsing
    |
    v
Standard Schema validation and transformation
    |
    v
afterValidation middleware
    |
    v
requirements and admission resilience
    |
    v
operation resilience and handler
    |
    v
response validation and HTTP representation
    |
    v
completion observation
```

Authentication runs before normal body parsing. A rejected caller therefore does not force the service to parse an
otherwise invalid JSON or multipart body. Webhook verification can use `beforeValidation` to authenticate exact body
bytes before the normal parser consumes the original request.

## Request state and resources

Mutable values are valid when their owner and lifetime are explicit. `middleware.context()` stores request-local values
in the state created for one request. Concurrent requests use different state maps.

Longer-lived capabilities use `@okikio/capability/resource`. The table shows the intended owner for common state:

| State                            | Owner                                          |
| -------------------------------- | ---------------------------------------------- |
| temporary request values         | `middleware.context()`                         |
| MCP session registry             | resource supplied to the MCP adapter           |
| database connection pool         | resource                                       |
| shared cache                     | resource                                       |
| durable webhook delivery records | higher-level webhook capability or application |

Resource acquisition remains lazy. The compiled service records which resources an operation may reach, while
`resources.get()` controls whether the runtime actually acquires one.

## Mounts and gateways

`http.mount()` embeds another Fetch handler in the same process. The gateway forwards a request to another network
service. They share route matching, but they do not own the same work.

A mount preserves the incoming URL by default. Use `requestPath: 'strip-prefix'` when the child handler expects a path
relative to the mount. The [complete MCP greeting](./11-mcp.md) supplies an actual SDK handler, local client and shutdown
owner rather than leaving an unspecified protocol callback here. The rewritten request keeps its method, headers,
query string, body stream and `AbortSignal`.

The gateway owns network forwarding and trust decisions. It rebuilds forwarding headers, applies credential and redirect
policy, enforces request admission and timeouts, filters response headers, applies cache policy, and observes response
body completion. It uses the same prepared route semantics as the in-process host.

## MCP transport hosting

The generic server does not implement JSON-RPC or own MCP sessions. It provides the Fetch behavior required by an MCP
adapter:

- Web `Request` and `Response`
- unchanged GET, POST, and DELETE methods
- preserved request headers and body
- `AbortSignal` propagation
- unchanged streaming and Server-Sent Events responses
- optional path-prefix removal for mounted handlers
- explicit resource ownership for sessionful transports

This design lets an MCP package bind the appropriate SDK generation without adding MCP protocol code to the service
compiler. The MCP adapter owns protocol version handling and session behavior. These are hosting capabilities, not a promise that
every MCP protocol version uses every method or supports sessions. Use the [pinned SDK example](./11-mcp.md) for the
actual transport contract, discovery and tool-call check.

## OpenAPI and wire representations

OpenAPI is generated from endpoint contracts. It is not a second validation system.

Request documentation uses Standard JSON Schema `input()` when the validator provides it. Response documentation uses
`output()` unless the HTTP response has an explicit serialized representation.

The following flow keeps runtime values separate from wire values:

```text
HTTP request
    |
    | Standard JSON Schema input()
    v
Standard Schema validation and transformation
    |
    v
handler value
    |
    | Standard JSON Schema output()
    | or an explicit HTTP response schema
    v
HTTP response representation
```

For example, a handler can return a `Date` while the response definition documents an ISO date-time string. The runtime
type remains `Date`. The OpenAPI document describes the bytes that an HTTP client receives.

A configured schema projector is a fallback by default. An explicit HTTP schema wins because it describes the transport
directly. An application can select the projector override mode when it deliberately wants the projector to replace a
validator's Standard JSON Schema representation.

## Performance rules

The current server optimizations must preserve these rules:

1. Compilation moves stable discovery out of request handling.
2. Static route lookup does not scan the complete route list.
3. Dynamic lookup inspects only the matching method and segment-count group.
4. Route semantics do not depend on `URLPattern` availability.
5. Resource acquisition stays lazy.
6. The compiler never removes declared validation or policy.
7. The server compiler does not require runtime `eval` or `new Function`.
8. Benchmarks use an independent implementation to check semantic equivalence.

Read [Benchmarks](../benchmarks/01-running.md) for performance evidence and
[Packaging and tree-shaking](../maintenance/02-packaging.md) for bundle and export verification.
