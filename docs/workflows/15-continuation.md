# Bounded durable continuation

An import can process 100 rows, save the next row position, and start a fresh segment for the next 100. Splitting the
import this way keeps each segment's history from growing with the entire file. The caller can keep the reference
it received at submission and pass it to `client.wait` to get the final result.

Use `workflow.continue(nextInput)` in a root workflow accepted by the service with a PostgreSQL store. It finishes
the current segment and starts the same workflow definition with new input, a new run ID, and fresh history. A policy
sets the maximum number of these extra segments.

The next input is checked data, such as the next row number. An open browser or database transaction cannot move
with it. The store preserves the completed segment and the link to its successor, so the caller can still use the
original reference.

```mermaid
sequenceDiagram
    participant Client
    participant Store as Saved workflow state
    participant Worker
    Client->>Store: Accept cursor 0; retain original reference
    Worker->>Store: Claim current segment
    Worker->>Store: Save next input and finish segment
    Store-->>Worker: New run ID with fresh instruction history
    Worker->>Store: Complete final segment
    Client->>Store: Wait using original reference
    Store-->>Client: Final chain result
```

Read down the diagram. Each handoff gives the worker a new run ID, but the caller still waits with the reference it
received at submission. The diagram leaves out business writes and cleanup; both must finish as described below
before the handoff.

Starting a fresh history does not make a write safe to repeat. Save a receipt with a SQL write so a retry can
recognize it. For an HTTP or browser action, rely on the receiving system to recognize the request or inspect
what it saved before trying again.

## Declare the budget

Add `maxContinuations` to the workflow's accepted policy rule. It counts **additional** segments, so `3` permits the
original segment plus three successors. The supported range is `0..1000`; zero or omission disables continuation.
Omitting the field leaves it absent in the parsed policy, preserving existing saved policy fingerprints.

This definition demonstrates state transfer without external effects:

```ts runnable=counter-definition.ts
import * as schema from '@okikio/schema';
import * as workflow from '@okikio/workflow';

const Counter = workflow.define({
	id: 'example.counter',
	version: '1',
	input: schema.object({
		cursor: schema.number({ integer: true, minimum: 0 }),
		stop: schema.number({ integer: true, minimum: 0 }),
	}),
	result: schema.number({ integer: true }),
});

const CounterLive = workflow.implement(Counter, function* (ctx) {
	if (ctx.input.cursor < ctx.input.stop) {
		yield* workflow.continue({ cursor: ctx.input.cursor + 1, stop: ctx.input.stop });
	}
	return ctx.input.cursor;
});
```

Pass the corresponding entries to the complete policy's `workflows` field:

```ts
const workflows = [{
	definition: Counter,
	maxInstructions: 1,
	maxContinuations: 3,
	requires: ['workflow.continue'],
}];
```

Serve `CounterLive` with that exact policy through the ordinary `workflow.serve` assembly. A start with
`{ cursor: 0, stop: 3 }` reaches its result after four segments. In a data pipeline, perform a bounded batch through
declared activities, durably publish its output/checkpoint, then carry the committed cursor and artifact references in
the next input.

The next input is validated against the **same definition's input schema** and the accepted input-size limit. Definition
identity, version, namespace, scope, and policy remain the same. Changing definition or policy is not a continuation
operation.

## Run all four segments and follow the original reference

The declaration above is intentionally side-effect free; it prints nothing and starts no worker. This complete assembly
runs it. Prepare a disposable PostgreSQL 18.3 database as described below, then save this block as `counter.ts` at the
repository root. It uses no activities or external business writes, so the counter isolates continuation and reference
following from idempotency questions.

```sh
mise run prepare -- --kind deps
docker run --name utils-counter-postgres --rm -d -e POSTGRES_PASSWORD=example -p 55433:5432 postgres:18.3
```

Wait for `docker exec utils-counter-postgres pg_isready -U postgres`. Then run
`DATABASE_URL=postgres://postgres:example@127.0.0.1:55433/postgres mise exec -- deno run --allow-env --allow-net counter.ts`.
Migration creates/updates `utils_workflow`; use only the disposable database. The application owns the pool and closes it
in `finally` after worker drain and local disposal.

