# `@okikio/task`

A user starts an import and then presses Pause or Cancel. A plain Promise represents the final answer, but offers no
standard control for those buttons or for knowing when cleanup has finished. `@okikio/task` gives one local operation a
handle for pause, resume, cancellation, and an awaited result that includes its cleanup.

A **checkpoint** is a place where the operation cooperates with pause and cancellation. A task is one live operation in
the current process; it is not a saved job that can restart on another computer.

```text
start -> operation runs -> checkpoint -> operation continues -> cleanup -> done
                              |
                         pause requested
                              v
                           paused -> resume -> next unit of work
```

This is a common successful lifecycle, with the pause branch at a checkpoint. It omits failure and cancellation paths,
which also lead through cleanup before terminal settlement. The handle cannot freeze an arbitrary in-flight provider
call.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](API.md).

## Give an ordinary import a result and a pause button

An import screen needs a Pause button that stops admitting new records. An async function can still do the work. Here an
array stands in for the destination: no database account is required. Pausing before admission leaves it empty; resuming
saves the three normalized names. `await using` closes the handle when its block ends, including after an error.

```ts runnable=normalize-contacts.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as task from '@okikio/task';

const names = [' Ada ', 'Grace ', ' Linus'];
const saved: string[] = [];
await using work = task.start(async (ctx) => {
	for (const name of names) {
		await ctx.checkpoint();
		saved.push(name.trim());
	}
	return saved;
}, { id: 'contact-import' });
await work.pause();
console.log('Saved while paused:', saved.length);
work.resume();
console.log((await work.done).join(', '));
```

```text output
Saved while paused: 0
Ada, Grace, Linus
```

The initial checkpoint gives the immediate pause request a place to be observed. `pause()` resolves once a checkpoint
acknowledges it or the operation finishes. `resume()` releases the gate; `done` carries the result after cleanup. For a
real import, replace the array push with your database call and pass `ctx.signal` to its cancellation option.

| Contract      | Ordinary JavaScript shape                                                                      | Responsibility                                                  |
| ------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Work function | `(ctx: TaskContext) => Value \| Promise<Value>`                                                | Perform work and return its answer. Here `Value` is `string[]`. |
| `Task<Value>` | `done: Promise<Value>`, `signal: AbortSignal`, `status`, `pause()`, `resume()`, `cancel()`     | Let the caller control and await one operation.                 |
| `TaskContext` | Context fields, cleanup registration, `checkpoint(): Promise<void>`, optional declared `get()` | Let work cooperate and borrow supplied resources.               |

Underneath `start()`, the package creates an owned context, a pause gate, and a terminal promise. A checkpoint checks
cancellation, waits on the gate if pause was requested, and checks cancellation again. When work settles, the task
releases pause waiters, disposes its context, and only then settles `done`. Receiving the answer therefore also means
task-owned cleanup has completed.

This keeps control state beside a familiar async function, instead of passing separate pause promises, controllers, and
cleanup stacks through each loop. Control remains cooperative: an uninterrupted provider call must finish or observe its
signal itself. A Task does not save progress for a later process.

## Release a temporary export URL before returning

