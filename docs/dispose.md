# Give cleanup one owner

An export opens a connection and then creates a temporary file. If conversion fails, the file and connection still need
cleanup. Register each release as soon as its value is acquired; a disposal stack then runs those releases in reverse
order, including when the operation throws.

A cancellation signal asks work to stop. Disposing a resource releases it. Decide explicitly whether an injected
resource is borrowed or transferred to the current owner.

## Release resources when the operation throws

The operation fails after registering two cleanup actions. Watch their order in the output: the last registered action
runs first, then the earlier action runs, and the original failure remains visible to the caller.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as a `.ts` file in your project and use
`mise exec -- deno run example.ts`.

```ts runnable=package-task.ts
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

## Choose local constructors or explicit global setup

These local constructors use the ECMAScript explicit-resource-management model: `DisposableStack`,
`AsyncDisposableStack`, and `SuppressedError`. They let a reusable library own cleanup without deciding whether its
application should modify globals.

## Compose with a streaming CSV import

An import owns its reader while another utility interprets the CSV. The stack releases the reader after success or an
early failure. Replace the in-memory stream with a response body while keeping the same ownership boundary.

Save this complete variation as `example-2.ts` and run `mise exec -- deno run example-2.ts` after the same checkout setup.

```ts runnable
import { AsyncDisposableStack } from '@okikio/dispose/ponyfill';
import { parse } from '@okikio/format/csv';
const source = new ReadableStream<Uint8Array>({
	start(controller) {
		controller.enqueue(new TextEncoder().encode('name,asset\nAda,photo.png\n'));
		controller.close();
	},
});
const owned = new AsyncDisposableStack();
try {
	const reader = owned.adopt(source.getReader(), async (value) => {
		try {
			await value.cancel();
		} finally {
			value.releaseLock();
		}
	});
	const decoder = new TextDecoder();
	let text = '';
	for (;;) {
		const next = await reader.read();
		if (next.done) break;
		text += decoder.decode(next.value, { stream: true });
	}
	text += decoder.decode();
	console.log(parse(text, { headerRow: 1 }).rows[0]?.values.join(':'));
} finally {
	await owned.disposeAsync();
}
```

```text output
Ada:photo.png
```

This example collects a bounded source before parsing. For an unbounded import, use `csv.parseStream()` and consume its
rows incrementally instead of building one string.

## Local protocol keys on older hosts

The ponyfill exports `dispose` and `asyncDispose`. Each binding reuses the corresponding well-known symbol when it
exists; otherwise it is a local symbol. Neither import writes to `Symbol` or `globalThis`.

```ts
import { DisposableStack, dispose } from '@okikio/dispose/ponyfill';
const owned = new DisposableStack();
owned.use({
	[dispose]() {
		console.log('closed');
	},
});
owned.dispose();
```

Local keys work with these imported stacks. They do not add native `using` syntax, nor replace an engine's intrinsic
disposal protocol. Use explicit method calls on old engines. The installer shares the local keys when it must add
missing symbol properties; existing native symbols and global constructors retain their identity.

An existing native `SuppressedError` is captured for local cleanup; otherwise the ponyfill provides a callable and
constructable local error. Its `error` and `suppressed` fields preserve failures without making them enumerable.

## Choose the stack that owns cleanup

When the runtime already provides the standard globals, no import is needed:

```ts
const resources = new AsyncDisposableStack();
const connection = resources.use(await openConnection());
resources.defer(() => releaseTemporaryLock());
await resources.disposeAsync();
```

Use `using` or `await using` when lexical ownership is clearer:

```ts
await using session = await openSession();
await session.write(value);
```

## Larger composition

Use one stack when several resources share one owner and must unwind in reverse acquisition order:

```ts
async function copyAsset() {
	await using resources = new AsyncDisposableStack();

	const source = resources.use(await openSource());
	const target = resources.use(await openTarget());
	resources.defer(() => recordCopyFinished());

	await source.pipeTo(target.writable);
}
```

If acquisition or work throws, the stack still disposes everything it already owns. If cleanup also throws, standard
`SuppressedError` semantics preserve both failures instead of silently replacing the original one.

## Failure model

Resource cleanup can fail. Standard explicit-resource-management semantics are kept so a cleanup failure does not
silently erase an earlier operation failure. Do not replace this with project-specific `finally` registries unless a
provider requires a different contract.

## Decide which bookkeeping to keep in your application

| Convenience                  | Manual equivalent                                                                        | Concrete value                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `@okikio/dispose/polyfill`   | install only the missing explicit-resource-management globals before application startup | compatibility only; native `using` semantics stay authoritative |
| `AsyncDisposableStack` usage | write nested `try/finally` blocks and manually preserve primary vs cleanup failures      | standard LIFO cleanup and `SuppressedError` behavior            |

A runtime that does not yet expose the stack classes can install only the missing globals explicitly:

```ts
import '@okikio/dispose/polyfill';
const owned = new AsyncDisposableStack();
owned.defer(() => console.log('Application cleanup finished'));
await owned.disposeAsync();
```

That import is compatibility plumbing. The manual equivalent is to provide the standard globals before application code
starts. The polyfill does not wrap or replace native implementations.

## Source guide

The paths below are relative to the [package directory](../packages/dispose).

- `mod.ts` documents the import-safe root.
- `ponyfill.ts` owns direct constructors and local protocol keys.
- `polyfill.ts` installs missing standard globals.
- `ponyfill.test.ts` verifies ownership, awaited cleanup, and failure behavior.
- `mod.test.ts` verifies the explicit global entry.

Read the [public source](../packages/dispose/mod.ts) for the complete stack methods and disposal protocol contracts.

The [language disposal contract](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-getdisposemethod)
rejects a non-callable asynchronous method even when a synchronous method exists. The synchronous fallback discards its
return value; use `adopt()` or `defer()` when the callback's promise must be awaited.

## Polyfill inventory

| Explicit global entry       | Direct-import counterpart                     | Decision                                                                        |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `@okikio/dispose/polyfill`  | `@okikio/dispose`, `@okikio/dispose/ponyfill` | Local resource owners and protocol keys; global installation stays optional.    |
| `@okikio/duration/polyfill` | `@okikio/duration/temporal`                   | Existing pure Temporal provider is retained; it never installs global Temporal. |

The matching `@okikio/utils/dispose/ponyfill` and `@okikio/utils/duration/temporal` entries re-export the focused
bindings. The umbrella polyfill entries remain explicit installers. There are no other utility-owned global polyfills in
the current source inventory.

## Bound cleanup waiting

`run(work, cleanups, timeoutMs)` attempts callbacks in reverse order after work succeeds or fails. Each callback
receives a finite wait budget. Cleanup continues after failure or timeout and uses `SuppressedError` to retain the
earlier failure, including thrown undefined. Timing out stops waiting; it cannot force arbitrary callback code to stop.
The host still owns any resources whose cleanup did not complete.
