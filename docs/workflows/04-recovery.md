# Recover work after a worker stops

A crash removes the worker's memory. It does not remove committed PostgreSQL rows. Recovery must therefore use saved
rows to decide what can run next. Read [the walkthrough](./01-basics.md) before the storage rules on this page.

Three objects play different roles during recovery. The **job** is the accepted request that remains in storage. An
**attempt** is one worker's try at that job. A **lease** is temporary permission for that attempt, renewed while the
worker remains responsible. If permission expires, a new attempt may run. The old worker cannot publish a new result
under its stale claim, but an external effect it already performed still needs a receipt or reconciliation.

## Follow one interrupted import

Suppose Parse saves its first 1,000 rows and then its container dies. The source has 1,005 rows, so the import is
unfinished. The worker did not report a completed Parse result.

1. The batch transaction has already saved both rows and a receipt.
2. The dead worker stops renewing its temporary permission for the job.
3. Another worker's scan finds that permission expired.
4. The database makes the repeat-safe job available again.
5. A compatible worker starts the next attempt with the same logical job ID.
6. Parse reads the existing receipt and skips that batch write.
7. Parse saves the remaining rows and accepts resolution.
8. Resolution preserves the customer's correction and resolves the accounts.

The [container test](../../tests/workflows/containers.test.ts) kills the actual worker at that first committed boundary.
It adds a correction while the worker is absent. It then checks the rows, correction, duplicate command reference, and
Parse attempt count.

## Understand temporary permission

A **claim** is the database's temporary permission for one worker to run one attempt. The worker renews it while work
runs. A **lease** is the time interval for which that permission remains valid without renewal. A **generation** is a
number that changes when the database replaces that permission. A **fence** is the check that rejects a result or write
from an older generation. These names describe internal protection against old workers. They are not extra jobs you
configure.

This protection matters even if the first worker appears dead. For example, its database connection can fail while its
HTTP request keeps running. Another worker can start a replacement attempt after the lease expires. If the first worker
returns later, its old permission must not overwrite the replacement's result. Stopping renewals alone would not prevent
that late write.

The adapter authenticates the claim object it created and checks the current saved state. Copying its fields or
constructing a lookalike does not grant permission. Pass the supplied `ctx.claim` to guarded writes. Do not serialize it
as workflow input or store it for later use. Business authorization still belongs to the application's grant and
revision checks.

## Put the application write and receipt in one transaction

`store.transaction(ctx.claim, options, callback)` checks permission before application SQL. The callback always runs. It
must check `receipt.get()` before repeating the application mutation. It then returns either the existing receipt or
`receipt.save(result)`.

The write key, validated input, and result contract identify the saved write. `contract` defaults to the write key. Use
a new versioned key or contract when the stored result contract changes. A result validator must accept its own stored
output. Avoid a transform that changes the value each time it parses.

The adapter validates the saved result and commits it with the business mutation. A callback cannot return a receipt
from another callback or use receipt methods after its lifetime ends. A plain object with a `value` field is not a
receipt. These restrictions keep a successful return tied to the actual transaction.

`getReceipt(ctx.claim, options)` checks for a committed result before expensive source or remote reads. A missing
receipt does not reserve a write. The later transaction checks permission and the receipt again.

## Keep the lock order

The guarded transaction locks these records in order:

1. The worker registration.
2. The run.
3. The job.
4. The application's business rows.

Cancellation and replacement follow the same ownership checks. This order prevents a replacement or cancellation from
taking ownership halfway through a permitted write. Keep remote calls and CSV parsing outside the transaction. The
adapter sets statement, lock, and transaction timeouts to bound these locks. The current limits are 5 seconds per
statement, 2 seconds per lock wait, and 10 seconds per transaction or idle transaction.

A transaction that acquired valid permission first may commit after its lease time passes while it holds these locks.
Cancellation or replacement waits for that transaction. A later transaction with expired permission cannot start
application writes. Thus expiry prevents a new stale write. It does not roll back a write that already won the lock
order.

