`@okikio/activity`
=================

`@okikio/activity` defines externally meaningful work. Definitions are immutable
and import-safe. They describe what one activity accepts, returns, can fail
with, can emit, requires, and where it can run. They do not open a provider or
start work.

```ts
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/effect';
import * as permission from '@okikio/permission';

const Browser = engine.define({ id: 'browser' });

const Download = activity.define({
  id: 'media.download',
  version: '1',
  input: DownloadInputSchema,
  result: DownloadResultSchema,
  placement: engine.require(Browser),
  resources: [Http, Storage],
  requirements: [permission.require(ReadSource)],
  effects: [DownloadCommitted],
});
```

Definitions keep direct requirements separate from requirements that are only
reachable through resource dependencies. Runtime admission applies direct
active requirements. Reachable permissions remain available for later dynamic
checks.

Start here
----------

`activity.request()` creates one serializable workflow operation. It does not
execute the implementation.

```ts
const saved = yield* activity.request(Download, input);
```

`activity.try()` creates the same request but converts only declared activity
failures into `@okikio/result`. Unexpected faults and cancellation still escape.

Direct attempts
---------------

`activity.run()` executes one exact implementation in the current host. A
host supplies the engine identity, input, parent context, resource collection,
job identity, attempt number, and optional permission/effect services.

```ts
const DownloadLive = activity.implement(Download, {
  async run(ctx) {
    await permission.assert(ctx, ReadSource, { url: ctx.input.url });
    const http = await ctx.get(Http);
    const writer = ctx.use(await openWriter());

    for await (const chunk of http.get(ctx.input.url, ctx.signal)) {
      await ctx.checkpoint();
      await writer.write(chunk);
      await ctx.heartbeat({ bytes: chunk.byteLength });
    }

    await effect.emit(ctx, DownloadCommitted, {
      url: ctx.input.url,
    }, {
      key: `download:${ctx.input.id}`,
    });

    return { ok: true };
  },
});
```

The direct attempt performs this sequence:

1. Validate the job and attempt identities.
2. Validate input with the activity schema.
3. Create one owned child context.
4. Attach the requirement runtime and reachable permission view.
5. Attach only the effects declared by the activity.
6. Narrow resource access to declared resources.
7. Apply direct active requirements unless a Scheduler already admitted them.
8. Run the initial cooperative checkpoint.
9. Invoke the exact implementation.
10. Validate the result schema.
11. Reject an expected failure that the activity did not declare.
12. Dispose attempt-owned values.

An implementation receives `ctx.get()` for borrowed resources and standard
owned-context operations such as `use()`, `adopt()`, and `defer()` for values it
creates itself.

Scheduler admission
-------------------

The default workflow Scheduler applies an activity's direct active requirements
before it reserves engine capacity. It then marks the fenced attempt as already
admitted. The provider calls `activity.run()` with that attempt, which binds
dynamic permission/effect/resource scopes without repeating the admission
check.

A caller that invokes `activity.run()` directly has no Scheduler above it, so
direct requirements are applied by `run()` itself.

Engine placement
----------------

`@okikio/activity/engine` owns static execution-target definitions and placement
choices:

```ts
const placement = engine.oneOf(
  engine.prefer(Browser),
  engine.allow(Server),
);
```

`require()` selects one exact engine. `prefer()` and `allow()` define an ordered
fallback choice. Placement does not start a process or Worker. Live engine
providers register with `workflow.scheduler()`.

Provider subpaths
-----------------

The package includes generic providers that compose existing runtime utilities:

- `@okikio/activity/local` executes an implementation in the Scheduler process.
- `@okikio/activity/worker` composes `@okikio/pool` and `@okikio/worker`.
- `@okikio/activity/process` composes `@okikio/pool`, `@okikio/process`, and the
  typed process channel.

The Scheduler remains the only owner of the logical activity attempt and retry
number. Providers report success, declared failure, fault, cancellation, or
loss. They do not silently create another attempt.

Permissions, effects, and heartbeats cross Worker/process transports as
correlated reverse calls. The authoritative host validates the permission
target or effect definition again before it answers. A heartbeat becomes
meaningful only after the Scheduler renews the exact active queue claim.

Pause and cancellation
----------------------

Pause is cooperative. A running implementation pauses only when it calls
`ctx.checkpoint()` or returns control. A `fetch()`, codec call, filesystem
mutation, or database operation is not suspended at an arbitrary JavaScript
instruction.

Cancellation changes the local `AbortSignal` immediately. Worker and process
providers also send the matching cancellation message. Cleanup still follows
the owned activity context.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `activity.define()` + `activity.implement()` | freeze metadata, keep a handler map, then validate input/result/failure schemas around every call | one activity identity and validation contract |
| `activity.request()` | construct a typed workflow instruction, suspend the generator, dispatch it, then validate the completion yourself | scheduler-facing request semantics without transport coupling |
| `activity.try()` | catch declared failures separately from unexpected faults and rebuild the discriminated result | declared failure stays data instead of becoming an exception |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/activity` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with a function call plus your own attempt IDs, permission checks, resource lookup, cancellation, and result transport.

Use the utility when those rules must stay identical across local, Worker, and process execution.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Operations and failures you will reach for next
-----------------------------------------------

After the basic definition/request/run path, these exports cover composition and
result handling:

- `catalog()` and `select()` build and narrow named activity definition sets.
- `document()` produces deterministic, JSON-safe definition metadata for tooling.
- `try_()` converts one attempt into explicit success/failure/fault/cancellation data
  instead of throwing declared activity failures.
- `isFailure()` checks whether a result contains one declared activity failure.
- `InvalidEngineError` reports a provider that claims the wrong engine definition.
- `UndeclaredFailureError` reports an implementation that returns a failure the
  activity definition did not declare.


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

Unexpected runtime diagnostics
------------------------------

Unexpected thrown values are projected through `@okikio/fault` before they cross
runtime or durable seams. This is separate from `@okikio/failure`, which represents
expected declared failures with stable application identity.
