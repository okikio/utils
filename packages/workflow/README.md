`@okikio/workflow`
===================

`@okikio/workflow` interprets deterministic generator programs. A workflow
program yields serializable instructions. The Scheduler gives each instruction
a stable path, records or replays its completion through `History`, and admits
external activity work through `ActivityDispatch`.

Use `@okikio/task` for finite work that is local to one process. Use this
package when the work needs replayable instruction identity, declared external
activities, or an explicit stored handoff between scheduling and execution.

Start with one local host
-------------------------

This complete example runs one activity through the process-local reference
stores. It is useful for tests and local development. It deliberately does not
claim crash recovery because both `memory()` stores disappear when the process
exits.

```ts
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as dispatch from '@okikio/workflow/dispatch';
import * as history from '@okikio/workflow/history';
import * as workflow from '@okikio/workflow';

const TextSchema = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: 'example',
    validate(value: unknown) {
      return typeof value === 'string'
        ? { value }
        : { issues: [{ message: 'Expected text.' }] };
    },
  }),
});

const Local = engine.define({ id: 'local' });
const Echo = activity.define({
  id: 'example.echo',
  version: '1',
  input: TextSchema,
  result: TextSchema,
  placement: engine.require(Local),
});

const EchoWorkflow = workflow.define({
  id: 'example.echo-workflow',
  version: '1',
  input: TextSchema,
  result: TextSchema,
  activities: [Echo],
});
const EchoLive = workflow.implement(EchoWorkflow, function* (ctx) {
  return yield* activity.request(Echo, ctx.input);
});

await using parent = context.create({ id: 'example-parent' });
await using jobs = dispatch.memory();
await using records = history.memory();
await using scheduler = workflow.scheduler({
  activityDispatch: jobs,
  history: records,
});
await using executor = await workflow.executor({
  dispatch: jobs,
  engine: Local,
  hostId: 'example-host',
  capacity: 1,
  provider: {
    activities: [Echo],
    async run(_ctx, attempt) {
      return Object.freeze({ type: 'success', value: attempt.input });
    },
  },
});
await using run = await workflow.context({
  definition: EchoWorkflow,
  runId: 'example-run',
  input: 'hello',
  ctx: parent,
});

console.log(await workflow.run({
  ctx: run,
  implementation: EchoLive,
  scheduler,
})); // hello
```

The generator never holds a queue, Worker, process, database connection, or
provider callback. It only creates an `activity.request()` instruction. The
Scheduler copies the serializable item to dispatch. The executor claims the
item, owns the live provider call, and conditionally stores the terminal result.

What the package provides today
-------------------------------

| Capability | Current behavior | Limit |
| --- | --- | --- |
| Workflow definitions and instructions | Immutable definitions, JSON-safe descriptions, stable fingerprints, replayable paths | Definitions and schemas stay in the importing program |
| Scheduler | Interprets activity and workflow-control instructions, requirements, effects, cleanup, cancellation, and retry | It is not an activation or timer service |
| `history.memory()` | Bounds local instruction history, coalesces local scheduling, replays recorded completions | Process-local only |
| `dispatch.memory()` | Stores logical items, placement, fenced executor generations, claims, retry timing, cancellation, and results | Process-local only |
| `workflow.executor()` | Independently claims matching work through `ActivityDispatch` with bounded capacity | A remote or process host needs a shared authoritative adapter |
| Compute metadata | Optional `id`, open `kind`, optional `parent`, and attributes | Describes topology; it does not enforce one |

The interfaces are ready for a durable adapter, but this package does **not**
provide SQLite, Postgres, OPFS, Deno KV, activation claims, durable timers,
external signal storage, an outbox, or a reconciler. An in-memory implementation
that has the same methods is still not durable.

Owners and handoffs
-------------------

```text
workflow program
    | yields a serializable instruction
    v
Scheduler ---- History
    | admits one logical activity item
    v
ActivityDispatch <---- Executor ----> provider resources
    |                         |
    | stores claim/result      `-- runs one fenced attempt
    v
replayed workflow completion
```

The Scheduler owns deterministic instruction identity and workflow-control
semantics. `History` owns whether an existing instruction completion can be
replayed or new work can advance. `ActivityDispatch` owns the logical item,
placement, claim, retry, cancellation, and terminal result. An executor owns
provider resources, local capacity, claim renewal, and attempt delivery.

This separation matters when an executor changes host. Replaying the same
workflow instruction adds the same logical dispatch key. A late completion from
an old executor generation is fenced, and a new claim can create the next
attempt without producing a second logical item.

```text
logical item
   |
   +-- attempt 1, host generation 4 -> host lost
   `-- attempt 2, host generation 5 -> terminal result
```

