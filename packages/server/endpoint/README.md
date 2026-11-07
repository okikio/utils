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

The example runs a service so you can see the declared endpoint answer a request. Its runtime owns request lifetimes
and resource cleanup; creating the endpoint description alone starts neither.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
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
// Bind code to the endpoint contract. The handler receives the query after input validation.

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

Expected output:

```text output
200 {"message":"Hello, Sam!"}
400
```

The query schema makes `input.query.name` a validated string in the ordinary callback. A request without a name returns
`400` before the callback can run. The response schema describes the greeting that callers receive. The `.invalid` URL
only supplies a URL for the in-process Request; no listener or network connection is opened. The example consumes the
success body, cancels the unused rejection body and closes the runtime at scope exit.

## Choose adjacent capabilities

Use Endpoint for one checked operation and its declared response variants. Service compiles exact endpoint
implementations together; HTTP alone is sufficient for a simple portable Fetch handler.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/server/05-endpoint.md) for composition,
ownership, and failure behavior.
