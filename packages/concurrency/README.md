# `@okikio/concurrency`

Suppose you have 1,000 pictures to download. Starting all 1,000 requests together can overwhelm a server or your
computer. `@okikio/concurrency` lets you work on a few pictures at a time and start the next one when a place becomes
available. You choose whether results arrive in the original order or as soon as they finish.

**Concurrency** means several operations are in progress together. While one download waits for the network, another can
make progress. This package does not create extra CPU threads; use [Worker](../worker/README.md) for work that needs a
separate Worker runtime.

```text
Input: first, second, third       maximum active operations: 2

admit first + second -> a place becomes available -> admit third
          |                                             |
          +--------------- ordered results -------------+
                         FIRST, SECOND, THIRD
```

Read this as admission order, not a measured timeline. The limiter admits at most two mapper calls at once; ordered
mapping delivers their results in input order even if the second call finishes first. The diagram omits failure cleanup,
which aborts admitted siblings and waits for them to settle.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

## Run a complete example

```ts runnable
import { mapPooledOrdered } from '@okikio/concurrency';
const values = mapPooledOrdered({
	items: ['first', 'second', 'third'],
	concurrency: 2,
	async map(value, { signal }) {
		signal.throwIfAborted();
		return value.toUpperCase();
	},
});
console.log(JSON.stringify(await Array.fromAsync(values)));
```

Expected output:

```text output
["FIRST","SECOND","THIRD"]
```

## Read the mini-demo

The mini-demo gives the limiter three words and two available places. Each mapper turns one word into capitals.
`Array.fromAsync()` consumes the returned sequence and collects the three results, so the printed array preserves
`first`, `second`, `third` order. The mapper checks its cancellation signal before doing work. This tiny transform
teaches ordering; it does not demonstrate a CPU speedup. Try `concurrency: 1` to make admission sequential while keeping
the same output.

Two situations where the pieces fit together:

- **Check a list of links:** use a [Context](../context/README.md) to stop the entire check, this package to cap active
  fetches, and [Streams](../streams/README.md) to write results in batches rather than retain the whole list.
- **Convert many pictures:** use [Pool](../pool/README.md) to own reusable Worker handles and this package to admit a
  bounded number of conversions. The pool owns handles; each conversion still needs a lease and cancellation wiring.

## Build on the example

Start with ordered mapping for reports; use unordered mapping for results that can be consumed as soon as they finish.
Pass cancellation into the actual fetch or provider call. Breaking iteration cancels admitted transforms and joins their
settlement. A concurrency bound limits active work, not the size of a result array; fold or batch large outputs instead
of materializing them all.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/concurrency` runs independent asynchronous operations with a fixed upper bound. It owns admission, sibling
cancellation, early-consumer cleanup, and ordered or completion-order delivery.

Use it when `Promise.all()` is too eager but introducing a durable queue or a worker pool would add the wrong lifecycle.
The package is process-local. It does not persist work, retry failed items, lease jobs, or create Worker threads.

## The ordinary problem

A batch API often starts with `Promise.all()`:

```ts
const results = await Promise.all(
	urls.map(async (url) => await fetch(url).then((response) => response.text())),
);
```

That starts every request at once. For a large input, the caller must add its own semaphore, cancellation propagation,
iterator cleanup, and failure handling. A hand-written limiter also has to decide whether results stay in input order or
are delivered as soon as each operation finishes.

## Use the utility

`mapPooledOrdered()` keeps at most `concurrency` mapper calls active and yields results in input order:

```ts
import * as concurrency from '@okikio/concurrency';

for await (
	const html of concurrency.mapPooledOrdered({
		items: urls,
		concurrency: 8,
		async map(url, { signal }) {
			const response = await fetch(url, { signal });
			return await response.text();
		},
	})
) {
	await save(html);
}
```

If one mapper fails, the utility aborts already-admitted siblings and drains them before it rethrows the first failure.
If the consumer stops early, the utility aborts admitted work and closes the source iterator.

Use `mapPooledUnordered()` when completed work should be handled immediately:

```ts
for await (
	const result of concurrency.mapPooledUnordered({
		items: urls,
		concurrency: 8,
		async map(url, { signal }) {
			return await inspect(url, signal);
		},
	})
) {
	await persist(result);
}
```

Use `runBoundedQueue()` when the operation has side effects and does not produce a value for the consumer.

## Channels

`Channel<T>` is a bounded asynchronous hand-off primitive. A sender waits when the channel is full. A receiver waits
when the channel is empty. Closing the channel settles waiting operations and prevents new sends.

```ts
import { Channel } from '@okikio/concurrency';

await using channel = new Channel<string>({ capacity: 2 });

await channel.send('first');
await channel.send('second');

console.log(await channel.receive()); // first
channel.close();
```

Use a channel for process-local coordination. Use `@okikio/queue` when work must have durable identity, claims, retries,
or completion state.

## Use with other utilities

A request `Context` can supply the cancellation lifetime for a bounded batch:

```ts
import * as concurrency from '@okikio/concurrency';
import * as context from '@okikio/context';

await using ctx = context.create({ id: 'asset-discovery' });

for await (
	const asset of concurrency.mapPooledUnordered({
		items: urls,
		concurrency: 6,
		signal: ctx.signal,
		async map(url, { signal }) {
			context.check(ctx);
			return await discoverAsset(url, signal);
		},
	})
) {
	await store(asset);
}
```

`@okikio/context` owns the operation lifetime. `@okikio/concurrency` owns bounded admission inside that lifetime.
Neither package becomes the owner of the other.

## Convenience and the manual equivalent

| Convenience            | Manual equivalent                                                      | Utility-owned invariant                                |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `runBoundedQueue()`    | semaphore + iterator loop + abort controller + sibling failure cleanup | bounded side-effect execution                          |
| `mapPooledOrdered()`   | bounded scheduler + result slots + failure draining                    | input-order results without unhandled sibling failures |
| `mapPooledUnordered()` | scheduler + completion channel + early-consumer cancellation           | completion-order delivery with bounded admission       |
| `Channel`              | waiter queues + capacity accounting + close/error propagation          | bounded async hand-off                                 |

The package removes concurrency bookkeeping. It does not choose business priority, retry policy, queue durability, or
which operations are safe to run in parallel.

## Source guide

1. `bounded.ts` owns bounded mapping and sibling-cancellation behavior.
2. `channel.ts` owns the bounded hand-off state machine.
3. `*.test.ts` files cover failure, cancellation, early consumer exit, ordering, capacity, and acknowledgement behavior.