```ts support=counter.ts
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as engine from '@okikio/activity/engine';
import * as schema from '@okikio/schema';
import * as workflow from '@okikio/workflow';

const Counter = workflow.define({
	id: 'example.counter',
	version: '1',
	input: schema.object({
		cursor: schema.number({ integer: true, minimum: 0 }),
		stop: schema.number({ integer: true, minimum: 0 }),
	}),
	result: schema.number({ integer: true }),
});

const CounterLive = workflow.implement(Counter, function* (ctx) {
	if (ctx.input.cursor < ctx.input.stop) {
		yield* workflow.continue({ cursor: ctx.input.cursor + 1, stop: ctx.input.stop });
	}
	return ctx.input.cursor;
});
const Policy = workflow.PolicySchema.parse({
	// The accepted policy reserves at most three successors, in addition to the original segment.
	id: 'counter.policy',
	version: '1',
	limits: {
		inputBytes: 4096,
		resultBytes: 4096,
		historyBytes: 16384,
		pendingRoots: 1,
		reservedSuccessors: 3,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 5000, renewEveryMs: 500, recoverEveryMs: 100 },
	activities: [],
	workflows: [{ definition: Counter, maxInstructions: 1, maxContinuations: 3, requires: ['workflow.continue'] }],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60000, resultsMs: 60000, auditMs: 60000 },
});
// The application owns this pool; the store borrows it and the worker must drain before it closes.
const url = Deno.env.get('DATABASE_URL');
if (!url) throw new Error('DATABASE_URL must select a disposable PostgreSQL 18.3 database.');
const sql = postgresjs(url, { max: 4, onnotice() {} });
try {
	await postgres.migrate({ database: sql });
	await using store = postgres.open({ database: sql, namespace: 'docs-counter-v1', notifications: false });
	await using owner = context.create({ id: 'counter-host' });
	await using resources = resource.create(resource.implementations(), { ctx: owner, host: {} });

	// Starting the worker is explicit. Declarations and store construction start no execution loop.
	await using worker = await workflow.serve({
		store,
		resources,
		engine: engine.define({ id: 'counter.local' }),
		policies: [Policy],
		activities: [],
		workflows: [CounterLive],
		hostId: 'counter-host',
		shutdown: new AbortController().signal,
		pollIntervalMs: 100,
		capacity: { activations: 1, activities: 1, finalizers: 1, control: 1 },
	});

	// Keep the original reference: wait follows its chain, while get can inspect the original physical segment.
	const client = workflow.client({ store, policy: Policy });
	const ref = await client.trigger(Counter, { cursor: 0, stop: 3 }, { scope: 'example', key: 'counter-one' });
	console.log('Final:', await client.wait(Counter, ref, { signal: AbortSignal.timeout(30000) }));
	const original = await client.get(Counter, ref);
	const current = await client.get(Counter, ref, { follow: true });
	console.log('Original segment:', original.state);
	console.log('New physical reference:', current.ref.id !== ref.id);
	await worker.drain();
} finally {
	await sql.end();
}
```

Expected output:

```text
Final: 3
Original segment: continued
New physical reference: true
```

The segments carry cursors 0, 1, 2 and 3. The first three end with a continuation, and the fourth returns 3.

| Physical segment | Input cursor | Result of this segment |
| --- | ---: | --- |
| Original | 0 | Continue with cursor 1 |
| First successor | 1 | Continue with cursor 2 |
| Second successor | 2 | Continue with cursor 3 |
| Third successor | 3 | Return final value 3 |

The budget counts successors, not total segments. That is why a limit of three permits four physical segments in
this example, but does not permit an unbounded loop. Their different IDs still belong to the same logical operation.
`client.wait` follows the chain from the original reference; physical `get` still returns the first `continued` segment.
This program exercises finite rollover in one live process. The fresh-process crash test below tests reconstruction
across process loss. Set `stop: 4` with a new command key to exceed the accepted three-successor budget: the chain blocks
with `continuation_limit` instead of silently reserving unlimited work. An operator cannot enlarge that accepted budget
by retrying an activity. Stop the example database with `docker stop utils-counter-postgres`.

