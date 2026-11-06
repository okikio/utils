# Build a notes API with `@okikio/server`

A notes API receives a title, saves it, and returns the title it accepted. Start with a normal request handler. Add a
shared endpoint contract when several callers need the same input and response rules. A service checks those declared
rules and owns the resources created for its requests; the deployment host still owns the network listener.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

These examples use the experimental Utils source checkout. From its root, review `mise.toml`, then run `mise trust`,
`mise install`, and `mise run prepare -- --kind deps`. Save each named file at that root. The examples use workspace exports;
they do not assume a newly published registry version.

## Save one note with ordinary Request and Response values

Save `plain-notes.ts`. The JSON reader admits at most 1,024 bytes; the handler then checks what those bytes mean:

```ts runnable=plain-notes.ts
import * as http from '@okikio/server/http';
import { parseJson, RequestTransportError } from '@okikio/http/request';

const notes: string[] = [];
const app = http.create({
	routes: [http.route('POST', '/notes', async (request) => {
		// Bound transport parsing before checking the application's title field.
		const value = await parseJson(request, { maximumBodyBytes: 1024 });
		if (value === null || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string') {
			return Response.json({ error: 'Supply a text title.' }, { status: 400 });
		}
		const title = value.title.trim();
		if (title === '') return Response.json({ error: 'Supply a nonblank title.' }, { status: 400 });
		notes.push(title);
		return Response.json({ title });
	})],
	middleware: [http.catchErrors(), async (request, next) => {
		try {
			return await next(request);
		} catch (error) {
			// Map known request-format failures here. Unexpected exceptions reach the outer catchErrors middleware.
			if (!(error instanceof RequestTransportError)) throw error;
			const code = error.issues[0]?.code;
			return Response.json({ error: 'Request format rejected.' }, {
				status: code === 'body-too-large' ? 413 : code === 'unsupported-content-type' ? 415 : 400,
			});
		}
	}],
});
// Call the Fetch application directly. A deployment host can mount the same app on a real listener.
const outgoing = await app.fetch(
	new Request('http://localhost/notes', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ title: 'First note' }),
	}),
);
console.log(outgoing.status, await outgoing.text());
```

Run `mise exec -- deno run plain-notes.ts`. It prints:

```text output
200 {"title":"First note"}
```

`app.fetch()` calls the route locally. It does not connect to localhost. `await` obtains the eventual response, and
`response.text()` reads its body separately. The array belongs to this application instance; restarting loses it. It is
not a database. The transport parser and your field checks solve different jobs. Known format failures become 400, oversized bodies
become 413 and unsupported media become 415. For forms, signed callbacks and rejection checks, use the [request workflows](../../docs/server/09-http-input.md).

The [HTTP README](./http/README.md) shows a real listener and curl. For streaming and reconnect, continue with
[streaming greetings](../../docs/server/10-http-streaming.md); for an AI tool, use the
[MCP example](../../docs/server/11-mcp.md).

## Declare the same operation once callers need a shared contract

The manual handler repeats checks at its call site. An endpoint describes accepted JSON and allowed answers as data.
A handler supplies the saving code. A service links the exact descriptions to those handlers before receiving traffic:

```text
Save: POST /notes + title schema + Saved response
  -> implement: bind the saving function
  -> compile: verify every declared operation has the right binding
  -> create: own one live runtime
  -> fetch: parse, validate, call the saving function, validate and write its answer
```

Compilation does not transpile TypeScript or open a port. Save this complete reusable module as `notes-contract.ts`:

```ts support=notes-contract.ts
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '@okikio/server/service';
import * as schema from '@okikio/schema';
export const Saved = response.ok(schema.object({ title: schema.string() }), {
	id: 'note.saved',
	description: 'Saved note title.',
});
export const Save = endpoint.post({
	id: 'note.save',
	path: '/notes',
	json: schema.object({ title: schema.string({ minLength: 1, pattern: /\S/u }) }),
	responses: [Saved],
});
export const Api = service.define({ id: 'notes', path: '/api', endpoints: [Save] });
export function createNotes() {
	const notes: string[] = [];
	const implementation = service.implement(Api, {
		endpoints: [endpoint.handler(Save, ({ input }) => {
			const title = input.json.title.trim();
			notes.push(title);
			return response.create(Saved, { title });
		})],
	});
	return service.create(service.compile(implementation), { host: {} });
}
```

`response.ok()` describes an allowed answer; `response.create()` produces one occurrence. The schema checks the title
before the handler runs. `createNotes()` creates an independent in-memory notes instance each time it is called.
The service and its dependencies use local time and disposal implementations; no global setup is required.

