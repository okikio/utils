# Control one local operation and await its result

A Promise represents an answer that will arrive later. `await` waits for that answer, but a Promise by itself has no
Pause or Cancel button. A Task keeps the ordinary async work function and adds those controls, plus cleanup that finishes
before its `done` Promise settles. A **checkpoint** is a place where that work agrees to pause or notice cancellation.

A task is local to a process. Pausing requires cooperation. It does not create a persistent queue or record workflow
history.

## Finish an import and inspect its result

Start one local import and await its terminal result. The task supplies the lifetime and controls; the operation still
returns the value. Later examples add checkpoints where pause and cancellation can cooperate with the work.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as a `.ts` file in your project and use
`mise exec -- deno run example.ts`.

```ts runnable=package-task.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as task from '@okikio/task';

const names = [' Ada ', 'Grace ', ' Linus'];
const saved: string[] = [];
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

- **Pause a multi-file import:** place checkpoints between files, use [Streams](../../packages/streams/README.md) for
  incremental input, and pass the task signal into actual I/O. Checkpoints do not interrupt an indivisible database or
  codec call.
- **Use an already-open connection:** borrow a [Resource](../../packages/capability/resource/README.md) collection or a
  value leased from [Pool](../../packages/pool/README.md). The task owns its local execution and registered cleanup; the
  outer owner still closes borrowed resources. Use [Workflow](../../packages/workflow/README.md) when execution also
  needs persisted history and recovery.

## Pause and resume

Pausing is cooperative. `pause()` resolves when the operation reaches its next `ctx.checkpoint()` or becomes terminal:

```ts
await using operation = task.start(async (ctx) => {
	for (const item of items) {
		// Pause takes effect here, before the next record changes application state.
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

## Decide which bookkeeping to keep in your application

| Convenience            | Manual equivalent                                                                                                            | Concrete value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `task.start()`         | create a child context, abort controller, pause gate, terminal promise, status state machine, and cleanup ownership yourself | one finite process-local operation lifetime                                                 |
| `pause()` / `resume()` | manage pause generations and acknowledgement promises around cooperative checkpoints manually                                | pause is explicit/cooperative instead of pretending JavaScript can be suspended arbitrarily |

The manual equivalent is an `AbortController`, a child lifetime, a pause Promise, an `AsyncDisposableStack`, and one
terminal result Promise. `@okikio/task` packages those process-local lifecycle rules so every caller does not have to
rebuild the same state machine.

It deliberately does not create durable identity, retry state, queue claims, or workflow history.

## Source guide

The paths below are relative to the [package directory](../../packages/task).

1. `mod.ts` contains the complete Task state machine and public `start()` operation.
2. `types.ts` defines `Task`, `TaskContext`, `TaskOptions`, and lifecycle states.
3. `mod.test.ts` shows cancellation, pause generations, cleanup, and resource borrowing as executable examples.
4. Read `@okikio/context` and `@okikio/capability/resource` when you need the ownership model behind the Task context.

Use this guide for scenarios and design decisions, and [the package source](../../packages/task/mod.ts) for the
source-derived exported contracts.
