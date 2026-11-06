# `@okikio/scheduler/concurrency`

Suppose you have 1,000 pictures to download. Starting all 1,000 requests together can overwhelm a server or your
computer. `@okikio/scheduler/concurrency` lets you work on a few pictures at a time and start the next one when a place
becomes available. You choose whether results arrive in the original order or as soon as they finish.

**Concurrency** means several operations are in progress together. While one download waits for the network, another can
make progress. This package does not create extra CPU threads; use [Worker](../../worker/thread/README.md) for work that
needs a separate Worker runtime.

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

An operation awaiting network input is still active. `await` lets other JavaScript
callbacks run, but does not release its mapper slot, capacity reservation or
resource borrow. Those limits protect different things and end at different
times. Choose separate workers for parallel CPU work; a synchronous loop still
occupies its thread.

## Count the bytes in a group of documents

The local documents below use data URLs so the fetches need no network access. The utility admits at most two requests
and returns their byte counts in document order. The mapper uses ordinary `fetch()` and `Response.arrayBuffer()`; it
forwards the supplied cancellation signal to the fetch that actually does the work.

From the repository root, run `mise run prepare -- --kind deps` once. Save the complete block as the named `.ts` file and run
`mise exec -- deno run count-documents.ts`. These examples use workspace imports; they need no published package or network service.

This checkout uses Deno 2; `Array.fromAsync` collects an asynchronous sequence. The next example shows the same
consumption with `for await`, which can write results incrementally.

```ts runnable=count-documents.ts
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

## Follow ordered results from concurrent work

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
import { mapPooledOrdered } from '@okikio/scheduler/concurrency';
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

- **Check a list of links:** use a [Context](../../context/README.md) to stop the entire check, this package to cap
  active fetches, and [Streams](../../streams/README.md) to write results in batches rather than retain the whole list.
- **Convert many pictures:** use [Pool](../../pool/README.md) to own reusable Worker handles and this package to admit a
  bounded number of conversions. The pool owns handles; each conversion still needs a lease and cancellation wiring.

## Stop admitting documents behind a slow first result

Suppose a report must preserve document order, but its first source is slow. Faster later results must not cause the
whole list to accumulate in memory. `map` requires an explicit item budget. This finite example blocks document 0 until
three calls are admitted, then consumes one result and closes the iterator.

```ts runnable=slow-document.ts
import { map } from '@okikio/scheduler/concurrency';
const releaseFirst = Promise.withResolvers<void>();
const admitted = Promise.withResolvers<void>();
let started = 0, sourceClosed = 0;
async function* documents() {
	try {
		for (let index = 0; index < 100; index++) yield { index, url: 'data:text/plain,first' };
	} finally {
		sourceClosed++;
	}
}
const iterator = map(documents(), async (document, { signal }) => {
	if (++started === 3) admitted.resolve();
	if (document.index === 0) await releaseFirst.promise;
	const response = await fetch(document.url, { signal });
	return (await response.arrayBuffer()).byteLength;
}, { concurrency: 3, maximumBuffered: 3, ordering: 'input' })[Symbol.asyncIterator]();
const first = iterator.next();
await admitted.promise;
console.log('Admitted behind slow first document:', started);
releaseFirst.resolve();
console.log('First bytes:', (await first).value);
await iterator.return?.();
console.log('Total admitted:', started, 'source closed:', sourceClosed);
```

```text output
Admitted behind slow first document: 3
First bytes: 5
Total admitted: 3 source closed: 1
```

The two finished tail results still occupy admitted slots until the consumer advances. Returning the iterator stops
admission, signals admitted work and joins it, then closes the source. This demonstrates an item bound for one deliberate
slow-result case, not a byte bound or a load test. A single result could still be huge. Stream or batch document
bodies, and set a separate byte limit when the application needs one. A source or mapper that ignores cancellation and
never settles can prevent that cleanup from completing.

## Choose ordering and an output memory bound

Start with ordered mapping for reports; use unordered mapping for results that can be consumed as soon as they finish.
Pass cancellation into the actual fetch or provider call. Breaking iteration cancels admitted transforms and joins their
settlement. A concurrency bound limits active work, not the size of a result array; fold or batch large outputs instead
of materializing them all.

If a mapper fails, the operation stops admitting work, cancels admitted siblings, and waits for them to settle before
rejecting with that first failure. The rejected value keeps its original identity, even if it is `undefined`, `null`, a
string, or an object rather than an `Error`. Native cancellation signals supply a default `DOMException` for
`abort(undefined)`; the terminal mapper rejection still retains `undefined`. Pass the signal into cooperative work so
cleanup can finish. A mapper that ignores cancellation and never settles can prevent the batch from settling too.

An input read already in progress must also settle before its iterator can close. A value arriving after cancellation
does not start another mapper. Pass the cancellation signal into the source's own I/O as well when it can wait for
network or storage indefinitely.

Ordered mapping also closes its input iterator. If that source cleanup fails, admitted siblings are still joined. A
cleanup failure alone is rethrown unchanged. If both the operation and source cleanup fail, you receive an
`AggregateError` whose `errors` array contains the operation failure first and cleanup failure second; `cause` retains
the operation failure. This keeps both failures available to your logger or error handler.

For `Channel`, `close()` ends iteration normally after buffered values drain. `close(reason)` fails receiving and
iteration with that exact reason, including `undefined` or a `ChannelClosedError` supplied by another operation. The
first close decides the outcome; later disposal cannot replace it. Errors thrown into the iterator by its consumer
remain consumer errors.

## Choose adjacent capabilities

Use Capacity for an atomic reservation across named resources, Queue for logical ownership, and Worker for CPU work in
another host.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/concurrency.md) explains the model, manual
alternatives, and composition.
