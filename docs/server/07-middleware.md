# Provide request values before another step uses them

An authentication step checks a credential and produces an actor for one request. A later step needs that actor.
Middleware declarations make the dependency visible; bound callbacks do the actual checking and populate the value.
Declaring `provides: [Actor]` does not create or authenticate anyone.

These examples use the experimental Utils source checkout. From its root, review `mise.toml`, then run `mise trust`,
`mise install`, and `mise run prepare -- --kind deps`. Save each named file at that root. The examples use workspace exports;
they do not assume a newly published registry version.

## Follow one greeting through a producer and a consumer

Save `actor-greeting.ts`. The public `demo-token` is a fixed teaching credential, not a real authentication scheme.
Only the example's local comparison accepts it. A deployed host must verify its own credential and authorization rules.
The first request reaches both middleware steps and the handler; the second is rejected before the actor consumer runs.

`await` waits for an operation's result while allowing other ready JavaScript callbacks to run.
`await using runtime` also registers the service for cleanup when the current block ends, including after an error.
That declaration does not open a network listener. Here, `runtime.fetch()` receives a local `Request` directly:

```ts runnable=actor-greeting.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as problem from '@okikio/http/problem';
import * as service from '@okikio/server/service';
import * as middleware from '@okikio/server/middleware';
import * as schema from '@okikio/schema';
const Actor = middleware.context<{ name: string }>()({ id: 'actor', description: 'Verified actor for one request.' });
const Unauthorized = problem.define({
	id: 'auth.required',
	type: 'https://problems.example.invalid/auth',
	status: 401,
	title: 'Authentication required',
	description: 'No accepted demo credential.',
});
const Authentication = middleware.define({
	id: 'authenticate',
	description: 'Check the demo credential.',
	provides: [Actor],
	problems: [Unauthorized],
});
const Read = middleware.define({ id: 'read-actor', description: 'Use the checked actor.', requires: [Actor] });
const Greeting = response.ok(schema.object({ message: schema.string() }), {
	id: 'greeting',
	description: 'Greeting result.',
});
const Greet = endpoint.get({ id: 'greet', path: '/greeting', responses: [Greeting] });
const Api = service.define({ id: 'greetings', path: '/', endpoints: [Greet], middleware: [Authentication, Read] });
const implementation = service.implement(Api, {
	endpoints: [endpoint.handler(Greet, () => response.create(Greeting, { message: 'Hello!' }))],
	middleware: [
		middleware.handler(Authentication, async ({ request, values }, next) => {
			if (request.headers.get('authorization') !== 'Bearer demo-token') return problem.create(Unauthorized);
			values.set(Actor, { name: 'Sam' });
			return await next();
		}),
		middleware.handler(Read, async ({ values }, next) => {
			console.log('Actor', values.get(Actor).name);
			return await next();
		}),
	],
});
await using runtime = service.create(service.compile(implementation), { host: {} });
for (const headers of [new Headers({ authorization: 'Bearer demo-token' }), new Headers()]) {
	const outgoing = await runtime.fetch(new Request('http://localhost/greeting', { headers }));
	console.log(outgoing.status, (await outgoing.json()).title ?? 'Greeting returned');
}
console.log(middleware.validate([Read]).valid, middleware.validate([Authentication, Read]).valid);
```

Run `mise exec -- deno run actor-greeting.ts`. It prints:

```text output
Actor Sam
200 Greeting returned
401 Authentication required
false true
```

The final two booleans check the declarations: `Read` alone has no producer; `Authentication` followed by `Read` has one.
The earlier output proves the callbacks actually ran. `Actor` is an identity-keyed slot, not a global variable. Each
request has its own store. Use the exact key object in `provides`, `requires`, `set` and `get`.

```text
valid credential -> Authentication sets Actor -> Read gets Actor -> greeting result
invalid credential -> declared 401 problem; Read and the greeting do not run
```

`middleware.context<{ name: string }>()(...)` first selects the TypeScript type, then creates the key. The annotation
does not validate a credential at runtime. `next()` runs downstream work and returns its eventual result; returning a
problem without calling `next()` stops this request. Code after `await next()` runs on the return path.

## Placement and ordering

A plain middleware definition uses the normal `afterValidation` lane. Special placement is explicit at the composition
site:

```ts
middleware: [
	middleware.beforeValidation(Authentication),
	Read,
];
```

The lane names describe **what they surround**, not what the middleware itself does:

1. `wholeRequest`: surrounds every application stage from raw request guards through the declared handler result. It
   does not imply that a streamed body has finished reaching the client.
2. `beforeValidation`: runs after whole-request setup and before endpoint input parsing/Standard Schema validation. Use
   it for exact raw webhook signatures and other pre-parsing guards.
3. `afterValidation`: the default lane. It receives validated inputs and runs before generic requirement interpretation
   and the operation.
4. `aroundOperation`: the innermost lane immediately around the endpoint handler. Use it for transactions and units of
   work.

```text
incoming Request
│
├─ wholeRequest.before
│  │
│  ├─ beforeValidation.before
│  │  ├─ authentication
│  │  ├─ parse request locations
│  │  ├─ Standard Schema validation
│  │  │
│  │  └─ afterValidation.before        ← default lane
│  │     ├─ requirement families
│  │     │   permission / entitlement / meter / future families
│  │     │
│  │     └─ aroundOperation.before
│  │        └─ endpoint handler
│  │        aroundOperation.after
│  │     afterValidation.after
│  │  beforeValidation.after
│  wholeRequest.after
│
├─ verify declared result/problem
├─ materialize with the service request state
└─ response-completion observer
   body drained, cancelled, aborted, or errored
```

Authored order is preserved within each lane. If A calls `next()` to run B, A's remaining code waits until B returns.
For two steps, the order is A before, B before, handler, B after, A after. This wrapping behavior is often called
“onion” middleware; it is ordinary nested function execution. Response completion is deliberately a separate host lifecycle because returning a streaming response is
not the same as finishing delivery.

## Once-per-request handlers

When the same imported middleware definition is intentionally contributed at several composition layers, wrap its
runtime binding rather than storing state in a framework context or module-global sets:

```ts
const ReadOnce = middleware.once(
	middleware.handler(Read, async ({ values }, next) => {
		console.log('Actor', values.get(Actor).name);
		return await next();
	}),
);
```

This replaces the `Read` binding in the complete program. Include the exact same definition only where the service
composition intends it; `once` is not a global suppression mechanism.


The wrapper is keyed by the actual `Request` object and exact middleware definition. Duplicate occurrences still call
`next()`, while the wrapped inner work runs once. A different request is never suppressed.

## Validation and documentation

- `middleware.plan()` normalizes nested middleware input into deterministic lanes.
- `middleware.validate()` detects duplicate IDs, unavailable required context, and conflicting context providers before
  runtime creation.
- `middleware.middlewareCatalog()`, `select()`, and `compose()` provide reusable immutable collections without global
  registration.
- `middleware.document()` produces JSON-safe context, resource, problem, requirement, effect, and resiliency
  inventories.

Definitions snapshot nested contribution arrays, so later mutation of authoring inputs cannot change a compiled graph.
