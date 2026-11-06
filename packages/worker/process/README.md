# `@okikio/worker/process`

A child process is a separate program started by your application. It does not share your JavaScript objects. Input and
output cross streams: stdin carries bytes into the child, stdout carries its replies, and stderr carries diagnostics.
This module can own an ordinary command or use an explicit framed protocol for typed calls. A frame marks where one
message ends, because a stream read can contain part of a message or several messages together.

A media application may need to call an installed converter, or a command-line tool may need another executable's
output. `@okikio/worker/process` starts that separate program, gathers output within a limit, and owns its shutdown. You
get one place to await the child's exit and output collection instead of coordinating several listeners yourself.

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

## Capture a short command's output

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

This example uses the Deno adapter and needs subprocess permission. Use the Node adapter with node:process.execPath on a
Node host.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run --allow-run example.ts`.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as process from '@okikio/worker/process';
import * as deno from '@okikio/runtime/deno/process';
await using ctx = context.create({ id: 'tool-output' });
// Bound captured output before starting the child. The returned exit includes the collected stdout bytes.
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

## Follow captured bytes through child shutdown

The demo launches the current Deno executable with an instruction to print `ready`. It captures at most 1,024 stdout
bytes, discards stderr, waits for the child's lifecycle, and decodes those bytes to text. The final line is `ready`. Try
changing the child's printed text to see that it is subprocess output, not a value returned by an in-process function.
Deno needs permission to launch the subprocess; the utility does not grant that permission.

The adapter answers "how do I spawn on this host?". The utility answers "who waits for exit, collects bytes, and stops
the child?". A Context supplies the operation's cancellation signal and cleanup lifetime. Importing the generic package
does not select a runtime or launch a program; the call to `exec()` does.

| Contract                                    | Meaning in this example                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `StartOptionsType.command` and `arguments`  | Executable plus ordered argument strings, not a shell command expression.                        |
| `stdout: { type: 'capture', maximumBytes }` | Retain at most the byte limit in memory; reject if it is exceeded.                               |
| `ProcessExitType`                           | `{ code: number, success: boolean, signal?: string, stdout?: Uint8Array, stderr?: Uint8Array }`. |
| `exec()`                                    | Return `Promise<ProcessExitType>` after owned process and output work settle.                    |
| `start()`                                   | Return `Promise<Process>` with `wait()`, `stop()`, and optional live streams.                    |

Internally, the generic owner resolves the stdio and shutdown settings, starts the adapter, and collects captured
streams while the child runs. It joins output collection with exit status before returning. An exit code describes the
child's result; capture failures describe an incomplete result. This distinction prevents an exited child from being
mistaken for a fully collected output. See the [public source contracts](./mod.ts) for the adapter and shutdown shapes.

## Handle a nonzero exit as ordinary result data

A converter can report a bad input through its exit code. Here a tiny Deno child prints a diagnostic and exits with
code 7. `exec()` resolves with that status; the caller chooses whether it is an expected outcome or an error.

```ts runnable=exit-status.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as process from '@okikio/worker/process';
import * as deno from '@okikio/runtime/deno/process';
await using owner = context.create({ id: 'converter-check' });
const exit = await process.exec(owner, deno.create(), {
	command: Deno.execPath(),
	arguments: ['eval', 'console.error("Unsupported input"); Deno.exit(7);'],
	stdout: { type: 'discard' },
	stderr: { type: 'capture', maximumBytes: 1024 },
});
console.log(exit.success, exit.code);
console.log(new TextDecoder().decode(exit.stderr).trim());
```

```text output
false 7
Unsupported input
```

This requires Deno subprocess permission. On Node, choose `@okikio/runtime/node/process`, `node:process.execPath`, and
Node's arguments for the child program. Executable trust and runtime permissions remain application decisions.

- **Convert an uploaded picture:** give the command a [Context](../../context/README.md), bound its output, and use
  [Dispose](../../dispose/README.md) for application-owned temporary files. The application still decides which
  executable and arguments are trusted.
- **Consume a long-running tool's records:** stream its output through [Streams](../../streams/README.md) line framing
  rather than capturing everything. Use [Telemetry](../../telemetry/README.md) to report progress; process exit and
  joined output remain the terminal evidence.

## Choose capture, streaming, or a process protocol

Capture bounded output for short commands, stream it for long commands, and use the process channel for correlated
activity protocols. Select the Node adapter for Node hosts. Direct-child ownership and POSIX process-group ownership
have different guarantees; an exited leader can leave descendants alive. wait() owns output failures while disposal
joins termination without repeating a handled capture failure. Callers still own executable trust and runtime
permissions.

## Framed requests and cancellation

The channel shares its request contracts and cleanup receipts with the thread adapter. A cancelled request stays
reserved until remote validation, encoding, handling and cleanup finish. `cancelMs` bounds that wait; if the child
cannot acknowledge release, the channel asks its Process owner to stop the child and waits for that owner before
settling requests. Ordinary protocol close leaves process lifetime authority with the Process owner.

Each JSON line has an explicit byte limit and must be valid UTF-8. Invalid byte sequences reject instead of becoming
replacement characters in an otherwise valid application string. Protocol contracts use native schemas for unchanged
representations or explicit codecs when application and serialized values differ.

## Choose adjacent capabilities

Runtime supplies native spawning. The application owns command selection and permission; a subprocess is not a durable
workflow.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/process.md) explains the model, manual alternatives,
and composition.

Activity providers built on this process transport can select one child inside
a pool. The provider owns portable identity and retirement; process and channel
lifetimes still own native close. See [Physical hosts](../../../docs/workflows/19-hosts.md).
