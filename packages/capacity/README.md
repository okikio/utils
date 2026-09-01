`@okikio/capacity`
=================

Purpose
-------

`@okikio/capacity` describes measurable capacity and owns small, process-local
admission pools. It does not own durable jobs, retries, claims, or remote queue
leases. Those remain `@okikio/queue` responsibilities.

The package has two related surfaces:

- `unit()`, `field()`, `define()`, `compose()`, `constraint()`, `check()`, and
  `assert()` describe and validate capacity relationships through Standard Schema.
- `create()`, `acquire()`, `available()`, and `snapshot()` reserve named integer
  limits atomically with FIFO fairness and cancellation.

Import the package as a namespace:

```ts
import * as capacity from '@okikio/capacity';
```

Start here
----------

A schema validates one value. A unit explains what the value measures. A
constraint explains how several validated values relate.

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

`assert()` runs the same validation and throws `CapacityExceededError` only when
one or more relationships are exceeded. Schema failures remain schema failures.

Atomic admission
----------------

```ts
const work = capacity.create({ browserContexts: 4, uploadParts: 8 });

await using lease = await capacity.acquire(work, {
  browserContexts: 1,
  uploadParts: 2,
}, ctx);
```

A request receives all named units or none of them. Waiting requests are FIFO.
A later request cannot skip a blocked head request. Cancellation removes the
waiter without consuming capacity. `lease.release()` is idempotent and async
disposal releases the same reservation.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `capacity.check()` / `capacity.assert()` | read all capacity fields, execute each constraint, collect violations, and decide whether to throw | one deterministic constraint report |
| `capacity.create()` + `acquire()` | maintain counters, FIFO waiters, abort listeners, impossible-request checks, and release bookkeeping | a reusable admission semaphore with explicit leases |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/capacity` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with counters, a FIFO waiter list, and AbortSignal listeners.

The utility adds atomic multi-name admission, fairness, cancellation cleanup, and disposable leases.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