Save `checked-notes.ts` beside it:

```ts runnable=checked-notes.ts
import { createNotes } from './notes-contract.ts';
await using runtime = createNotes();
for (const title of ['First note', 42]) {
	const result = await runtime.fetch(
		new Request('http://localhost/api/notes', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title }),
		}),
	);
	console.log(result.status, (await result.json()).title);
}
```

Run `mise exec -- deno run checked-notes.ts`. It prints:

```text output
200 First note
400 Invalid request
```

The numeric title is rejected before the saving callback. `await using` disposes the live runtime at scope exit and
waits for its owned cleanup. It leaves borrowed host clients under their caller's ownership. Read or cancel every
response body before disposing its owner, especially when the body streams.

## Call that exact contract from a client

An ordinary `fetch` caller can build JSON itself. The optional typed client reuses `Save` and its response definitions.
This complete check routes the client's HTTP request into the same runtime; it opens no network connection.
Save `notes-client.ts` beside `notes-contract.ts`:

```ts runnable=notes-client.ts
import { createNotes, Save } from './notes-contract.ts';
import * as client from '@okikio/server/client';

await using runtime = createNotes();
const notes = client.create(Save, {
	baseUrl: 'http://localhost/api',
	fetch: async (input, init) => await runtime.fetch(new Request(input, init)),
	maximumDeclarations: 10,
	maximumRequestBytes: 4096,
	maximumResponseBytes: 4096,
});
const result = await notes.call(Save.operations[0], { json: { title: 'Second note' } });
if (result.kind === 'success') console.log(result.value.title);
```

Run `mise exec -- deno run notes-client.ts`. It prints:

```text output
Second note
```

Put the service prefix `/api` in `baseUrl`. The client adds the endpoint path `/notes`. A real deployment supplies the
network `fetch` instead of this local bridge. Construction makes no request; `call()` does the work.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                               | Use it to                                                                   | Exact contract                       |
| ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------ |
| `@okikio/server`                     | Use the package entry shown in the complete examples above.                 | [Contract](./mod.ts)                 |
| `@okikio/server/endpoint`            | Declare and bind a validated endpoint contract.                             | [Contract](./endpoint/mod.ts)        |
| `@okikio/server/endpoint/definition` | Declare import-safe endpoints without acquiring live resources.             | [Contract](./endpoint/definition.ts) |
| `@okikio/server/endpoint/handler`    | Bind endpoint behavior to its exact declaration.                            | [Contract](./endpoint/handler.ts)    |
| `@okikio/server/endpoint/openapi`    | Derive OpenAPI from endpoint definitions.                                   | [Contract](./endpoint/openapi.ts)    |
| `@okikio/server/endpoint/path`       | Join and inspect route-template paths.                                      | [Contract](./endpoint/path.ts)       |
| `@okikio/server/endpoint/types`      | Import public types for this capability; this entry does not start work.    | [Contract](./endpoint/types.ts)      |
| `@okikio/server/gateway`             | Forward imported service routes to explicitly selected upstreams.           | [Contract](./gateway/mod.ts)         |
| `@okikio/server/gateway/definition`  | Declare upstream ownership without making a network request.                | [Contract](./gateway/definition.ts)  |
| `@okikio/server/gateway/types`       | Import public types for this capability; this entry does not start work.    | [Contract](./gateway/types.ts)       |
| `@okikio/server/http`                | Compose portable Fetch handlers without opening a listener.                 | [Contract](./http/mod.ts)            |
| `@okikio/server/http/router`         | Compile immutable route plans into a router.                                | [Contract](./http/router.ts)         |
| `@okikio/server/http/types`          | Import public types for this capability; this entry does not start work.    | [Contract](./http/types.ts)          |
| `@okikio/server/middleware`          | Declare request lanes, ordering, and context requirements.                  | [Contract](./middleware/mod.ts)      |
| `@okikio/server/middleware/types`    | Import public types for this capability; this entry does not start work.    | [Contract](./middleware/types.ts)    |
| `@okikio/server/service`             | Compile exact definitions and implementations into a live service runtime.  | [Contract](./service/mod.ts)         |
| `@okikio/server/service/definition`  | Declare service contracts independently of host startup.                    | [Contract](./service/definition.ts)  |
| `@okikio/server/service/resilience`  | Apply service retry and protection policy.                                  | [Contract](./service/resilience.ts)  |
| `@okikio/server/service/types`       | Import public types for this capability; this entry does not start work.    | [Contract](./service/types.ts)       |
| `@okikio/server/gateway/artifact`    | Read a serialized gateway contract instead of importing live service code.  | [Contract](./gateway/artifact.ts)    |
| `@okikio/server/gateway/openapi`     | Derive OpenAPI for a gateway contract.                                      | [Contract](./gateway/openapi.ts)     |
| `@okikio/server/service/route`       | Inspect and compose routes derived from a service definition.               | [Contract](./service/route.ts)       |
| `@okikio/server/client`              | Call an endpoint through its exact wire contract and explicit byte budgets. | [Contract](./client.ts)              |

