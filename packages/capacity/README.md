# `@okikio/capacity`

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

## Reserve room for one upload

```ts runnable
import * as capacity from '@okikio/capacity';
const host = capacity.create({ browsers: 2, uploads: 4 });
const lease = await capacity.acquire(host, { browsers: 1, uploads: 3 });
try {
	console.log(JSON.stringify(capacity.available(host)));
} finally {
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
import * as capacity from '@okikio/capacity';
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

## Build on the example

- For a bulk file import, use [CSV](../csv/README.md) to read rows and reserve the resources each row needs before
  starting its work. CSV understands the file; capacity controls admission.
- For work that the user can cancel, pass a [Context](../context/README.md) to `acquire()` and release the resulting
  lease in cleanup. Cancellation can stop the wait; it does not itself close a browser you opened.

Use admission for local concurrency, then add units and constraints to describe relationships such as threads per core.
Reservations are atomic and waiting requests keep FIFO fairness. An impossible request fails before queueing. The caller
must release each lease and cancel waits when it no longer needs work. These counters govern one process; a cluster
needs an authoritative distributed adapter.

## Purpose

`@okikio/capacity` describes measurable capacity and owns small, process-local admission pools. It does not own durable
jobs, retries, claims, or remote queue leases. Those remain `@okikio/queue` responsibilities.

The package has two related surfaces:

- `unit()`, `field()`, `define()`, `compose()`, `constraint()`, `check()`, and `assert()` describe and validate capacity
  relationships through Standard Schema.
- `create()`, `acquire()`, `available()`, and `snapshot()` reserve named integer limits atomically with FIFO fairness
  and cancellation.

Import the package as a namespace:

```ts
import * as capacity from '@okikio/capacity';
```

## Start here

A schema validates one value. A unit explains what the value measures. A constraint explains how several validated
values relate.

```ts
import * as capacity from '@okikio/capacity';
import * as z from 'zod';

const count = capacity.unit('count', {
	description: 'A discrete number of items.',
	symbol: 'items',
});

const Count = capacity.field(z.number().int().nonnegative(), count, {
	description: 'A non-negative item count.',
});

type Host = Readonly<{ cores: number; threads: number; threadsPerCore: number }>;
const ThreadsPerCore = capacity.constraint<Host, typeof count>({
	id: 'threads-per-core',
	description: 'Threads must fit the host core topology.',
	unit: count,
	used: (host) => host.threads,
	maximum: (host) => host.cores * host.threadsPerCore,
});

const HostCapacity = capacity.define({
	cores: Count,
	threads: Count,
	threadsPerCore: Count,
}, { constraints: [ThreadsPerCore] });

const result = await capacity.check(HostCapacity, {
	cores: 4,
	threads: 8,
	threadsPerCore: 2,
});
// result.status === 'hit'
```

`assert()` runs the same validation and throws `CapacityExceededError` only when one or more relationships are exceeded.
Schema failures remain schema failures.

## Atomic admission

```ts
const work = capacity.create({ browserContexts: 4, uploadParts: 8 });

await using lease = await capacity.acquire(work, {
	browserContexts: 1,
	uploadParts: 2,
}, ctx);
```

A request receives all named units or none of them. Waiting requests are FIFO. A later request cannot skip a blocked
head request. Cancellation removes the waiter without consuming capacity. `lease.release()` is idempotent and async
disposal releases the same reservation.

## Convenience and the manual equivalent

| Convenience                              | Manual equivalent                                                                                    | Concrete value                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `capacity.check()` / `capacity.assert()` | read all capacity fields, execute each constraint, collect violations, and decide whether to throw   | one deterministic constraint report                 |
| `capacity.create()` + `acquire()`        | maintain counters, FIFO waiters, abort listeners, impossible-request checks, and release bookkeeping | a reusable admission semaphore with explicit leases |

`@okikio/capacity` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with counters, a
FIFO waiter list, and AbortSignal listeners.

The utility adds atomic multi-name admission, fairness, cancellation cleanup, and disposable leases.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

Read the [generated API reference](API.md) for the complete exported contracts and field descriptions.

## Validator interoperability

Capacity authoring accepts Standard Schema contracts directly. The package does not expose Zod- or Valibot-named aliases
because those aliases did not add distinct behavior. Use the same capacity API with any Standard Schema implementation.
