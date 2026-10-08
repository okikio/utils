# `@okikio/process`

A media application may need to call an installed converter, or a command-line tool may need another executable's
output. `@okikio/process` starts that separate program, gathers output within a limit, and owns its shutdown. You get
one place to await the child's exit and output collection instead of coordinating several listeners yourself.

A **subprocess** is a separate operating-system program. An **adapter** is the small runtime-specific implementation
that starts it in Deno or Node. The generic package keeps the caller's lifecycle contract the same across those hosts.

```text
Caller + Context -> chosen adapter -> child program
                                       |
                      stdout bytes <---+---> exit status
                            |                   |
                      enforce byte limit        |
                            +--------- join ----+
                                       |
                                exec() returns
```

Read the two output branches together: observing exit alone is not the complete captured-output result. Cancellation
requests shutdown through the adapter. Descendant handling depends on the selected ownership mode and platform; this is
not a promise to reap arbitrary grandchildren.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

## Run a complete example

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

This example uses the Deno adapter and needs subprocess permission. Use the Node adapter with node:process.execPath on a
Node host.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as process from '@okikio/process';
import * as deno from '@okikio/process/deno';
await using ctx = context.create({ id: 'tool-output' });
const exit = await process.exec(ctx, deno.create(), {
	command: Deno.execPath(),
	arguments: ['eval', 'console.log("ready")'],
	stdout: { type: 'capture', maximumBytes: 1024 },
	stderr: { type: 'discard' },
});
console.log(new TextDecoder().decode(exit.stdout).trim());
```

Expected output:

```text output
ready
```

`exec()` returns `Promise<ProcessExitType>` after the child and output capture settle. Its `stdout` is a captured
`Uint8Array`; the final string is `ready`. The operation owns and closes its child handle. Bounded capture failure
rejects, and the context signal requests termination according to the selected adapter and ownership mode.

## Read the mini-demo

The demo launches the current Deno executable with an instruction to print `ready`. It captures at most 1,024 stdout
bytes, discards stderr, waits for the child's lifecycle, and decodes those bytes to text. The final line is `ready`. Try
changing the child's printed text to see that it is subprocess output, not a value returned by an in-process function.
Deno needs permission to launch the subprocess; the utility does not grant that permission.

- **Convert an uploaded picture:** give the command a [Context](../context/README.md), bound its output, and use
  [Dispose](../dispose/README.md) for application-owned temporary files. The application still decides which executable
  and arguments are trusted.
- **Consume a long-running tool's records:** stream its output through [Streams](../streams/README.md) line framing
  rather than capturing everything. Use [Telemetry](../telemetry/README.md) to report progress; process exit and joined
  output remain the terminal evidence.

## Build on the example

Capture bounded output for short commands, stream it for long commands, and use the process channel for correlated
activity protocols. Select the Node adapter for Node hosts. Direct-child ownership and POSIX process-group ownership
have different guarantees; an exited leader can leave descendants alive. wait() owns output failures while disposal
joins termination without repeating a handled capture failure. Callers still own executable trust and runtime
permissions.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/process` owns one child-process lifecycle without choosing a runtime for the caller. The generic package
handles bounded output, input, cancellation, graceful shutdown, forced shutdown, process-tree capability checks, and
terminal status. A small runtime adapter performs only the spawn and platform translation.

That split keeps process ownership consistent when a library runs in Node or Deno. It also prevents importing the
generic package from pulling `node:child_process`, `Deno.Command`, or another host-specific process API into unrelated
runtimes.

Use this package when an independently useful capability must own a subprocess. Keep queues, workflows, and
domain-specific process meaning outside it.

Do not add a second watcher or restart supervisor around a runtime command that already owns that lifecycle. For
example, `deno serve --watch` already watches the module graph, stops the previous server, and rebinds its listener. If
unrelated services restart together, inspect their static import graph and composition ownership before introducing
another process layer.

## Start here

Select the adapter at the composition point, then pass it to `start()` or `exec()`.

```ts
import * as context from '@okikio/context';
import * as process from '@okikio/process';
import * as node from '@okikio/process/node';
import nodeProcess from 'node:process';

await using ctx = context.create({ id: 'tool-version' });
const result = await process.exec(ctx, node.create(), {
	command: nodeProcess.execPath,
	arguments: ['--version'],
	stdout: { type: 'capture', maximumBytes: 64 * 1024 },
	stderr: { type: 'capture', maximumBytes: 64 * 1024 },
});
```

