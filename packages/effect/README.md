`@okikio/effect`
================

`@okikio/effect` lets code declare and announce externally observable side
effects without coupling the declaration to a queue, database, workflow engine,
or provider SDK.

An effect answers two questions:

1.  Which side effect may this execution announce?
2.  Which live owner accepts responsibility when that side effect occurs?

It is not the Effect TypeScript runtime. It is also not the generic logging or
metrics API. Optional observations belong in telemetry. An effect is used when
announcing the side effect is part of the operation's declared behavior.

Declare the side effect
-----------------------

An effect definition is import-safe data. Its schema describes the value carried
by one announcement.

~~~~ typescript
import * as effect from '@okikio/effect';

const RouteCommitted = effect.define({
  id: 'capture.route-committed',
  description: 'A route unit became authoritative.',
  value: RouteCommittedSchema,
});
~~~~

Declaring an effect does not mean every execution emits it. It means code in
that execution scope is allowed to announce it.

For example, an endpoint can declare the side effects that its handler may
announce:

~~~~ typescript
const CommitRoute = endpoint.post({
  id: 'routes.commit',
  path: '/routes/:routeId/commit',
  effects: [RouteCommitted],
  responses: [RouteResponse],
});
~~~~

The service compiler carries that exact definition into the effective operation
and generated service manifest. A declaration allows an announcement; it does
not require every request, or service startup, to have an effect owner.

Announce one occurrence
-----------------------

`effect.emit()` announces that one declared side effect occurred. It validates
the value and requires a stable logical key.

~~~~ typescript
const CommitRouteHandler = endpoint.handler(CommitRoute, async ({ ctx, input }) => {
  const route = await commitRoute(input.param.routeId);

  await effect.emit(
    ctx,
    RouteCommitted,
    { routeId: route.id, revision: route.revision },
    { key: `${route.id}:${route.revision}` },
  );

  return response.create(RouteResponse, route);
});
~~~~

The stable key identifies the logical occurrence. Retries that represent the
same side effect must reuse the same key. Do not include an attempt number merely
because execution retried.

`create()` performs the validation and occurrence construction without delivery:

~~~~ typescript
const occurrence = await effect.create(
  RouteCommitted,
  { routeId, revision },
  { key: `${routeId}:${revision}` },
);
~~~~

This is useful when another component decides when the announcement is accepted.

Acceptance has an exact meaning
-------------------------------

When configured, `emit()` resolves when the `EffectEmitter` accepts
responsibility for the occurrence. Acceptance is the point after which the
producer may rely on the announcement having an owner. An unconfigured emitter
only matters when code actually calls `emit()`.

Acceptance can mean different concrete things:

- a direct handler completed the required work;
- a database transaction committed an outbox record;
- a queue durably accepted an idempotent item;
- another runtime accepted responsibility for later delivery.

Acceptance does not mean every asynchronous consequence has finished.

A direct owner executes the exact handler before returning:

~~~~ typescript
const effects = effect.emitter(
  effect.implement(RouteCommitted, async (ctx, occurrence) => {
    await publishCommittedRoute(ctx, occurrence.value);
  }),
);
~~~~

A service supplies that owner explicitly:

~~~~ typescript
await using runtime = service.create(compiled, {
  host,
  adapters: {
    effect: effects,
  },
});
~~~~

If a compiled execution can emit an effect and no owner is configured, runtime
creation fails. If code tries to emit an effect that the execution did not
declare, `UndeclaredEffectError` fails that call.

Atomicity is owned where the side effect occurs
-----------------------------------------------

`effect.emit()` does not make an earlier database mutation and a later
announcement atomic by itself.

When the domain mutation and the announcement must commit together, the
application must put both under one authoritative transaction or outbox design.
For example:

~~~~ text
transaction
  |
  +-- update domain row
  +-- insert effect outbox occurrence
  `-- commit
          |
          v
      effect accepted
          |
          v
      later delivery
~~~~

A billing reservation, usage commitment, audit record, or workflow-start event
may need this stronger form. A direct in-memory emitter is appropriate only when
its weaker ownership semantics are acceptable.

Use `outbox()` when queue acceptance is the handoff point
---------------------------------------------------------

`effect.outbox()` provides a queue-backed `EffectEmitter`. Producer acceptance
occurs when the queue accepts the idempotent encoded occurrence. `drain()` later
claims occurrences and sends each one to its exact handler.

~~~~ typescript
await using effects = effect.outbox({
  queue,
  handlers: [
    effect.implement(RouteCommitted, handleCommittedRoute),
  ],
  maximumAttempts: 8,
  retryDelay: { seconds: 1 },
});
~~~~

The outbox separates producer acceptance from downstream completion while
retaining the same definition identity and stable occurrence key.

Scopes enforce declarations
---------------------------

Hosts attach the definitions available to an execution with `effect.scope()`.
Service, activity, and workflow runtimes do this from their compiled/static
contracts.

~~~~ typescript
const effectCtx = effect.scope(ctx, {
  effects: [RouteCommitted],
  emitter,
});
~~~~

The scope is a typed `@okikio/context` view. It borrows the parent lifetime and
does not create a registry or hidden resource container.

The service compiler gathers effects contributed by the service, targeted
service policies, endpoint groups, endpoint paths, endpoint operations, and
middleware. A resource does not silently add side effects to an operation. If an
externally visible side effect is part of the operation contract, declare it at
a service or execution composition layer where callers and tooling can see it.

Durable transport revalidates data
----------------------------------

`encode()` stores the stable definition ID, logical key, and validated value.
`decode()` accepts trusted imported definitions and validates the value again
before recreating an occurrence.

~~~~ typescript
const encoded = await effect.encode(occurrence);
const restored = await effect.decode(encoded, [RouteCommitted]);
~~~~

The encoded envelope must be an inert plain record with own enumerable data
properties. Accessor-backed transport values are rejected without invoking their
getters.

The occurrence wrapper is shallowly frozen. Its schema-produced `value` is
borrowed. A schema or producer that requires immutable nested data must enforce
that rule itself.

Cancellation and failure
------------------------

`emit()` checks cancellation before transferring responsibility. If cancellation
wins before the emitter accepts the occurrence, the producer cannot assume the
announcement exists.

After the emitter resolves, ownership has transferred. Later producer
cancellation does not recall the accepted occurrence.

The main failures are deliberate and specific:

| Failure | Meaning |
| ------- | ------- |
| `UndeclaredEffectError` | Code tried to announce an effect outside the declarations available to this execution. |
| `MissingEffectEmitterError` | The execution declared effects but no live owner can accept an emission. |
| `DuplicateEffectHandlerError` | Two direct/outbox handlers claim the same exact definition. |
| `MissingEffectHandlerError` | The owner has no handler for an occurrence it was asked to deliver. |
| `UnknownEffectDefinitionError` | Durable data names an effect definition not trusted by this receiving process. |

Use effects for required announcements, not diagnostics
-------------------------------------------------------

An effect is appropriate when the system needs an explicit, typed record that a
side effect occurred or when another component must accept responsibility for a
required consequence.

Typical examples include:

- usage and meter occurrences;
- billing or balance consequences;
- audit records that must not disappear silently;
- notification or webhook delivery intents;
- workflow or activity side-effect announcements;
- domain events whose delivery is part of correctness.

Metrics, logs, and traces normally use observers instead. An observer is allowed
to fail without changing a successful application result; an announced effect is
not.
