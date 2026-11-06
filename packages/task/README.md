# `@okikio/task`

A user starts an import and then presses Pause or Cancel. A plain Promise represents the final answer, but offers no
standard control for those buttons or for knowing when cleanup has finished. `@okikio/task` gives one local operation a
handle for pause, resume, cancellation, and an awaited result that includes its cleanup.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

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
[the short glossary](https://github.com/okikio/utils/blob/main/docs/02-learn.md#read-the-small-amount-of-code-you-need).

For control, observation, and cancellation details, read the [Task guide](../../docs/task/01-guide.md).

For work accepted by a service and resumed after worker loss, use the
[saved background-work path](https://github.com/okikio/utils/blob/main/docs/workflows/01-basics.md). A local Task
remains useful inside a process, but it is not another required scheduler for that path.

## Give an ordinary import a result and a pause button

An import screen needs a Pause button that stops admitting new records. An async function can still do the work. Here an
array stands in for the destination: no database account is required. Pausing before admission leaves it empty; resuming
saves the three normalized names. `await using` closes the handle when its block ends, including after an error.

From the repository root, run `mise run prepare -- --kind deps`, save the next block as `normalize-contacts.ts`, then run
`mise exec -- deno run normalize-contacts.ts` with the pinned Deno 2.9.7 host. The examples below use workspace imports
and local arrays; no network or database is required. Later named blocks can be saved and run in the same way.

```ts runnable=normalize-contacts.ts
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

## Observe progress separately from the result

Emit `task.ProgressEffect` through `effect.emit(ctx, task.ProgressEffect, report)` for standard progress. No key or
`progress` option is needed. Read `work.progress` or subscribe to `work.updates`; await `work.done` for the result. See
the [progress guide](../../docs/task/03-progress.md).

## Connect local controls to a visible operation

An import dialog and a finite media job both need a terminal result plus pause or cancellation controls. The ordinary
function still produces the result.

Use Task for one local controllable operation. Pass Context for lifetime and resources; add Workflow when state must
survive a process restart.

Pause is cooperative at checkpoints. It cannot suspend an arbitrary CPU loop, migrate a JavaScript stack, or undo
completed writes.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                  | Use it to                                                                | Exact contract            |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `@okikio/task`          | Use the package entry shown in the complete examples above.              | [Contract](./mod.ts)      |
| `@okikio/task/types`    | Import public types for this capability; this entry does not start work. | [Contract](./types.ts)    |
| `@okikio/task/group`    | Admit tasks through a bounded scheduler and join owned cleanup.          | [Contract](./group.ts)    |
| `@okikio/task/progress` | Project weighted display progress without controlling task results.      | [Contract](./progress.ts) |

## Measure joined children and progress

The focused benchmarks measure joined child lifetimes and shared-source progress snapshots. The benchmark compares
against ordinary Task lifecycle; raw source read. Raw reads omit weighted progress; local Tasks do not establish durable
orchestration.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
mise run test -- --project task
mise run bench -- --project task --check
mise run bench -- --project task
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Import two contact lists and join their cleanup

A screen can run several independently controllable imports. A group limits how many start and awaits their cleanup.
This is the earlier name-trimming operation applied to two small lists, with a counter proving both cleanups finished.

```ts runnable=contact-groups.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as groups from '@okikio/task/group';
await using owner = context.create({ id: 'contact-groups' });
await using group = groups.create({ ctx: owner, concurrency: 2, maximumWaiting: 2, mode: 'settled' });
let cleaned = 0;
async function start(names: string[]) {
	return await group.start(async (ctx) => {
		ctx.defer(() => {
			cleaned++;
		});
		const saved: string[] = [];
		for (const name of names) {
			// Pause takes effect here, before the next record changes application state.
			await ctx.checkpoint();
			saved.push(name.trim());
		}
		return saved.join(', ');
	});
}
const first = await start([' Ada ', ' Grace ']);
const second = await start([' Linus ']);
const summary = await group.close();
console.log(await first.done);
console.log(await second.done);
console.log('Completed:', summary.completed, 'cleaned:', cleaned);
```

```text output
Ada, Grace
Linus
Completed: 2 cleaned: 2
```

`start` waits for admission before returning a normal Task. Excess starts reject with `GroupAdmissionError` before
retaining their work; use bounded production rather than creating an unlimited Promise.all. `close` stops new starts and
drains already accepted queued work. `cancel` stops admission, cancels queued/active work cooperatively and joins it.
Parent cancellation also releases paused checkpoints. Uncooperative work can delay settlement. The group keeps counters,
not a history of child handles or results; callers keep returned Tasks when they need those outcomes.

`mode: 'fail-fast'` closes admission on the first child rejection, cancels siblings and rejects `done` with that
original value only after every accepted start and child cleanup settles. `mode: 'settled'` preserves rejections on each
Task.done and resolves group counters after close, including failed-child count and whether cancellation was requested.
It does not reinterpret a failed child as successful. Disposal cancels and joins the group; a fail-fast terminal
rejection remains visible on repeated close/disposal. No process-loss durability or forced preemption is implied.

## Display the combined progress of those contact lists

The view owns two progress cells, one for each import. Actual Task subscriptions update these cells; this isolated
example supplies the snapshots directly so their weights are inspectable. It never changes either Task's result.
The first list has two contacts and the second has one, so weights 2 and 1 make each contact an equal share.

```ts runnable=contact-progress.ts
import * as state from '@okikio/context/state';
import * as progress from '@okikio/task/progress';
using first = state.create<progress.ProgressType | undefined>({ completed: 1, total: 2 });
using second = state.create<progress.ProgressType | undefined>({ completed: 0, total: 1 });
using total = progress.combine([first.reader, second.reader], { weights: [2, 1], maximumChildren: 2 });
console.log('Saved share:', total.get().ratio?.toFixed(2));
first.set({ completed: 2, total: 2 });
second.set({ completed: 1, total: 1 });
console.log('Saved share:', total.get().ratio?.toFixed(2));
```

```text output
Saved share: 0.33
Saved share: 1.00
```

For display progress, `@okikio/task/progress` exposes `combine(readers, { weights, maximumChildren })`. It borrows
Context progress readers and returns an owned read-only projection. Each positive finite weight is a relative share
independent of the child's unit. Unknown completed/total counters keep the aggregate ratio unknown. Zero/zero is known
empty work and contributes one; an empty reader set remains unknown. Changing totals changes the ratio without changing
weights. Floating-point ratios are display data, not accounting values.

To observe a Task, own a Context cell initialized from `work.progress?.value`, then subscribe to `work.updates` and set
that cell from each standard progress occurrence. Pass the cell's reader to combine and dispose both subscriptions with
the view. The projection suppresses unchanged ratios, owns only its reader subscriptions and never cancels borrowed
tasks. A ratio of one does not settle Task.done or prove that cleanup succeeded; a task can fail after its final
progress report.

## Read further

The [Task guide](https://github.com/okikio/utils/blob/main/docs/task/01-guide.md) explains the model, manual
alternatives, and composition.

See [progress reports](https://github.com/okikio/utils/blob/main/docs/task/03-progress.md) for effect-based reports
through `updates`. `done` still owns the result.
