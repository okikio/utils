# Server: endpoint

An endpoint is the reusable description of one request: its method and path,
accepted input and possible answers. Its handler is the function that performs
the work. Keeping them separate lets another caller inspect the same contract
without starting a server. The complete example below connects them again; a
definition alone does not register a live route.

Start with the [complete package example](../../packages/server/endpoint/README.md). The sections below continue that
example.

## Run the greeting contract before extending it

An Express or Hono route often combines input checks and the callback. Here `Greet` describes the accepted name and the allowed response; `endpoint.handler` supplies the callback separately. The service links those exact objects before executing any request. Missing input returns 400 before the greeting callback runs.

From the experimental Utils checkout, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps` at the repository root. Save each named program there and run `mise exec -- deno run <filename>.ts`, replacing `<filename>` with the name shown. These examples use workspace exports, not an assumed published registry release. Save this as `declared-greeting.ts` and run `mise exec -- deno run declared-greeting.ts`.

```ts runnable=declared-greeting.ts
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import * as schema from '@okikio/schema';

const Greeting = response.ok(schema.object({ message: schema.string() }), {
	id: 'greeting.ok',
	description: 'Personal greeting.',
});
const Greet = endpoint.get({
	id: 'greeting.read',
	path: '/greeting',
	query: schema.object({ name: schema.string({ minLength: 1 }) }),
	responses: [Greeting],
});

// Collect the declared routes before attaching their behavior.
const Api = service.define({ id: 'greeting-api', path: '/api', endpoints: [Greet] });

// Bind handlers to the exact definitions above. Matching text IDs alone are insufficient.
const implementation = service.implement(Api, {
	endpoints: [
		endpoint.handler(Greet, ({ input }) => response.create(Greeting, { message: `Hello, ${input.query.name}!` })),
	],
});

// Compilation checks the bindings; the live runtime owns request resources.
await using runtime = service.create(service.compile(implementation), { host: {} });

// Exercise a matched request and consume its body.
const outgoing = await runtime.fetch(new Request('https://service.invalid/api/greeting?name=Sam'));
console.log(outgoing.status, await outgoing.text());

