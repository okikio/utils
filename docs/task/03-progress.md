# 03 — Report progress

A Task runs one local operation. Its `done` promise gives the result after cleanup. Progress tells a caller what that
operation has reached so far. Progress does not settle the result.

For an import screen, `completed: 2` means the operation has reported two finished units. It does not mean the whole
import is complete or that its cleanup has finished. A Promise is the eventual answer; `await work.done` waits for that
answer. Progress is a separate stream of updates that can change the display while the Promise is still pending.

Use `task.ProgressEffect` for the standard counters, message, and optional JSON data. Emit it without a key. Tasks
recognize it automatically. The first example uses that standard report to describe the same contact import from the Task README.
Save it as `import-progress.ts`, after `mise run prepare -- --kind deps`, and run
`mise exec -- deno run import-progress.ts`.

```ts runnable=import-progress.ts
import * as task from '@okikio/task';
import * as effect from '@okikio/capability/effect';

const names = [' Ada ', ' Grace '];
const saved: string[] = [];
/** A terminal result must not become available until this cleanup has run. */
let cleaned = false;

await using work = task.start(async (ctx) => {
	ctx.defer(() => {
		cleaned = true;
	});
	for (const name of names) {
		// Give cancellation and cooperative pause a boundary before each write.
		await ctx.checkpoint();
		saved.push(name.trim());
		// Report completed writes. A progress counter does not settle work.done.
		await effect.emit(ctx, task.ProgressEffect, {
			completed: saved.length,
			total: names.length,
			unit: 'contacts',
			message: 'Saved contact',
		});
	}
	return saved.join(', ');
});

console.log('Result:', await work.done);
console.log('Latest:', work.progress?.value.completed, '/', work.progress?.value.total);
console.log('Cleanup finished:', cleaned);
```

```text output
Result: Ada, Grace
Latest: 2 / 2
Cleanup finished: true
```

`start` returns a handle while the function runs. Emit after each successful write. `updates` is for a live display;
`progress` keeps its latest snapshot; `done` supplies the result after cleanup. Reading a counter of 2 is not equivalent
to awaiting `done`: cleanup or a later operation could still fail. This example reads the snapshot after completion to
make its output deterministic without needing to coordinate a subscription.

## Give the same import an application-specific report

Use a custom effect only when the standard counters/message/data shape cannot describe your display. The following
smaller variation reports a validated row count. It deliberately gates work until the subscription exists so the printed
callback is deterministic. The gate is demonstration setup, not a requirement for real Tasks.

Declare the report as an effect. Select that effect when starting the Task. Subscribe to `updates` to display accepted
reports.

```ts runnable
import * as task from '@okikio/task';
import * as effect from '@okikio/capability/effect';
import * as schema from '@okikio/schema';

const Rows = effect.define({
	id: 'import.rows',
	value: schema.define((value: unknown) => {
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
			throw new TypeError('Expected a nonnegative row count.');
		}
		return value;
	}),
});
const ready = Promise.withResolvers<void>();
await using work = task.start(async (ctx) => {
	await ready.promise;
	await ctx.checkpoint();
	// In an import, report this count after the corresponding write commits.
	await effect.emit(ctx, Rows, 200, { key: 'rows:200' });
	return 200;
}, { progress: Rows });
using subscription = work.updates.subscribe((report) => {
	console.log('Rows:', report.value);
});
ready.resolve();
console.log('Result:', await work.done);
```

```text output
Rows: 200
Result: 200
```

The `ready` promise only makes the example's subscription order explicit. Real work can begin immediately. Read
`work.progress` for its latest accepted report if a subscriber attaches late. A new subscription receives future
reports. It does not replay the previous report.

The application supplies the report schema and decides when to emit. The Task validates each occurrence through the
effect API. It keeps the latest accepted report in memory. It uses `@okikio/observables` for subscriptions. Pending
notifications may combine into one latest snapshot. This is suitable for a progress display. Use a durable outbox when
every occurrence must be delivered.

A progress report needs no response from the display. A failed display does not fail the Task. Supply `onError` to
record subscriber failures. A callback still runs JavaScript in this process, so expensive synchronous display code can
block the event loop. Keep callbacks short.

A Task can also declare business effects with `effects: [Charged]`. Supply their recipient with `emitter`. The standard
`task.ProgressEffect` and the exact custom definition selected by `progress` become progress snapshots. Other effects go
to that recipient. A missing recipient rejects emission. The Task does not silently treat a credit charge as a progress
report.

When the Task ends, it joins cleanup and completes the update stream. Unsubscribing only detaches a display. Call
`work.cancel()` to request cancellation. Report values, subscriptions, and Task status do not survive process loss. Use
[saved progress](../workflows/12-progress.md) for durable workers.
