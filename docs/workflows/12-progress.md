# 12 — Observe saved progress

A customer starts an import and sees that 200 rows have been written. The service can restart and still show that
report. The report does not prove that the whole import succeeded. The customer gets completion from the run's terminal
result.

Use `task.ProgressEffect` for standard reports without keys. Declare it on the activity; `workflow.serve()` saves it
automatically. Local Tasks recognize it automatically too. See
[connected consumers](./14-consumers.md#report-progress-without-making-it-the-result) for counters, application data,
child reports, and replay limits.

A progress report is a saved observation, for example `{ completed: 200, total: 1000 }`. A receipt is evidence that a
particular write committed. A terminal result says the run finished, including required cleanup. A display may show
progress while the run is active, but must read the saved run state before announcing success. These records can arrive
at different times, so one should not stand in for another.

## Save an import's progress and read it through a new owner

Import two contact names and save a report only after their database write commits. The same standard report works for
local Task displays and durable workers. It requires no custom effect definition, no authored report key and no worker
`progress` option. The activity still declares `effects: [task.ProgressEffect]` so the host knows it may emit progress.

This complete example uses a disposable PostgreSQL 18.3 database and this checkout's Postgres.js 4.0.0. Migration and the
application table are explicit setup. Prepare dependencies and start the isolated database from the repository root:

```sh
mise run prepare -- --kind deps
docker run --name utils-progress-postgres --rm -d -e POSTGRES_PASSWORD=example -p 55434:5432 postgres:18.3
```

Wait for `docker exec utils-progress-postgres pg_isready -U postgres`. Save the next block as `saved-progress.ts` at the
repository root, then run
`DATABASE_URL=postgres://postgres:example@127.0.0.1:55434/postgres mise exec -- deno run --allow-env --allow-net saved-progress.ts`.
The program writes application data; use only that disposable database.

```ts support=saved-progress.ts
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as resource from '@okikio/capability/resource';
import * as effect from '@okikio/capability/effect';
import * as context from '@okikio/context';
import * as task from '@okikio/task';
import * as schema from '@okikio/schema';
const Local = engine.define({ id: 'import.local' });
const Store = resource.define<postgres.StoreType>()({ id: 'import.store', description: 'Guarded import SQL.' });
const Import = activity.define({
	id: 'contacts.import',
	version: '1',
	input: schema.object({ names: schema.array(schema.string()) }),
	result: schema.number({ integer: true }),
	placement: engine.require(Local),
	resources: [Store],
	effects: [task.ProgressEffect],
});
const Write = activity.implement(Import, {
	async run(ctx) {
		const store = await ctx.get(Store);
		const saved = await store.transaction(
			ctx.claim,
			{ key: 'contacts-v1', input: ctx.input, result: Import.result },
			async (tx, receipt) => {
				const previous = await receipt.get();
				if (previous !== undefined) return previous;
				for (
					const name of ctx.input.names
				) await tx`insert into utils_docs_contacts values (${store.namespace},${name.trim()})`;
				return await receipt.save(ctx.input.names.length);
			},
		);
		await effect.emit(ctx, task.ProgressEffect, {
			completed: saved.value,
			total: ctx.input.names.length,
			unit: 'contacts',
			message: 'Saved batch',
		});
		return saved.value;
	},
});
const Policy = workflow.PolicySchema.parse({
	id: 'contacts.policy',
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
		definition: Import,
		maxAttempts: 3,
		deadlineMs: 20000,
		retry: 'transient',
		delay: { initialMs: 50, maximumMs: 500 },
		recovery: 'retry',
		requires: ['postgres.transactions', 'postgres.receipts', 'effects.progress'],
	}],
	workflows: [],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 60000, resultsMs: 60000, auditMs: 60000 },
});
const url = Deno.env.get('DATABASE_URL');
if (!url) throw new Error('DATABASE_URL must select a disposable PostgreSQL 18.3 database.');
const sql = postgresjs(url, { max: 4, onnotice() {} });
try {
	await postgres.migrate({ database: sql });
	await sql`create table if not exists utils_docs_contacts(namespace text, name text)`;
	let ref: workflow.ReferenceType;
	{
		await using store = postgres.open({ database: sql, namespace: 'docs-contacts-v1', notifications: false });
		const client = workflow.client({ store, policy: Policy });
		ref = await client.trigger(Import, { names: [' Ada ', ' Grace '] }, { scope: 'account-1', key: 'import-one' });
		await using owner = context.create({ id: 'contact-host' });
		await using resources = resource.create(
			resource.implementations(resource.implement(Store, { create: () => store })),
			{ ctx: owner, host: {} },
		);
		await using worker = await workflow.serve({
			store,
			resources,
			engine: Local,
			policies: [Policy],
			activities: [Write],
			workflows: [],
			hostId: 'contact-host',
			shutdown: new AbortController().signal,
			capacity: { activations: 1, activities: 1, finalizers: 1, control: 1 },
			pollIntervalMs: 100,
		});
		using display = client.watch(ref).subscribe({
			next(report) {
				task.ProgressSchema.parse(report.progress);
			},
			error(error) {
				console.error('Progress display stopped', error);
			},
		});
		console.log('Result:', await client.wait(Import, ref, { signal: AbortSignal.timeout(30000) }));
		await worker.drain();
	}
	await using reopened = postgres.open({ database: sql, namespace: 'docs-contacts-v1', notifications: false });
	const snapshot = await workflow.client({ store: reopened, policy: Policy }).get(Import, ref);
	const latest = task.ProgressSchema.parse(snapshot.progress?.[0]?.progress);
	console.log('Reopened progress:', latest.completed, '/', latest.total, latest.unit);
} finally {
	await sql.end();
}
```

Expected application output:

```text
Result: 2
Reopened progress: 2 / 2 contacts
```

`Write` commits the contacts and receipt together, then emits a report. `serve` saves that report under the current
attempt. `watch` feeds a live display; this tiny operation can finish before its next poll, so the example prints the
authoritative result and then reads the retained snapshot through a new owner. It does not depend on receiving every
callback. The SQL pool stays open until worker, resource, store and subscription disposal have joined. Stop the isolated
database with `docker stop utils-progress-postgres`.

If report persistence fails after the write committed, emission rejects. A retry reads the write receipt before
reporting again, preventing a duplicate contact append. A replaced attempt cannot overwrite the new attempt's saved
report. A counter can still move backward on a new attempt; the progress display is not a business checkpoint. This
program reconstructs owners in one process; the recovery suite below separately tests killed workers.

## Customize the report only when the standard shape is insufficient

The remaining excerpts describe custom `Rows` effects and selected worker progress. They are an alternative to the
standard path above, not additional setup for it. The small occurrence example encodes a custom value without starting
any worker.

Declare progress with the same effect contract used by a local Task:

```ts runnable=progress-schema.ts
import * as effect from '@okikio/capability/effect';
import * as schema from '@okikio/schema';

const Rows = effect.define({
	id: 'import.rows',
	value: schema.object({ rows: schema.number({ integer: true, minimum: 0 }) }),
});
const report = await effect.create(Rows, { rows: 200 }, { key: 'rows:200' });
console.log(JSON.stringify(await effect.encode(report)));
```

```text output
{"id":"import.rows","key":"rows:200","value":{"rows":200}}
```

This occurrence carries validated data and a stable key. The worker saves reports emitted by an activity that declares
the same effect:

```ts
const Import = activity.define({
	id: 'import.write',
	version: '1',
	input: InputSchema,
	result: ResultSchema,
	placement: engine.require(Engine),
	resources: [Database],
	effects: [Rows],
});
const Write = activity.implement(Import, {
	async run(ctx) {
		const database = await ctx.get(Database);
		const count = await database.write(ctx.input, { signal: ctx.signal });
		await effect.emit(ctx, Rows, { rows: count }, { key: `rows:${count}` });
		return count;
	},
});
```

The application supplies `InputSchema`, `ResultSchema`, and the database resource. The resource's write and return type
must match this activity's result schema. This fragment shows the progress integration. The
[complete executable fixture](../../tests/workflows/scenarios/events.ts) has all declarations and worker setup without
application dependencies.

Select progress effects explicitly in the worker:

```ts
await using worker = await workflow.serve({
	store,
	policies: [Policy],
	engine: Engine,
	resources,
	activities: [Write],
	workflows: [],
	progress: [Rows],
	hostId: workerId,
	shutdown: shutdown.signal,
	capacity: { activations: 1, activities: 4, finalizers: 1, control: 1 },
});
```

The worker needs the same PostgreSQL migration as event waiting. Readiness rejects a progress binding when the store
cannot save reports. An activity policy can require `effects.progress`. Keep the exact effect definition object in both
the activity declaration and the worker's `progress` list.

The worker routes selected effects to saved progress. All other effects need the worker's `effect` recipient. Missing
recipients fail setup before worker registration. That recipient still owns charges, notifications, or other business
effects. Listing an effect as progress does not also dispatch it to that recipient. If both are required, emit separate
declared effects with separate meanings.

There is one latest saved report per activity job and effect name. PostgreSQL checks that the reporting attempt is still
current. A replaced or expired attempt cannot overwrite the new attempt's report. Reports share the run's history
budget. A failed save rejects emission, so the activity decides whether that failure should stop its work.

Observe reports in the service:

```ts
const ref = await client.submit(Import, input, { scope: accountId, key: requestId });
using subscription = client.watch(ref, { signal: request.signal }).subscribe({
	next(report) {
		console.log(report.job, report.attempt, report.effect.id, report.effect.value);
	},
	error(error) {
		console.error('Progress observation stopped', error);
	},
});
const result = await client.wait(Import, ref, { signal: request.signal });
```

`watch()` returns an Observable from `@okikio/observables`. Each subscription polls saved snapshots. It emits each
changed revision once for that subscription. It includes the latest saved reports when connecting again. It completes
when the physical run is completed, failed, cancelled, blocked, or continued. Supply an error callback for observation
failures. Unsubscribe or abort to stop polling. Neither action cancels the run. Cancel work explicitly through
`client.cancel()`.

This is a snapshot feed. Fast intermediate reports can be skipped. Ordering is per report slot, not a total order across
parallel jobs. `attempt` identifies the attempt that saved a report. A retry can begin again with a lower count. A
parent run's watch reads its own activity jobs by default. Set `{ children: true }` to include child runs. Independently
submitted roots retain separate references and feeds.

If a worker dies after saving a report, that report remains readable. The retry policy still decides whether to retry or
block. A new attempt can replace the snapshot. Progress is not a business checkpoint. To avoid repeating a database
write, save the business checkpoint with the write in the application's transaction. To avoid duplicate external
requests, use the provider's stable request key or an outbox. Saving a progress message alone provides neither
guarantee.

Local Tasks use `progress`, `updates`, and `done` as shown in [Task progress](../task/03-progress.md). A local activity
can instead receive an `effect.observe()` recipient through its existing effect binding. Neither local mechanism
survives process loss. The PostgreSQL worker owns persistence; the Observable only presents what it reads.

The [recovery suite](../../tests/workflows/events.test.ts) kills an activity after its report commits. A fresh client
sees the old count. A replacement worker retries the activity and saves a report with a new attempt number. The suite
also checks that stopping observation does not cancel the activity and that a replaced attempt cannot write another
report.

For elapsed attempt time, report freshness, queued work, worker capacity, and a resumable lifecycle timeline, use the
[PostgreSQL inspector](../postgres/03-inspection.md). Its operational history complements this latest-value progress
feed. It does not turn intermediate progress values into business checkpoints or retain every replaced report body.
