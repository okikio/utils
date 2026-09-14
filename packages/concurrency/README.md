`@okikio/concurrency`
=====================

Purpose
-------

`@okikio/concurrency` runs independent asynchronous operations with a fixed
upper bound. It owns admission, sibling cancellation, early-consumer cleanup,
and ordered or completion-order delivery.

Use it when `Promise.all()` is too eager but introducing a durable queue or a
worker pool would add the wrong lifecycle. The package is process-local. It does
not persist work, retry failed items, lease jobs, or create Worker threads.

The ordinary problem
--------------------

A batch API often starts with `Promise.all()`:

```ts
const results = await Promise.all(
  urls.map(async (url) => await fetch(url).then((response) => response.text())),
);
```

That starts every request at once. For a large input, the caller must add its
own semaphore, cancellation propagation, iterator cleanup, and failure handling.
A hand-written limiter also has to decide whether results stay in input order or
are delivered as soon as each operation finishes.

Use the utility
---------------

`mapPooledOrdered()` keeps at most `concurrency` mapper calls active and yields
results in input order:

```ts
import * as concurrency from '@okikio/concurrency';

for await (const html of concurrency.mapPooledOrdered({
  items: urls,
  concurrency: 8,
  async map(url, { signal }) {
    const response = await fetch(url, { signal });
    return await response.text();
  },
})) {
  await save(html);
}
```

If one mapper fails, the utility aborts already-admitted siblings and drains
them before it rethrows the first failure. If the consumer stops early, the
utility aborts admitted work and closes the source iterator.

Use `mapPooledUnordered()` when completed work should be handled immediately:

```ts
for await (const result of concurrency.mapPooledUnordered({
  items: urls,
  concurrency: 8,
  async map(url, { signal }) {
    return await inspect(url, signal);
  },
})) {
  await persist(result);
}
```

Use `runBoundedQueue()` when the operation has side effects and does not produce
a value for the consumer.

Channels
--------

`Channel<T>` is a bounded asynchronous hand-off primitive. A sender waits when
the channel is full. A receiver waits when the channel is empty. Closing the
channel settles waiting operations and prevents new sends.

```ts
import { Channel } from '@okikio/concurrency';

await using channel = new Channel<string>({ capacity: 2 });

await channel.send('first');
await channel.send('second');

console.log(await channel.receive()); // first
channel.close();
```

Use a channel for process-local coordination. Use `@okikio/queue` when work must
have durable identity, claims, retries, or completion state.

Use with other utilities
------------------------

A request `Context` can supply the cancellation lifetime for a bounded batch:

```ts
import * as concurrency from '@okikio/concurrency';
import * as context from '@okikio/context';

await using ctx = context.create({ id: 'asset-discovery' });

for await (const asset of concurrency.mapPooledUnordered({
  items: urls,
  concurrency: 6,
  signal: ctx.signal,
  async map(url, { signal }) {
    context.check(ctx);
    return await discoverAsset(url, signal);
  },
})) {
  await store(asset);
}
```

`@okikio/context` owns the operation lifetime. `@okikio/concurrency` owns bounded
admission inside that lifetime. Neither package becomes the owner of the other.

Convenience and the manual equivalent
-------------------------------------

| Convenience | Manual equivalent | Utility-owned invariant |
| --- | --- | --- |
| `runBoundedQueue()` | semaphore + iterator loop + abort controller + sibling failure cleanup | bounded side-effect execution |
| `mapPooledOrdered()` | bounded scheduler + result slots + failure draining | input-order results without unhandled sibling failures |
| `mapPooledUnordered()` | scheduler + completion channel + early-consumer cancellation | completion-order delivery with bounded admission |
| `Channel` | waiter queues + capacity accounting + close/error propagation | bounded async hand-off |

The package removes concurrency bookkeeping. It does not choose business
priority, retry policy, queue durability, or which operations are safe to run in
parallel.

Source guide
------------

1. `bounded.ts` owns bounded mapping and sibling-cancellation behavior.
2. `channel.ts` owns the bounded hand-off state machine.
3. `*.test.ts` files cover failure, cancellation, early consumer exit, ordering,
   capacity, and acknowledgement behavior.
