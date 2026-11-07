# Bound active work without collecting every input

A report needs to fetch hundreds of documents. Starting every request with `Promise.all()` can overwhelm its provider,
while fetching them one at a time wastes the available capacity. A bounded mapper keeps only the chosen number of
callbacks active and starts the next input when a slot becomes free.

Choose input order when callers need positional results. Choose completion order when slow items must not hold back
finished work. Bounding concurrency does not bound the size of each result.

An operation awaiting network input is still active. `await` lets other JavaScript
callbacks run, but does not release its mapper slot, capacity reservation or
resource borrow. Those limits protect different things and end at different
times. Choose separate workers for parallel CPU work; a synchronous loop still
occupies its thread.

## Fetch a group with two active requests

Each document request is independent, so two can run at once. The mapper returns results in input order; the final byte
count comes from reading every response, rather than counting requests that merely started.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `example.ts` at the checkout root and use
`mise exec -- deno run example.ts`.

```ts runnable
import { mapPooledOrdered } from '@okikio/scheduler/concurrency';
const values = mapPooledOrdered({
	items: ['data:text/plain,first', 'data:text/plain,second', 'data:text/plain,third'],
	concurrency: 2,
	/** Forward mapper cancellation to I/O so early consumer exit can stop outstanding reads. */
	async map(url, { signal }) {
		const response = await fetch(url, { signal });
		if (!response.ok) throw new Error(`Document request failed: ${response.status}`);
		return (await response.arrayBuffer()).byteLength;
	},
});
// Collect only this small finite example; a large consumer can instead process each yielded value.
console.log(JSON.stringify(await Array.fromAsync(values)));
```

Expected output:

```text output
[5,6,5]
```

The byte counts show the input order. To see what happens when one request takes longer, hold `first` until the
other two finish. The consumer still receives `first`, `second`, `third`:

```ts runnable=ordered-tasks.ts
import { mapPooledOrdered } from '@okikio/scheduler/concurrency';

const releaseFirst = Promise.withResolvers<void>();
const tailsFinished = Promise.withResolvers<void>();
const completed: string[] = [];

// Collecting starts iteration. All three calls fit, but the first cannot finish yet.
const delivered = Array.fromAsync(mapPooledOrdered({
	items: ['first', 'second', 'third'],
	concurrency: 3,
	async map(name) {
		if (name === 'first') {
			await releaseFirst.promise;
		}
		completed.push(name);
		if (completed.length === 2) {
			tailsFinished.resolve();
		}
		return name;
	},
}));

await tailsFinished.promise;
releaseFirst.resolve();
const results = await delivered;
console.log('Finished:', completed.join(', '));
console.log('Delivered:', results.join(', '));
```

```text output
Finished: second, third, first
Delivered: first, second, third
```

| What is ordered? | This example's order | Why it differs |
| --- | --- | --- |
| Admission | first, second, third | Input supplies the next task while a slot is available. |
| Completion | second, third, first | The explicit gate holds only the first task. |
| Delivery | first, second, third | Ordered mapping waits for the earliest input position. |

This example controls when `first` finishes, so it does not measure network speed. The mapper keeps the other two
results in memory until it can give them to the consumer. If order does not matter, choose completion order to read
each result sooner. In either case, decide how many results your program should keep.

## Choose the result order and work limit

`@okikio/scheduler/concurrency` starts up to the number of operations you choose. You can read results in input
order or as each operation finishes. If one operation fails or you stop reading early, the utility asks the
remaining operations to stop.

Use it to limit work in one process. It does not save jobs for later, retry failures, assign queue leases, or
create Worker threads.

## The ordinary problem

A batch API often starts with `Promise.all()`:

```ts
const results = await Promise.all(
	urls.map(async (url) => await fetch(url).then((response) => response.text())),
);
```

That starts every request at once. If you limit the requests yourself, keep track of how many are active.
Also decide what to do when one request fails or when the consumer stops reading. If the input is an iterator,
close it when you stop. Choose whether the reader gets results in input order or as they finish.

## Run bounded work with explicit cancellation

`mapPooledOrdered()` keeps at most `concurrency` mapper calls active and yields results in input order:

```ts
import * as concurrency from '@okikio/scheduler/concurrency';

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

If one call fails, the utility signals the other active calls to stop. It waits for them to settle before throwing
the first failure. If you stop reading early, it also closes the input iterator.

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

Use `Channel<T>` to pass values from one part of your program to another. A sender waits when the channel is full.
A receiver waits when the channel is empty. Closing the channel settles waiting calls and prevents new sends.

```ts
import { Channel } from '@okikio/scheduler/concurrency';

await using channel = new Channel<string>({ capacity: 2 });

await channel.send('first');
await channel.send('second');

console.log(await channel.receive()); // first
channel.close();
```

Use a channel for process-local coordination. Use `@okikio/scheduler/queue` when work must have durable identity,
claims, retries, or completion state.

## Use with other utilities

A request `Context` can supply the cancellation lifetime for a bounded batch:

```ts
import * as concurrency from '@okikio/scheduler/concurrency';
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

Context decides when the operation ends and signals cancellation. Concurrency uses that signal to stop its
own batch. Limiting the batch does not change when the Context ends.

## Decide which bookkeeping to keep in your application

| Convenience            | Manual equivalent                                                      | Utility-owned invariant                                |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `runBoundedQueue()`    | semaphore + iterator loop + abort controller + sibling failure cleanup | bounded side-effect execution                          |
| `mapPooledOrdered()`   | bounded scheduler + result slots + failure draining                    | input-order results without unhandled sibling failures |
| `mapPooledUnordered()` | scheduler + completion channel + early-consumer cancellation           | completion-order delivery with bounded admission       |
| `Channel`              | waiter queues + capacity accounting + close/error propagation          | bounded async hand-off                                 |

The package removes concurrency bookkeeping. It does not choose business priority, retry policy, queue durability, or
which operations are safe to run in parallel.

## Source guide

The paths below are relative to the [package directory](../packages/scheduler/concurrency).

1. `bounded.ts` owns bounded mapping and sibling-cancellation behavior.
2. `channel.ts` owns the bounded hand-off state machine.
3. `*.test.ts` files cover failure, cancellation, early consumer exit, ordering, capacity, and acknowledgement behavior.

Read the [public source](../packages/scheduler/concurrency/mod.ts) for complete mapping and channel contracts.
