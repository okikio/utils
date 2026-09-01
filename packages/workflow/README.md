`@okikio/workflow`
=================

`@okikio/workflow` owns deterministic orchestration and the default Scheduler.
Process-local asynchronous work belongs to `@okikio/task`; workflow generators
produce serializable instructions that can be identified, recorded, replayed,
and routed to activity engines.

Start here
----------

`workflow.define()` creates immutable metadata. `workflow.implement()` binds one
exact definition to a generator program.

```ts
import * as workflow from '@okikio/workflow';

const Convert = workflow.define({
  id: 'media.convert',
  version: '1',
  input: ConvertInputSchema,
  result: ConvertResultSchema,
  activities: [Inspect, Save],
  effects: [MediaCommitted],
});

const ConvertLive = workflow.implement(Convert, function* (ctx) {
  const inspected = yield* activities.request(Inspect, ctx.input);
  return yield* activities.request(Save, inspected);
});
```

The generator itself does not call a queue, Worker, process, database, or
network service. It yields instructions and receives typed completions.

Workflow context
----------------

`workflow.context()` validates input and creates one owned local context for a
specific workflow run. The context contains stable workflow/run identity and a
cooperative checkpoint. Live resources are deliberately absent.

```ts
await using ctx = await workflow.context({
  definition: Convert,
  runId: 'run-42',
  input,
  ctx: parent,
});
```

Context snapshots can cross a runtime seam because they contain serializable
identity and timing values. `AbortSignal`, resource collections, browser
handles, processes, Workers, and provider clients do not enter snapshots or
workflow history.

Operations
----------

The public operations use short namespace-oriented names:

- `activity()` creates a structural activity operation used by
  `@okikio/activity.request()`.
- `sleep()` requests a durable timer from the command host.
- `wait()` waits for one declared external signal.
- `child()` requests a child workflow.
- `effect()` emits one workflow-declared required effect.
- `defer()` registers serializable cleanup.
- `continue()` ends the current run and continues with validated new input.
- `parallel()`, `map()`, `race()`, and `retry()` define control semantics that
  the Scheduler interprets itself.

Every yielded instruction is also a cooperative checkpoint.

Scheduler
---------

`workflow.scheduler()` is the default instruction interpreter and the one
logical activity-placement authority.

```ts
await using scheduler = workflow.scheduler({
  requirements: requirementRuntime,
  effect: effectEmitter,
  activityQueue,
});

await using registration = await scheduler.register({
  engine: Browser,
  hostId: 'browser-host-1',
  capacity: 4,
  affinity: { region: 'ca-central', browser: 'chromium' },
  provider: browserProvider,
});

// A command can require some or all of those host facts.
const convert = workflow.activity(ConvertPage, input, {
  affinity: { browser: 'chromium' },
});

const result = await workflow.run({
  ctx,
  implementation: ConvertLive,
  scheduler,
});
```

The Scheduler owns:

- workflow control-instruction semantics;
- deterministic instruction identity;
- direct activity admission requirements;
- idempotent activity job admission;
- live engine registration and generation;
- placement and capacity reservation;
- queue claims and attempt numbers;
- heartbeats and claim renewal;
- activity retry decisions;
- stale completion fencing;
- workflow-level effect delivery;
- terminal activity completion returned to the generator.

A provider owns only delivery of the current fenced attempt. It cannot create a
new logical retry.

Registration is a live-resource boundary. The Scheduler snapshots the provider's
advertised activity list, affinity facts, capacity, protocol version, and exact
`run()` / `cancel()` methods when `register()` is called. Later mutation of the
original configuration or provider object does not silently change that live
registration. The provider object itself remains the owner of its live resources;
when `disposeProvider: true` transfers cleanup ownership, the disposal method is
captured at registration too.

Manually, this is the same pattern as copying immutable placement metadata into a
registration record while retaining bound callbacks to the live host. The utility
adds generation fencing, capacity accounting, queue claims, and disposal ordering
around that ordinary ownership split.

Instruction identity and history
--------------------------------

`workflow.describe()` creates JSON-safe instruction history data.
`workflow.identify()` adds a stable SHA-256 fingerprint. A Scheduler can borrow
one `History` implementation to persist, compare, replay, or audit that identity.
The process-local reference implementation lives at `@okikio/workflow/history`.

```text
run id + deterministic path + instruction fingerprint
                     |
                     +-- same identity -> replay/reattach
                     `-- different identity -> workflow divergence
```

```ts
import * as history from '@okikio/workflow/history';

