# `@okikio/streams`

A download may contain millions of lines. Reading it all into one array before doing useful work can run out of memory.
`@okikio/streams` lets you consume pieces as they arrive, split byte chunks into complete lines, and group records into
limited batches. You can start saving results before the whole input arrives.

A **stream** delivers data incrementally. A **batch** is one bounded group. **Materializing** means collecting the
entire result in memory. `collect()` accepts optional limits; omitting them leaves collection unbounded, so supply
limits when the size of the source is unknown.

```text
Values: a, b, c -> batch(maximumItems: 2) -> [a, b] -> [c]

Byte chunks -> carry partial UTF-8 text / line -> complete lines -> consumer
                     enforce maximumLineBytes
```

The first row shows grouping; the second shows framing text that may span chunks. Neither promises that the consumer
stores nothing: collecting every batch or line still retains the full output. Incremental consumption is the useful path
for large inputs.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

## Run a complete example

```ts runnable
import * as streams from '@okikio/streams';
const batches = streams.batch(['a', 'b', 'c'], { maximumItems: 2 });
console.log(JSON.stringify(await Array.fromAsync(batches)));
const bytes = new Response(`first
second
`).body!;
console.log(JSON.stringify(await Array.fromAsync(streams.lines(bytes, { maximumLineBytes: 64 }))));
```

Expected output:

```text output
[["a","b"],["c"]]
["first","second"]
```

`batch()` returns an async iterable of readonly item arrays; `lines()` returns an async iterable of strings.
`Array.fromAsync()` returns a Promise of a materialized array. The example deliberately collects small finite inputs;
its output has two groups and two lines. Streaming adapters release owned readers when iteration completes or stops.

## Read the mini-demo

The demo first groups three letters into a pair and a final single-letter batch. It then reads a small response body and
returns two text lines without their line-ending characters. Both sequences are collected only so their complete output
can be printed. Try a batch size of `1` to see three groups, or lower `maximumLineBytes` below the length of a line to
see the byte limit reject that line rather than silently truncate it.

- **Import a large CSV:** consume [CSV](../csv/README.md) rows incrementally, use batches for database writes, and use a
  [Context](../context/README.md) cancellation signal throughout. The database adapter still owns commit behavior.
- **Read records from a converter:** let [Process](../process/README.md) own the child and use `lines()` for its byte
  output. Add [Concurrency](../concurrency/README.md) only where independent downstream work can safely overlap.

## Build on the example

Batch for database writes, fold streams without collecting, and use bounded collect() only when a finite materialized
result is needed. Pass cancellation into the source operation as well as the adapter. Early iteration exit cancels owned
Web streams unless preventCancel explicitly keeps borrowed ownership. Byte estimates for object batches are caller
policy; line framing counts actual encoded bytes.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/streams` contains project-neutral adapters between Web Streams and iterables. It also owns bounded collection,
batching, and UTF-8 line framing.

The package preserves streaming and cancellation unless the caller explicitly chooses materialization through
`collect()`.

## Start here

- `readable()` adapts an iterable to `ReadableStream`.
- `iterable()` adapts a `ReadableStream` to an async iterable and cancels the source when the consumer stops early
  unless `preventCancel` is set.
- `lines()` frames a byte stream into UTF-8 lines. It handles UTF-8 sequences split across chunks, removes CR before LF,
  returns the final unterminated line, and can enforce `maximumLineBytes`.
- `pipe()` sends iterable values to a `WritableStream` with native pressure and cancellation behavior.
- `batch()` emits bounded immutable groups without materializing the full source.
- `collect()` materializes a source and enforces any supplied item and byte limits. Without limits, it can retain an
  arbitrarily large result; it cannot make an infinite source finish.

```ts
import * as streams from '@okikio/streams';

const response = await fetch('https://service.invalid/events');
if (response.body === null) throw new Error('Response has no body.');

for await (
	const line of streams.lines(response.body, {
		maximumLineBytes: 64 * 1024,
	})
) {
	consume(line);
}
```

`lines()` counts UTF-8 bytes before decoding. This makes the limit meaningful for process IPC even when one character
spans several byte chunks.

## Batch without materializing the source

```ts
async function* values() {
	for (let value = 0; value < 10_000; value++) yield value;
}

for await (const group of streams.batch(values(), { maximumItems: 100 })) {
	await writeGroup(group);
}
```

`batch()` retains only the current bounded group. At least one of `maximumItems` or `maximumBytes` is required. When
byte limits matter, provide a `size(value)` function so the utility can enforce the same unit you care about.

```ts
for await (
	const group of streams.batch(records(), {
		maximumItems: 500,
		maximumBytes: 4 * 1024 * 1024,
		size: (record) => new TextEncoder().encode(JSON.stringify(record)).byteLength,
		signal,
	})
) {
	await upload(group, signal);
}
```

Use `collect()` only when the caller intentionally wants a finite source in memory and can supply explicit limits. The
manual equivalent is an ordinary `for await` loop that tracks the same counters before retaining each value.

## Ownership

This package does not own process lifecycle, retries, persistence, durable jobs, or domain-specific codecs.
`@okikio/process` owns child process lifecycle. `@okikio/queue` owns claimed work. Product-specific durable
representations belong in product packages.

## Convenience and the manual equivalent

| Convenience                           | Manual equivalent                                                                                                       | Concrete value                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `streams.lines()`                     | read chunks, incrementally decode UTF-8, carry partial lines, enforce byte/line bounds, and release the reader yourself | correct line framing across arbitrary chunk splits     |
| `batch()` / `map()` / bounded helpers | write async-iterator loops with explicit buffers, concurrency, cancellation, and cleanup every time                     | small composable streaming mechanics with backpressure |

`@okikio/streams` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with ReadableStream
readers, async iterators, TextDecoder, and explicit byte counters.

The utility centralizes cancellation, line framing, bounded collection, batching, and conversion rules that are easy to
get subtly wrong.

## Bound failures

`StreamLimitError` reports a byte/item collection bound being exceeded. `StreamLineLimitError` reports one decoded line
exceeding the configured line limit. Both errors carry the relevant configured limit so a caller can produce a useful
diagnostic without inspecting stream internals.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.
