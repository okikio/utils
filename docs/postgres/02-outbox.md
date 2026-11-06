# Commit a message with a business write

A transactional outbox saves a message in the same PostgreSQL transaction as the
business change that requires it. If that transaction rolls back, neither is
visible. After commit, a dispatcher can deliver the message even if the producer
has exited. A delivery may repeat when the sink accepts it but the dispatcher
does not save the acknowledgement.

Use `@okikio/storage/outbox/postgres` for finite JSON messages and
`@okikio/storage/outbox/effect` for declared effects with trusted decoders. This
adapter is separate from Workflow's internal delivery tables. It does not start
workflows, poll automatically, manage hosts or own the application's pool.

For example, saving an order can require notifying another system. Calling that system before SQL commits can notify
it about an order that later rolls back. Calling it only after commit can lose the notification if the producer crashes
between those actions. The outbox closes that gap by committing the order and the message together, then delivering
from the saved message. It does not remove duplicate delivery: the receiver must recognize the same message identity.

## Save and deliver one note

Prepare workspace dependencies as described in the root README. Save the complete
example as `outbox-example.ts`. Point `UTILS_TEST_DATABASE_URL` at a disposable
PostgreSQL database, then run `node outbox-example.ts` from the repository
root. The example installs adapter tables and three example tables. It leaves its
committed rows for inspection, so use a fresh database or a new note key when
repeating it. These are explicit application writes, not import-time work.

The sink records its receipt and consequence in one transaction. Its receipt's
unique key prevents a repeated delivery from writing the consequence twice. The
producer and sink transactions are separate: the outbox cannot make an arbitrary
external effect exactly once.

```ts
import process from 'node:process';
import postgres from 'postgres';
import * as context from '@okikio/context';
import * as effects from '@okikio/capability/effect';
import * as schema from '@okikio/schema';
import * as outbox from '@okikio/storage/outbox/postgres';
import * as delivery from '@okikio/storage/outbox/effect';

const url = process.env.UTILS_TEST_DATABASE_URL;
if (!url) throw new Error('Select a disposable database with UTILS_TEST_DATABASE_URL.');

// The application owns the pool and joins all calls before closing it.
const database = postgres(url, { max: 4, onnotice() {} });
try {
	await outbox.migrate({ database });
	await database`create table if not exists example_notes (id text primary key, title text not null)`;
	await database`create table if not exists example_receipts (
		consumer text, id text, key text, primary key(consumer,id,key))`;
	await database`create table if not exists example_notifications (note text not null)`;

	const Saved = effects.define({
		id: 'example.note.saved.v1',
		value: schema.object({ title: schema.string() }),
	});
	const box = outbox.open({ database, namespace: 'example-notes', maximum: 100 });
	await using ctx = context.create({ id: 'save-note' });
	const occurrence = await effects.create(Saved, { title: 'Read later' }, { key: 'note:one' });

	await database.begin(async (tx) => {
		await tx`insert into example_notes values ('note:one','Read later')`;
		// This emitter borrows tx. Do not retain it after the transaction callback.
		await delivery.emitter(box, tx).emit(ctx, occurrence);
	});

	const notify = effects.implement(Saved, async (_ctx, saved) => {
		await database.begin(async (tx) => {
			const inserted = await tx`insert into example_receipts values ('notify',${Saved.id},${saved.key})
				on conflict do nothing returning key`;
			if (inserted.length) {
				await tx`insert into example_notifications values (${saved.value.title})`;
			}
		});
	});

	// One explicit batch, not a background dispatcher. The handler commits first;
	// only then can dispatch acknowledge its reservation in the outbox.
	console.log(await delivery.dispatch(ctx, box, [notify], { limit: 1 }));
	console.log(await box.inspect(Saved.id, 'note:one'));
} finally {
	await database.end({ timeout: 2 });
}
```

Expected output is `{ accepted: 1, retried: 0 }` followed by `complete`. A committed
business row means message acceptance is durable. A `complete` outbox row means
the selected sink accepted and the dispatcher saved that acknowledgement. It
does not establish that every downstream system finished its work.

