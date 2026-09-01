`@okikio/context`
================

Purpose
-------

`@okikio/context` carries the local execution state that many runtime operations
need: identity, cancellation, deadlines, trace identity, idempotency identity,
and a clock.

The package is intentionally small. It does not schedule work, own a queue, resolve declared capability resources, or provide parallel execution. An owned context does contain one `AsyncDisposableStack` so code running inside an already established execution scope can attach values whose lifetime belongs to that scope.


How it fits
-----------

A service request, queue operation, activity job, workflow run, process action,
or Worker request can all receive a context.

The generic identity is `ctx.id`.  The caller decides what the ID represents.
For example, an HTTP service copies its request ID into the request context.  An
activity creates a child context whose ID is the activity job ID.

A serializable snapshot can cross a queue, process, or Worker message. The receiving runtime restores a new local `AbortController`. Cancellation and live owned resources are never serialized.



Runtime views
-------------

`context.view()` adds typed runtime-local fields without creating a new execution lifetime. The returned object retains the source context's cancellation and ownership identity, so focused utilities can compose concerns safely:

```ts
import * as context from '@okikio/context';

const permissionCtx = permission.scope(ctx, permissionOptions);
const operationCtx = effect.scope(permissionCtx, effectOptions);
```

The second view still contains the permission runtime. Cancelling a view of an owned context cancels the same underlying owner. A view cannot replace an existing property. Use `context.child()` when work needs a new independently owned cancellation and cleanup lifetime.

Ownership
---------

`context.create()` and `context.child()` return owned contexts.  The caller must
dispose the returned value.

Asynchronous disposal:

 - clears the deadline timer;
 - removes the parent abort listener;
 - aborts unfinished local work;
 - disposes values registered through `use()`, `adopt()`, and `defer()` in standard LIFO order;
 - resolves `closed` after cleanup finishes.

Because owned cleanup can be asynchronous, an owned context implements `AsyncDisposable`, not synchronous `Disposable`. Use `await using` or await `Symbol.asyncDispose` when the caller owns the context.

A child can shorten a deadline. It cannot extend its parent deadline. A child links cancellation to its parent, but it is still an independently owned scope unless another owner explicitly adopts it.

Timing has two levels. `context.delay(milliseconds, signalOrController?)` is a thin convenience over `@std/async/delay`. `context.wait(ctx, duration)` adds context semantics: it checks cancellation and deadlines before and after the timer and converts context cancellation into the context error model.

```ts
await context.delay(250);
await context.delay(250, controller);
await context.wait(ctx, { seconds: 2 });
```

The manual equivalent of `context.delay(250, signal)` is `delay(250, { signal })` from `@std/async/delay`. Use the context form only when the wait belongs to an operation context.


Start here
----------

The following code gives one activity job its own local identity while it keeps
the parent deadline and cancellation signal.

~~~~ typescript
await using job = context.child(parent, { id: jobId });
context.check(job);
await context.wait(job, { milliseconds: 100 });

job.defer(async () => {
  await flushAttemptLog();
});
~~~~

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.


Ownership diagram
-----------------

~~~~ text
parent Context
    |
    +-- context.child() / timeout()
    |       |
    |       +--> child AbortController
    |       +--> shorter-or-equal deadline timer
    |       +--> parent abort listener
    |       `--> child AsyncDisposableStack
    |
    `-- parent cancellation propagates to child

Snapshot
    | ids + timestamps only
    v
serialized seam
    |
    `--> restore() -> new local AbortController
~~~~

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `context.child()` | create an `AbortController`, link the parent signal, clamp the deadline, install a timer, and own an `AsyncDisposableStack` | one child lifetime with deterministic cleanup |
| `context.wait(ctx, duration)` | check cancellation/deadline, call `@std/async/delay`, then check again | timer completion cannot hide context cancellation |
| `snapshot()` / `restore()` | serialize IDs/timestamps only and create a fresh local controller on the other side | serializable identity without serializing live resources |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/context` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with AbortController, AbortSignal, Temporal, AsyncDisposableStack, and @std/async/delay.

The utility adds one shared identity/deadline/clock model and makes owned cleanup explicit.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Cancellation, clocks, and diagnostics
------------------------------------

The basic examples use `check()`, `wait()`, and `delay()`. These exports cover
the rest of the local operation model:

- `cancel()` cancels an owned context explicitly.
- `cause()` returns the normalized cancellation/deadline cause after a signal stops.
- `remaining()` reports the remaining deadline duration without starting a timer.
- `combineSignals()` combines borrowed signals when an integration needs one signal.
- `SystemClock` is the normal real-time clock; `TestClock` is deterministic test time.
- `ContextCancelledError` and `ContextDeadlineExceededError` distinguish explicit
  cancellation from deadline expiry.


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
