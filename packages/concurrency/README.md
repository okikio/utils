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

## Count the bytes in a group of documents

The local documents below use data URLs so the fetches need no network access. The utility admits at most two requests
and returns their byte counts in document order. The mapper uses ordinary `fetch()` and `Response.arrayBuffer()`; it
forwards the supplied cancellation signal to the fetch that actually does the work.

```ts runnable
import { mapPooledOrdered } from '@okikio/concurrency';
const values = mapPooledOrdered({
	items: ['data:text/plain,first', 'data:text/plain,second', 'data:text/plain,third'],
	concurrency: 2,
	async map(url, { signal }) {
		const response = await fetch(url, { signal });
		if (!response.ok) throw new Error(`Document request failed: ${response.status}`);
		return (await response.arrayBuffer()).byteLength;
	},
});
console.log(JSON.stringify(await Array.fromAsync(values)));
```

Expected output:

```text output
[5,6,5]
```

## Read the mini-demo

`first` contains five bytes, `second` six, and `third` five. `Array.fromAsync()` collects the sequence into the small
array `[5,6,5]`. Replace the local URLs with your document URLs to cap an actual batch of requests. The example proves
the output and admission call shape; it makes no throughput claim. Set `concurrency: 1` to make admission sequential.

`mapPooledOrdered()` returns an `AsyncIterable<R>`, which means a sequence you consume with ordinary `for await`. Your
mapper still returns `Promise<R>`; the utility neither wraps each result nor asks you to learn a new result language.
`Array.fromAsync()` is convenient for small inputs. For a large report, write each yielded value instead of keeping the
whole report in an array.

| Part of the input contract               | Meaning                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `items: Iterable<T> \| AsyncIterable<T>` | An array, generator, or incremental input source.                       |
| `concurrency: number`                    | A positive integer bounding admitted mapper calls.                      |
| `map(item, { signal }): Promise<R>`      | Your usual asynchronous operation, with a signal to forward to its I/O. |
| `signal?: AbortSignal`                   | Optional caller cancellation for the whole batch.                       |

The ordered mapper retains a bounded list of admitted Promises. It waits for the first position, yields that result, and
fills the free position from the source. A later result can be ready while an earlier one is still running. This design
preserves report order without launching every operation at once. The unordered variant delivers completed results
through a bounded channel when order does not matter.

## Fetch several documents with two requests at a time

This is the same `fetch()` and `response.text()` you would use for one document. Only admission and result order change.
The data URLs contain the documents locally, so the example needs no server or network access. Replace them with your
application's HTTP URLs to keep the same call shape.

```ts runnable=fetch-documents.ts
import { mapPooledOrdered } from '@okikio/concurrency';
const documents = ['data:text/plain,first%20document', 'data:text/plain,second%20document'];
for await (
	const text of mapPooledOrdered({
		items: documents,
		concurrency: 2,
		async map(url, { signal }) {
			const response = await fetch(url, { signal });
			if (!response.ok) throw new Error(`Document request failed: ${response.status}`);
			return await response.text();
		},
	})
) {
	console.log(text);
}
```

```text output
first document
second document
```

Forwarding the supplied signal matters: it lets a failed request cancel admitted sibling fetches. This small local
example proves the call shape and output order, not HTTP throughput or a performance gain.

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

If a mapper fails, the operation stops admitting work, cancels admitted siblings, and waits for them to settle before
rejecting with that first failure. The rejected value keeps its original identity, even if it is `undefined`, `null`, a
string, or an object rather than an `Error`. Native cancellation signals supply a default `DOMException` for
`abort(undefined)`; the terminal mapper rejection still retains `undefined`. Pass the signal into cooperative work so
cleanup can finish. A mapper that ignores cancellation and never settles can prevent the batch from settling too.

Ordered mapping also closes its input iterator. If that source cleanup fails, admitted siblings are still joined. A
cleanup failure alone is rethrown unchanged. If both the operation and source cleanup fail, you receive an
`AggregateError` whose `errors` array contains the operation failure first and cleanup failure second; `cause` retains
the operation failure. This keeps both failures available to your logger or error handler.

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

Read the [generated API reference](API.md) for complete mapping and channel contracts.
