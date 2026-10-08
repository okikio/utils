# @okikio/process contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                          | Source                                   | Reference                       |
| ------------------------------- | ---------------------------------------- | ------------------------------- |
| `@okikio/process`               | [./mod.ts](./mod.ts)                     | [root](#root)                   |
| `@okikio/process/channel`       | [./channel/mod.ts](./channel/mod.ts)     | [channel](#channel)             |
| `@okikio/process/channel/types` | [./channel/types.ts](./channel/types.ts) | [channel-types](#channel-types) |
| `@okikio/process/deno`          | [./deno.ts](./deno.ts)                   | [deno](#deno)                   |
| `@okikio/process/node`          | [./node.ts](./node.ts)                   | [node](#node)                   |
| `@okikio/process/types`         | [./types.ts](./types.ts)                 | [types](#types)                 |

## root

Import `@okikio/process`. [Source](./mod.ts).

Own subprocess termination and bounded output with one lifecycle contract across Deno and Node. A raw spawn plus
scattered listeners can leave descendants alive or report success before output collection settles.

Capture bounded output for short commands, stream it for long commands, and use the process channel for correlated
activity protocols. Select the Node adapter for Node hosts. Direct-child ownership and POSIX process-group ownership
have different guarantees; an exited leader can leave descendants alive. wait() owns output failures while disposal
joins termination without repeating a handled capture failure. Callers still own executable trust and runtime
permissions.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                           |
| ------------------ | ------------------------------------------------------------------ |
| `EventBus`         | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `contextCore`      | [context contracts](../context/API.md)                             |
| `Context`          | [context contracts](../context/API.md)                             |
| `Adapter`          | [Source](types.ts)                                                 |
| `ExecOptionsType`  | [Source](types.ts)                                                 |
| `OutputModeType`   | [Source](types.ts)                                                 |
| `Process`          | [Source](types.ts)                                                 |
| `ProcessEventType` | [Source](types.ts)                                                 |
| `ProcessExitType`  | [Source](types.ts)                                                 |
| `SignalType`       | [Source](types.ts)                                                 |
| `Spawned`          | [Source](types.ts)                                                 |
| `SpawnOptionsType` | [Source](types.ts)                                                 |
| `StartOptionsType` | [Source](types.ts)                                                 |
| `StdioType`        | [Source](types.ts)                                                 |
| `TreeModeType`     | [Source](types.ts)                                                 |

### root: exec

[Declaration source](mod.ts#L418)

```text
async function exec(ctx: Context, adapter: Adapter, options: ExecOptionsType): Promise<ProcessExitType>
  Runs one finite process and returns its terminal status and captured output.
```

### root: start

[Declaration source](mod.ts#L410)

````text
async function start(ctx: Context, adapter: Adapter, options: StartOptionsType): Promise<Process>
  Starts one child through an explicit runtime adapter.

  The adapter finishes once the process has spawned. From that point the returned
  handle owns output pumps, parent cancellation, graceful shutdown, forced
  escalation, and final disposal. Keeping those rules here means a Node process
  and a Deno process present the same lifecycle to higher-level libraries.

  @example
      ```ts
      import '@okikio/duration/polyfill';
      import '@okikio/dispose/polyfill';
      import nodeProcess from 'node:process';
      import * as context from '@okikio/context';
      import * as process from '@okikio/process';
      import * as node from '@okikio/process/node';

      await using ctx = context.create({ id: 'version-check' });
      await using child = await process.start(ctx, node.create(), {
        command: nodeProcess.execPath,
        arguments: ['--version'],
        stdout: { type: 'capture', maximumBytes: 4096 },
      });
      const exit = await child.wait();
      console.log(exit.success);
      ```
````

### root: OutputLimitError

[Declaration source](mod.ts#L55)

```text
class OutputLimitError extends Error
  Captured child output exceeded its configured byte limit.

  constructor(stream: "stdout" | "stderr", maximumBytes: number)
    Create this OutputLimitError from the explicit contract values supplied by its caller.
  readonly stream: "stdout" | "stderr"
    Async observation or data stream owned under this contract.
  readonly maximumBytes: number
    Maximum byte budget admitted or retained by this operation.
```

### root: ProcessStopTimeoutError

[Declaration source](mod.ts#L71)

```text
class ProcessStopTimeoutError extends Error
  Child process did not stop within the graceful and forced shutdown periods.

  constructor(pid: number)
    Create this ProcessStopTimeoutError from the explicit contract values supplied by its caller.
  readonly pid: number
    Native process identifier; it is not a durable activity identity.
```

### root: UnsupportedTreeModeError

[Declaration source](mod.ts#L42)

```text
class UnsupportedTreeModeError extends Error
  Requested process-tree ownership mode is not implemented by the selected adapter.

  constructor(tree: TreeModeType)
    Create this UnsupportedTreeModeError from the explicit contract values supplied by its caller.
  readonly tree: TreeModeType
    Requested process ownership mode that the selected adapter does not support.
```

### root: Adapter

[Declaration source](mod.ts#L500)

```text
reference Adapter: ./packages/process/types.ts:124:1
```

### root: ExecOptionsType

[Declaration source](mod.ts#L501)

```text
reference ExecOptionsType: ./packages/process/types.ts:181:1
```

### root: OutputModeType

[Declaration source](mod.ts#L502)

```text
reference OutputModeType: ./packages/process/types.ts:25:1
```

### root: Process

[Declaration source](mod.ts#L503)

```text
reference Process: ./packages/process/types.ts:159:1
```

### root: ProcessEventType

[Declaration source](mod.ts#L504)

```text
reference ProcessEventType: ./packages/process/types.ts:136:1
```

### root: ProcessExitType

[Declaration source](mod.ts#L505)

```text
reference ProcessExitType: ./packages/process/types.ts:145:1
```

### root: ShutdownPolicyType

[Declaration source](mod.ts#L506)

```text
reference ShutdownPolicyType: ./packages/process/types.ts:33:1
```

### root: SignalType

[Declaration source](mod.ts#L507)

```text
reference SignalType: ./packages/process/types.ts:6:1
```

### root: SpawnOptionsType

[Declaration source](mod.ts#L509)

```text
reference SpawnOptionsType: ./packages/process/types.ts:72:1
```

### root: Spawned

[Declaration source](mod.ts#L508)

```text
reference Spawned: ./packages/process/types.ts:104:1
```

### root: StartOptionsType

[Declaration source](mod.ts#L510)

```text
reference StartOptionsType: ./packages/process/types.ts:45:1
```

### root: StatusType

[Declaration source](mod.ts#L511)

```text
reference StatusType: ./packages/process/types.ts:94:1
```

### root: StdioType

[Declaration source](mod.ts#L512)

```text
reference StdioType: ./packages/process/types.ts:69:1
```

### root: TreeModeType

[Declaration source](mod.ts#L513)

```text
reference TreeModeType: ./packages/process/types.ts:3:1
```

## channel

Import `@okikio/process/channel`. [Source](./channel/mod.ts).

Bounded newline-framed JSON request channels above `@okikio/process`.

`@okikio/process` remains the sole owner of spawn, signals, process-tree behavior, exit, and shutdown. This subpath only
owns framing, request correlation, validation, optional notices, reverse calls, and cooperative pause controls carried
through the child process streams.

Stdout must be reserved for protocol frames. Use the child process stderr policy for diagnostics so arbitrary logs
cannot corrupt framing.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source                                           |
| ------------------------ | ------------------------------------------------------------------ |
| `EventBus`               | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `contextCore`            | [context contracts](../context/API.md)                             |
| `Context`                | [context contracts](../context/API.md)                             |
| `failure`                | [failure contracts](../failure/API.md)                             |
| `faultCore`              | [fault contracts](../fault/API.md)                                 |
| `EncodedFailure`         | [failure contracts](../failure/API.md)                             |
| `schema`                 | [schema contracts](../schema/API.md)                               |
| `ProcessChannel`         | [Source](channel/types.ts)                                         |
| `ProcessChannelOptions`  | [Source](channel/types.ts)                                         |
| `ProcessChannelProtocol` | [Source](channel/types.ts)                                         |
| `ProcessChannelSource`   | [Source](channel/types.ts)                                         |
| `ProcessEventType`       | [Source](channel/types.ts)                                         |
| `ProcessProtocolOptions` | [Source](channel/types.ts)                                         |
| `ProcessRequestControl`  | [Source](channel/types.ts)                                         |
| `ProcessRequestFrame`    | [Source](channel/types.ts)                                         |
| `ProcessRequestOptions`  | [Source](channel/types.ts)                                         |
| `ProcessServeOptions`    | [Source](channel/types.ts)                                         |
| `ProcessServer`          | [Source](channel/types.ts)                                         |

### channel: open

[Declaration source](channel/mod.ts#L774)

```text
function open<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(ctx: Context, child: ProcessChannelSource, options: ProcessChannelOptions<Request, Response, Notice, CallRequest, CallResponse>): ProcessChannel<Request, Response>
  Open one request channel above a child process with piped stdin and stdout.

  Closing the channel does not replace process lifetime ownership. It asks the
  child protocol server to close, settles channel-local requests, and releases
  stream locks. The caller still owns the `Process` and decides when to stop or
  dispose it.
```

### channel: protocol

[Declaration source](channel/mod.ts#L131)

```text
function protocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(options: ProcessProtocolOptions<Request, Response, Notice, CallRequest, CallResponse>): ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>
  Define and validate one immutable process channel protocol.
```

### channel: serve

[Declaration source](channel/mod.ts#L790)

```text
function serve<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(options: ProcessServeOptions<Request, Response, Notice, CallRequest, CallResponse>): ProcessServer
  Serve one framed protocol over child-process stdin/stdout streams.

  The server owns only request contexts and stream locks. The executable that
  calls this function remains responsible for its process lifetime and exit
  code. `close()` cancels active requests, rejects pending reverse calls, sends
  the close acknowledgement, and releases stream locks.
```

### channel: ChannelClosedError

[Declaration source](channel/mod.ts#L78)

```text
class ChannelClosedError extends Error
  The channel closed before one pending request reached a terminal response.

  constructor(reason?: unknown)
    Create one terminal error for a request attempted after channel shutdown.
  readonly reason: unknown
    Local or remote reason associated with channel shutdown.
```

### channel: ChannelFailureError

[Declaration source](channel/mod.ts#L39)

```text
class ChannelFailureError extends Error
  A framed process peer returned an expected encoded failure.

  constructor(failure: EncodedFailure)
    Create one parent-side error for a declared child failure envelope.
  readonly failure: EncodedFailure
    Encoded declared failure returned by the child request.
```

### channel: ChannelFaultError

[Declaration source](channel/mod.ts#L52)

```text
class ChannelFaultError extends Error
  The child process reported an unexpected request fault.

  constructor(fault: unknown)
    Create one parent-side error for an unexpected child fault.
  readonly fault: unknown
    Cloneable unexpected fault reported by the child process.
```

### channel: ChannelProtocolError

[Declaration source](channel/mod.ts#L65)

```text
class ChannelProtocolError extends Error
  Framing, correlation, or schema validation no longer makes the process channel trustworthy.

  constructor(message: string, value?: unknown)
    Create one protocol error and retain the invalid value for local diagnostics.
  readonly value: unknown
    Invalid frame or payload value that made request correlation untrustworthy.
```

### channel: ProcessCallProtocol

[Declaration source](channel/types.ts#L7)

```text
interface ProcessCallProtocol<Request, Response>
  Optional child-to-parent request/result contract used inside one active process request.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates child-to-parent reverse-call requests.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this process call.
```

### channel: ProcessChannel

[Declaration source](channel/types.ts#L79)

```text
interface ProcessChannel<Request, Response> extends AsyncDisposable
  Owned parent-side framed request endpoint. The underlying Process keeps process lifetime authority.

  readonly pid: number
    Operating-system process ID used only for diagnostics and process ownership.
  readonly events: EventBus<ProcessEventType>["events"]
    Read-only local observations for request and channel lifecycle changes.
  request(ctx: Context, request: Request, options?: ProcessRequestOptions): Promise<Response>
    Send one correlated request and await its sole terminal response.
  pause(id: string): Promise<void>
    Block the matching child request at its next cooperative checkpoint.
  resume(id: string): Promise<void>
    Release the matching paused checkpoint generation.
  close(reason?: unknown): Promise<void>
    Stop new requests and close the framed protocol without taking process-lifecycle authority.
```

### channel: ProcessChannelOptions

[Declaration source](channel/types.ts#L65)

```text
interface ProcessChannelOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while opening one framed channel above an owned process.

  readonly protocol: ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact schemas for requests, responses, notices, failures, and reverse calls.
  readonly maximumFrameBytes?: number
    Maximum UTF-8 bytes in one JSON frame, excluding the newline delimiter.
  readonly requestId?: () => string
    Optional factory used when the caller does not supply a process request ID.
  readonly notice?: ProcessNoticeSink<Notice>
    Optional observation contract or callback for this process channel.
  readonly call?: ProcessCallRun<CallRequest, CallResponse>
    Make one correlated reverse request while this process channel remains active.
```

### channel: ProcessChannelProtocol

[Declaration source](channel/types.ts#L15)

```text
interface ProcessChannelProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Schemas that define one framed child-process request protocol.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates parent-to-child request payloads.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this process channel.
  readonly failure?: StandardSchemaV1<unknown, EncodedFailure>
    Optional schema for encoded declared failures returned by child requests.
  readonly notice?: StandardSchemaV1<unknown, Notice>
    Optional observation contract or callback for this process channel.
  readonly call?: ProcessCallProtocol<CallRequest, CallResponse>
    Make one correlated reverse request while this process channel remains active.
```

### channel: ProcessProtocolOptions

[Declaration source](channel/types.ts#L29)

```text
interface ProcessProtocolOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> extends ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>
  Input accepted by `channel.protocol()`.
```

### channel: ProcessRequestControl

[Declaration source](channel/types.ts#L95)

```text
interface ProcessRequestControl<Notice = never, CallRequest = never, CallResponse = never>
  Controls available to one child-side active request.

  checkpoint(): Promise<void>
    Wait while the parent has paused this request and recheck cancellation before returning.
  notify(notice: Notice): Promise<void>
    Publish one optional non-authoritative notice to the parent.
  call(request: CallRequest): Promise<CallResponse>
    Make one correlated reverse call to the parent and await its result.
```

### channel: ProcessRequestFrame

[Declaration source](channel/types.ts#L136)

```text
interface ProcessRequestFrame<Request>
  Parent-to-child request frame.

  readonly type: "request"
    Stable discriminant for this process request variant.
  readonly id: string
    Optional caller-supplied correlation ID for one process request.
  readonly context: Snapshot
    Serializable execution-context snapshot restored by the receiving host.
  readonly request: Request
    Request payload validated before child-side execution begins.
```

### channel: ProcessRequestOptions

[Declaration source](channel/types.ts#L33)

```text
interface ProcessRequestOptions
  Correlation options for one process-channel request.

  readonly id?: string
    Optional caller-supplied correlation ID for one process request.
```

### channel: ProcessServeOptions

[Declaration source](channel/types.ts#L112)

```text
interface ProcessServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while serving one framed process protocol.

  readonly protocol: ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact framed protocol contract accepted by the child server.
  readonly input: ReadableStream<Uint8Array>
    Readable protocol stream consumed by the child-side channel server.
  readonly output: WritableStream<Uint8Array>
    Protocol-only byte stream used for framed responses; diagnostics belong on stderr.
  readonly run: ProcessRequestRun<Request, Response, Notice, CallRequest, CallResponse>
    Child-side implementation for one correlated request.
  readonly maximumFrameBytes?: number
    Maximum UTF-8 bytes accepted in one framed protocol message.
  readonly callId?: () => string
    Optional factory used to create child-to-parent reverse-call IDs.
```

### channel: ProcessServer

[Declaration source](channel/types.ts#L128)

```text
interface ProcessServer extends AsyncDisposable
  Owned child-side process channel server.

  readonly closed: Promise<void>
    Terminal Promise for child-side protocol shutdown.
  close(reason?: unknown): Promise<void>
    Stop accepting frames and close the child-side protocol owner.
```

### channel: ProcessCallRun

[Declaration source](channel/types.ts#L39)

```text
type ProcessCallRun<CallRequest, CallResponse> = (request: CallRequest, ctx: Context, requestId: string, callId: string) => CallResponse | Promise<CallResponse>
  Parent-side reverse-call implementation for one active process request.
```

### channel: ProcessChannelSource

[Declaration source](channel/types.ts#L168)

```text
type ProcessChannelSource = Process & Required<Pick<Process, "stdin" | "stdout">>
  Process shape required by `channel.open()`.
```

### channel: ProcessControlFrame

[Declaration source](channel/types.ts#L148)

```text
type ProcessControlFrame<CallResponse = unknown> = Readonly<{ readonly type: "cancel"; readonly id: string; readonly reason?: unknown; }> | Readonly<{ readonly type: "pause"; readonly id: string; }> | Readonly<{ readonly type: "resume"; readonly id: string; }> | Readonly<{ readonly type: "call-result"; readonly id: string; readonly callId: string; readonly response: CallResponse; }> | Readonly<{ readonly type: "call-fault"; readonly id: string; readonly callId: string; readonly fault: unknown; }> | Readonly<{ readonly type: "close"; readonly reason?: unknown; }>
  Parent-to-child control frames.
```

### channel: ProcessEventType

[Declaration source](channel/types.ts#L50)

```text
type ProcessEventType = Readonly<{ readonly type: "opened"; readonly pid: number; }> | Readonly<{ readonly type: "request"; readonly id: string; }> | Readonly<{ readonly type: "notice"; readonly id: string; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; }> | Readonly<{ readonly type: "paused"; readonly id: string; }> | Readonly<{ readonly type: "resumed"; readonly id: string; }> | Readonly<{ readonly type: "result"; readonly id: string; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failureId: string; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly reason: unknown; }> | Readonly<{ readonly type: "cancelled"; readonly id: string; }> | Readonly<{ readonly type: "closing"; readonly reason?: unknown; }> | Readonly<{ readonly type: "closed"; }>
  Process channel lifecycle and correlated request observations.
```

### channel: ProcessNoticeSink

[Declaration source](channel/types.ts#L47)

```text
type ProcessNoticeSink<Notice> = (notice: Notice, ctx: Context, requestId: string) => void | Promise<void>
  Parent-side observer for optional non-authoritative process notices.
```

### channel: ProcessRequestRun

[Declaration source](channel/types.ts#L105)

```text
type ProcessRequestRun<Request, Response, Notice = never, CallRequest = never, CallResponse = never> = (request: Request, ctx: Context, control: ProcessRequestControl<Notice, CallRequest, CallResponse>) => Response | Promise<Response>
  Child-side request implementation.
```

### channel: ProcessResponseFrame

[Declaration source](channel/types.ts#L159)

```text
type ProcessResponseFrame<Response, Notice = unknown, CallRequest = unknown> = Readonly<{ readonly type: "result"; readonly id: string; readonly response: Response; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failure: EncodedFailure; }> | Readonly<{ readonly type: "notice"; readonly id: string; readonly notice: Notice; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; readonly request: CallRequest; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly fault: unknown; }> | Readonly<{ readonly type: "closed"; }>
  Child-to-parent terminal, notice, reverse-call, and close frames.
```

## channel-types

Import `@okikio/process/channel/types`. [Source](./channel/types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                           |
| ------------------ | ------------------------------------------------------------------ |
| `EventBus`         | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `StandardSchemaV1` | External declaration: `@standard-schema/spec/dist/index.d.ts`      |
| `Context`          | [context contracts](../context/API.md)                             |
| `Snapshot`         | [context contracts](../context/API.md)                             |
| `EncodedFailure`   | [failure contracts](../failure/API.md)                             |
| `Process`          | [Source](types.ts)                                                 |

### channel-types: ProcessCallProtocol

[Declaration source](channel/types.ts#L7)

```text
interface ProcessCallProtocol<Request, Response>
  Optional child-to-parent request/result contract used inside one active process request.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates child-to-parent reverse-call requests.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this process call.
```

### channel-types: ProcessChannel

[Declaration source](channel/types.ts#L79)

```text
interface ProcessChannel<Request, Response> extends AsyncDisposable
  Owned parent-side framed request endpoint. The underlying Process keeps process lifetime authority.

  readonly pid: number
    Operating-system process ID used only for diagnostics and process ownership.
  readonly events: EventBus<ProcessEventType>["events"]
    Read-only local observations for request and channel lifecycle changes.
  request(ctx: Context, request: Request, options?: ProcessRequestOptions): Promise<Response>
    Send one correlated request and await its sole terminal response.
  pause(id: string): Promise<void>
    Block the matching child request at its next cooperative checkpoint.
  resume(id: string): Promise<void>
    Release the matching paused checkpoint generation.
  close(reason?: unknown): Promise<void>
    Stop new requests and close the framed protocol without taking process-lifecycle authority.
```

### channel-types: ProcessChannelOptions

[Declaration source](channel/types.ts#L65)

```text
interface ProcessChannelOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while opening one framed channel above an owned process.

  readonly protocol: ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact schemas for requests, responses, notices, failures, and reverse calls.
  readonly maximumFrameBytes?: number
    Maximum UTF-8 bytes in one JSON frame, excluding the newline delimiter.
  readonly requestId?: () => string
    Optional factory used when the caller does not supply a process request ID.
  readonly notice?: ProcessNoticeSink<Notice>
    Optional observation contract or callback for this process channel.
  readonly call?: ProcessCallRun<CallRequest, CallResponse>
    Make one correlated reverse request while this process channel remains active.
```

### channel-types: ProcessChannelProtocol

[Declaration source](channel/types.ts#L15)

```text
interface ProcessChannelProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Schemas that define one framed child-process request protocol.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates parent-to-child request payloads.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this process channel.
  readonly failure?: StandardSchemaV1<unknown, EncodedFailure>
    Optional schema for encoded declared failures returned by child requests.
  readonly notice?: StandardSchemaV1<unknown, Notice>
    Optional observation contract or callback for this process channel.
  readonly call?: ProcessCallProtocol<CallRequest, CallResponse>
    Make one correlated reverse request while this process channel remains active.
```

### channel-types: ProcessProtocolOptions

[Declaration source](channel/types.ts#L29)

```text
interface ProcessProtocolOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> extends ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>
  Input accepted by `channel.protocol()`.
```

### channel-types: ProcessRequestControl

[Declaration source](channel/types.ts#L95)

```text
interface ProcessRequestControl<Notice = never, CallRequest = never, CallResponse = never>
  Controls available to one child-side active request.

  checkpoint(): Promise<void>
    Wait while the parent has paused this request and recheck cancellation before returning.
  notify(notice: Notice): Promise<void>
    Publish one optional non-authoritative notice to the parent.
  call(request: CallRequest): Promise<CallResponse>
    Make one correlated reverse call to the parent and await its result.
```

### channel-types: ProcessRequestFrame

[Declaration source](channel/types.ts#L136)

```text
interface ProcessRequestFrame<Request>
  Parent-to-child request frame.

  readonly type: "request"
    Stable discriminant for this process request variant.
  readonly id: string
    Optional caller-supplied correlation ID for one process request.
  readonly context: Snapshot
    Serializable execution-context snapshot restored by the receiving host.
  readonly request: Request
    Request payload validated before child-side execution begins.
```

### channel-types: ProcessRequestOptions

[Declaration source](channel/types.ts#L33)

```text
interface ProcessRequestOptions
  Correlation options for one process-channel request.

  readonly id?: string
    Optional caller-supplied correlation ID for one process request.
```

### channel-types: ProcessServeOptions

[Declaration source](channel/types.ts#L112)

```text
interface ProcessServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while serving one framed process protocol.

  readonly protocol: ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact framed protocol contract accepted by the child server.
  readonly input: ReadableStream<Uint8Array>
    Readable protocol stream consumed by the child-side channel server.
  readonly output: WritableStream<Uint8Array>
    Protocol-only byte stream used for framed responses; diagnostics belong on stderr.
  readonly run: ProcessRequestRun<Request, Response, Notice, CallRequest, CallResponse>
    Child-side implementation for one correlated request.
  readonly maximumFrameBytes?: number
    Maximum UTF-8 bytes accepted in one framed protocol message.
  readonly callId?: () => string
    Optional factory used to create child-to-parent reverse-call IDs.
```

### channel-types: ProcessServer

[Declaration source](channel/types.ts#L128)

```text
interface ProcessServer extends AsyncDisposable
  Owned child-side process channel server.

  readonly closed: Promise<void>
    Terminal Promise for child-side protocol shutdown.
  close(reason?: unknown): Promise<void>
    Stop accepting frames and close the child-side protocol owner.
```

### channel-types: ProcessCallRun

[Declaration source](channel/types.ts#L39)

```text
type ProcessCallRun<CallRequest, CallResponse> = (request: CallRequest, ctx: Context, requestId: string, callId: string) => CallResponse | Promise<CallResponse>
  Parent-side reverse-call implementation for one active process request.
```

### channel-types: ProcessChannelSource

[Declaration source](channel/types.ts#L168)

```text
type ProcessChannelSource = Process & Required<Pick<Process, "stdin" | "stdout">>
  Process shape required by `channel.open()`.
```

### channel-types: ProcessControlFrame

[Declaration source](channel/types.ts#L148)

```text
type ProcessControlFrame<CallResponse = unknown> = Readonly<{ readonly type: "cancel"; readonly id: string; readonly reason?: unknown; }> | Readonly<{ readonly type: "pause"; readonly id: string; }> | Readonly<{ readonly type: "resume"; readonly id: string; }> | Readonly<{ readonly type: "call-result"; readonly id: string; readonly callId: string; readonly response: CallResponse; }> | Readonly<{ readonly type: "call-fault"; readonly id: string; readonly callId: string; readonly fault: unknown; }> | Readonly<{ readonly type: "close"; readonly reason?: unknown; }>
  Parent-to-child control frames.
```

### channel-types: ProcessEventType

[Declaration source](channel/types.ts#L50)

```text
type ProcessEventType = Readonly<{ readonly type: "opened"; readonly pid: number; }> | Readonly<{ readonly type: "request"; readonly id: string; }> | Readonly<{ readonly type: "notice"; readonly id: string; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; }> | Readonly<{ readonly type: "paused"; readonly id: string; }> | Readonly<{ readonly type: "resumed"; readonly id: string; }> | Readonly<{ readonly type: "result"; readonly id: string; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failureId: string; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly reason: unknown; }> | Readonly<{ readonly type: "cancelled"; readonly id: string; }> | Readonly<{ readonly type: "closing"; readonly reason?: unknown; }> | Readonly<{ readonly type: "closed"; }>
  Process channel lifecycle and correlated request observations.
```

### channel-types: ProcessNoticeSink

[Declaration source](channel/types.ts#L47)

```text
type ProcessNoticeSink<Notice> = (notice: Notice, ctx: Context, requestId: string) => void | Promise<void>
  Parent-side observer for optional non-authoritative process notices.
```

### channel-types: ProcessRequestRun

[Declaration source](channel/types.ts#L105)

```text
type ProcessRequestRun<Request, Response, Notice = never, CallRequest = never, CallResponse = never> = (request: Request, ctx: Context, control: ProcessRequestControl<Notice, CallRequest, CallResponse>) => Response | Promise<Response>
  Child-side request implementation.
```

### channel-types: ProcessResponseFrame

[Declaration source](channel/types.ts#L159)

```text
type ProcessResponseFrame<Response, Notice = unknown, CallRequest = unknown> = Readonly<{ readonly type: "result"; readonly id: string; readonly response: Response; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failure: EncodedFailure; }> | Readonly<{ readonly type: "notice"; readonly id: string; readonly notice: Notice; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; readonly request: CallRequest; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly fault: unknown; }> | Readonly<{ readonly type: "closed"; }>
  Child-to-parent terminal, notice, reverse-call, and close frames.
```

## deno

Import `@okikio/process/deno`. [Source](./deno.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source |
| ------------------ | ------------------------ |
| `Adapter`          | [Source](types.ts)       |
| `SignalType`       | [Source](types.ts)       |
| `Spawned`          | [Source](types.ts)       |
| `SpawnOptionsType` | [Source](types.ts)       |
| `StdioType`        | [Source](types.ts)       |

### deno: create

[Declaration source](deno.ts#L9)

```text
function create(): Adapter
  Creates the Deno subprocess adapter.

  Importing this module does not start a process. `Deno.Command` is resolved only
  when the generic process owner asks the adapter to spawn one child.
```

## node

Import `@okikio/process/node`. [Source](./node.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                   |
| ------------------ | ------------------------------------------ |
| `spawn`            | External declaration: `node:child_process` |
| `process`          | External declaration: `node:process`       |
| `Readable`         | External declaration: `node:stream`        |
| `Writable`         | External declaration: `node:stream`        |
| `Adapter`          | [Source](types.ts)                         |
| `SignalType`       | [Source](types.ts)                         |
| `Spawned`          | [Source](types.ts)                         |
| `SpawnOptionsType` | [Source](types.ts)                         |
| `StdioType`        | [Source](types.ts)                         |

### node: create

[Declaration source](node.ts#L12)

```text
function create(): Adapter
  Creates the Node.js subprocess adapter.

  The adapter only translates Node child-process primitives to Web streams and
  normalized status. Lifecycle ownership remains in `@okikio/process`.
```

## types

Import `@okikio/process/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                                           |
| ---------------- | ------------------------------------------------------------------ |
| `EventBus`       | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |

### types: Adapter

[Declaration source](types.ts#L124)

```text
interface Adapter
  Runtime adapter that creates one process without owning its later lifecycle.

  readonly trees: readonly TreeModeType[]
    Process ownership modes supported by this adapter, such as one child or a process tree.
  readonly signal: SignalType
    Native signal used for the initial graceful stop request.
  readonly forceSignal: SignalType
    Native signal selected after graceful termination does not settle in time.
  spawn(options: SpawnOptionsType): Promise<Spawned>
    Start one native child under the adapter ownership contract.
```

### types: ExecOptionsType

[Declaration source](types.ts#L181)

```text
interface ExecOptionsType extends StartOptionsType
  Options accepted by the finite exec helper.

  readonly input?: Uint8Array | string
    Optional bytes written to child stdin before the finite process execution waits for exit.
```

### types: Process

[Declaration source](types.ts#L159)

```text
interface Process extends AsyncDisposable
  Owned child process.

  readonly pid: number
    Operating-system process ID associated with this process.
  readonly tree: TreeModeType
    Selected native ownership mode; tree mode includes descendants when the adapter supports it.
  readonly stdin?: WritableStream<Uint8Array>
    Writable standard-input stream borrowed from the owned child process.
  readonly stdout?: ReadableStream<Uint8Array>
    Readable standard-output stream used by the framed protocol.
  readonly stderr?: ReadableStream<Uint8Array>
    Standard-error stream reserved for bounded diagnostics outside the protocol.
  readonly events: EventBus<ProcessEventType>["events"]
    Read-only observation stream for local process lifecycle changes.
  wait(): Promise<ProcessExitType>
    Join the owned terminal result; observation alone does not prove completion.
  signal(signal: SignalType): void
    Send an explicit native signal to the child or owned process group.
  stop(reason?: unknown): Promise<void>
    Stop owned work and join the termination contract; the reason remains available for diagnostics.
```

### types: ProcessExitType

[Declaration source](types.ts#L145)

```text
interface ProcessExitType
  Terminal process status and optionally captured output.

  readonly code: number
    Platform exit code, or null when the process ended without a numeric exit code.
  readonly success: boolean
    Whether the process exit satisfies the runtime adapter success rule.
  readonly signal?: string
    Abort signal controlling this process exit local lifetime.
  readonly stdout?: Uint8Array
    Readable standard-output stream used by the framed protocol.
  readonly stderr?: Uint8Array
    Standard-error stream reserved for bounded diagnostics outside the protocol.
```

### types: ShutdownPolicyType

[Declaration source](types.ts#L33)

```text
interface ShutdownPolicyType
  Graceful then forced shutdown policy in milliseconds.

  readonly signal?: SignalType
    Abort signal controlling this shutdown policy local lifetime.
  readonly forceSignal?: SignalType
    Signal used when graceful shutdown does not stop the owned process or process group.
  readonly graceMs?: number
    Grace period after the first shutdown request before forced termination.
  readonly forceMs?: number
    Maximum additional wait after forced termination before shutdown reports failure.
```

### types: SpawnOptionsType

[Declaration source](types.ts#L72)

```text
interface SpawnOptionsType
  Runtime-neutral process options after media-independent ownership policy is resolved.

  readonly command: string
    Executable path or command translated by the runtime adapter.
  readonly arguments: readonly string[]
    Ordered child arguments translated by the runtime adapter.
  readonly cwd?: string | URL
    Optional child working directory translated by the runtime adapter.
  readonly env?: Readonly<Record<string, string>>
    Explicit environment entries translated by the runtime adapter.
  readonly clearEnv: boolean
    Whether the runtime adapter clears inherited environment variables.
  readonly stdin: StdioType
    Writable standard-input stream borrowed from the owned child process.
  readonly stdout: StdioType
    Readable standard-output stream used by the framed protocol.
  readonly stderr: StdioType
    Standard-error stream reserved for bounded diagnostics outside the protocol.
  readonly tree: TreeModeType
    Process ownership mode the runtime adapter must provide or reject.
```

### types: Spawned

[Declaration source](types.ts#L104)

```text
interface Spawned
  Spawned runtime process used by the generic lifecycle owner.

  readonly pid: number
    Operating-system process ID associated with this spawned.
  readonly stdin?: WritableStream<Uint8Array>
    Writable standard-input stream borrowed from the owned child process.
  readonly stdout?: ReadableStream<Uint8Array>
    Readable standard-output stream used by the framed protocol.
  readonly stderr?: ReadableStream<Uint8Array>
    Standard-error stream reserved for bounded diagnostics outside the protocol.
  readonly status: Promise<StatusType>
    Native exit status promise; output pumps and public wait() retain their separate cleanup contract.
  kill(signal: SignalType): void
    Send one signal to the owned child or process group selected at spawn time.
  isGone(error: unknown): boolean
    Return whether a signalling error means the owned child or group no longer exists.
  treeAlive?(): boolean
    Probe whether an owned process group still has live members when the runtime provides a side-effect-free probe.
```

### types: StartOptionsType

[Declaration source](types.ts#L45)

```text
interface StartOptionsType
  Inputs accepted while starting an operating-system process.

  readonly command: string
    Executable path or command used to create the child process.
  readonly arguments?: readonly string[]
    Ordered command-line arguments passed to the child process.
  readonly cwd?: string | URL
    Optional working directory inherited by the child process.
  readonly env?: Readonly<Record<string, string>>
    Environment entries supplied to the child process.
  readonly clearEnv?: boolean
    Whether the child starts without inheriting the parent environment.
  readonly stdin?: "inherit" | "null" | "piped"
    Writable standard-input stream borrowed from the owned child process.
  readonly stdout?: OutputModeType
    Readable standard-output stream used by the framed protocol.
  readonly stderr?: OutputModeType
    Standard-error stream reserved for bounded diagnostics outside the protocol.
  readonly tree?: TreeModeType
    Requested direct-child or process-group ownership strength.
  readonly shutdown?: ShutdownPolicyType
    Graceful and forced shutdown policy owned by the returned Process.
```

### types: StatusType

[Declaration source](types.ts#L94)

```text
interface StatusType
  Terminal status returned by a runtime adapter.

  readonly code: number
    Native exit code returned by the runtime adapter.
  readonly success: boolean
    Whether the native child exited successfully according to the runtime adapter.
  readonly signal?: string
    Native termination signal, when the runtime reports one.
```

### types: OutputModeType

[Declaration source](types.ts#L25)

```text
type OutputModeType = Readonly<{ readonly type: "inherit"; }> | Readonly<{ readonly type: "discard"; }> | Readonly<{ readonly type: "capture"; readonly maximumBytes: number; }> | Readonly<{ readonly type: "stream"; }> | Readonly<{ readonly type: "sink"; readonly write: WritableStream<Uint8Array>; }>
  Explicit output ownership policy.
```

### types: ProcessEventType

[Declaration source](types.ts#L136)

```text
type ProcessEventType = Readonly<{ readonly type: "started"; readonly pid: number; }> | Readonly<{ readonly type: "signal"; readonly signal: SignalType; }> | Readonly<{ readonly type: "stopping"; readonly reason?: unknown; }> | Readonly<{ readonly type: "forced"; }> | Readonly<{ readonly type: "exited"; readonly code: number; readonly success: boolean; readonly signal?: string; }> | Readonly<{ readonly type: "output-limit"; readonly stream: "stdout" | "stderr"; readonly maximumBytes: number; }>
  Process lifecycle event.
```

### types: SignalType

[Declaration source](types.ts#L6)

```text
type SignalType = "SIGABRT" | "SIGALRM" | "SIGHUP" | "SIGINFO" | "SIGINT" | "SIGKILL" | "SIGPIPE" | "SIGQUIT" | "SIGSTOP" | "SIGTERM" | "SIGUSR1" | "SIGUSR2" | "SIGWINCH" | (string & { }) | number
  Runtime signal accepted by the selected process adapter.
```

### types: StdioType

[Declaration source](types.ts#L69)

```text
type StdioType = "inherit" | "discard" | "piped"
  Stdio mode requested from one runtime adapter.
```

### types: TreeModeType

[Declaration source](types.ts#L3)

```text
type TreeModeType = "direct-child" | "posix-process-group" | "windows-process-tree" | "windows-job-object"
  Process-tree ownership guarantee implemented by the selected runtime adapter.
```
