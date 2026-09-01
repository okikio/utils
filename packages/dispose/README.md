`@okikio/dispose`
================

Purpose
-------

This package does not invent a disposal framework. Runtime code uses the
ECMAScript explicit-resource-management model directly: `DisposableStack`,
`AsyncDisposableStack`, `Symbol.dispose`, `Symbol.asyncDispose`, and
`SuppressedError`.


Start here
----------

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



Larger composition
------------------

Use one stack when several resources share one owner and must unwind in reverse
acquisition order:

```ts
async function copyAsset() {
  await using resources = new AsyncDisposableStack();

  const source = resources.use(await openSource());
  const target = resources.use(await openTarget());
  resources.defer(() => recordCopyFinished());

  await source.pipeTo(target.writable);
}
```

If acquisition or work throws, the stack still disposes everything it already
owns. If cleanup also throws, standard `SuppressedError` semantics preserve both
failures instead of silently replacing the original one.


Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `@okikio/dispose/polyfill` | install only the missing explicit-resource-management globals before application startup | compatibility only; native `using` semantics stay authoritative |
| `AsyncDisposableStack` usage | write nested `try/finally` blocks and manually preserve primary vs cleanup failures | standard LIFO cleanup and `SuppressedError` behavior |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


A runtime that does not yet expose the stack classes can install only the
missing globals explicitly:

```ts
import '@okikio/dispose/polyfill';
```

That import is compatibility plumbing. The manual equivalent is to provide the
standard globals before application code starts. The polyfill does not wrap or
replace native implementations.


Failure model
-------------

Resource cleanup can fail. Standard explicit-resource-management semantics are
kept so a cleanup failure does not silently erase an earlier operation failure.
Do not replace this with project-specific `finally` registries unless a provider
requires a different contract.


Source guide
------------

- `mod.ts` documents the import-safe root.
- `polyfill.ts` installs missing standard globals.
- `polyfill_test.ts` verifies compatibility behavior.

The README is the primary user documentation.
