# Storage

An editor needs to restore a saved title when a view closes and opens again. A queue needs to retain unprocessed work.
A workflow needs completed steps and recovery permission. Choose the kind of saved state before choosing its backing.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

Here, **persistence** means that an acknowledged write is retained by the selected backing store. A JavaScript memory
store lasts only as long as its process. PostgreSQL retains committed rows independently of a worker process. Neither
choice saves an arbitrary JavaScript stack or a live browser object. Store portable values and recreate live connections
under a new owner when recovery requires them.

## Reopen a saved value through a different owner

From the repository root, run `mise run prepare -- --kind deps` once. Save the complete block as the named `.ts` file and run
`mise exec -- deno run saved-title.ts`. These examples use workspace imports; they need no published package or network service.

A snapshot store is independent of a queue or workflow. Reusing this memory slot preserves its value across local
owners, not process restarts.

```ts runnable=saved-title.ts
import * as state from '@okikio/context/state';
import * as stores from '@okikio/storage/state';
import * as schema from '@okikio/schema';

// This store outlives each state view, but its data still belongs to this process.
const store = stores.memory();
{
	await using draft = await state.open({
		store,
		contract: 'draft.v1',
		value: schema.string(),
		initial: () => '',
	});
	await draft.set('Saved title');
}
// Reopen the same contract after the first view closes; the store supplies the saved snapshot.
await using restored = await state.open({ store, contract: 'draft.v1', value: schema.string() });
console.log(restored.reader.get());
```

```text output
Saved title
```

The same operation is described in the [focused guide](./state/README.md), including its ownership rules and failure
behavior.

| Reader task | Start here | Persistence boundary |
| --- | --- | --- |
| Restore an editor draft or cursor | [State adapters](./state/README.md) | Memory preserves local owner changes; Web Storage or SQL can survive process loss. |
| Recover an invoice another executor abandoned | [Queue contract](../scheduler/queue/README.md), then [PostgreSQL setup](./queue/postgres.ts) | SQL retains claims and results; business writes still need repeat-safety. |
| Resume a multi-step accepted command | [Complete PostgreSQL workflow](./workflow/postgres/README.md) | Saved steps, timers, receipts and cleanup belong to Workflow's own queue. |
| Publish a consequence of a business write | [Transactional outbox](../../docs/postgres/02-outbox.md) | The business row and message commit together; delivery can repeat until the sink acknowledges. |

Persist Context state, Scheduler queues, and Workflow execution through explicitly selected adapters.