`scheduler.register()` is only a local convenience. It creates an executor
against the Scheduler's configured dispatch owner. It does not use a separate
placement path.

Workflow programs
-----------------

`workflow.define()` declares input, result, direct requirements, activities,
effects, child workflows, and expected failures. `workflow.implement()` binds
one exact definition to a generator program. `workflow.context()` validates one
run input and creates a local cancellation/checkpoint lifetime.

| Operation | Meaning |
| --- | --- |
| `activity()` or `activity.request()` | Request one declared external activity |
| `sleep()` | Ask the command host to interpret a timer instruction |
| `wait()` | Ask the command host to interpret one declared external signal |
| `child()` | Request a declared child workflow |
| `effect()` | Announce one declared workflow effect |
| `defer()` | Register serializable cleanup before the program advances |
| `continue()` | End this run and validate the next input |
| `parallel()`, `map()`, `race()`, `retry()` | Scheduler-owned deterministic control operations |

Every yielded instruction is a cooperative checkpoint. Context snapshots contain
serializable identity and timing only. Do not put an `AbortSignal`, browser
handle, process, Worker, provider client, or resource collection in workflow
input or history.

History and durable values
--------------------------

`workflow.describe()` returns JSON-safe instruction data. `workflow.identify()`
adds a stable SHA-256 fingerprint. A `History` implementation must record that
identity before it starts external work, return a stored completion on replay,
and reject a different fingerprint at the same deterministic path.

History and activity results retain JSON-safe data. `undefined` has an explicit
marker so storage does not erase the difference between an absent JavaScript
value and a stored value. Expected failures are reduced to stable definition ID,
data, and message; the replayed definition reconstructs the occurrence. Live
schemas, functions, errors, and provider objects do not cross the storage seam.

`history.memory()` is useful for local replay tests. A durable implementation
needs storage-authoritative ownership and an atomic or recoverable protocol for
identity, completion, and concurrent claims. It must record committed outcomes,
not merely attempted work.

Placement and compute
---------------------

An activity declares ordered engine choices. An executor advertises one exact
engine, supported activities, capacity, optional affinity, protocol version, and
optional compute metadata. Dispatch matches activity version and affinity before
it grants a claim.

Compute metadata is topology-neutral. A flat host can omit it. A deployment
that models a process and child threads can use `parent`; another deployment can
use different open `kind` names or no hierarchy at all. The contract carries
facts for placement and diagnostics without imposing a cluster/pod/container
taxonomy.

Requirements, effects, cleanup, and cancellation
-------------------------------------------------

Workflow definitions keep direct requirements. Activity definitions keep their
own direct requirements. The Scheduler applies an activity's active direct
requirements before placement; target-bearing permissions remain declarations
until activity code checks a concrete target.

Workflow effects must be declared by the workflow definition. The Scheduler
gives an occurrence a deterministic default key and waits for the configured
effect owner to accept it. Durable delivery still needs a concrete outbox or
equivalent owner.

`workflow.defer()` records cleanup before the generator moves forward. Required
cleanup runs after a failure and during cancellation. Cancellation asks work to
stop cooperatively; it does not make an uncooperative provider safe to abandon
without fencing or lease recovery.

Building a durable host
-----------------------

A concrete host can implement `History` and `ActivityDispatch`, but must add:

1. Persisted and fenced workflow-run or activation ownership.
2. Instruction identity before external dispatch and terminal completion through
   the same authority.
3. Atomic activity claims using storage-authoritative lease time.
4. Reconciliation for expired registrations and claims that rejects late results.
5. Timer and signal storage, wake-ups, and an outbox or equivalent idempotent
   effect commitment.

Do not persist definitions, schemas, callbacks, live errors, or provider
resources. Import the exact definitions in the host, then resolve stored identity
through the replayed workflow contract.

Source guide
------------

1. `mod.ts` owns definitions, instructions, identity, and the Scheduler.
2. `types.ts` defines public contracts and storage documents.
3. `history.ts` and `dispatch.ts` provide bounded process-local references.
4. `jobs.ts` owns executor admission, provider snapshots, and lease delivery.
5. `*.test.ts` demonstrates replay, stale-generation fencing, cancellation,
   virtual-clock retry, and accessor-safe durable snapshots.
