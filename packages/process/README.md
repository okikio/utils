`@okikio/process`
================

Purpose
-------

`@okikio/process` owns one child-process lifecycle without choosing a runtime for the caller. The generic package handles bounded output, input, cancellation, graceful shutdown, forced shutdown, process-tree capability checks, and terminal status. A small runtime adapter performs only the spawn and platform translation.

That split keeps process ownership consistent when a library runs in Node or Deno. It also prevents importing the generic package from pulling `node:child_process`, `Deno.Command`, or another host-specific process API into unrelated runtimes.

Use this package when an independently useful capability must own a subprocess. Keep queues, workflows, and domain-specific process meaning outside it.

Start here
----------

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

`exec()` owns the complete finite lifecycle. It starts the child, writes optional piped input, waits for termination, drains owned output, enforces capture limits, and returns the terminal `ProcessExitType`.

Use `start()` when the caller needs a live `Process`. The returned handle owns its child after spawn. `wait()` is terminal authority, while `stop()` is idempotent lifecycle control. Parent-context cancellation calls the same shutdown path, so disposal, explicit stop, and cancellation do not create separate cleanup rules.

Keep a live child when the caller owns its lifetime
---------------------------------------------------

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

`stop()` is idempotent. Disposing the handle and parent-context cancellation use
the same shutdown path rather than competing cleanup mechanisms.


Stream large output instead of capturing it
--------------------------------------------

Capture mode is intentionally bounded because it retains bytes in memory. When
output can be large, ask for a pipe and consume the Web stream incrementally:

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

The caller owns consumption of a piped stream. `@okikio/process` still owns the
child lifetime and final shutdown path.


Runtime adapters
----------------

`@okikio/process/node` creates a Node child through `node:child_process`. `@okikio/process/deno` creates a Deno child through `Deno.Command`. `direct-child` is available on every supported host. On POSIX hosts, both adapters also support `posix-process-group`: the child starts as the leader of a detached process group and shutdown signals target that complete group. This prevents descendants from being orphaned when the owned child launches its own processes. Windows remains `direct-child` only until a tested Windows process-tree or Job Object adapter can provide a stronger guarantee. A request for an unsupported tree mode fails with `UnsupportedTreeModeError` instead of silently degrading.

Adapters expose Web streams to the generic owner. They do not decide output limits, shutdown timing, cancellation behavior, or final result semantics. A future Bun or operating-system-specific process-tree adapter can therefore add host capability without duplicating the lifecycle implementation.

Captured output is always bounded by an explicit `maximumBytes`. Streaming and sink modes preserve backpressure instead of collecting output in memory. If a child exceeds a capture limit, `OutputLimitError` becomes the operation failure and the generic owner stops the child before returning control.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `process.start()` | spawn the child, convert Node streams to Web streams, link cancellation, enforce output limits, and own stop/cleanup yourself | one cross-runtime child-process lifetime |
| `process.capture()` | consume stdout/stderr with byte bounds while awaiting exit and preserving failure information | bounded collecting convenience over the streaming process |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/process` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with Deno.Command or node:child_process plus AbortSignal and manual stdout/stderr/process-tree cleanup.

The utility keeps process lifetime, cancellation, disposal, and runtime adapters under one provider-neutral contract.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Expected stop failure
---------------------

`ProcessStopTimeoutError` means a child did not reach terminal state inside the
configured graceful/forced stop window. The owned process remains a lifecycle
problem the caller must surface; the utility does not pretend the process exited.



Unexpected channel faults
-------------------------

The channel subpath projects unexpected thrown values through `@okikio/fault`
before JSON framing. Expected declared failures continue to use
`@okikio/failure`. This keeps diagnostic serialization bounded and prevents
arbitrary fault objects from controlling the framing path through getters,
cycles, or custom string conversion.

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
