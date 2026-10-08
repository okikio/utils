# @okikio/streams contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                  | Source                   | Reference       |
| ----------------------- | ------------------------ | --------------- |
| `@okikio/streams`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/streams/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/streams`. [Source](./mod.ts).

Consume asynchronous data with explicit item, byte and line budgets. A successful Array.fromAsync can still exhaust
memory if the source never ends or one record is enormous.

Batch for database writes, fold streams without collecting, and use bounded collect() only when a finite materialized
result is needed. Pass cancellation into the source operation as well as the adapter. Early iteration exit cancels owned
Web streams unless preventCancel explicitly keeps borrowed ownership. Byte estimates for object batches are caller
policy; line framing counts actual encoded bytes.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                  | Contract owner or source |
| --------------------------------- | ------------------------ |
| `BatchOptions`                    | [Source](types.ts)       |
| `IterableOptions`                 | [Source](types.ts)       |
| `LimitOptions`                    | [Source](types.ts)       |
| `LineOptions`                     | [Source](types.ts)       |
| [Declaration source](mod.ts#L203) |                          |

```text
async function* batch<Value>(source: Iterable<Value> | AsyncIterable<Value>, options: BatchOptions<Value>): AsyncIterableIterator<readonly Value[]>
  Group source values into bounded immutable batches without materializing the full source.
```

### root: collect

[Declaration source](mod.ts#L179)

```text
async function collect<Value>(source: Iterable<Value> | AsyncIterable<Value>, options: LimitOptions<Value>): Promise<readonly Value[]>
  Materialize a finite iterable only within explicit optional item and byte limits.
```

[Declaration source](mod.ts#L71)

```text
async function* iterable<Value>(source: ReadableStream<Value>, options: IterableOptions): AsyncIterableIterator<Value>
  Iterate a Web ReadableStream with explicit early-return cancellation policy.
```

[Declaration source](mod.ts#L116)

```text
async function* lines(source: ReadableStream<Uint8Array>, options: LineOptions): AsyncIterableIterator<string>
  Decode a byte stream into UTF-8 lines while preserving stream cancellation.

  The line-feed separator is not returned. A carriage return immediately
  before the separator is removed. The final unterminated line is returned.
```

### root: pipe

[Declaration source](mod.ts#L170)

```text
async function pipe<Value>(source: Iterable<Value | PromiseLike<Value>> | AsyncIterable<Value>, destination: WritableStream<Value>, options: StreamPipeOptions): Promise<void>
  Pipe iterable values into a Web WritableStream with native pressure and cancellation.
```

### root: readable

[Declaration source](mod.ts#L40)

```text
function readable<Value>(source: Iterable<Value | PromiseLike<Value>> | AsyncIterable<Value>): ReadableStream<Value>
  Convert an iterable into a Web ReadableStream while retaining source cancellation.
```

### root: StreamLimitError

[Declaration source](mod.ts#L21)

```text
class StreamLimitError extends Error
  Materialization or batching exceeded an explicit item or byte limit.

  constructor(limit: "items" | "bytes", maximum: number, actual: number)
    Create one typed limit failure that reports both the configured maximum and the observed amount.
  readonly limit: "items" | "bytes"
    Whether the caller-configured limit was based on item count or estimated bytes.
  readonly maximum: number
    The configured maximum that the caller declared as part of the contract.
  readonly actual: number
    The observed count or byte estimate that crossed the configured maximum.
```

### root: StreamLineLimitError

[Declaration source](mod.ts#L95)

```text
class StreamLineLimitError extends RangeError
  One UTF-8 line exceeded the caller-declared byte limit.

  constructor(maximum: number, actual: number)
    Create this StreamLineLimitError from the explicit contract values supplied by its caller.
  readonly maximum: number
    Maximum UTF-8 bytes accepted for one line.
  readonly actual: number
    Line bytes observed when the limit was crossed.
```

### root: BatchOptions

[Declaration source](mod.ts#L363)

```text
reference BatchOptions: ./packages/streams/types.ts:13:1
```

### root: IterableOptions

[Declaration source](mod.ts#L363)

```text
reference IterableOptions: ./packages/streams/types.ts:21:1
```

### root: LimitOptions

[Declaration source](mod.ts#L363)

```text
reference LimitOptions: ./packages/streams/types.ts:1:1
```

### root: LineOptions

[Declaration source](mod.ts#L363)

```text
reference LineOptions: ./packages/streams/types.ts:27:1
```

## types

Import `@okikio/streams/types`. [Source](./types.ts).

### types: BatchOptions

[Declaration source](types.ts#L13)

```text
interface BatchOptions<Value> extends LimitOptions<Value>
  Required batch limits. At least one maximum must be supplied.

  readonly maximumItems?: number
    Maximum number of values retained in one emitted batch.
  readonly maximumBytes?: number
    Maximum estimated bytes retained in one emitted batch.
```

### types: IterableOptions

[Declaration source](types.ts#L21)

```text
interface IterableOptions
  ReadableStream iteration policy.

  readonly preventCancel?: boolean
    Keep the source open when iteration ends early. Defaults to `false`.
```

### types: LimitOptions

[Declaration source](types.ts#L1)

```text
interface LimitOptions<Value>
  Shared size limits for stream materialization and batching.

  readonly maximumItems?: number
    Maximum number of values retained in one materialized collection or batch.
  readonly maximumBytes?: number
    Maximum estimated bytes retained in one materialized collection or batch.
  readonly size?: (value: Value) => number
    Required byte estimator when `maximumBytes` is set.
  readonly signal?: AbortSignal
    Optional cancellation signal checked before and after each source read.
```

### types: LineOptions

[Declaration source](types.ts#L27)

```text
interface LineOptions extends IterableOptions
  UTF-8 line iteration policy.

  readonly maximumLineBytes?: number
    Maximum UTF-8 bytes allowed in one line, excluding the line-feed separator.
  readonly signal?: AbortSignal
    Optional cancellation signal. Aborting it cancels the source reader.
```
