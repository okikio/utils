# `@okikio/capacity`

Reserve several scarce resources together. Separate counters can admit half of a request and leave work holding a
browser while it waits forever for an upload slot.

## Run a complete example

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

## Build on the example

Use admission for local concurrency, then add units and constraints to describe relationships such as threads per core.
Reservations are atomic and waiting requests keep FIFO fairness. An impossible request fails before queueing. The caller
must release each lease and cancel waits when it no longer needs work. These counters govern one process; a cluster
needs an authoritative distributed adapter.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

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

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.

## Validator interoperability

Capacity authoring accepts Standard Schema contracts directly. The package does not expose Zod- or Valibot-named aliases
because those aliases did not add distinct behavior. Use the same capacity API with any Standard Schema implementation.