`exec()` owns the complete finite lifecycle. It starts the child, writes optional piped input, waits for termination,
drains owned output, enforces capture limits, and returns the terminal `ProcessExitType`.

Use `start()` when the caller needs a live `Process`. The returned handle owns its child after spawn. `wait()` is
terminal authority, while `stop()` is idempotent lifecycle control. Parent-context cancellation calls the same shutdown
path, so disposal, explicit stop, and cancellation do not create separate cleanup rules.

## Keep a live child when the caller owns its lifetime

```ts
await using child = await process.start(ctx, node.create(), {
	command: nodeProcess.execPath,
	arguments: ['-e', 'setTimeout(() => {}, 60_000)'],
	stdout: { type: 'discard' },
	stderr: { type: 'capture', maximumBytes: 64 * 1024 },
});

console.log(child.pid);
await child.stop('host shutdown');
const exit = await child.wait();
```

`stop()` is idempotent. Disposing the handle and parent-context cancellation use the same shutdown path rather than
competing cleanup mechanisms.

## Stream large output instead of capturing it

Capture mode is intentionally bounded because it retains bytes in memory. When output can be large, ask for a pipe and
consume the Web stream incrementally:

```ts
await using child = await process.start(ctx, node.create(), {
	command: nodeProcess.execPath,
	arguments: ['large-output.mjs'],
	stdout: 'piped',
	stderr: { type: 'capture', maximumBytes: 64 * 1024 },
});

if (child.stdout === undefined) throw new Error('stdout was not piped');
for await (const chunk of streams.iterable(child.stdout)) {
	await destination.write(chunk);
}

const exit = await child.wait();
```

The caller owns consumption of a piped stream. `@okikio/process` still owns the child lifetime and final shutdown path.

## Runtime adapters

`@okikio/process/node` creates a Node child through `node:child_process`. `@okikio/process/deno` creates a Deno child
through `Deno.Command`. `direct-child` is available on every supported host. On POSIX hosts, both adapters also support
`posix-process-group`: the child starts as the leader of a detached process group and shutdown signals target that
complete group. This lets shutdown target descendants even after the group leader exits. The host must still reap
orphaned children, for example through a container init process: sending termination signals does not reap them. Windows
remains `direct-child` only until a tested Windows process-tree or Job Object adapter can provide a stronger guarantee.
A request for an unsupported tree mode fails with `UnsupportedTreeModeError` instead of silently degrading.

Adapters expose Web streams to the generic owner. They do not decide output limits, shutdown timing, cancellation
behavior, or final result semantics. A future Bun or operating-system-specific process-tree adapter can therefore add
host capability without duplicating the lifecycle implementation.

Captured output is always bounded by an explicit `maximumBytes`. Streaming and sink modes preserve backpressure instead
of collecting output in memory. If a child exceeds a capture limit, `OutputLimitError` becomes the operation failure and
the generic owner stops the child before returning control.

## Convenience and the manual equivalent

| Convenience       | Manual equivalent                                                                                                             | Concrete value                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `process.start()` | spawn the child, convert Node streams to Web streams, link cancellation, enforce output limits, and own stop/cleanup yourself | one cross-runtime child-process lifetime                   |
| `process.exec()`  | consume configured stdout/stderr with byte bounds while awaiting exit and preserving failure information                      | finite execution with explicit capture or streaming policy |

`@okikio/process` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with Deno.Command
or node:child_process plus AbortSignal and manual stdout/stderr/process-tree cleanup.

The utility keeps process lifetime, cancellation, disposal, and runtime adapters under one provider-neutral contract.

## Expected stop failure

`ProcessStopTimeoutError` means a child did not reach terminal state inside the configured graceful/forced stop window.
The owned process remains a lifecycle problem the caller must surface; the utility does not pretend the process exited.

## Unexpected channel faults

The channel subpath projects unexpected thrown values through `@okikio/fault` before JSON framing. Expected declared
failures continue to use `@okikio/failure`. This keeps diagnostic serialization bounded and prevents arbitrary fault
objects from controlling the framing path through getters, cycles, or custom string conversion.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.