await using records = history.memory({ maximumEntries: 10_000 });
await using scheduler = workflow.scheduler({ history: records });
```

`history.memory()` coalesces concurrent scheduling, returns recorded completions
on replay, rejects changed fingerprints, and bounds retained instruction state.
The Scheduler encodes each completion before history retains it. Stored history
contains only JSON-safe `HistoryCompletionType` data; expected failure
occurrences are reduced to stable ID/data/message and reconstructed through the
current replayed workflow definitions. History never needs to persist schemas,
functions, live errors, or resource values.

It is process-local and is not a durability claim. The generic utility does not
choose SQLite, Postgres, Deno KV, or another persistence provider. Concrete
durable history, run claims, timers, and signal stores belong in packages that
implement the same semantic contracts.

Activity jobs and engine registrations
--------------------------------------

The Scheduler uses `@okikio/queue` for logical activity jobs and temporary
claims. Replaying the same workflow instruction produces the same stable job
key. A claim creates the attempt number.

A registration advertises one exact engine definition, supported activity
definitions, capacity, optional affinity, and a host generation. Reconnecting
the same host creates a new generation. A late result from an older generation
is fenced before it can mutate terminal job state.

```text
logical job
   |
   +-- attempt 1 -> host generation 4 -> lost
   `-- attempt 2 -> host generation 5 -> success
```

The default queue is process-local. `ActivityJobType` deliberately stores only
serializable activity ID/version, validated input, workflow origin, context
snapshot, and affinity. `ActivityJobResultType` stores JSON-safe terminal data
and encoded declared failures. The replayed workflow instruction remains the
authority that resolves those IDs back to the exact imported activity contract.

Injecting a durable `Queue` therefore preserves the same Scheduler ownership
model without asking the queue to persist JavaScript definitions or maintain a
global registry, and without putting concrete database behavior in
`@okikio/workflow`.

Requirements and effects
------------------------

Workflow definitions keep their direct requirements. Activity definitions keep
their own direct requirements. Reachable declarations can be inspected without
being eagerly activated.

Before engine placement, the Scheduler applies the activity's direct active
requirements. A target-bearing permission remains a declaration until activity
code supplies the target to `permissions.check()` or `permissions.assert()`.

Workflow effects must be declared by the workflow definition. The Scheduler
creates an occurrence whose default key is the deterministic instruction
fingerprint and waits for the configured effect owner to accept it.

Cleanup and cancellation
------------------------

`workflow.defer()` registers one activity or child-workflow cleanup operation.
Registration occurs before the generator advances. Required cleanup runs even
when the workflow body fails. Cleanup execution does not wait behind a paused
checkpoint during cancellation.

A workflow run can use a parent `@okikio/task` checkpoint gate. Without a Task,
the same workflow checkpoint still checks cancellation and deadlines.

Durable hosting
---------------

The generic package defines orchestration semantics, not a database service.
Concrete durable providers can supply:

- workflow run/activation claims;
- instruction history;
- durable activity `Queue` storage;
- timers and external signal storage;
- effect outboxes;
- wake-up and reconciliation services.

Those are concrete persistence/runtime capabilities and therefore belong in
`packages/`. They must preserve the Scheduler's deterministic identity, claim,
retry, and fencing contracts rather than invent a second execution model.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `workflow.define()` + `implement()` | freeze workflow metadata, write a generator contract, then separately maintain deterministic instruction IDs and replay rules | one deterministic orchestration definition |
| `workflow.activity()` / `sleep()` / `wait()` / `child()` | manually construct serializable instruction records with stable keys/paths/annotations for each operation kind | typed durable instructions without embedding transports |
| `workflow.scheduler()` | persist/compare instruction identity, enqueue activity jobs, claim attempts, place by affinity/capacity, heartbeat, retry, fence stale completion, deliver effects, and run cleanup yourself | one execution authority instead of several overlapping retry/placement loops |
| `scheduler.register()` | snapshot advertised activities/affinity/capacity and bind provider callbacks while retaining the provider as the live disposal owner | mutable host objects cannot silently rewrite a registration generation |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/workflow` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with persist instruction history, replay a generator, enqueue activities, schedule timers, deliver signals, and fence duplicate completions yourself.

The utility owns the deterministic instruction contract and scheduler model. Concrete durable history, activation, timer, and queue stores remain provider packages.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Composition, terminal helpers, and scheduler errors
-------------------------------------------------

Definition tooling uses `catalog()`, `select()`, `compose()`, and `document()` in
the same import-safe style as other definition utilities. Terminal helpers
`failed()`, `fault()`, and `cancelled()` create explicit completion variants for
interpreter/provider code.

The scheduler exposes distinct errors rather than collapsing orchestration faults:
`FaultError`, `CancelledError`, `ContinueAsNewError`, `PlacementError`,
`RegistrationConflictError`, `SchedulerClosedError`, `CleanupInstructionError`,
and `CleanupFailureError`. Their names correspond to different replay, placement,
shutdown, or cleanup states and should not be handled as one generic retry signal.


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