| Import                              | Responsibility                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@okikio/storage`                   | Type-only Queue and Workflow store contracts; no database driver is imported.                      |
| `@okikio/storage/state`             | One shared memory slot and the Context snapshot/store types.                                       |
| `@okikio/storage/state/web`         | Supplied Web Storage with explicit single-writer or Web Locks coordination.                        |
| `@okikio/storage/state/postgres`    | Version-checked current snapshots through a borrowed PostgreSQL pool.                              |
| `@okikio/storage/session/postgres` | Persist resource-session authority using database time and serialized transitions. |
| `@okikio/storage/queue`             | The shared Queue and codec types for persistence adapters.                                         |
| `@okikio/storage/queue/postgres`    | PostgreSQL-backed claimed work, delays, retries, renewal, fenced completion and bounded retention. |
| `@okikio/storage/workflow`          | Type-only execution/client store contracts.                                                        |
| `@okikio/storage/workflow/postgres` | PostgreSQL workflow history, receipts, outbox, inspection and recovery.                            |
| `@okikio/storage/outbox/postgres` | Bounded message acceptance inside a borrowed business transaction, with leased delivery and explicit retention. |
| `@okikio/storage/outbox/effect` | Stage an effect in that transaction and deliver a bounded batch through trusted, idempotent handlers. |

The PostgreSQL adapters borrow an application-owned Postgres.js pool. Apply `migrate({ database })` explicitly, then
`open(...)` with a namespace and versioned payload contracts. Construction issues no SQL. The application closes the pool.
Queue, state and Workflow views have their own disposal contracts. The outbox is an inert view with explicit operations,
no polling loop and no close operation. Join its active calls before closing the pool; stopping a caller does not revoke
a dispatch lease or prove that a remote sink stopped.

For one draft, crawl cursor, or checkpoint, use `state.open` with a [state adapter](./state/README.md). The same reader
works with local and stored state, while saved mutations are explicitly asynchronous. A stored cell retains one latest
snapshot, exposes conflicts instead of overwriting another owner, and joins active storage work during disposal. Queue
claims and Workflow history retain their own contracts and persistence protocols.

## Queue ownership and persistence

A namespace identifies one independently governed queue in the shared tables. Hosts opening it must agree on its
contract revision and admission/retention policy. This prevents accidental contract mixing; namespace strings do not
provide database authorization or tenant access control.

Admission and deduplication are atomic. Claims use row locks with `SKIP LOCKED`, database-clock leases and an exact
owner/token fence. Expired attempts can be reclaimed. Stale workers cannot complete, renew, retry or cancel another
attempt. Delivery is at least once: external effects need their own idempotency or transactional policy.

Inputs and outputs use explicit two-way codecs. Application values are encoded before storage and decoded after
retrieval. Persisted JSON is bounded, rejects implicit lossy conversion and defaults to 1 MiB per payload. The default
active capacity is 10,000 items, terminal retention is 10,000 rows/24 hours and each local view permits 1,000 waiting
operations. Pruning ends the retained deduplication window. Observer events are local notifications after commit, not a
persisted event stream.

Queue transactions explicitly use PostgreSQL `READ COMMITTED`; they leave the borrowed pool's session defaults
unchanged. Admission, completion, failure, cancellation and pruning take the namespace policy lock before item locks.
This serializes admission and terminal maintenance within one queue, so a completion sees earlier committed terminal
rows before applying retention. Claims, retries and renewal keep their independent item locks. Reusing an admission key
returns its existing reference without emitting another `added` event.

Each prune removes at most 1,000 eligible terminal rows and skips rows held by external transactions. An explicit
`prune()` returns `more: true` when another pass is needed; release the external lock and repeat maintenance. Retention
can temporarily exceed its configured limit under those locks or a pre-existing backlog. Pruning never deletes active
work. Keep transaction callbacks short: terminal maintenance within one namespace waits for the current policy owner.

## Workflow receipts

Workflow history and transaction receipts use the same explicit wire/application distinction. A durable receipt stores
encoded data and a reopening client decodes it back to the declared application type, including authored Date codecs.
Workflow namespaces isolate stored identities; separately enforce authorization and tenancy in the application and
PostgreSQL policy.

Read the [workflow persistence guide](../../docs/workflows/01-basics.md) and
[Scheduler queue guide](../scheduler/queue/README.md). The migration from `@okikio/postgres` is intentionally breaking;
use these exports and a fresh/versioned namespace when saved contract identities or wire history formats change.

## Construct a persistent queue without connecting

Construct and close a PostgreSQL queue adapter using a deliberately unreachable address. The constructor stays lazy, so
this program makes no connection. It demonstrates setup ownership, not a successful database deployment.

```ts runnable
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/queue/postgres';
import * as schema from '@okikio/schema';
const database = postgresjs('postgres://fixture:fixture@127.0.0.1:1/example');
const jobs = postgres.open({
	database,
	namespace: 'example',
	contract: 'example-v1',
	input: schema.string(),
	output: schema.string(),
});
await jobs.close();
await database.end();
console.log('Closed without connecting.');
```

```text output
Closed without connecting.
```

Postgres.js reads named `PG*` defaults while constructing a pool. The example runner grants those environment reads but
no network permission. Real queue operations require an application-owned connection and an explicit migration first.

## Database time representation

The PostgreSQL queue and workflow drivers borrow Postgres.js Date values where that driver's public contract supplies
millisecond timestamps. Queue decoding checks a finite epoch value and converts it to a Temporal instant; ordinary
workflow records serialize the driver Date at that integration point. Inspection paths that require microsecond ordering
select timestamp text instead and preserve all six fractional digits. Temporal validates their calendar values without
rewriting the saved cursor. Native Date interoperability here does not define process timing or lease authority;
PostgreSQL evaluates durable lease expiry.

## Choose what survives closing an owner

An editor snapshot, queued invoice, and workflow receipt retain different kinds of state. Choose their contract before
selecting memory, browser, or SQL backing.

Use State for one versioned snapshot, Queue for logical item claims, and Workflow for instruction and execution history.
Context, Scheduler, and Workflow remain the consumers of these stores.

Constructors do not migrate or connect implicitly. Borrowed SQL pools stay application-owned; a memory adapter does not
survive process loss.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                              | Use it to                                                                  | Exact contract                         |
| ----------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `@okikio/storage`                   | Import type-only persistence contracts without a database driver.                | [Contract](./mod.ts)                   |
| `@okikio/storage/workflow/postgres` | Persist workflow jobs, progress, and receipts through a borrowed SQL pool. | [Contract](./workflow/postgres/mod.ts) |
| `@okikio/storage/queue`             | Select persistent implementations of the Scheduler Queue contract.         | [Contract](./queue/mod.ts)             |
| `@okikio/storage/queue/postgres`    | Persist claims and results in PostgreSQL; migrate explicitly before use.   | [Contract](./queue/postgres.ts)        |
| `@okikio/storage/workflow`          | Use portable workflow-storage contracts without choosing a database.       | [Contract](./workflow/mod.ts)          |
| `@okikio/storage/state`             | Reuse a process-local snapshot slot across Context owners.                 | [Contract](./state/mod.ts)             |
| `@okikio/storage/state/web`         | Persist a snapshot in supplied Web Storage with an explicit writer policy. | [Contract](./state/web.ts)             |
| `@okikio/storage/state/postgres`    | Persist a version-checked snapshot through a borrowed PostgreSQL pool.     | [Contract](./state/postgres.ts)        |

Queue inspection and redrive implement the Scheduler Queue contract on PostgreSQL. Inspection reads metadata through
`(namespace, sequence)` and never runs application payload decoders. Redrive serializes source lookup, key reuse and
active-capacity admission with the namespace policy lock. It copies the saved input within the transaction; it does not
call the application or revive a claim. Apply `queue/postgres.migrate({ database })` explicitly before using this
revision: schema revision 2 adds redrive source metadata and the inspection index. Revision 1 upgrades atomically under
the migration advisory lock; future revisions reject. Roll back application code without downgrading the schema, or
restore from an application-owned backup. Adapter close leaves the borrowed database pool and retained jobs owned by the
application.

## Measure conditional snapshot replacement

The focused benchmarks measure 1–10,000 values; initialize, replace, reject stale version and read. The benchmark
compares against three structured clones without validation/version arbitration. Memory slots lose data on process exit.
PostgreSQL collection is an explicit external-service lane.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
mise run test -- --project storage
mise run bench -- --project storage --check
mise run bench -- --project storage
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.


The [physical PostgreSQL failover drill](../../docs/maintenance/07-recovery.md#recover-saved-work-after-the-database-writer-disappears)
checks saved snapshots, queue fencing and workflow receipts after a synchronously replicated primary is killed and its
standby promoted. With Postgres.js **4.0.0**, the interrupted transaction and queued queries reject inside the same process;
the existing single-connection pool reconnects. A late callback cannot write through its lost transaction or end the
replacement transaction. The drill preserves database logs, rejected-query outcomes and a promoted-database dump.

Use 4.0.0 for caller-owned pools too. Its parameter typing and array API differ from v3; read the
[upgrade and failover instructions](../../docs/maintenance/07-recovery.md#recover-saved-work-after-the-database-writer-disappears)
before changing an existing application. A reconnecting pool does not elect or fence database writers, and loss around
COMMIT can leave its outcome unknown. Reconcile saved identities and receipts before retrying a write.

A connection cap does not bound waiting work. The application owns its pool's Postgres.js `queue_timeout` and transport
failure detection. SQL timeouts apply only after connection admission and cannot run on a stopped database server.
The [admission and client-silence tests](../../docs/maintenance/07-recovery.md#keep-permission-alive-during-a-long-database-run)
keep those limits separate from claim expiry. Test-owned pools can close pending work on failure; borrowed adapters
leave that shutdown decision with the application.

## Persist resource session authority

`@okikio/storage/session/postgres` explicitly migrates a separate session schema and supplies per-reference atomic transitions using database time. It borrows the application pool; it does not own live resources. See [Resource sessions](../../docs/workflows/18-sessions.md) for acquisition, retention, expiry and recovery ownership.

The [continuous-write and lost-COMMIT-reply drills](../../docs/maintenance/07-recovery.md#keep-writes-running-while-the-primary-is-unavailable)
keep guarded writes active during promotion and verify that a rejected write can already have a committed receipt.
Use `target_session_attrs: 'primary'` for the tested Postgres.js 4.0.0 topology; its `read-write` selection can admit
an unpromoted standby. Reconcile the original receipt identity under a current claim before repeating a SQL write.
The finite load cases do not establish a production capacity or multi-hour availability target.

The [lease and soak drills](../../docs/maintenance/07-recovery.md#keep-permission-alive-during-a-long-database-run) separate recovery within a live lease
from replacement after expiry. Renew the host before its claims, and never revive expired permission by retrying a
write. The opt-in two-hour test checks exact receipts while renewal and bounded recovery scans continue through one
physical promotion. It exercises an explicit store-level renewal loop; `workflow.serve()` cancels an attempt when
automatic renewal fails. Read the guide before applying the test's retry policy to a service.
