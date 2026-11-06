# `@okikio/storage/workflow/postgres`

Save accepted jobs and workflow progress in PostgreSQL. A worker can stop without losing committed work. Another
compatible worker can then continue from saved steps and write receipts. The adapter supplies the saved queue. You do
not need a second queue package for this path.

The application owns its Postgres.js pool, business SQL, authorization, and remote-write safety. The adapter borrows
that pool and owns the tables in `utils_workflow`. Importing it starts no worker, opens no pool, and runs no migration.

The adapter uses PostgreSQL `transaction_timeout` for its owned transactions. Run the complete repository tests with
PostgreSQL 18.3, which matches CI; a server without that setting rejects this workflow path. The separate state and
queue adapters have their own contracts and do not imply compatibility for this one.

Server-side timeouts start after a transaction obtains a connection and require PostgreSQL to remain responsive.
The application's pool owner must separately bound waiting work, set an appropriate Postgres.js `queue_timeout`, and
choose transport failure detection. Leave lease margin for connection admission as well as SQL execution. The adapter
does not close a borrowed pool to force pending work to settle. The [recovery tests](../../../../docs/maintenance/07-recovery.md#keep-permission-alive-during-a-long-database-run)
show separate checks for queued work, a physically paused server, and expired write permission.

Start with [the background-work walkthrough](../../../../docs/workflows/01-basics.md). Then read the complete
[HTTP service](../../../../tests/workflows/scenarios/service.ts),
[worker](../../../../tests/workflows/scenarios/host.ts), [Core import](../../../../tests/workflows/scenarios/core.ts),
and [Intelligence research](../../../../tests/workflows/scenarios/intelligence.ts) consumers. The
[test guide](../../../../docs/workflows/07-tests.md) explains both process recovery and actual service/worker
containers.

## Save one accepted note and reopen its result

Start with one note before adding a multi-step workflow. The client first accepts a note command. `serve` starts a
worker that performs the write, and a receipt records its result in the same transaction. A newly opened client then
reads the saved result, using the reference returned at acceptance.

Think of the receipt as a saved answer to “did this job already write this note?” It is stored in the same
transaction as the note. If a connection drops after commit, a retry can read that answer before writing again.

```mermaid
flowchart TD
    Command[Accept the note command] --> Accepted[Commit source command and job together]
    Accepted --> Worker[Worker claims the job]
    Worker --> Permission[Check current claim inside transaction]
    Permission --> Check[Check the saved receipt]
    Check -->|Found| Result[Return the saved result]
    Check -->|Missing| Write[Commit note and receipt together]
    Write --> Result
    Result --> Reopen[New client reads the saved result]
```

The names in the program describe different jobs:

| Name | What it does here |
| --- | --- |
| `SaveNote` | Declares the input, result, and resources the activity needs. It does not write a note. |
| `SaveNoteLive` | Implements that declaration with SQL. The worker calls it. |
| `Store` | Declares a resource the activity can request. The resource collection supplies the open store view. |
| `Policy` | Sets queue limits, attempt limits, lease renewal, and retention for accepted work. |
| `client` / `worker` | The client accepts commands and reads results. The worker claims accepted jobs and runs activities. |

Use a **disposable PostgreSQL 18.3 database**, Postgres.js 4.0.0 from this checkout, and the pinned Deno host. The
example creates application tables and explicitly migrates `utils_workflow`; do not point it at a production database.
From the repository root:

```sh
mise run prepare -- --kind deps
docker run --name utils-docs-postgres --rm -d -e POSTGRES_PASSWORD=example -p 55432:5432 postgres:18.3
```

Wait until `docker exec utils-docs-postgres pg_isready -U postgres` succeeds. Save the following program as `save-note.ts`
at the repository root, then run:

```sh
DATABASE_URL=postgres://postgres:example@127.0.0.1:55432/postgres mise exec -- deno run --allow-env --allow-net save-note.ts
```

The environment permission lets the program read its URL and Postgres.js read driver defaults; network permission lets
it connect to PostgreSQL. `open` borrows the SQL pool. `migrate` is explicit setup, and the outer `finally` closes that
pool only after worker/resource/store cleanup. In a deployment, run migration as a maintenance step before workers start.

```ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as schema from '@okikio/schema';

// The application owns this pool. Close it after the worker and store views stop.
const url = Deno.env.get('DATABASE_URL');
if (!url) throw new Error('DATABASE_URL must select a disposable PostgreSQL 18.3 database.');
const sql = postgresjs(url, { max: 4, onnotice() {} });
const namespace = 'docs-save-note-v1';

// Describe where the activity can run and which borrowed resource it needs.
const Local = engine.define({ id: 'notes.local' });
const Store = resource.define<postgres.StoreType>()({
	id: 'notes.store',
	description: 'Borrow the workflow store for guarded SQL.',
});

// This declaration checks input and output. The implementation below performs the write.
const SaveNote = activity.define({
	id: 'notes.save',
	version: '1',
	input: schema.object({ id: schema.string(), title: schema.string({ minLength: 1 }) }),
	result: schema.object({ id: schema.string() }),
	placement: engine.require(Local),
	resources: [Store],
});

// Bound accepted work, retries, and saved data. Lease durations and deadlines are milliseconds.
const Policy = workflow.PolicySchema.parse({
	id: 'notes.policy',
	version: '1',
	limits: {
		inputBytes: 4096,
		resultBytes: 4096,
		historyBytes: 16384,
		pendingRoots: 4,
		reservedSuccessors: 0,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 5000, renewEveryMs: 500, recoverEveryMs: 100 },
	activities: [{
		definition: SaveNote,
		maxAttempts: 3,
		deadlineMs: 20000,
		retry: 'transient',
		delay: { initialMs: 50, maximumMs: 500 },
		recovery: 'retry',
		requires: ['postgres.transactions', 'postgres.receipts'],
	}],
	workflows: [],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60000, resultsMs: 60000, auditMs: 60000 },
});
try {
	// An explicit setup step for this disposable example, not import-time behavior.
	await postgres.migrate({ database: sql });
	await sql`create table if not exists utils_docs_commands(namespace text, id text, title text, primary key(namespace,id))`;
	await sql`create table if not exists utils_docs_notes(namespace text, id text, title text)`;
	let ref: workflow.ReferenceType;
	{
		await using store = postgres.open({ database: sql, namespace, notifications: false });
		const client = workflow.client({ store, policy: Policy });
		const input = { id: 'note-1', title: 'Summer trip' };

		// Commit the source command and its accepted job together. No activity runs in this transaction.
		ref = await postgres.begin(sql, async (tx) => {
			await tx`insert into utils_docs_commands values (${namespace},${input.id},${input.title}) on conflict do nothing`;
			return await client.in(tx).submit(SaveNote, input, { scope: 'account-1', key: input.id });
		});
		const repeated = await client.trigger(SaveNote, input, { scope: 'account-1', key: input.id });
		console.log('Same accepted run:', ref.id === repeated.id);

		/** Save the note once for this job and write key, including after a lost commit reply. */
		const SaveNoteLive = activity.implement(SaveNote, {
			/** Use the worker-issued claim to check permission before changing business data. */
			async run(ctx) {
				const database = await ctx.get(Store);
				const saved = await database.transaction(ctx.claim, {
					key: 'note-write-v1',
					input: ctx.input,
					result: SaveNote.result,
				}, async (tx, receipt) => {
					// A prior receipt means this insert already committed. Return it without inserting again.
					const previous = await receipt.get();
					if (previous !== undefined) return previous;
					await tx`insert into utils_docs_notes values (${namespace},${ctx.input.id},${ctx.input.title})`;
					// The note and receipt commit together when this callback returns.
					return await receipt.save({ id: ctx.input.id });
				});
				return saved.value;
			},
		});

		// The context owns local resource lifetime. The resource collection lends the store to the activity.
		await using owner = context.create({ id: 'note-host' });
		await using resources = resource.create(
			resource.implementations(resource.implement(Store, { create: () => store })),
			{ ctx: owner, host: {} },
		);

		// Start the worker after setup and activity implementation. It claims the accepted job.
		await using worker = await workflow.serve({
			store,
			resources,
			engine: Local,
			policies: [Policy],
			activities: [SaveNoteLive],
			workflows: [],
			hostId: 'note-host',
			shutdown: new AbortController().signal,
			pollIntervalMs: 100,
			capacity: { activations: 1, activities: 1, finalizers: 1, control: 1 },
		});
		console.log('Saved:', (await client.wait(SaveNote, ref, { signal: AbortSignal.timeout(30000) })).id);
		// Stop accepting local work and wait for active work before the scope disposes its owners.
		await worker.drain();
	}
	// A new view reads committed state. This is owner reconstruction, not a process-kill test.
	await using reopened = postgres.open({ database: sql, namespace, notifications: false });
	const reader = workflow.client({ store: reopened, policy: Policy });
	console.log('Reopened result:', (await reader.wait(SaveNote, ref, { signal: AbortSignal.timeout(5000) })).id);
	const rows = await sql`select count(*)::integer as count from utils_docs_notes where namespace=${namespace}`;
	console.log('Business writes:', rows[0]!.count);
} finally {
	await sql.end();
}
```

Expected application output in this disposable database:

```text
Same accepted run: true
Saved: note-1
Reopened result: note-1
Business writes: 1
```

The first transaction saves the source command and accepts `SaveNote` together. The second matching submission returns
the same run. The worker later saves the note and its receipt in another transaction. The callback checks the receipt
before writing: when a replacement retries after that transaction committed, it returns the saved receipt rather than
inserting again. The receipt belongs to that logical activity job and key, not to every note with the same title.

Closing a store view and reopening it reads saved state without rerunning the activity. This program demonstrates
acceptance deduplication and owner reconstruction; it deliberately does not kill the process between write and result
publication. The [recovery suite](../../../../tests/workflows/recovery.test.ts) exercises that distinct crash window. Repeating
this script while the same command/result are retained reattaches to the same run. After pruning ends deduplication,
new acceptance can write again: production domain keys or retention policy must protect the intended business lifetime.

| Failure point | What remains | Recovery |
| --- | --- | --- |
| Before acceptance commit | Neither source command nor job from that transaction. | Retry with the same command key. |
| During note/receipt transaction | Both roll back. | A permitted replacement executes the write. |
| After note/receipt commit, before result publication | Note and receipt remain. | Replacement reads receipt and returns its result. |
| Old worker attempts a new guarded write after replacement | Old permission is stale. | Store rejects; it cannot replace the current result. |
| Remote API succeeds but reply is lost | SQL cannot infer that API's outcome. | Reconcile or reuse a receiver-owned idempotency key. |

Stop the disposable database after the example with `docker stop utils-docs-postgres`. No automatic retention loop or
container lifecycle is installed by the library.

The [transaction guide](../../../../docs/postgres/01-workflow.md) explains the same note's commit boundaries and exact
receipt calls. [Connected consumers](../../../../docs/workflows/14-consumers.md) extend this model with process/thread
engines, standard progress and registered durable cleanup. The application remains responsible for authorization and
remote-write safety.

## Optionally check that construction stays lazy

For an import-safe start, construct and close a store without requesting database work:

Postgres.js reads its `PG*` environment defaults during construction. Deno must permit those named reads, even when the
connection URL is explicit. The example runner grants only the driver defaults and no network permission.

```ts runnable
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';

const sql = postgresjs('postgres://fixture:fixture@127.0.0.1:1/example');
await using store = postgres.open({ database: sql, namespace: 'example' });
console.log(store.namespace);
await sql.end();
```

```text output
example
```

## Execution and wake-ups

The [execution guide](https://github.com/okikio/utils/blob/main/docs/workflows/13-execution.md) explains the common
activity and workflow operations across local and durable hosts. It also covers saved parallel branches, relative sleep,
race cancellation, notification ownership, and crash tests. A PostgreSQL worker listens before scanning and keeps a
bounded fallback scan. `serve({ pollIntervalMs })` sets the maximum idle interval; its default is 1000 ms.
`postgres.open({ database, namespace, notifications: false })` selects polling for transaction-pooled connections. The
worker owns its notification session. The application owns its query pool and closes it after worker drain.

## Control and inspection

Schema revision 2 adds persisted admission pause/resume, a committed operational timeline, bounded terminal-family
pruning, and bounded root continuation. Start with [operations](../../../../docs/workflows/16-operations.md), then the
[inspector API](../../../../docs/postgres/03-inspection.md). `inspector({ database, namespace })` starts no background
work; each read is bounded and does not claim or renew a job. Run actual schema upgrades only after draining old
workers.

Inspection timestamps use four-digit UTC years and exactly three or six fractional digits. Temporal validates the
calendar and clock values while the schema retains the exact input text. Queue cursors can therefore preserve PostgreSQL
microseconds without a Date conversion. Ordinary Postgres.js reads still supply native Date values where the driver
promises millisecond precision; the adapter converts those values once when constructing its public record. It does not
reinterpret an arbitrary local-time string as a saved instant.

Worker polling, renewal cadence, recovery spacing, and scan-age readiness use monotonic host time. The first recovery
scan runs immediately, including immediately after host startup. PostgreSQL remains authoritative for persisted lease
expiry. A readiness `checkedAt` is a wall-time Temporal instant serialized with milliseconds, independent of those
elapsed scheduling decisions.

## Choose adjacent capabilities

Workflow owns the instruction and execution model; this adapter owns persisted jobs and receipts through a borrowed SQL
pool. Context State stores one snapshot, and Queue stores logical items without supplying an entire workflow engine.

The [package choice map](../../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/postgres/01-workflow.md) for
composition, ownership, and failure behavior.

## Plan maintenance before applying it

`await migrationStatus({ database: sql })` reports the saved revision, this library's target revision, compatibility and
whether unexpired non-draining hosts exist. `await planMigrations({ database: sql })` adds a bounded authored install or
forward-upgrade step and `ready`. Both calls use read-only repeatable-read transactions and apply no DDL. A current
schema needs no transition. A future or malformed revision is incompatible; this library never proposes a downgrade. An
upgrade with live non-draining hosts reports `ready: false`.

The plan is an observation, not a maintenance lease. Drain workers and call `migrate({ database: sql })` explicitly;
that call obtains the migration advisory lock, repeats the revision/host checks and commits the complete migration
transaction atomically. Registration uses the same lock. Unrelated readers and older workers still require operational
draining. Concurrent external DDL can invalidate a read-only observation and cause a database error; refresh the plan
rather than treating an old `ready` result as authority. All calls borrow the application's pool and leave it open.

Schema revision 3 persists required placement, activity affinity, and compute generations. Drain older workers before the explicit upgrade. The [placement guide](../../../../docs/workflows/17-placement.md) explains ancestor budgets, inherited child constraints, executor replacement, and the trusted registration boundary.
