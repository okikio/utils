# Commit a message with a business write

Someone saves a note called “Read later.” The app saves the note in PostgreSQL, then asks another service to send a
notification. What if the app stops between those two calls? The note is there when the person comes back, but no
service knows it still needs to send the notification. Sending first has the opposite problem: the notification could
go out for a note that never gets saved.

A **transactional outbox** lets you save the note and a message asking for the notification in the same transaction.
A transaction makes both writes visible together when it commits. If it rolls back, neither write is saved. A separate
process, called a **dispatcher**, reads the saved messages and delivers them. It can pick up the message even if the
app that saved the note has stopped.

## When the dispatcher stops before marking delivery complete

The dispatcher can still stop after the receiver saves the notification and before the dispatcher marks the message
complete. A replacement cannot tell from the outbox alone whether the receiver finished. After the first reservation
expires, it can try again with the same message key. The receiver uses that key to look up its **receipt**: a saved
record that it already did the work.

```mermaid
flowchart TD
    A["App saves note + outbox message"] --> B["Receiver saves notification + receipt"]
    B --> C["Dispatcher stops before marking complete"]
    C -->|After reservation expires| D["Replacement delivers note:one again"]
    D --> E["Receiver finds receipt and accepts"]
    E --> F["Replacement marks message complete"]
```

The receiver can accept the second delivery without saving another notification because its receipt and notification
were saved in one transaction. If your receiver calls an external API, use the API's own key for recognizing repeat
requests, or check what the external system saved before trying again. The outbox cannot include that call in the
receiver's database transaction.

Use `@okikio/storage/outbox/postgres` to store JSON messages and `@okikio/storage/outbox/effect` to deliver messages
that have a declared format and a trusted decoder. The example below uses both. This adapter is separate from
Workflow's internal delivery tables. Your application supplies the database pool and decides when to run delivery.

## Save and deliver one note

Prepare workspace dependencies as described in the root README. Save the complete
example as `outbox-example.ts`. Point `UTILS_TEST_DATABASE_URL` at a disposable
PostgreSQL database, then run `node outbox-example.ts` from the repository
root. The example installs adapter tables and three example tables. It leaves its
committed rows for inspection, so use a fresh database or a new note key when
repeating it. These are explicit application writes, not import-time work.

The receiver saves its receipt and the notification in one transaction. If the message arrives again, the receipt's
unique key tells the receiver that it already saved the notification. The app saves the original note in a separate
transaction. The outbox cannot make an external system perform an action exactly once.

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

	// Producer: commit the note and its delivery obligation together.
	await database.begin(async (tx) => {
		await tx`insert into example_notes values ('note:one','Read later')`;
		// This emitter borrows tx. Do not retain it after the transaction callback.
		await delivery.emitter(box, tx).emit(ctx, occurrence);
	});

	// Receiver: the receipt and visible consequence either both commit or both roll back.
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

Expect `{ accepted: 1, retried: 0 }` followed by `complete`. When PostgreSQL commits the note, it also saves the
outbox message. When the outbox row says `complete`, the receiver has accepted the message and the dispatcher
has recorded its reply. Other systems that act on that notification may still be working.

## Identity, leases and recovery

While the outbox keeps a message, it identifies it by three values: the namespace, the exact definition ID, and the
key for that occurrence. If you call `append()` again with those values and the same canonical JSON payload, the
call succeeds without adding a row. If the payload differs, the call rejects with `conflict`.

If old handlers cannot read the new payload format, give the new definition its own ID. The dispatcher will not
hand a message to a handler registered for a different ID.

`claim()` reserves up to 100 messages. It gives each reservation a fresh token and counts attempts starting at one.
To acknowledge the message or request a retry, pass the current token before it expires. PostgreSQL supplies the
clock that determines expiry.

`dispatch()` runs the handlers one at a time and does not renew reservations. Set the lease long enough for the
entire batch, including handler calls, scheduling delays, and SQL waits. If you write your own claim loop, call
[`renew(claim, leaseMs)`](#inspect-and-recover-failed-delivery) before the lease expires. If the receiver is still
working after expiry, a replacement can send the same message again. The receiver needs a receipt it saves with the
action, a provider key that prevents a repeat action, or a stronger check that rejects attempts from old workers.

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

The outbox uses the pool and transactions you pass to it. It does not commit your transactions, close the pool,
or start a background process. Opening a view does not issue SQL.

Your application decides when to poll, how many dispatchers run, who may use them, when transactions time out,
and how many namespaces to keep. Use a separate access check for each tenant. If several dispatchers run at once,
do not rely on them to deliver messages about the same business object in order.

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

Call `redrive()` only for a retained `failed` row. Pass the total attempt number you saw when you inspected it.
If another operator has already reopened the message or the attempt number has changed, the call throws
`OutboxError` with code `stale`. Completed, pending, and leased messages cannot be reopened this way.

In one transaction, the outbox grants another `maximumAttempts` tries and records who made the decision, why,
and at what database time in `utils_outbox.repairs`. The attempt counter keeps increasing. The payload and
identity stay the same, and old tokens cannot be used again.

Pruning a finished message also removes its repair history. Export the history before pruning if you need to
keep it longer. Call `history(id, key, { limit, after })` to read up to 1,000 decisions in increasing attempt
order. Use the last attempt number as `after` for the next page. Reading a row does not reopen it or extend its
lease.

If you write your own dispatcher, call `renew(claim, leaseMs)` before the reservation expires. PostgreSQL's
clock decides whether the reservation is still valid. Renewal cannot restore an expired reservation.

If renewal fails, stop sending new work and check what the receiver already did. Another system may still
finish work it already accepted. `dispatch()` has no renewal timer. Set its batch size and lease duration
so one reservation covers the whole batch, or write a claim loop that renews during longer work.

`retry(claim, { delayMs, reason })` stores an application-supplied safe label.
Do not pass secrets, payloads, or raw exceptions. The effect dispatcher records only the stage that failed:
`handler_missing`, `decode_rejected`, `acceptance_unconfirmed`, or `acknowledgement_unconfirmed`.
The label tells you where to look. It cannot tell you whether the receiver performed the action. When
delivery completes, the dispatcher clears the label.

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
