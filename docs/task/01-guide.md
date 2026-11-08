# Control one local operation and await its result

A Promise represents an answer that will arrive later. `await` waits for that answer, but a Promise by itself has no
Pause or Cancel button. A Task keeps the ordinary async work function and adds those controls, plus cleanup that finishes
before its `done` Promise settles. A **checkpoint** is a place where that work agrees to pause or notice cancellation.

A task is local to a process. Pausing requires cooperation. It does not create a persistent queue or record workflow
history.

## Finish an import and inspect its result

Start one local import and await its terminal result. The task supplies the lifetime and controls; the operation still
returns the value. Later examples add checkpoints where pause and cancellation can cooperate with the work.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `finish-import.ts` at the checkout root and use
`mise exec -- deno run finish-import.ts`.

```ts runnable=finish-import.ts
import * as task from '@okikio/task';

// Fixture: keep the input local so pausing does not depend on network timing.
const names = [' Ada ', 'Grace ', ' Linus'];
const saved: string[] = [];

// Start the import; the Task owns its Context and any cleanup registered there.
await using work = task.start(async (ctx) => {
	for (const name of names) {
		// Pause takes effect here, before the next record changes application state.
		await ctx.checkpoint();
		saved.push(name.trim());
	}
	return saved;
}, { id: 'contact-import' });

// Wait until the operation reaches a checkpoint; a pause request cannot interrupt arbitrary code.
await work.pause();
console.log('Saved while paused:', saved.length);

// Resume permits the next checkpoint to continue; it does not itself produce a result.
work.resume();

// done settles after task cleanup, so the owner can use the final result.
console.log((await work.done).join(', '));
```

```text output
Saved while paused: 0
Ada, Grace, Linus
```

## Release a temporary export URL before returning

A contact preview uses a temporary Blob URL to read an export. That URL must be revoked after the read, including when
work fails or is cancelled. Registering it with the task keeps that responsibility beside the work. Awaiting `done`
means the exported text is available and the temporary URL has already been released.

```ts runnable
import * as task from '@okikio/task';

// Register the URL immediately, so a failed Fetch also releases it.
await using work = task.start(async (ctx) => {
	const url = ctx.adopt(URL.createObjectURL(new Blob(['Name\nAda\nGrace\n'])), URL.revokeObjectURL);
	const response = await fetch(url, { signal: ctx.signal });
	return { text: await response.text(), url };
}, { id: 'contact-preview' });

// The result arrives after registered cleanup, including URL revocation.
const exportFile = await work.done;
console.log(exportFile.text.trim());

// This second read checks release; an application would use exportFile.text instead.
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

- **Pause a multi-file import:** place checkpoints between files, use [Streams](../../packages/streams/README.md) for
  incremental input, and pass the task signal into actual I/O. Checkpoints do not interrupt an indivisible database or
  codec call.
- **Use an already-open connection:** borrow a [Resource](../../packages/capability/resource/README.md) collection or a
  value leased from [Pool](../../packages/pool/README.md). The task owns its local execution and registered cleanup; the
  outer owner still closes borrowed resources. Use [Workflow](../../packages/workflow/README.md) when execution also
  needs persisted history and recovery.

## Pause and resume

Pausing is cooperative. `pause()` resolves when the operation reaches its next `ctx.checkpoint()` or becomes terminal.
The following application sketch assumes `items` and `processItem` are supplied by your import; the complete local
example above demonstrates the same control sequence:

```ts
await using operation = task.start(async (ctx) => {
	for (const item of items) {
		// Pause takes effect here, before the next record changes application state.
		await ctx.checkpoint();
		await processItem(item, ctx.signal);
	}
});

// Request a pause, then wait for acknowledgement at a checkpoint.
await operation.pause();
// In this multi-item operation, pause stops new items at a checkpoint.
operation.resume();

// Join the final result and Task-owned cleanup after work continues.
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
		// Pause takes effect here, before the next record changes application state.
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

The Task uses the supplied resource collection without closing it. The collection still decides when its
values close. Read `status` for the state at that moment. Await `done` for the final result after cleanup.

## Cancellation

`cancel(reason)` asks active work to stop and resolves after the Task reaches a terminal state and its owned Context has
finished cleanup:

```ts
await using operation = task.start(run, { ctx: requestContext });

await operation.cancel(new Error('request no longer needs this work'));
console.log(operation.status); // "cancelled" unless cleanup itself failed
```

If work fails and cleanup also fails, standard `SuppressedError` semantics keep both failures visible.

## Decide which bookkeeping to keep in your application

| Convenience            | Manual equivalent                                                                                                            | Concrete value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `task.start()`         | create a child context, abort controller, pause gate, terminal promise, status state machine, and cleanup ownership yourself | one finite process-local operation lifetime                                                 |
| `pause()` / `resume()` | manage pause generations and acknowledgement promises around cooperative checkpoints manually                                | pause is explicit/cooperative instead of pretending JavaScript can be suspended arbitrarily |

To write this yourself, use an `AbortController` to ask work to stop, a Promise to wait during a pause, and an
`AsyncDisposableStack` to close resources. Keep the result in a separate Promise that finishes after cleanup.
`@okikio/task` coordinates these steps for one process.

It deliberately does not create durable identity, retry state, queue claims, or workflow history.

## Source guide

The paths below are relative to the [package directory](../../packages/task).

1. `mod.ts` contains the complete Task state machine and public `start()` operation.
2. `types.ts` defines `Task`, `TaskContext`, `TaskOptions`, and lifecycle states.
3. `mod.test.ts` shows cancellation, pause generations, cleanup, and resource borrowing as executable examples.
4. Read `@okikio/context` and `@okikio/capability/resource` when you need the ownership model behind the Task context.

Use this guide for scenarios and design decisions, and [the package source](../../packages/task/mod.ts) for the
source-derived exported contracts.
