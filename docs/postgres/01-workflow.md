# Save workflow progress beside business state

Suppose someone submits a note, then the worker stops before the site can show “Saved.” Storing the accepted job in
PostgreSQL gives a replacement worker something to pick up. Saving a receipt with the note lets that worker tell
whether it still needs to write the note.

A **transaction** commits several SQL changes together or rolls all of them back. A **receipt** records the answer to
one logical operation inside that same transaction. If the client loses the commit reply, it cannot tell from the
network error whether the transaction succeeded. Reading the original receipt lets a later attempt reuse the committed
answer instead of blindly repeating the business write.

The application supplies the Postgres.js connection pool and owns the tables that hold its notes. The adapter uses
that pool and manages its own `utils_workflow` tables for jobs and results. Those tables cannot make an unrelated
remote service safe to call twice. The [Storage README](../../packages/storage/README.md) compares the available
stores if you only need to save a draft or keep a queue.

## Accept and save one note, then reopen the result

The customer wants one saved note even if a request is repeated. Acceptance and completion are separate commits. The
client accepts the command, the worker performs the business write, and a receipt lets replacement work distinguish
“already saved” from “not saved yet.” The example keeps those owners visible in one file; a service and worker can
later run them in separate processes using the same declarations and policy.

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

Close the store view and open it again to read the saved result without running the activity again. If you repeat the
script while PostgreSQL still holds the command and result, the client attaches to the same run. If cleanup removes
the records that identify the original command, the client can accept it again and another worker can write again.
Choose an application key or keep those records for as long as a repeat request must reuse the first write.

This program keeps the process alive between the write and the result. The
[recovery suite](../../tests/workflows/recovery.test.ts) stops the process in that window.

| Failure point | What remains | Recovery |
| --- | --- | --- |
| Before acceptance commit | Neither source command nor job from that transaction. | Retry with the same command key. |
| During note/receipt transaction | Both roll back. | A permitted replacement executes the write. |
| After note/receipt commit, before result publication | Note and receipt remain. | Replacement reads receipt and returns its result. |
| Old worker attempts a new guarded write after replacement | Old permission is stale. | Store rejects; it cannot replace the current result. |
| Remote API succeeds but reply is lost | SQL cannot infer that API's outcome. | Reconcile or reuse a receiver-owned idempotency key. |

Stop the disposable database after the example with `docker stop utils-docs-postgres`. No automatic retention loop or
container lifecycle is installed by the library.

## Accept a command with an application transaction

Run `await postgres.migrate({ database: sql })` explicitly during deployment or test setup.
`postgres.begin(sql, callback)` supplies a real Postgres.js transaction and records its pool and callback lifetime.
`client.in(tx).submit(...)` can then accept a job in the same commit as a business insert. A raw `sql.begin()`
transaction has not been registered by this bridge and is rejected. The
[service source](../../tests/workflows/scenarios/service.ts) shows source insertion and job acceptance together.

## Save a business write with a receipt

`store.transaction(ctx.claim, options, callback)` checks the running attempt's temporary permission before application
SQL. Utils supplies `ctx.claim` to activities running as saved jobs. A local activity call has no such permission. The
adapter rejects absent, fabricated, or expired permission. It does not treat that case as an ordinary unguarded
transaction.

The callback always runs. Check `receipt.get()` before repeating the business write. Return the existing receipt or
`receipt.save(result)` after the write. The write and new receipt then commit together. A replacement can return the
saved result after a crash without repeating the write. `getReceipt(ctx.claim, options)` supports checking that result
before reopening source bytes or repeating remote I/O.

A claim check prevents a replaced worker from starting a stale write. It does not replace customer authorization or make
an arbitrary HTTP receiver safe to call twice. Read [recovery](../workflows/04-recovery.md) for lock ordering, receipt
contracts, and remote-request safety.

## Run and maintain this profile

Run `mise run test -- --suite postgres` with `UTILS_TEST_DATABASE_URL` selecting a disposable PostgreSQL database. Run
`mise run test -- --suite containers` for Docker deployment cases. CI uses pinned PostgreSQL 18.3 and Postgres.js 4.0.0. The tests run the same host code in Node and Deno. The deployment tests bundle that code into two Node containers:
one accepts requests and one runs jobs.

The profile supports activities, children, relative/absolute timers, saved events, bounded branches, registered cleanup,
root continuation, finalizers, cancellation and audited blocked repair. Generic custom-host commands and workflow-level
business effects remain outside that durable profile. Retention settings do not currently
delete execution records automatically. Read the [API settings](../workflows/03-policy.md) and
[design boundaries](../workflows/09-design.md) before deploying it. The tests do not establish production failover or
throughput.
