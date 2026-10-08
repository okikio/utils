# @okikio/concurrency contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                        | Source                       | Reference           |
| ----------------------------- | ---------------------------- | ------------------- |
| `@okikio/concurrency`         | [./mod.ts](./mod.ts)         | [root](#root)       |
| `@okikio/concurrency/bounded` | [./bounded.ts](./bounded.ts) | [bounded](#bounded) |
| `@okikio/concurrency/channel` | [./channel.ts](./channel.ts) | [channel](#channel) |

## root

Import `@okikio/concurrency`. [Source](./mod.ts).

Bound active asynchronous work while choosing whether consumers need input order or completion order. Promise.all starts
every operation immediately and gives cancellation no ownership over admitted siblings.

Start with ordered mapping for reports; use unordered mapping for results that can be consumed as soon as they finish.
Pass cancellation into the actual fetch or provider call. Breaking iteration cancels admitted transforms and joins their
settlement. A concurrency bound limits active work, not the size of a result array; fold or batch large outputs instead
of materializing them all.

[Declaration source](bounded.ts#L60)

```text
async function* mapPooledOrdered<T, R>(input: { readonly items: Iterable<T> | AsyncIterable<T>; readonly concurrency: number; readonly signal?: AbortSignal; readonly map: (item: T, context: PooledOperationContext) => Promise<R>; }): AsyncIterable<R>
  Transform values concurrently and yield them in input order.

  Mapper promises settle into data before they enter the ordered queue. This is
  intentional: a rejected background promise can become an unhandled rejection
  while the consumer is still waiting for an earlier item. The first mapper
  failure aborts admitted siblings, all admitted promises are drained, and only
  then is that original failure rethrown to the caller.
```

[Declaration source](bounded.ts#L142)

```text
async function* mapPooledUnordered<T, R>(input: { readonly items: Iterable<T> | AsyncIterable<T>; readonly concurrency: number; readonly shouldStop?: () => boolean; readonly signal?: AbortSignal; readonly acknowledgeCompletions?: boolean; readonly map: (item: T, context: PooledOperationContext) => Promise<R>; }): AsyncIterable<R>
  Transform values with Deno std's bounded pool and yield successful results in
  completion order.

  `pooledMap()` deliberately yields in input order. Browser capture needs the
  opposite delivery policy so a completed route can be persisted immediately
  instead of waiting behind a slower earlier route. A bounded std `Channel`
  carries completions while `pooledMap()` continues to own admission. No custom
  semaphore or Promise-race scheduler is maintained here.
```

### root: runBoundedQueue

[Declaration source](bounded.ts#L16)

```text
async function runBoundedQueue<T>(input: { readonly items: Iterable<T> | AsyncIterable<T>; readonly concurrency: number; readonly shouldStop?: () => boolean; readonly signal?: AbortSignal; readonly run: (item: T, context: PooledOperationContext) => Promise<void>; }): Promise<void>
  Run values through Deno std's bounded async pool with structured sibling cancellation.

  `pooledMap()` owns concurrency and input backpressure. This adapter adds the
  the application lifecycle rule that one failed operation aborts already admitted sibling
  work through the operation signal before the failure is returned to the caller.
```

### root: Channel

[Declaration source](channel.ts#L16)

```text
class Channel<T> implements AsyncIterable<T>, AsyncDisposable
  Bounded asynchronous channel with explicit iteration and disposal contracts.

  `@std/async` owns buffering, FIFO delivery, and backpressure. This adapter
  owns the lifecycle surface the application's generic pipelines require across Deno and
  Node type-checking: async iteration drains until a normal close, while a
  close reason remains observable as a consumer failure.

  constructor(options?: ChannelOptions)
    Create a channel with the upstream buffer and waiter limits selected by the caller.
  send(value: T, options?: ChannelSendOptions): Promise<void>
    Send one value, waiting while the bounded buffer is full.
  receive(options?: ChannelReceiveOptions): Promise<T>
    Receive one value from the channel.
  trySend(value: T): boolean
    Attempt to send without waiting for buffer capacity.
  close(reason?: unknown): void
    Close the channel. A supplied reason is propagated to consumers.
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T>
    Read values in channel order until closure; iteration borrows the channel lifetime.
  async [Symbol.asyncDispose](): Promise<void>
    Close the channel normally, releasing blocked senders and receivers.
```

### root: PooledOperationContext

[Declaration source](bounded.ts#L4)

```text
interface PooledOperationContext
  Cancellation context supplied to one pooled operation.

  readonly signal: AbortSignal
    Signal aborted when the caller cancels, a sibling fails, or the consumer stops early.
```

## bounded

Import `@okikio/concurrency/bounded`. [Source](./bounded.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding                     | Contract owner or source                                  |
| ------------------------------------ | --------------------------------------------------------- |
| `pooledMap`                          | [External source](https://jsr.io/@std/async/1.5.0/mod.ts) |
| `Channel`                            | [Source](channel.ts)                                      |
| [Declaration source](bounded.ts#L60) |                                                           |

```text
async function* mapPooledOrdered<T, R>(input: { readonly items: Iterable<T> | AsyncIterable<T>; readonly concurrency: number; readonly signal?: AbortSignal; readonly map: (item: T, context: PooledOperationContext) => Promise<R>; }): AsyncIterable<R>
  Transform values concurrently and yield them in input order.

  Mapper promises settle into data before they enter the ordered queue. This is
  intentional: a rejected background promise can become an unhandled rejection
  while the consumer is still waiting for an earlier item. The first mapper
  failure aborts admitted siblings, all admitted promises are drained, and only
  then is that original failure rethrown to the caller.
```

[Declaration source](bounded.ts#L142)

```text
async function* mapPooledUnordered<T, R>(input: { readonly items: Iterable<T> | AsyncIterable<T>; readonly concurrency: number; readonly shouldStop?: () => boolean; readonly signal?: AbortSignal; readonly acknowledgeCompletions?: boolean; readonly map: (item: T, context: PooledOperationContext) => Promise<R>; }): AsyncIterable<R>
  Transform values with Deno std's bounded pool and yield successful results in
  completion order.

  `pooledMap()` deliberately yields in input order. Browser capture needs the
  opposite delivery policy so a completed route can be persisted immediately
  instead of waiting behind a slower earlier route. A bounded std `Channel`
  carries completions while `pooledMap()` continues to own admission. No custom
  semaphore or Promise-race scheduler is maintained here.
```

### bounded: runBoundedQueue

[Declaration source](bounded.ts#L16)

```text
async function runBoundedQueue<T>(input: { readonly items: Iterable<T> | AsyncIterable<T>; readonly concurrency: number; readonly shouldStop?: () => boolean; readonly signal?: AbortSignal; readonly run: (item: T, context: PooledOperationContext) => Promise<void>; }): Promise<void>
  Run values through Deno std's bounded async pool with structured sibling cancellation.

  `pooledMap()` owns concurrency and input backpressure. This adapter adds the
  the application lifecycle rule that one failed operation aborts already admitted sibling
  work through the operation signal before the failure is returned to the caller.
```

### bounded: PooledOperationContext

[Declaration source](bounded.ts#L4)

```text
interface PooledOperationContext
  Cancellation context supplied to one pooled operation.

  readonly signal: AbortSignal
    Signal aborted when the caller cancels, a sibling fails, or the consumer stops early.
```

## channel

Import `@okikio/concurrency/channel`. [Source](./channel.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding        | Contract owner or source                                  |
| ----------------------- | --------------------------------------------------------- |
| `StdChannel`            | [External source](https://jsr.io/@std/async/1.5.0/mod.ts) |
| `ChannelClosedError`    | [External source](https://jsr.io/@std/async/1.5.0/mod.ts) |
| `ChannelOptions`        | [External source](https://jsr.io/@std/async/1.5.0/mod.ts) |
| `ChannelReceiveOptions` | [External source](https://jsr.io/@std/async/1.5.0/mod.ts) |
| `ChannelSendOptions`    | [External source](https://jsr.io/@std/async/1.5.0/mod.ts) |

### channel: Channel

[Declaration source](channel.ts#L16)

```text
class Channel<T> implements AsyncIterable<T>, AsyncDisposable
  Bounded asynchronous channel with explicit iteration and disposal contracts.

  `@std/async` owns buffering, FIFO delivery, and backpressure. This adapter
  owns the lifecycle surface the application's generic pipelines require across Deno and
  Node type-checking: async iteration drains until a normal close, while a
  close reason remains observable as a consumer failure.

  constructor(options?: ChannelOptions)
    Create a channel with the upstream buffer and waiter limits selected by the caller.
  send(value: T, options?: ChannelSendOptions): Promise<void>
    Send one value, waiting while the bounded buffer is full.
  receive(options?: ChannelReceiveOptions): Promise<T>
    Receive one value from the channel.
  trySend(value: T): boolean
    Attempt to send without waiting for buffer capacity.
  close(reason?: unknown): void
    Close the channel. A supplied reason is propagated to consumers.
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T>
    Read values in channel order until closure; iteration borrows the channel lifetime.
  async [Symbol.asyncDispose](): Promise<void>
    Close the channel normally, releasing blocked senders and receivers.
```