// Missing required input rejects before the business callback runs.
const invalid = await runtime.fetch(new Request('https://service.invalid/api/greeting'));
console.log(invalid.status);
// We only inspect the status, so release the otherwise unread problem body.
await invalid.body?.cancel();
```

```text output
200 {"message":"Hello, Sam!"}
400
```

`runtime.fetch` invokes the service locally; the URL does not open a network connection. Read the successful body and cancel the unused rejection body before the runtime closes. `await using` waits for owned cleanup at scope exit. To expose this operation over a socket, the application supplies the listener as shown in the [HTTP guide](04-http.md).

## What an endpoint adds to a function

| Value                    | Important contents                                                                   | What happens when it is created                       |
| ------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `EndpointDefinition`     | `id`, `path`, shared `inputs`, method `operations`                                   | Snapshots a reusable HTTP description                 |
| `EndpointOperation`      | `method`, input schemas, allowed response/problem definitions, resource declarations | Describes one method's accepted inputs and results    |
| `EndpointHandlerBinding` | Exact `endpoint`, exact `operation`, ordinary `handle` function                      | Links behavior by object identity; does not invoke it |
| Handler argument         | `{ request, input, host, resources, ctx }` plus declared request values              | Supplied by the service for one invocation            |

For example, adding `json: schema.object({ title: schema.string() })` to an endpoint causes its handler to receive
`input.json.title` as a string after validation. Adding `query: schema.object({ limit: schema.coerce.number() })`
exposes a number at `input.query.limit`, although the URL started with text. The schema's output type flows into the
callback; you do not cast unvalidated JSON into an application type yourself.

Under the hood, method helpers build an operation and wrap it in an endpoint definition. They snapshot contribution
arrays and retain the actual schema/response objects. The service compiler resolves prefixed paths and links exact
handler identities before serving requests. This makes one description usable for validation and OpenAPI without forcing
the code to live in a particular router. An ID is diagnostic text; constructing another object with the same ID does not
make it the original declaration.

Use a plain Fetch route when all you need is a local callback. Use an endpoint when clients and hosts need an explicit
shared contract. See the [full endpoint types](../../packages/server/README.md) for optional inputs and policies.

## Build on the example

For the greeting API, declare the name input, a successful [response](../../packages/http/response/README.md) and any expected
[problem](../../packages/http/problem/README.md). Bind the behavior with `endpoint.handler()` and compile
it through a [service](../../packages/server/service/README.md). The validated values entering that handler can differ
from the raw URL or JSON when a schema deliberately transforms input.

For a gateway serving the same API at another origin, import the same service definition into the
[gateway](../../packages/server/gateway/README.md). For API documentation, use the endpoint/service OpenAPI projection
rather than maintaining a second route list. Keep schema validation rules distinct from the description of HTTP fields
that clients send.

## Give several methods one path contract

The first program uses `endpoint.get` because the path has one operation. If the same greeting path later accepts POST JSON too, path-independent operations share an `endpoint.define`. This is a definition excerpt using the same `endpoint`, `schema`, `response` imports and `Greeting` response above; it is not another independently runnable service.

```ts
const ReadGreeting = endpoint.operation.get({
	id: 'greeting.read',
	query: schema.object({ name: schema.string({ minLength: 1 }) }),
	responses: [Greeting],
});
const WriteGreeting = endpoint.operation.post({
	id: 'greeting.write',
	json: schema.object({ name: schema.string({ minLength: 1 }) }),
	responses: [Greeting],
});
const GreetingPath = endpoint.define({
	id: 'greeting.path',
	path: '/greeting',
	operations: [ReadGreeting, WriteGreeting],
});
const GreetingHandlers = endpoint.handler(GreetingPath, {
	get: ({ input }) => response.create(Greeting, { message: `Hello, ${input.query.name}!` }),
	post: ({ input }) => response.create(Greeting, { message: `Hello, ${input.json.name}!` }),
});
```

Replace `[Greet]` with `[GreetingPath]` in the service definition and use `[GreetingHandlers]` in its implementation. Both bindings refer to the exact new operation objects. GET still validates the URL name; POST validates JSON. Neither form implements persistence simply because the method is POST.

Request locations accept Standard Schema values directly: `param`, `query`, `header`, `cookie`, `json`, `form`, and `raw`. `raw` is mutually exclusive with parsed body contracts.

## Schema projection for OpenAPI

Endpoint validation depends only on Standard Schema. OpenAPI uses Standard JSON Schema when the validator exposes it
through `schema["~standard"].jsonSchema`. Request documentation calls `input()`; response documentation calls
`output()`. This distinction is required for coercions and transforms.

```ts
const document = await endpoint.openapi([Greet], {
	title: 'Example API',
	version: '1.0.0',
});
```

The next standalone example extends greeting discovery with a `/search` query contract. It generates documentation only; it does not search records or run a service. Save `query-documentation.ts` and run the command shown.

A documented endpoint input can provide `jsonSchema` when HTTP documentation needs an explicit wire description. Query
definitions require this choice: their `wireSchema()` describes transport syntax, while Standard JSON Schema input
conversion cannot express tagged-value decoding and field validation. Response definitions have the matching
serialized-body override. The runtime still validates with the original schema.

Save `query-documentation.ts` and run `mise exec -- deno run query-documentation.ts`.

```ts runnable=query-documentation.ts
import * as schema from '@okikio/schema';
import * as query from '@okikio/query';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';