A contact preview uses a temporary Blob URL to read an export. That URL must be revoked after the read, including when
work fails or is cancelled. Registering it with the task keeps that responsibility beside the work. Awaiting `done`
means the exported text is available and the temporary URL has already been released. The explicit polyfills support the
task's Temporal clock and disposal stack on hosts missing those APIs.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as task from '@okikio/task';
await using work = task.start(async (ctx) => {
	const url = ctx.adopt(URL.createObjectURL(new Blob(['Name\nAda\nGrace\n'])), URL.revokeObjectURL);
	const response = await fetch(url, { signal: ctx.signal });
	return { text: await response.text(), url };
}, { id: 'contact-preview' });
const exportFile = await work.done;
console.log(exportFile.text.trim());
try {
	await fetch(exportFile.url);
} catch (error) {
	if (!(error instanceof TypeError)) throw error;
	console.log('Temporary URL released');
}
```

Expected output:

```text output
Name
Ada
Grace
Temporary URL released
```

`start()` returns `Task<{ text: string; url: string }>` immediately. `work.done` resolves to that value after registered
cleanup runs. A thrown operation or cleanup failure rejects it. The task owns its child context; the caller owns the
task through `await using`.

## Read the mini-demo

The demo reads the export through a real Fetch call. Its second Fetch call fails because the task has revoked the URL,
so the observation checks a real resource release rather than an artificial cleanup marker. The returned URL is included
only to inspect that release; an application should use the returned text, not pass the expired URL to a download link.
A link that must stay usable belongs to the screen's longer lifetime instead.

- **Pause a multi-file import:** place checkpoints between files, use [Streams](../streams/README.md) for incremental
  input, and pass the task signal into actual I/O. Checkpoints do not interrupt an indivisible database or codec call.
- **Use an already-open connection:** borrow a [Resource](../resource/README.md) collection or a value leased from
  [Pool](../pool/README.md). The task owns its local execution and registered cleanup; the outer owner still closes
  borrowed resources. Use [Workflow](../workflow/README.md) when execution also needs persisted history and recovery.

## Pause and resume

Pausing is cooperative. `pause()` resolves when the operation reaches its next `ctx.checkpoint()` or becomes terminal:

```ts
await using operation = task.start(async (ctx) => {
	for (const item of items) {
		await ctx.checkpoint();
		await processItem(item, ctx.signal);
	}
});

await operation.pause();
// In this multi-item operation, pause stops new items at a checkpoint.
operation.resume();
await operation.done;
```

A Task cannot suspend an in-flight `fetch()`, codec call, database statement, or other indivisible provider operation.
Put checkpoints between meaningful units of work rather than pretending arbitrary JavaScript can be frozen safely.

## Larger composition

A Task can borrow an existing resource collection while owning only its local execution lifetime:

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

The Task borrows `resources`; it does not dispose the collection. Values acquired through the Task context remain
subject to the collection's ownership rules. `done` is terminal authority. `status` is only a synchronous lifecycle
snapshot.

## Cancellation

`cancel(reason)` asks active work to stop and resolves after the Task reaches a terminal state and its owned Context has
finished cleanup:

```ts
await using operation = task.start(run, { ctx: requestContext });

await operation.cancel(new Error('request no longer needs this work'));
console.log(operation.status); // "cancelled" unless cleanup itself failed
```

If work fails and cleanup also fails, standard `SuppressedError` semantics keep both failures visible.

## Convenience and the manual equivalent

| Convenience            | Manual equivalent                                                                                                            | Concrete value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `task.start()`         | create a child context, abort controller, pause gate, terminal promise, status state machine, and cleanup ownership yourself | one finite process-local operation lifetime                                                 |
| `pause()` / `resume()` | manage pause generations and acknowledgement promises around cooperative checkpoints manually                                | pause is explicit/cooperative instead of pretending JavaScript can be suspended arbitrarily |

The manual equivalent is an `AbortController`, a child lifetime, a pause Promise, an `AsyncDisposableStack`, and one
terminal result Promise. `@okikio/task` packages those process-local lifecycle rules so every caller does not have to
rebuild the same state machine.

It deliberately does not create durable identity, retry state, queue claims, or workflow history.

## Source guide

1. `mod.ts` contains the complete Task state machine and public `start()` operation.
2. `types.ts` defines `Task`, `TaskContext`, `TaskOptions`, and lifecycle states.
3. `mod.test.ts` shows cancellation, pause generations, cleanup, and resource borrowing as executable examples.
4. Read `@okikio/context` and `@okikio/resource` when you need the ownership model behind the Task context.

Use this README for scenarios and design decisions, and [API.md](API.md) for the source-derived exported contracts.