## Identity, leases and recovery

A retained message is identified by namespace, exact definition ID and occurrence
key. Repeating `append()` with the same key and canonical JSON payload succeeds
without adding a row. A different payload under that retained identity rejects
with `conflict`. Change the definition ID when the payload contract changes
incompatibly; a handler for a different ID cannot decode it implicitly.

`claim()` reserves up to 100 messages and assigns each a fresh token and one-based
attempt number. Only that token, while unexpired, can acknowledge or retry the
message. Expiry uses database time. `dispatch()` does not renew leases automatically: choose a lease
longer than the entire sequential batch, including handler calls, scheduling and SQL delays. A custom claim loop can
call `renew(claim, leaseMs)` before expiry; the [renewal section](#inspect-and-recover-failed-delivery) explains that ownership.
Even then, a slow sink can overlap redelivery after expiry. The sink needs its
own atomic receipt, provider idempotency key or stronger resource-specific fence.

| Observation | Meaning and next action |
| --- | --- |
| `pending` | Accepted and awaiting a due claim. Call `dispatch()` or implement a bounded claim loop. |
| `leased` | One attempt holds a reservation. After a crash, wait for expiry before reclaiming; stopping the dispatcher does not stop an external sink. |
| `complete` | Sink acceptance was acknowledged. Preserve the row for the required deduplication window. |
| `failed` | Attempts are exhausted. Reconcile the sink and repair the application deliberately; there is no automatic redrive operation. |
| Native SQL/commit error | The outcome may be unknown. Inspect retained state and retry acceptance with the same identity and payload; do not assume rollback. |
| `stale` | The token is expired, replaced or foreign. Do not overwrite the newer reservation. |

The default attempt budget is eight, including attempts that never reached the
sink. Missing handlers, decoding failures and handler failures all consume that
budget. `dispatch().retried` counts calls to retry policy, including those that
reach `failed`; it is not a count of messages that are guaranteed to run again.
Cancellation rejects the dispatch call and leaves its unacknowledged reservations
to expire. The caller must join its handler's real work and cleanup.

## Bounds and ownership

All views of one namespace must agree on policy. The defaults are 10,000 retained
messages, 1 MiB canonical JSON per payload and eight attempts. Terminal rows count
toward capacity. `prune(before, limit)` removes at most 1,000 terminal rows before
an epoch-millisecond cutoff. Pruning ends the outbox's deduplication window and
permits reuse of those identities. Retain sink receipts for at least the whole
possible redelivery window as well.

The outbox borrows the pool and each producer transaction. It never commits a
producer's transaction, closes the pool or acquires an autonomous background
lifetime. Opening a view issues no SQL. Applications own polling cadence,
dispatcher concurrency, authorization, transaction timeouts and total retained
namespace count. A namespace is not tenant access control. Delivery order across
concurrent dispatchers is not an aggregate-ordering guarantee.

## Inspect and recover failed delivery

`inspect(id, key)` retains its small state-only contract. Use `list()` for a
bounded metadata page with attempts, budget baseline, database timestamps and a
safe failure label. It excludes payloads and claim tokens. Each page contains at
most 1,000 entries in byte-ordered `(id, key)` order. Pass `next` as `after` with
the same state filter to continue. This is a live traversal: concurrent inserts
or state changes can enter or leave later pages. It is not a snapshot export.

After fixing the cause and reconciling the sink, an application can explicitly
redrive a failed message. The following function borrows an existing outbox view;
the application must authenticate and authorize the operator before calling it.

```ts
import type { EntryType, Outbox } from '@okikio/storage/outbox/postgres';

/** Reopen one reconciled failure without changing its payload or sink identity. */
async function retryReconciled(
	box: Outbox,
	actor: string,
	reconcile: (entry: EntryType) => Promise<boolean>,
): Promise<boolean> {
	const page = await box.list({ state: 'failed', limit: 1 });
	const entry = page.entries[0];
	if (!entry) return false;

	// The application must check the sink receipt first. A failed delivery does
	// not prove that its effect never committed, so the sink must still deduplicate.
	if (!await reconcile(entry)) return false;
	await box.redrive({
		id: entry.id,
		key: entry.key,
		attempt: entry.attempt,
		actor,
		reason: 'Sink reconciled and missing handler deployed.',
	});
	return true;
}
```

Redrive accepts only a retained `failed` row at the observed lifetime attempt.
A competing or stale decision rejects with `OutboxError` code `stale`. The
transaction records the actor, reason and database time in `utils_outbox.repairs`
and grants another `maximumAttempts` budget. Lifetime attempt numbers never
reset; the payload and logical identity remain unchanged, and all earlier tokens
remain invalid. Completed, pending and leased messages cannot be redriven.
Pruning a terminal message also removes its repair history. Export that history
before pruning if application audit policy requires longer retention.
`history(id, key, { limit, after })` reads at most 1,000 decisions in ascending
attempt order; use the last returned attempt as `after` to continue. Inspection
and audit reads do not authorize redelivery or extend a lease.

For low-level dispatchers, `renew(claim, leaseMs)` extends a current unexpired
reservation using database time. It cannot revive a lost lease. Stop admitting
effects after renewal failure and reconcile the sink; renewal cannot stop a
request already accepted by another system. `dispatch()` does not run a renewal
timer: choose its batch size and lease duration for the whole sequential batch,
or use low-level claims for longer work and explicitly own the renewal loop.

`retry(claim, { delayMs, reason })` stores an application-supplied safe label.
Do not pass secrets, payloads or raw exceptions. Effect dispatch stores only its
safe failure stage (`handler_missing`, `decode_rejected`,
`acceptance_unconfirmed` or `acknowledgement_unconfirmed`). These labels locate
the uncertainty; they do not prove that a sink effect did not occur. Successful
completion clears the label.

Run `migrate()` before deploying this API. Revision 2 adds the budget baseline,
safe failure label and repair table without resetting existing attempts. Drain
older dispatchers before enabling redrive: revision-1 code does not understand
renewed budgets. Applications continue to own credentials, access control,
diagnostic retention and reconciliation with external sinks.

## Verify and measure

Use only a disposable database. The maintained tests cover transaction rollback,
duplicate acceptance, competing claims, payload representation, lease expiry,
exhaustion, missing handlers, cancellation and a transactional sink receipt after
lost acknowledgement. Three cases fork a real process and send `SIGKILL` before
producer commit, after claim commit or after sink commit. Losing the producer
rolls back both writes. A replacement dispatcher claims after lease
expiry and the transactional sink receipt prevents a second business write.
Operator cases check competing redrive, stale decisions, finite renewed budgets,
renewal fencing and metadata pagination against PostgreSQL.

```sh
UTILS_TEST_DATABASE_URL=postgres://fixture:fixture@127.0.0.1:5432/utils_test \
  mise run test -- --suite postgres tests/workflows/outbox.test.ts
UTILS_BENCH_DATABASE_URL=postgres://fixture:fixture@127.0.0.1:5432/utils_test \
  node bench/outbox.bench.ts --check
```

Remove `--check` to measure. Each sample accepts sixteen messages with 4 KiB text
payloads, claims them in batches of one or sixteen, acknowledges every message
and prunes the sample's rows. Migration and pool startup are outside timing;
retention cleanup is inside. The untimed oracle verifies no message remains.
The benchmark removes only its own namespaces, then closes its pool even after
failure. It measures SQL coordination, not sink latency, native host execution,
production capacity or a memory ceiling.

Two additional workloads list sixteen failed metadata records and perform one
inspection/redrive/claim/failure cycle. The cycle includes audit insertion and
fixture audit cleanup in timing, so retained history stays bounded across
samples. The untimed oracle checks the unchanged occurrence identity, cumulative
attempt, new budget and retained safe failure label. It does not model a
production audit-retention policy.