const Search = query.define({
	fields: { name: query.field(schema.string({ minLength: 2 })) },
	filters: { name: [query.eq] },
	pagination: query.offset(),
});
const Result = response.ok(schema.object({ count: schema.number() }), {
	id: 'search-result',
	description: 'Search result count.',
});
const Route = endpoint.get({
	id: 'search',
	path: '/search',
	query: endpoint.input(Search, { jsonSchema: Search.wireSchema() }),
	responses: [Result],
});
const document = await endpoint.openapi([Route], { title: 'Search', version: '1' });
console.log(Object.keys(document.paths).join(','));
```

```text output
/search
```

`wireSchema()` is documentation, not an alternative validator. Query's output converter describes its parsed structural
type; total parser budgets and relationships between fields still need Query parsing or semantic creation.

A composition root can still provide `schemaProjector` for a validator that does not expose Standard JSON Schema. The
default mode uses it as a fallback. Set `schemaProjectorMode: 'override'` only when the application deliberately wants
its projector to supersede the validator's Standard JSON Schema projection.

Public schemas that cannot be represented fail OpenAPI generation instead of silently becoming `{}`. Internal-only
operations may remain opaque.

OpenAPI path parameters are projected as `in: "path"`; `param` remains only the internal endpoint input-slot name.

`endpoint.input(...)` can also carry request parsing policy for that exact input slot. For example, a query schema can
opt into `bareQueryParameters: 'flag'` without changing bare-query meaning for unrelated endpoints. Endpoint parsing
policy overrides the service host's generic parsing defaults. Hard runtime policies such as a compiled body-size limit
still win.

## Link handlers by identity

The complete program binds `endpoint.handler(Greet, callback)` to the exact imported `Greet`. The multi-method excerpt binds both methods of `GreetingPath` together. A matching string ID on a separately created object is insufficient. Service compilation rejects missing bindings before serving traffic and verifies that handlers return declared response/problem envelopes.

## Declaring side effects

Use `effects` when code in an endpoint scope may announce an externally visible side effect through
`@okikio/capability/effect`. The declaration says the effect is allowed in that execution; it does not mean every
request emits it.

For the greeting, an optional `GreetingSent` effect could announce that a greeting was produced. This is a declaration excerpt: reuse the imports above and add the effect import. It does not replace the running `Greet` unless the service and its handler also select this new definition.

```typescript
import * as effect from '@okikio/capability/effect';

const GreetingSent = effect.define({
	id: 'greeting.sent',
	value: schema.object({ name: schema.string() }),
});
const TrackedGreet = endpoint.get({
	id: 'greeting.tracked',
	path: '/greeting',
	query: schema.object({ name: schema.string({ minLength: 1 }) }),
	effects: [GreetingSent],
	responses: [Greeting],
});
```

The handler must explicitly call `effect.emit` and the live host must supply a recipient before acceptance can occur. Use an observer for optional diagnostics; a declared effect is appropriate when the announcement needs an owner. See the [same-occurrence effect flow](../effect/01-guide.md).

Groups and endpoint paths can contribute the same effect declarations. Service compilation combines those definitions
with service, service-policy, operation, and middleware contributions. The live service runtime may supply an effect
owner.

## Composition and artifacts

- `endpoint.group()` creates a reusable path-prefixed endpoint collection.
- `endpoint.select()` creates a named key-preserving subset.
- `endpoint.compose()` flattens nested definitions, groups, catalogs, and selections while retaining direct identities.
- `endpoint.validate()` checks methods, paths, inputs, IDs, and result envelopes.
- `endpoint.document()` creates deterministic JSON-safe documentation.
- `endpoint.openapi()` projects an endpoint-only OpenAPI document. A service should normally generate OpenAPI from the
  compiler-resolved service graph so inherited policies and generated failures are included.

Definitions snapshot nested author-supplied arrays. Mutating the source arrays after construction cannot alter the
imported application graph.

## Wire input and validated input

Standard Schema can intentionally have different input and output types. `InferEndpointWireInputs` describes what exists
on the transport side before schema transforms; `InferEndpointInputs` describes the validated values exposed to
handlers. OpenAPI/request documentation is projected from the declared input contract independently of whether an
earlier middleware needs exact raw bytes. This prevents raw-body authentication from erasing API documentation.