The focused client accepts an exact imported operation from one endpoint. Put group/service mount prefixes in `baseUrl`;
it contains no credentials, query or fragment. Construction performs no I/O. Request input types are wire inputs, before
schema transforms. Each location validates once locally after transport normalization; the server independently
validates its boundary. Repeated query, cookie and form fields remain repeated. Path parameters are encoded as one
segment; empty and dot-only segments reject. Headers and cookies follow HTTP's native grammar. Browsers can prohibit
authored Cookie headers. Native credentials default to `omit`, redirect handling is `manual`, and retries are
application-owned. Both policies are passed in the native Request and the Fetch init argument. Injected transports must
honor that init argument. The browser lane checks the native Request properties too; Bun 1.4.2 in this checks
reports `include` for a Request constructed with `omit`, so its property alone is not used as evidence of browser cookie
behavior.

Body responses need an explicit Codec or an owned identity schema. A transforming Standard Schema supplies no inverse.
Declare identity for a third-party identity validator with `codec.identity()` or provide both Codec directions. OpenAPI
also needs an explicit wire JSON Schema for arbitrary transformations. The client rejects ambiguous successful status
declarations, unknown status/problem type, incorrect media type and malformed or oversized materialized bodies. Declared
problems return `kind: 'problem'`; protocol defects throw `ClientResponseError`. Validator and transport defects retain
their original errors. The application owns redaction before showing an error cause.

`maximumRequestBytes` bounds JSON/raw bytes and form name/value bytes plus declared Blob sizes; multipart framing is
additional. It is not a complete network or heap quota. Raw input consumes its supplied Request under that limit. JSON
projections reject accessors and cycles. Request locations keep their own authored HTTP parsing limits.
`maximumResponseBytes` bounds materialized success/problem bytes; byte limits require a signal to interrupt a peer that
never sends data. Page items decode serially. Successful stream/download/HTML responses return the exact native Response
as `value`; the caller owns reading/cancelling that body. Other success/problem bodies are consumed once with HTTP's
bounded reader. Receiving a response or aborting a call does not prove a remote effect committed or was undone.

## Inspect the authoritative service and router

Use `service.document(compiled)` for the existing immutable manifest: it already contains routes, middleware lane order,
resource dependency graphs and declared policy owners without acquiring resources. These are compiler/deployment
declarations, not proof that a remote adapter enforces them. Requirement apply-mode explanation and live resource
inspection have separate owners.

`router.inspect(plan, { maximumRoutes, maximumComparisons, maximumOverlaps })` at `@okikio/server/http/router` returns
overlap witnesses and the actual router winner. It shares `prepare()`'s canonical grammar and
`matchRoute()`/`matchMount()` precedence, including explicit HEAD versus GET fallback and route-before-mount dispatch.
It invokes no handler. `capped` means the report is incomplete. A witness shows an overlap; it does not claim either
declaration is unreachable for every request. Invalid duplicate shapes still reject in `prepare()`.

## Measure prepared routing

The focused benchmarks measure 16, 256 and 4,096 routes with HEAD and misses. The benchmark compares against independent
linear route-selection reference. This isolates routing. Complete validated services and network behavior remain root
workflows.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/server test
deno task --cwd=packages/server bench:check
deno task --cwd=packages/server bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Find the behavior tests

Service runtime tests are split by the caller's concern: [request pipeline](./service/runtime.test.ts),
[resource authority](./service/resources.test.ts), [request admission](./service/requests.test.ts),
[response materialization](./service/responses.test.ts), [private failures and observation](./service/observation.test.ts),
and [route exposure](./service/routing.test.ts). Shared fixtures contain immutable definitions and validation adapters;
each scenario owns its live runtime. [Client tests](./client.test.ts) distinguish protocol, JSON and size failures so
one earlier rejection cannot stand in for another contract.

## Read further

The [Server guide](https://github.com/okikio/utils/blob/main/docs/server/01-guide.md) explains the model, manual
alternatives, and composition.
