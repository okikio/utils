# @okikio/dispose contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                     | Source                         | Reference             |
| -------------------------- | ------------------------------ | --------------------- |
| `@okikio/dispose`          | [./mod.ts](./mod.ts)           | [root](#root)         |
| `@okikio/dispose/polyfill` | [./polyfill.ts](./polyfill.ts) | [polyfill](#polyfill) |
| `@okikio/dispose/ponyfill` | [./ponyfill.ts](./ponyfill.ts) | [ponyfill](#ponyfill) |

## root

Import `@okikio/dispose`. [Source](./mod.ts).

Dispose owned values in a predictable order while preserving both the operation failure and any cleanup failure.
Hand-written finally blocks often skip later cleanup when one callback throws.

Import the local constructors for library-owned lifetimes without changing globals. Use language-level using and await
using when the engine supports the standard protocol. Import @okikio/dispose/polyfill explicitly if an application
chooses global compatibility. Cleanup runs in reverse registration order even after failure, including thrown undefined.
Register only owned resources.

### root: AsyncDisposableStack

[Declaration source](mod.ts#L18)

```text
reference AsyncDisposableStack: ./packages/dispose/ponyfill.ts:141:1
```

### root: DisposableStack

[Declaration source](mod.ts#L18)

```text
reference DisposableStack: ./packages/dispose/ponyfill.ts:62:1
```

### root: SuppressedError

[Declaration source](mod.ts#L18)

```text
reference SuppressedError: ./packages/dispose/ponyfill.ts:53:14
```

### root: asyncDispose

[Declaration source](mod.ts#L18)

```text
reference asyncDispose: ./packages/dispose/ponyfill.ts:21:14
```

### root: dispose

[Declaration source](mod.ts#L18)

```text
reference dispose: ./packages/dispose/ponyfill.ts:17:14
```

## polyfill

Import `@okikio/dispose/polyfill`. [Source](./polyfill.ts).

Install only missing disposal globals at an executable entry point.

Libraries can import constructors and protocol keys from @okikio/dispose/ponyfill without changing their host. This
explicit installer reuses those bindings and preserves existing native constructors and symbols. It cannot add using
syntax to an older parser.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source |
| ---------------------- | ------------------------ |
| `AsyncDisposableStack` | [Source](ponyfill.ts)    |
| `asyncDispose`         | [Source](ponyfill.ts)    |
| `DisposableStack`      | [Source](ponyfill.ts)    |
| `dispose`              | [Source](ponyfill.ts)    |
| `SuppressedError`      | [Source](ponyfill.ts)    |

## ponyfill

Import `@okikio/dispose/ponyfill`. [Source](./ponyfill.ts).

Own resources through direct imports without installing disposal globals.

Call dispose() or await disposeAsync() in finally. The exported protocol keys reuse host symbols or provide local
fallback keys. Native using syntax requires host well-known symbols or the explicit polyfill; local keys alone cannot
change the language's disposal protocol.

### ponyfill: SuppressedError

[Declaration source](ponyfill.ts#L53)

```text
const SuppressedError: SuppressedErrorConstructor
  Keep the current cleanup failure in error and the previous failure in suppressed.
  The binding uses the existing native constructor or a local callable constructor, without
  installing a global. Stacks capture this binding rather than reading a mutable global later.
```

### ponyfill: asyncDispose

[Declaration source](ponyfill.ts#L21)

```text
const asyncDispose: typeof Symbol.asyncDispose
  Register asynchronous cleanup through a host symbol or a local key without installing a global.
```

### ponyfill: dispose

[Declaration source](ponyfill.ts#L17)

```text
const dispose: typeof Symbol.dispose
  Register synchronous cleanup through a host symbol or a local key without installing a global.
```

### ponyfill: AsyncDisposableStack

[Declaration source](ponyfill.ts#L141)

```text
class AsyncDisposableStack implements globalThis.AsyncDisposableStack
  Own asynchronous resources and await each cleanup before starting the next one.
  A callable async method takes precedence. A nullish async method permits a synchronous
  fallback; a non-callable async method is an error. The fallback's return value is ignored.
  Use defer() or adopt() when cleanup returns a promise that must be awaited.

  get disposed(): boolean
    Report whether asynchronous disposal or ownership transfer has started.
  get [Symbol.toStringTag](): string
    Identify the asynchronous owner without exposing resources.
  use(value: Value): Value
    Capture an owned resource's method and receiver; nullish values retain an await boundary.
  adopt(value: Value, onDispose: (value: Value) => void | PromiseLike<void>): Value
    Own a value whose cleanup promise must finish before the next callback starts.
  defer(onDispose: () => void | PromiseLike<void>): void
    Register cleanup without a value and await any promise it returns.
  move(): AsyncDisposableStack
    Move all pending cleanup into a new base stack without starting asynchronous work.
  async disposeAsync(): Promise<void>
    Close ownership synchronously, then await every LIFO callback and reject on accumulated failure.
  [asyncDispose](): Promise<void>
    Participate in asynchronous protocol disposal; aliases disposeAsync() on the prototype.
```

### ponyfill: DisposableStack

[Declaration source](ponyfill.ts#L62)

```text
class DisposableStack implements globalThis.DisposableStack
  Own synchronous resources until one explicit LIFO disposal.
  Only register owned values. move() transfers pending cleanup and closes the old owner.
  All cleanup is attempted after failure; a thrown undefined remains a failure.

  get disposed(): boolean
    Report whether disposal or ownership transfer has started.
  get [Symbol.toStringTag](): string
    Identify the standard stack without exposing its resource list.
  use(value: Value): Value
    Capture the resource method and receiver now, and return the same value.
  adopt(value: Value, onDispose: (value: Value) => void): Value
    Own an arbitrary value through a callback receiving that value once.
  defer(onDispose: () => void): void
    Register cleanup that needs no value, in reverse disposal order.
  move(): DisposableStack
    Transfer pending cleanup into a new base stack without invoking it.
  dispose(): void
    Close ownership once and attempt every callback, preserving the complete failure chain.
  [dispose](): void
    Participate in the imported protocol; the prototype aliases this method to dispose().
```