## Admission reserves the whole promise

The initial root admission reserves the finite worst-case work across every permitted segment. The existing acyclic
child/successor reservation graph remains unchanged; continuation does not make cycles legal.

For a budget of `N` additional segments, the adapter reserves `N` continuation successors, plus `N + 1` times the
ordinary per-segment successor, child, and cleanup/finalizer reservation. The policy's `reservedSuccessors`,
`pendingChildren`, and `pendingFinalizers` limits must accommodate that promise. This is deliberately conservative:
later segments might not use all reserved work.

An exhausted continuation budget blocks the current segment with `continuation_limit`. Repairing an attempt does not
increase the accepted chain budget or silently replace its policy. Plan a finite workload envelope before acceptance; a
new command remains a separate business operation with its own idempotency decisions.

Finished chains release admission capacity even while their `continued` segments remain retained for inspection.

## Transition and cleanup

The storage adapter owns the transition under the current activation's guarded transaction:

1. Validate root-chain ownership, the finite budget, next input, replay count, and history size.
2. Save the continuation instruction and its immutable request; move the old segment to `settling`.
3. Complete registered durable `workflow.defer(...)` cleanup in its existing order. If cleanup fails or needs repair,
   preserve the pending continuation and publish no successor.
4. After cleanup settles, atomically insert the next ready segment and mark the old segment `continued`, with a
   `continuedTo` link.

When no cleanup remains, the request and rollover can complete in the same transaction. When cleanup requires activity
work, the frozen request survives a worker crash while that work is pending. The final cleanup completion transaction
also owns the eventual rollover.

A `continued` segment has **no successful business result**. Its outcome remains absent; only the eventual terminal
segment has the final success/failure/cancellation result. No code after the continuation instruction executes in that
segment.

Once the continuation request is accepted, it is an immutable exit intent. Cancellation returns `too_late` even if
cleanup has subsequently blocked; it cannot replace the request with a contradictory cancelled outcome. An eligible
failed local cleanup activity can receive an explicit additional attempt through operator repair. A failed terminal
**cleanup child** cannot be restarted through that parent operation: repair returns `repair_policy` without changing the
parent's epoch, intent, or audit. The current profile has no child replacement contract; the preserved blocked state
requires an explicit application recovery decision.

Registered durable cleanup is distinct from arbitrary generator `finally` code. This profile reconstructs and discards
generator state during durable replay. Use `workflow.defer` for cleanup that must survive restart, and the owning
activity/resource lifetime for local process or browser resources. Do not depend on a JavaScript stack unwinding after
process loss.

## Supported scope and explicit rejections

| Request                                                                                                | Behavior                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Continue from the root sequence of an externally admitted workflow or one of its continuation segments | Supported within the accepted budget.                                                                           |
| Continue inside `parallel`, `map`, `retry`, or `race` branches                                         | Rejected with `continuation_scope`; join branches first.                                                        |
| Continue from a child workflow or an independently admitted successor of another run                   | Rejected with `continuation_scope`. Their parent result and ownership references retain their existing meaning. |
| Continue while ordinary jobs or other family runs remain unfinished                                    | Rejected with `continuation_pending`. Background/discarded work must settle first.                              |
| Continue from a workflow with a configured business finalizer                                          | Rejected with `continuation_finalizer`. Existing finalization obligations are not skipped or reinterpreted.     |
| Continue after using all allowed segments                                                              | Rejected with `continuation_limit`.                                                                             |
| Continue without a supporting execution store                                                          | Rejected with `continuation_binding`.                                                                           |

Completed child workflows are permitted within a segment. The restriction concerns continuing **the child itself** and
leaving unfinished family work behind. Deferred cleanup remains supported before root rollover, including its existing
activity/child cleanup mechanisms.

The coordinator cannot bypass these storage checks by submitting another unrelated root.
`ExecutionStore.continue(activation, { path, fingerprint, input }, instructions)` is a guarded interpreter/storage
boundary, not an application replacement for `client.trigger`.

## Follow the result, inspect each segment

Given a client bound to the exact accepted policy:

```ts
const ref = await client.trigger(Counter, { cursor: 0, stop: 3 }, {
	scope: 'example',
	key: 'counter:one',
});

// The original accepted reference follows the saved continuation links.
const result = await client.wait(Counter, ref, {
	signal: AbortSignal.timeout(30_000),
});

// Physical inspection remains the default.
const originalSegment = await client.get(Counter, ref);

// Opt in to inspecting the currently reachable segment.
const currentSegment = await client.get(Counter, ref, { follow: true });
```

`client.wait` follows links automatically. `client.get(..., { follow: true })` follows them for inspection. Both reject
cycles, invalid scope/namespace/definition changes, missing continuation links, and chains exceeding the traversal
bound. The supported policy permits at most 1,000 continuation links.

By default, `client.get` returns the addressed physical segment. A continued snapshot exposes `state: 'continued'` and
`continuedTo`, with no fabricated `value`. Repeating the original matching command key still returns the original
accepted reference; it does not start another chain.

In storage, `chain_root` identifies the original logical root and `chain_index` identifies the segment position. Each
successor's physical `parent` points to the previous segment, while `family` remains the original family. This allows
existing descendant inspection to include the continuation chain. Physical parentage here records lineage, not an
additional child-result wait.

## Controls, events, and progress address physical runs

Pause, resume, cancel, repair, event delivery, and `watch` remain **physical-run operations**. They do not implicitly
follow the chain. Obtain the desired current reference with a following read and apply the operation to that reference.
A transition can race the read; handle a closed/conflicting response by inspecting again rather than mutating a guessed
run.

An already authorized activation can request continuation while its physical segment is paused. The successor inherits
the current paused state and control revision and cannot be newly activated until explicitly resumed. An operation
addressed to the now-continued predecessor cannot resume the successor.

Events are not migrated or forwarded into the next segment. A pending continuation has frozen its future input and
rejects new event slots; acknowledgment of an already stored identical event retains normal deduplication behavior.
Consume needed events before continuing, or put the required state explicitly in `nextInput`. A new segment's
timer/event keys and activity paths belong to its own run.

`watch` observes the addressed physical segment and ends when it becomes `continued`. It does not provide an automatic
subscription across the chain. `get(..., { children: true })` can inspect descendant progress, including later segments,
within the existing report limit. Progress remains the latest saved report per job/effect, not an every-event delivery
log or a replacement for `wait`'s terminal result.

## History, receipts, and retention

Every segment gets fresh instruction, event, job, and receipt identities. Reusing an instruction path such as `0:` in a
new segment does not reuse the previous segment's job receipt. If two segments can attempt the same external business
effect, the application must carry a stable effect key and use its domain/provider idempotency contract. Continuation
does not make arbitrary HTTP effects exactly once.

Fresh segments bound active replay history. They do not immediately delete older histories or reduce all stored bytes.
Retention conservatively protects the whole family while any member is live and waits for every required retention
window before pruning the family. Retained continued segments remain inspectable until that lifecycle removes them.

## Verification boundary

`tests/workflows/continuation.test.ts` uses real PostgreSQL and fresh worker processes. It covers:

- A committed rollover observed independently before `SIGKILL`, followed through the original handle by a replacement
  process.
- Cleanup business writes and matching receipts committed before worker loss, an unfinished first attempt, and recovery
  with one domain append and no early successor.
- An injected SQL failure after successor insertion that rolls back the request, successor, and predecessor transition
  together.
- Finite-budget reservation/exhaustion, paused-state inheritance, retained-chain capacity release, unfinished family
  work, and nested/child/successor/finalizer rejection.

The test supports `UTILS_WORKFLOW_TEST_DATABASE_URL` for a dedicated disposable database; otherwise it owns its pinned
PostgreSQL Testcontainer. These tests test the stated local SQL/process boundaries. They do not prove database
failover, arbitrary external-effect idempotency, multi-region behavior, automatic code-version migration, or unbounded
continuation.

For the broader execution contract, see [saved execution](./13-execution.md), [consumer assemblies](./14-consumers.md),
and [operator controls](./16-operations.md).
