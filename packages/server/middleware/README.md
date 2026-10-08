# `@okikio/server/middleware`

Authentication should run before code that needs the authenticated actor. If that ordering is hidden in a callback list,
a missing producer can become a request-time failure. This package describes what each middleware step needs and
provides, so validation and service compilation can check the plan before traffic arrives. Middleware is code that wraps
another step in the request flow.

```text
Authentication step: provides Actor -> available Actor value
Business step:       requires Actor -> allowed only after Actor is available
No producer or initial Actor        -> invalid plan
```

The arrows mean availability in the ordered plan, not proof of authentication. `Actor` is a named slot for a typed
value; your authentication implementation checks credentials and supplies that value. The plan can verify that the slot
exists, but it cannot decide whether your authentication provider is correct.

## Catch a missing value before serving requests

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as middleware from '@okikio/server/middleware';
const Actor = middleware.context<{ id: string }>()({ id: 'actor', description: 'Authenticated actor.' });
const Read = middleware.define({
	id: 'actor.read',
	description: 'Read actor after authentication.',
	requires: [Actor],
});
console.log(middleware.validate([Read]).valid);
console.log(middleware.validate([Read], [Actor]).valid);
```

Expected output:

```text output
false
true
```

The demo defines an `Actor` slot containing an `id`, then declares a middleware step that needs it. Validation of
`[Read]` returns `false` because nothing has supplied that slot. Supplying `[Actor]` as initially available makes the
second plan valid, so it prints `true`. This checks declarations only: it neither runs authentication nor creates an
actual actor value. Runtime bindings must still populate the declared values when the service handles a request.

## The declarations are data; the behavior is a normal callback

`context<{ id: string }>()({ ... })` can look like a new language. The first call selects the TypeScript value type; the
second constructs an immutable key from ordinary object data. It does not run authentication or create a nested runtime.
The key later identifies a value stored for one request.

| Contract                             | Important fields or operations                                               | Job                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `MiddlewareContextDefinition<Value>` | `kind`, `id`, `description`; retains the inferred value type                 | Typed key for one request value                                    |
| `MiddlewareDefinition`               | `requires`, `provides`, resources, problems and other declared contributions | Says what a step needs and may expose                              |
| `MiddlewareHandler`                  | Exact `definition` and `handle(context, next)` callback                      | Supplies the code that actually runs                               |
| Callback `context`                   | `request`, `host`, `values`, `resources`, `ctx`                              | Borrowed request data and declared capabilities                    |
| `context.values`                     | `has(Key)`, `get(Key)`, `set(Key, value)`                                    | Identity-keyed store restricted to declared required/provided keys |
| `next()`                             | `Promise<Result>`                                                            | Executes downstream work, then returns its result                  |

For example, an authentication binding can call `values.set(Actor, checkedActor)` before `await next()`. A later binding
that declares `requires: [Actor]` can call `values.get(Actor)`. Use the exact imported `Actor` object for both calls;
another key with the same textual ID is not the same key. The handler must supply the promised value: a `provides`
declaration does not manufacture it.

### Time a request with ordinary try/finally

The callback shape is the same wrapper pattern used by many web frameworks. This composition sketch uses the definition
from the first example; the application supplies `authenticate` and `recordDuration`:

```ts
const Authentication = middleware.define({
	id: 'actor.authenticate',
	description: 'Check the session and provide its actor.',
	provides: [Actor],
});
const AuthenticationHandler = middleware.handler(Authentication, async ({ request, values }, next) => {
	const actor = await authenticate(request);
	values.set(Actor, actor);
	const started = performance.now();
	try {
		return await next();
	} finally {
		recordDuration(performance.now() - started);
	}
});
```

Under the hood, definitions snapshot their arrays, validation walks the ordered lanes and tracks available keys, and the
service links each declaration to its exact binding. Each request gets its own store and callback sequence. This lets
startup reject a missing producer while keeping runtime behavior as readable JavaScript. Timing around `next()` measures
the wrapped work through its result; it does not measure the final drain of a streaming response body. Use a completion
observer for that separate lifetime. See the [full middleware contracts](../API.md#middleware).

## Build on the example

For an authenticated account API, bind the authentication producer and the actor reader with `handler()`, declare their
placement, and let the [service compiler](../service/README.md) validate the combined plan. Use
[permission requirements](../../permission/README.md) for access decisions rather than treating an available actor value
as permission to read every record.

For a transaction around one endpoint invocation, choose `aroundOperation` and make resource ownership explicit with
[resources](../../resource/README.md). Earlier lanes suit whole-request work or work before and after validation. Use
`once()` when repeated contributions of the same exact binding should run its inner work once for one Request; other
contributions still continue downstream. This contract middleware is distinct from the simple Fetch middleware in
[server/http](../http/README.md).

## Definitions and context

```ts
import * as middleware from '@okikio/server/middleware';

export const Authentication = middleware.context<{
	readonly actorId: string;
}>()({
	id: 'identity.authentication',
	description: 'Verified application authentication.',
});

export const Organization = middleware.context<{
	readonly organizationId: string;
}>()({
	id: 'identity.organization',
	description: 'Active organization.',
});

export const ResolveOrganization = middleware.define({
	id: 'identity.resolve-organization',
	description: 'Resolve the active organization.',
	requires: [Authentication],
	provides: [Organization],
	resources: [OrganizationRepository],
	problems: [OrganizationRequired],
});
```

Definitions are static data. A middleware definition may also declare `effects` when its runtime handler can announce an
externally visible side effect. The service compiler carries those effect definitions into every operation where the
middleware is active, so `effect.emit()` remains checked against the compiled execution contract.

Runtime behavior is supplied separately and bound by direct identity:

```ts
export const ResolveOrganizationHandler = middleware.handler(
	ResolveOrganization,
	async (context, next) => {
		// Resolve and set the declared context value.
		return await next();
	},
);
```

## Placement and ordering

A plain middleware definition uses the normal `afterValidation` lane. Special placement is explicit at the composition
site:

```ts
middleware: [
	middleware.wholeRequest(RequestDiagnostics),
	middleware.beforeValidation(VerifyWebhookSignature),
	ResolveOrganization,
	middleware.aroundOperation(TransactionScope),
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

Authored order is preserved within each lane. Each lane uses normal onion semantics, so post-`next()` work unwinds in
reverse order. Response completion is deliberately a separate host lifecycle because returning a streaming response is
not the same as finishing delivery.

## Once-per-request handlers

When the same imported middleware definition is intentionally contributed at several composition layers, wrap its
runtime binding rather than storing state in a framework context or module-global sets:

```ts
export const RequestMetricsHandler = middleware.once(
	middleware.handler(RequestMetrics, async (context, next) => {
		return await recordRequest(context, next);
	}),
);
```

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
