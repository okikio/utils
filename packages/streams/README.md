`@okikio/streams`
================

Purpose
-------

`@okikio/streams` contains project-neutral adapters between Web Streams and
iterables. It also owns bounded collection, batching, and UTF-8 line framing.

The package preserves streaming and cancellation unless the caller explicitly
chooses materialization through `collect()`.

Start here
----------

- `readable()` adapts an iterable to `ReadableStream`.
- `iterable()` adapts a `ReadableStream` to an async iterable and cancels the
  source when the consumer stops early unless `preventCancel` is set.
- `lines()` frames a byte stream into UTF-8 lines. It handles UTF-8 sequences
  split across chunks, removes CR before LF, returns the final unterminated
  line, and can enforce `maximumLineBytes`.
- `pipe()` sends iterable values to a `WritableStream` with native pressure and
  cancellation behavior.
- `batch()` emits bounded immutable groups without materializing the full source.
- `collect()` materializes a finite source only within explicit item and byte
  limits.

```ts
import * as streams from '@okikio/streams';

const response = await fetch('https://service.invalid/events');
if (response.body === null) throw new Error('Response has no body.');

for await (const line of streams.lines(response.body, {
  maximumLineBytes: 64 * 1024,
})) {
  consume(line);
}
```

`lines()` counts UTF-8 bytes before decoding. This makes the limit meaningful for
process IPC even when one character spans several byte chunks.

Batch without materializing the source
--------------------------------------

```ts
async function* values() {
  for (let value = 0; value < 10_000; value++) yield value;
}

for await (const group of streams.batch(values(), { maximumItems: 100 })) {
  await writeGroup(group);
}
```

`batch()` retains only the current bounded group. At least one of
`maximumItems` or `maximumBytes` is required. When byte limits matter, provide a
`size(value)` function so the utility can enforce the same unit you care about.

```ts
for await (const group of streams.batch(records(), {
  maximumItems: 500,
  maximumBytes: 4 * 1024 * 1024,
  size: (record) => new TextEncoder().encode(JSON.stringify(record)).byteLength,
  signal,
})) {
  await upload(group, signal);
}
```

Use `collect()` only when the caller intentionally wants a finite source in
memory and can supply explicit limits. The manual equivalent is an ordinary
`for await` loop that tracks the same counters before retaining each value.

Ownership
---------

This package does not own process lifecycle, retries, persistence, durable jobs,
or domain-specific codecs. `@okikio/process` owns child process lifecycle.
`@okikio/queue` owns claimed work. Product-specific durable representations belong
in product packages.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `streams.lines()` | read chunks, incrementally decode UTF-8, carry partial lines, enforce byte/line bounds, and release the reader yourself | correct line framing across arbitrary chunk boundaries |
| `batch()` / `map()` / bounded helpers | write async-iterator loops with explicit buffers, concurrency, cancellation, and cleanup every time | small composable streaming mechanics with backpressure |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/streams` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with ReadableStream readers, async iterators, TextDecoder, and explicit byte counters.

The utility centralizes cancellation, line framing, bounded collection, batching, and conversion rules that are easy to get subtly wrong.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Bound failures
--------------

`StreamLimitError` reports a byte/item collection bound being exceeded.
`StreamLineLimitError` reports one decoded line exceeding the configured line
limit. Both errors carry the relevant configured limit so a caller can produce a
useful diagnostic without inspecting stream internals.


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
