# `@okikio/dispose`

Dispose owned values in a predictable order while preserving both the operation failure and any cleanup failure.
Hand-written finally blocks often skip later cleanup when one callback throws.

## Run a complete example

Direct imports give this lifetime its own stack without installing or replacing global constructors. This example also
works when the host's stack globals are absent.

```ts runnable
import { AsyncDisposableStack } from '@okikio/dispose';
const closed: string[] = [];
const stack = new AsyncDisposableStack();
stack.defer(() => {
	closed.push('connection');
});
stack.defer(() => {
	closed.push('temporary file');
});
await stack.disposeAsync();
console.log(closed.join(', '));
```

Expected output:

```text output
temporary file, connection
```

## Build on the example

Import from the package root or `@okikio/dispose/ponyfill` for a local owner. Use language-level `using` and
`await using` when the engine implements the standard disposal protocol. The explicit `@okikio/dispose/polyfill` entry
installs only missing global constructors and symbols. Cleanup runs in reverse registration order even after failure,
including a thrown `undefined`. Register only owned resources.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

These local constructors use the ECMAScript explicit-resource-management model: `DisposableStack`,
`AsyncDisposableStack`, and `SuppressedError`. They let a reusable library own cleanup without deciding whether its
application should modify globals.

## Compose with a streaming CSV import

An import owns its reader while another utility interprets the CSV. The stack releases the reader after success or an
early failure. Replace the in-memory stream with a response body while keeping the same ownership boundary.

```ts runnable
import { AsyncDisposableStack } from '@okikio/dispose/ponyfill';
import { parse } from '@okikio/csv';
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

## Start here

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

## Convenience and the manual equivalent

| Convenience                  | Manual equivalent                                                                        | Concrete value                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `@okikio/dispose/polyfill`   | install only the missing explicit-resource-management globals before application startup | compatibility only; native `using` semantics stay authoritative |
| `AsyncDisposableStack` usage | write nested `try/finally` blocks and manually preserve primary vs cleanup failures      | standard LIFO cleanup and `SuppressedError` behavior            |

A runtime that does not yet expose the stack classes can install only the missing globals explicitly:

```ts
import '@okikio/dispose/polyfill';
```

That import is compatibility plumbing. The manual equivalent is to provide the standard globals before application code
starts. The polyfill does not wrap or replace native implementations.

## Failure model

Resource cleanup can fail. Standard explicit-resource-management semantics are kept so a cleanup failure does not
silently erase an earlier operation failure. Do not replace this with project-specific `finally` registries unless a
provider requires a different contract.

## Source guide

- `mod.ts` documents the import-safe root.
- `ponyfill.ts` owns direct constructors and local protocol keys.
- `polyfill.ts` installs missing standard globals.
- `ponyfill.test.ts` verifies ownership, awaited cleanup, and failure behavior.
- `mod.test.ts` verifies the explicit global entry.

The README is the primary user documentation.

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
