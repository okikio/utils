# `@okikio/task`

Purpose
-------

`@okikio/task` owns one finite process-local operation with a child Context,
cooperative pause points, cancellation, borrowed resources, and deterministic
cleanup.

Use a Task when the caller needs to pause, resume, cancel, or await one live
operation. A Task is not a queue item, workflow run, subprocess, or Worker
request. Those abstractions can create Tasks internally, but their durable or
external identity belongs to their own utility.

Start here
----------

Create one finite operation and await its terminal `done` Promise:

```ts
import * as task from '@okikio/task';

await using operation = task.start(async (ctx) => {
  await ctx.checkpoint();
  return await loadValue(ctx.signal);
});

const value = await operation.done;
```

The Task owns the child Context it creates for the operation. Disposing the Task
uses the same cancellation path as `cancel()` and waits for Task-owned cleanup.

Pause and resume
----------------

Pausing is cooperative. `pause()` resolves when the operation reaches its next
`ctx.checkpoint()` or becomes terminal:

```ts
const operation = task.start(async (ctx) => {
  for (const item of items) {
    await ctx.checkpoint();
    await processItem(item, ctx.signal);
  }
});

await operation.pause();
// The operation is now waiting at a checkpoint.
operation.resume();
await operation.done;
```

A Task cannot suspend an in-flight `fetch()`, codec call, database statement, or
other indivisible provider operation. Put checkpoints between meaningful units
of work rather than pretending arbitrary JavaScript can be frozen safely.

Larger composition
------------------

A Task can borrow an existing resource collection while owning only its local
execution lifetime:

```ts
await using conversion = task.start(async (ctx) => {
  const input = await ctx.get(MediaInput);

  for await (const segment of input.segments()) {
    await ctx.checkpoint();
    await convertSegment(segment, ctx.signal);
  }

  return { converted: true };
}, {
  ctx: requestContext,
  resources,
  allowed: [MediaInput],
});

await conversion.pause();
conversion.resume();
const result = await conversion.done;
```

The Task borrows `resources`; it does not dispose the collection. Values acquired
through the Task context remain subject to the collection's ownership rules.
`done` is terminal authority. `status` is only a synchronous lifecycle snapshot.

Cancellation
------------

`cancel(reason)` asks active work to stop and resolves after the Task reaches a
terminal state and its owned Context has finished cleanup:

```ts
const operation = task.start(run, { ctx: requestContext });

await operation.cancel(new Error('request no longer needs this work'));
console.log(operation.status); // "cancelled" unless cleanup itself failed
```

If work fails and cleanup also fails, standard `SuppressedError` semantics keep
both failures visible.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `task.start()` | create a child context, abort controller, pause gate, terminal promise, status state machine, and cleanup ownership yourself | one finite process-local operation lifetime |
| `pause()` / `resume()` | manage pause generations and acknowledgement promises around cooperative checkpoints manually | pause is explicit/cooperative instead of pretending JavaScript can be suspended arbitrarily |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


The manual equivalent is an `AbortController`, a child lifetime, a pause Promise,
an `AsyncDisposableStack`, and one terminal result Promise. `@okikio/task`
packages those process-local lifecycle rules so every caller does not have to
rebuild the same state machine.

It deliberately does not create durable identity, retry state, queue claims, or
workflow history.

Source guide
------------

1. `mod.ts` contains the complete Task state machine and public `start()`
   operation.
2. `types.ts` defines `Task`, `TaskContext`, `TaskOptions`, and lifecycle states.
3. `mod_test.ts` shows cancellation, pause generations, cleanup, and resource
   borrowing as executable examples.
4. Read `@okikio/context` and `@okikio/resource` when you need the ownership model
   behind the Task context.

The README is the primary user documentation.