Application-owned `postgres.begin()` transactions need their own database timeouts. For writes to existing guarded
records, preserve permission-before-business lock ordering. The adapter serializes guarded writes within one run in this
first profile. This is a correctness choice, not a throughput claim.

## Handle an HTTP result that was lost

A local SQL receipt cannot make a remote receiver's write atomic. The research scenario sends a stable capture key based
on scope and research ID. The receiver stores that key with its capture. A duplicate returns the saved capture and
version. The key remains the same across worker attempts and operator repair.

The container test kills the capture worker after the receiver commits but before the activity saves its result. The
replacement sends the same capture key. The receiver returns one capture, and publication creates one committed
contribution. Later deletion removes raw bytes but keeps the receiver's receipt metadata. A duplicate capture request
therefore cannot recreate expired bytes.

A different provider needs an equivalent duplicate-request contract or an inspection API. If its outcome is uncertain
and repeating it is unsafe, choose `recovery: 'reconcile'`. The run blocks after interruption. An operator must inspect
the provider before requesting another try.

## Read the visible states

| Run state   | Meaning                                                              | Operator or user action                                   |
| ----------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| `ready`     | A workflow can advance                                               | Wait for a compatible worker                              |
| `advancing` | A worker is deciding its next step                                   | Inspect if its permission repeatedly expires              |
| `waiting`   | A job, child, or timer has not finished                              | Check queued work, worker roles, and due time             |
| `settling`  | The intended exit is saved; its finalizer is unfinished              | Keep exit workers available                               |
| `blocked`   | Automatic progress stopped because repeating or continuing is unsafe | Inspect `reason`, resolve the cause, then consider repair |
| `completed` | Successful result and required finalization finished                 | Read the validated value                                  |
| `failed`    | A terminal failure and required finalization finished                | Fix the business cause before accepting a new command     |
| `cancelled` | Cancellation and required finalization finished                      | Reconcile effects already committed if necessary          |

A failed attempt is not necessarily a failed run. A transient failure can consume one attempt and schedule the next. A
missing worker can leave a valid job waiting without producing an activity failure. Use queue age and registration
monitoring to distinguish those cases.

A finalizer is a saved activity, not a JavaScript `finally` block. Its intended exit cannot change after it is proposed.
A finalizer crash repeats only finalization using its receipt. It does not restart source parsing or change a successful
domain result into a different result.

## Decide what an operator may retry

`client.get()` exposes the state, reason, and current recovery `epoch`. A repair must supply that current epoch, an
actor, a reason, and a bounded extra attempt count. The adapter records an audit entry and invalidates old worker
permission. It keeps all logical job and external-write identities.

Repair is appropriate after restoring a missing pinned implementation or resolving an uncertain provider result. It is
not a way to silently replace accepted input, policy, or code version. For `history_limit`, accepted job evidence and
receipts remain stored. Attempt repair cannot enlarge that run's history limit and rejects with `repair_policy`. Inspect
its effects before submitting an explicit new command under a new key and policy.

A code version identifies the workflow program and its expected saved step sequence. Keep the old version available
during a rolling deployment. A new worker leaves old-version work for a live compatible worker. If no compatible worker
exists when missing workflow code is detected, the run blocks with `missing_version`. Restore that version and request
audited repair. Never change a deterministic program under its existing version.

## Keep cancellation separate from undo

Aborting `client.wait()` only stops that caller's observation. `client.cancel()` changes the saved run and asks active
work to stop. Draining a worker stops new attempts in that process and waits for active work. Killing a container ends
that process without running its cleanup. These actions have different purposes.

None of them undoes committed business SQL or guarantees that an in-flight HTTP write was rejected. To withdraw business
permission, first update the application's grant or mapping revision under its domain lock. Then request cancellation
and retry that request after interruption if necessary. Independent child runs and already accepted independent
follow-up work retain their obligations.

The [test map](./07-tests.md) identifies the cases for each crash window, stale worker, cancellation race, and repair.
