# `@okikio/dispose`

A data import job can open a connection, create a temporary file, and then fail halfway through. Someone still needs to
close the connection and remove the file. `@okikio/dispose` gives that owner a cleanup list which runs in reverse order,
even when one cleanup fails. You write the cleanup once instead of repeating it on every return and error path.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

A **resource** is something that needs to be released, such as a reader or connection. **Disposal** is its cleanup, not
necessarily deletion of its data. A **stack** remembers cleanup callbacks in the order you register them.

Register the connection's cleanup first, then the temporary file's cleanup. Disposal removes the temporary file before
closing the connection. This ordering does not decide when a database commits or a file becomes durable. The application
supplies the appropriate close and delete operations. Cleanup failures remain visible while earlier callbacks still run.

In the examples, `await using name = value` is a JavaScript resource declaration. When execution leaves its block,
including through `throw`, the runtime calls `value[Symbol.asyncDispose]()` and waits for it. A normal `const` declaration
does not do this. Use an asynchronous stack for cleanup that returns a Promise; the synchronous stack cannot await it.

## Run cleanup even after an operation fails

Direct imports give this lifetime its own stack without installing or replacing global constructors. This example also
works when the host's stack globals are absent.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `example.ts` and run `mise exec -- deno run example.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable
import { AsyncDisposableStack } from '@okikio/dispose';
const closed: string[] = [];
try {
	await using stack = new AsyncDisposableStack();
	// Register each cleanup when its resource is acquired. Later cleanup runs first.
	stack.defer(() => {
		closed.push('connection');
	});
	stack.defer(() => {
		closed.push('temporary file');
	});
	// Leaving this scope awaits both cleanups before the catch block runs.
	throw new Error('Conversion failed');
} catch (error) {
	console.log(error instanceof Error ? error.message : String(error));
}
console.log(closed.join(', '));
```

Expected output:

```text output
Conversion failed
temporary file, connection
```

## Follow reverse-order cleanup

The demo registers two callbacks that append names to a list. `await using` awaits cleanup as the block exits; the last registered
callback runs first, so you see `temporary file, connection`. No actual file or connection is opened here. Replace those
callbacks with real resource cleanup to use the same ownership rule. Try reversing the two registrations to see the
printed order reverse too.

The familiar version is `try { await work(); } finally { await cleanup(); }`. A stack keeps that rule when several
resources are acquired along the way. Register a cleanup immediately after acquiring its value so a later failure cannot
bypass it.

| Stack method             | Contract                                             | Use it for                                                                |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `defer(callback)`        | Register a callback; return `void`.                  | Cleanup that needs no separate returned value.                            |
| `adopt(value, callback)` | Return the same value and register its cleanup.      | A reader with `cancel()` and `releaseLock()`, or a client with `close()`. |
| `use(value)`             | Return the same value and use its disposal protocol. | A value with `[Symbol.asyncDispose]()` or `[Symbol.dispose]()`.           |
| `disposeAsync()`         | Return `Promise<void>` after all callbacks finish.   | The owner reaches success, failure, or cancellation cleanup.              |

An async stack keeps one list of cleanup functions. It marks itself disposed before taking functions from the end,
awaits each asynchronous cleanup, and retains cleanup failures while continuing through the list. A synchronous
`[Symbol.dispose]()` fallback follows the standard synchronous contract: use `adopt()` or `defer()` if that callback
actually returns a Promise that must be awaited. The separation prevents silently treating a synchronous protocol as an
asynchronous one.

Null and undefined resources have no cleanup method, but an async stack still supplies the required asynchronous turn.
Several nullish entries share that requirement; they do not delay the start of a real cleanup behind separate no-op
callbacks. A synchronous disposer that throws becomes a rejected promise before earlier resources are released.

The first `disposeAsync()` call owns the complete cleanup result. The stack marks itself disposed before invoking a
callback, so a repeated or reentrant call completes immediately. A longer-lived resource that promises every caller a
joined close must retain and return its first disposal promise.

`await using stack = new AsyncDisposableStack()` asks the language to call disposal when the block ends, including when
it throws. If work and cleanup both fail, the language retains both in a `SuppressedError`. Explicit `try/finally` can
join cleanup on hosts where that syntax is unavailable, but its error path must also preserve both failures. Neither
form cancels a pending operation automatically; register the appropriate abort or close action.

## Transfer an acquired lifetime and inspect competing failures

Use `move()` when initialization succeeds and a longer-lived owner takes responsibility. The original stack closes
registration immediately; disposing it no longer releases the transferred resources.

Save this complete variation as `move-owner.ts` and run `mise exec -- deno run move-owner.ts` after the same checkout setup.

```ts runnable=move-owner.ts
import { AsyncDisposableStack } from '@okikio/dispose';
const released: string[] = [];
const preparing = new AsyncDisposableStack();
preparing.defer(() => {
	released.push('connection');
});
const running = preparing.move();
await preparing.disposeAsync();
console.log(released.length);
await running.disposeAsync();
console.log(released.join(','));
```

```text output
0
connection
```

A `SuppressedError` stores the later cleanup failure in `error` and the earlier failure in `suppressed`. More failed
releases nest this structure without replacing a thrown `null` or `undefined` with a generic error.

Save this complete variation as `failed-cleanup.ts` and run `mise exec -- deno run failed-cleanup.ts` after the same checkout setup.

```ts runnable=failed-cleanup.ts
import { AsyncDisposableStack, SuppressedError } from '@okikio/dispose';
try {
	await using owned = new AsyncDisposableStack();
	owned.defer(() => {
		throw new Error('close failed');
	});
	throw new Error('import failed');
} catch (error) {
	if (!(error instanceof SuppressedError)) throw error;
	console.log((error.error as Error).message);
	console.log((error.suppressed as Error).message);
}
```

```text output
close failed
import failed
```

- **Import a CSV file:** combine this stack with [CSV](../format/csv/README.md) and [Streams](../streams/README.md). The
  importer owns readers and temporary outputs; parsing owns how bytes become rows. The linked CSV guide shows those
  responsibilities with a complete example and a small in-memory input.
- **Run an external converter:** let [Process](../worker/process/README.md) own the child process, and register other
  application-owned resources alongside it. A disposal stack coordinates cleanup; it does not add process-tree
  guarantees beyond the selected process adapter.

## Choose local stacks or explicit global setup

Import from the package root or `@okikio/dispose/ponyfill` for a local owner. Use language-level `using` and
`await using` when the engine implements the standard disposal protocol. The explicit `@okikio/dispose/polyfill` entry
installs only missing global constructors and symbols. Cleanup runs in reverse registration order even after failure,
including a thrown `undefined`. Register only owned resources.

## Choose who releases each acquired value

A temporary file, subscription, and borrowed connection lease all need release when a block exits. The resource owner
chooses which release actions belong to that block.

Use a local try/finally for one straightforward release. Use a stack when acquisition is incremental; use Context when
cleanup also needs a cancellation lifetime.

Do not register a borrowed client as though you own it. If work and cleanup both fail, preserve both causes instead of
replacing the operation error.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                     | Use it to                                                                 | Exact contract            |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| `@okikio/dispose/once` | Join repeated close calls through the same first Promise. | [Contract](./once.ts) |
| `@okikio/dispose`          | Use the package entry shown in the complete examples above.               | [Contract](./mod.ts)      |
| `@okikio/dispose/polyfill` | Install missing disposal globals explicitly at an application entrypoint. | [Contract](./polyfill.ts) |
| `@okikio/dispose/ponyfill` | Import disposal constructors and keys without changing host globals.      | [Contract](./ponyfill.ts) |
| `@okikio/dispose/run`      | Run one operation and bounded cleanup while retaining competing failures. | [Contract](./run.ts)      |

## Join repeated close requests

`@okikio/dispose/once` publishes one completion promise before calling cleanup:

Save this complete variation as `example-4.ts` and run `mise exec -- deno run example-4.ts` after the same checkout setup.

```ts runnable
import { once } from '@okikio/dispose/once';
let calls = 0;
const owner = once(async () => {
	calls++;
});
const first = owner.close();
console.log(first === owner.close());
await first;
console.log(calls);
```

```text output
true
1
```

`close()` and asynchronous disposal share that same promise, including after failure. Cleanup is lazy and starts in a
microtask. Its callback may observe the receipt reentrantly but must not await its own completion. There is no forced
cancellation or deadline: stopping a wait cannot stop cleanup. Standard disposal stacks retain their existing semantics.
See the [contract](./once.ts) and [joiner benchmark](./dispose-once.bench.ts).

## Measure complete cleanup lifetimes

The focused benchmarks measure 1–1,024 cleanup callbacks, including registration and error handling. The benchmark
compares against equivalent successful reverse finally-loop. The successful reference does not reproduce
suppressed-error chains.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/dispose test
deno task --cwd=packages/dispose bench:check
deno task --cwd=packages/dispose bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Read further

The [Dispose guide](https://github.com/okikio/utils/blob/main/docs/dispose.md) explains the model, manual alternatives,
and composition.
