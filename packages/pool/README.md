`@okikio/pool`
=============

Purpose
-------

`@okikio/pool` owns a bounded set of reusable values and lends them through
explicit disposable leases.

Use it for resources that are expensive to create but safe to reuse, such as
connections or host-specific runtime objects.  A domain package should still
name the actual resource it pools.  For example, a browser package can build a
`BrowserProcessPool` on top of this generic primitive.


How it fits
-----------

`@okikio/context` supplies cancellation, deadlines, identity, and time.
`@okikio/pool` uses that context while values wait, are created, are checked, and
are returned.

The package does not know how to create a browser, database connection, or
provider client.  The caller supplies `create`, `check`, and `close` behavior.


Ownership and admission
-----------------------

The pool enforces minimum and maximum size, optional idle limits, idle age, and
acquisition timeout.  Acquisition is FIFO when callers must wait.

A lease owns one borrowed value until disposal.  Returning the lease either
puts a healthy value back in the idle set or closes an invalid value.

Cancellation is checked while a value is being created.  If creation finishes
after the caller has cancelled, the pool closes that value instead of leaking
it.

Draining stops new acquisition, waits for active leases, and closes retained
values.  Close failures are collected without leaving waiters asleep forever.


Start here
----------

```ts
import * as pool from '@okikio/pool';

await using pool = await pool.create({
  ctx,
  maximum: 8,
  create: createConnection,
  close: closeConnection,
});

await using lease = await pool.acquire(ctx);
await useConnection(lease.value);
```

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.


Drain is a lifecycle barrier
---------------------------

`drain()` does not mean "the idle array is empty." It is a lifecycle barrier.
It resolves only after every pool-owned transition that can still create, lease,
inspect, reject, or close a value has settled. In particular, drain waits for:

- leased values;
- in-flight creation;
- a creation that resolves after drain starts and must be rejected/closed;
- asynchronous health checks that started during release;
- rejection cleanup and provider `close()` calls.

This rule is what makes process shutdown safe.


Larger example
--------------

```ts
await using clients = await pool.create({
  ctx,
  minimum: 2,
  maximum: 8,
  maximumIdle: 4,
  maximumIdleAge: { minutes: 5 },
  acquireTimeout: { seconds: 2 },
  create: (createCtx) => connectClient(createCtx.signal),
  check: (client) => client.ping(),
  close: (client, reason) => client.close(reason),
});

await using lease = await clients.acquire(ctx);
try {
  await lease.value.request(request);
} catch (error) {
  lease.invalidate(error);
  throw error;
}

await clients.maintain();
```

If you implemented this manually, you would need idle and leased collections,
capacity counters, FIFO waiters, abort listener cleanup, health checks, timeout
logic, and shutdown fencing. The pool keeps those mechanics generic; the caller
still owns the meaning of `connectClient`, `ping`, and `close`.

Ownership diagram
-----------------

~~~~ text
Pool
  | owns
  +--> idle value
  +--> idle value
  +--> leased value ---- Lease ----> caller borrows
  |                         |
  |                         `-- dispose -> return or close
  |
  `-- drain()
       +--> reject waiters
       +--> close idle values
       +--> wait for leases
       `--> finish disposal
~~~~

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `pool.create()` + `acquire()` | track idle/leased/creating values, FIFO waiters, limits, abort/timeouts, provider create/health/close, and releases manually | resource reuse without losing ownership state |
| `pool.drain()` | wait for leases, creations, health checks, rejection cleanup, and close operations before resolving | shutdown cannot finish while pool-owned transitions remain |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/pool` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with arrays for idle values, a Map for leases, counters for creation, FIFO waiters, AbortSignal cleanup, health checks, and explicit close calls.

The utility exists because the difficult part is not storing reusable values. It is keeping ownership correct during cancellation, creation, release, drain, and cleanup races.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Expected acquisition failures
-----------------------------

Two errors are deliberately part of normal pool control flow:

- `PoolAcquireTimeoutError` means an acquisition waited longer than its caller-selected timeout.
- `PoolUnavailableError` means the pool cannot supply another value under its current/closing state.

Both are preferable to silently exceeding the configured maximum.


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
