# `@okikio/server/endpoint`

An API route needs more than a URL: callers need to know what they can send, what success looks like and which failures
are expected. An endpoint definition describes those facts as a reusable value. Keep it with the domain contract so a
server, client description and gateway can use the same route instead of copying strings and guessing its body shape.

```text
Definition: GET /greeting + name query -> declared greeting result
           + service prefix /api
           -> service compiler links exact handler -> runtime serves /api/greeting
```

A definition is the description of an operation, not the code that performs it. The handler is linked separately to the
exact definition. The compiler checks that link before serving traffic. Defining an endpoint starts no server and
creates no provider connection.

## Validate a query before greeting its caller

The example runs a service so you can see the declared endpoint answer a request. Its duration and disposal imports
supply Temporal timestamps and `AsyncDisposableStack` cleanup when those APIs are absent from the environment.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import { z } from 'zod';
const Greeting = response.ok(z.object({ message: z.string() }), {
	id: 'greeting.ok',
	description: 'Personal greeting.',
});
const Greet = endpoint.get({
	id: 'greeting.read',
	path: '/greeting',
	query: z.object({ name: z.string().min(1) }),
	responses: [Greeting],
});
const Api = service.define({ id: 'greeting-api', path: '/api', endpoints: [Greet] });
const implementation = service.implement(Api, {
	endpoints: [
		endpoint.handler(Greet, ({ input }) => response.create(Greeting, { message: `Hello, ${input.query.name}!` })),
	],
});
await using runtime = service.create(service.compile(implementation), { host: {} });
const outgoing = await runtime.fetch(new Request('https://service.invalid/api/greeting?name=Sam'));
console.log(outgoing.status, await outgoing.text());
const invalid = await runtime.fetch(new Request('https://service.invalid/api/greeting'));
console.log(invalid.status);
await invalid.body?.cancel();
```

Expected output:

```text output
200 {"message":"Hello, Sam!"}
400
```

The query schema makes `input.query.name` a validated string in the ordinary callback. A request without a name returns
`400` before the callback can run. The response schema describes the greeting that callers receive. The `.invalid` URL
only supplies a URL for the in-process Request; no listener or network connection is opened. The example consumes the
success body, cancels the unused rejection body and closes the runtime at scope exit.

## What an endpoint adds to a function

| Value                    | Important contents                                                                   | What happens when it is created                       |
| ------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `EndpointDefinition`     | `id`, `path`, shared `inputs`, method `operations`                                   | Snapshots a reusable HTTP description                 |
| `EndpointOperation`      | `method`, input schemas, allowed response/problem definitions, resource declarations | Describes one method's accepted inputs and results    |
| `EndpointHandlerBinding` | Exact `endpoint`, exact `operation`, ordinary `handle` function                      | Links behavior by object identity; does not invoke it |
| Handler argument         | `{ request, input, host, resources, ctx }` plus declared request values              | Supplied by the service for one invocation            |

For example, adding `json: z.object({ title: z.string() })` to an endpoint causes its handler to receive
`input.json.title` as a string after validation. Adding `query: z.object({ limit: z.coerce.number() })` exposes a number
at `input.query.limit`, although the URL started with text. The schema's output type flows into the callback; you do not
cast unvalidated JSON into an application type yourself.

Under the hood, method helpers build an operation and wrap it in an endpoint definition. They snapshot contribution
arrays and retain the actual schema/response objects. The service compiler resolves prefixed paths and links exact
handler identities before serving requests. This makes one description usable for validation and OpenAPI without forcing
the code to live in a particular router. An ID is diagnostic text; constructing another object with the same ID does not
make it the original declaration.

Use a plain Fetch route when all you need is a local callback. Use an endpoint when clients and hosts need an explicit
shared contract. See the [full endpoint types](../API.md#endpoint) for optional inputs and policies.

## Build on the example

For an asset API, declare an input rule, a successful [response](../../http/response/README.md) and an expected
[missing-asset problem](../../http/problem/README.md). Bind the behavior with `endpoint.handler()` and compile it
through a [service](../service/README.md). The validated values entering that handler can differ from the raw URL or
JSON when a schema deliberately transforms input.

For a gateway serving the same API at another origin, import the same service definition into the
[gateway](../gateway/README.md). For API documentation, use the endpoint/service OpenAPI projection rather than
maintaining a second route list. Keep schema validation rules distinct from the description of HTTP fields that clients
send.

## Authoring model

Use a method helper for the common single-operation case:

```ts
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';

export const ListWidgets = endpoint.get({
	id: 'widgets.list',
	path: '/widgets',
	query: ListWidgetsQuery,
	responses: [response.ok(WidgetList, {
		id: 'widgets:list',
		description: 'Visible widgets.',
	})],
});
```

Use path-independent operations plus `endpoint.define()` when several methods share one path contract:

```ts
export const GetWidget = endpoint.operation.get({
	id: 'widgets.get',
	responses: [WidgetDetail],
	problems: [WidgetNotFound],
});

export const UpdateWidget = endpoint.operation.patch({
	id: 'widgets.update',
	json: UpdateWidgetInput,
	responses: [WidgetDetail],
});

export const WidgetById = endpoint.define({
	id: 'widgets.by-id',
	path: '/:widgetId',
	param: WidgetPath,
	operations: [GetWidget, UpdateWidget],
});
```

Request locations accept Standard Schema values directly: `param`, `query`, `header`, `cookie`, `json`, `form`, and
`raw`. `raw` is mutually exclusive with parsed body contracts.

## Schema projection for OpenAPI

Endpoint validation depends only on Standard Schema. OpenAPI uses Standard JSON Schema when the validator exposes it
through `schema["~standard"].jsonSchema`. Request documentation calls `input()`; response documentation calls
`output()`. This distinction is required for coercions and transforms.

```ts
const document = await endpoint.openapi(ApiEndpoints, {
	title: 'Example API',
	version: '1.0.0',
});
```

A documented endpoint input can provide `jsonSchema` when the HTTP wire shape is more precise than the executable
validator. Query definitions can expose their transport syntax through `wireSchema()`. Response definitions have the
matching serialized-body override.

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

## Runtime bindings

Handlers bind to exact imported definitions rather than IDs or registry keys:

```ts
export const WidgetByIdHandlers = endpoint.handler(WidgetById, {
	get: async (context) => WidgetDetailResult,
	patch: async (context) => UpdatedWidgetResult,
});
```

The binding retains the exact endpoint and operation objects. Service compilation verifies exhaustive handler coverage
and declared result envelopes.

## Declaring side effects

Use `effects` when code in an endpoint scope may announce an externally visible side effect through `@okikio/effect`.
The declaration says the effect is allowed in that execution; it does not mean every request emits it.

```typescript
const EnrichCompany = endpoint.post({
	id: 'companies.enrich',
	path: '/companies/:companyId/enrich',
	effects: [UsageCommitted],
	responses: [Accepted],
});
```

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
