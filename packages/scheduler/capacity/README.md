# `@okikio/scheduler/capacity`

Imagine a video upload needs one browser session and three upload slots. Starting it with only the browser available can
leave that browser idle while other work waits. `capacity` reserves all the requested slots together, or waits until all
of them are available. A **lease** is the receipt for that reservation; releasing it returns the slots.

The example has two browsers and four upload slots. These numbers show free slots, not running work:

```text
                         browsers    uploads
Before reservation           2          4
Reserve one job             -1         -3
While the lease is held      1          1
After release                2          4
```

Read each row as a moment in one local pool. The pool counts permission to start work; your application still starts and
stops the actual browser and upload. This view omits queued requests and cancellation.

An operation awaiting network input is still active. `await` lets other JavaScript
callbacks run, but does not release its mapper slot, capacity reservation or
resource borrow. Those limits protect different things and end at different
times. Choose separate workers for parallel CPU work; a synchronous loop still
occupies its thread.

Imagine uploading one file as three separate pieces. Each piece uses one upload slot while it is being sent.
This job reserves a browser instance and three upload slots together. The counters do not start those transfers.

## Reserve room for one upload

One upload needs a browser slot and three upload slots together. Inspect the available counts before and after releasing
its lease; both limits return to their initial values.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import * as capacity from '@okikio/scheduler/capacity';
const host = capacity.create({ browsers: 2, uploads: 4 });
const lease = await capacity.acquire(host, { browsers: 1, uploads: 3 });
try {
	console.log(JSON.stringify(capacity.available(host)));
} finally {
	// Release on success or failure so later work can use these counters again.
	lease.release();
}
console.log(JSON.stringify(capacity.available(host)));
```

Expected output:

```text output
{"browsers":1,"uploads":1}
{"browsers":2,"uploads":4}
```

The demo reserves both resources, prints the remaining slots, and releases the lease even if the work fails. The second
line proves the reservation was returned. Try requesting three browsers from this two-browser pool: the request is
impossible and rejects rather than waiting forever.

The inputs and outputs are ordinary objects. The important contract is the reservation between them:

| Call                                    | What you receive                           | What you own                                                     |
| --------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `create({ uploads: 4 })`                | An `Admission` with fixed named limits     | One process-local counter set; it opens no upload connection.    |
| `acquire(host, { uploads: 1 }, signal)` | `Promise<AdmissionLease>`                  | One reservation after the Promise resolves.                      |
| `lease.release()`                       | `void`                                     | Returns that reservation exactly once, including repeated calls. |
| `snapshot(host)`                        | Limits, availability, and `queuedRequests` | A snapshot, not permission to begin work.                        |

Under the hood, `acquire()` validates non-negative integer counts, checks that the request can ever fit, then either
subtracts all requested counts or adds one waiter to a FIFO list. `release()` restores counts and tries the head waiter
again. No browser or upload is started on your behalf. Keeping admission separate lets the same limits protect a
`fetch()`, a database write, or a child process without changing those operations' normal return values.

## Cancel a wait without cancelling the current upload

Here the only upload slot is already reserved. Cancelling the second caller removes its wait; it leaves the first
reservation intact. A native `AbortController` is sufficient, so this path requires no additional utility.

```ts runnable=cancel-wait.ts
import * as capacity from '@okikio/scheduler/capacity';
const uploads = capacity.create({ uploads: 1 });
const first = await capacity.acquire(uploads, { uploads: 1 });
const cancellation = new AbortController();
const stopped = new Error('The user left the upload page.');
const waiting = capacity.acquire(uploads, { uploads: 1 }, cancellation.signal);
cancellation.abort(stopped);
try {
	await waiting;
} catch (error) {
	console.log(error === stopped, capacity.available(uploads).uploads);
} finally {
	first.release();
}
console.log(capacity.available(uploads).uploads);
```

```text output
true 0
1
```

The first line says the cancelled caller received its exact cause and the held slot is still unavailable. The second
line says the first caller returned the slot. To stop an upload already running, pass its cancellation signal into the
actual `fetch()` as well; cancelling admission alone cannot stop external work.

## Release admission before admitting the next caller

- For a bulk file import, use [CSV](../../format/csv/README.md) to read rows and reserve the resources each row needs
  before starting its work. CSV understands the file; capacity controls admission.
- For work that the user can cancel, pass a [Context](../../context/README.md) to `acquire()` and release the resulting
  lease in cleanup. Cancellation can stop the wait; it does not itself close a browser you opened.

Use admission for local concurrency, then add units and constraints to describe relationships such as threads per core.
Reservations are atomic and waiting requests keep FIFO fairness. An impossible request fails before queueing. The caller
must release each lease and cancel waits when it no longer needs work. These counters govern one process; a cluster
needs an authoritative distributed adapter.

## Choose adjacent capabilities

Use Concurrency for callback limits and Queue for item ownership. A capacity reservation neither schedules work nor
makes it durable.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/capacity.md) explains the model, manual
alternatives, and composition.
