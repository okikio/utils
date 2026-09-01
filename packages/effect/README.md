`@okikio/effect`
===============

Purpose
-------

An effect is a required one-way consequence that another owner must accept. It is not a general computation type, a log, or an optional observation.

```ts
import * as effect from '@okikio/effect';

const RouteCommitted = effect.define({
	id: 'capture.route-committed',
	description: 'A route unit became authoritative.',
	value: RouteCommittedSchema,
});
```

Definition, occurrence, and delivery are separate:

```text
effect.define()
    static import-safe contract
        |
        v
effect.create()
    validated frozen occurrence
    no effect delivery
        |
        v
effect.emit()
    required delivery
    resolves after exact owner accepts responsibility
```

Start here
----------

`create()` validates the value and requires a caller-owned stable key. It does not call the effect emitter.

```ts
const occurrence = await effect.create(
	RouteCommitted,
	{ captureId, generation, routeId, reference },
	{ key: `${generation}:${routeId}` },
);
```

The key identifies the logical consequence within its owning execution. It must contain 1 to 512 characters. Durable handlers normally combine it with stable execution identity such as an activity job ID. Do not use an activity attempt number when a retry represents the same logical consequence.

Delivery
--------

Create an effect-aware scope around the current execution context:

```ts
const effectCtx = effect.scope(ctx, {
	effects: [RouteCommitted],
	emitter,
});

await effect.emit(effectCtx, occurrence);
```

Ordinary call sites can use the create-and-emit form:

```ts
await effect.emit(
	effectCtx,
	RouteCommitted,
	{ captureId, generation, routeId, reference },
	{ key: `${generation}:${routeId}` },
);
```

`emit()` resolves when the emitter accepts ownership. Acceptance can mean that the handler completed the consequence directly, committed a database transaction, wrote an outbox record, or admitted an idempotent downstream job. It does not mean downstream asynchronous work is finished.

Declaration safety
------------------

`effect.scope()` creates a typed `context.view()` and receives the exact effect definitions the current execution path declared. It can wrap a permission-aware context without dropping the permission runtime. Emitting another definition throws `UndeclaredEffectError`. A missing emitter throws `MissingEffectEmitterError` instead of turning a required consequence into an optional no-op.

This mirrors the project rule for permissions: static definitions describe what runtime work can demand or cause, while a live host supplies the implementation.

Durable transport
-----------------

`encode()` stores only the stable definition ID, logical key, and validated value. `decode()` requires trusted imported definitions and validates the value again before recreating an occurrence.

The encoded envelope is treated as inert data. It must be a plain object or
null-prototype record with own enumerable data properties; accessor-backed fields
are rejected without invoking their getters. The nested `value` is then validated
by the trusted effect definition.

Occurrence immutability is shallow. The occurrence wrapper is frozen, while its
schema-produced `value` is borrowed. A schema or producer that requires immutable
nested data must enforce that contract itself.

This permits process, Worker, queue, outbox, and durable-store adapters without serializing live definition objects or runtime resources.

Cancellation
------------

`emit()` checks cancellation before delivery. Cancellation before acceptance means the producer cannot assume the consequence exists. Once the emitter resolves, ownership has transferred and later producer cancellation does not recall the accepted effect or change the successful acknowledgement into a cancellation error. The emitter owns downstream recovery from that point.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `effect.define()` + `effect.create()` | freeze identity metadata, validate the occurrence value, derive a stable key, and mark process-local occurrence identity | one typed logical effect occurrence |
| `effect.emitter()` | build a handler index, reject duplicates/missing handlers, and route each occurrence yourself | one explicit effect-delivery boundary |
| `effect.outbox()` | encode an occurrence, persist an idempotent acceptance record, and separate acceptance from later delivery | durable acceptance without embedding a provider in definitions |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/effect` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with call a handler directly, or persist an outbox record and invoke the handler later.

The utility gives both forms the same declared effect identity, stable key, scope, and acceptance semantics.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Composition, handlers, and expected errors
-----------------------------------------

Beyond `define()`, `create()`, `emit()`, and `outbox()`:

- `catalog()`, `select()`, and `compose()` build import-safe effect definition sets.
- `implement()` binds one exact effect definition to its authoritative handler.
- `isOccurrence()` verifies process-local identity for an occurrence created by this module instance; a copied lookalike object is not accepted.
- `DuplicateEffectHandlerError` rejects two handlers claiming the same exact definition.
- `MissingEffectHandlerError` reports an emitted/queued effect with no authoritative handler.
- `UnknownEffectDefinitionError` reports durable encoded data whose definition ID is not trusted by the receiving host.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
