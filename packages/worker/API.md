# @okikio/worker contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                 | Source                   | Reference       |
| ---------------------- | ------------------------ | --------------- |
| `@okikio/worker`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/worker/deno`  | [./deno.ts](./deno.ts)   | [deno](#deno)   |
| `@okikio/worker/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/worker`. [Source](./mod.ts).

Call a standard Worker with validated, correlated requests instead of a hand-built postMessage listener. Correlation,
reverse calls, cancellation and shutdown need distinct authority even when messages race.

Save the second module beside the first. Start with request/result, then add notices for progress and reverse calls for
host-owned policy. A notice is not completion. Transfer lists move ownership of transferable data; they do not move
arbitrary resources. Pause is cooperative and requires handler checkpoints. Cancellation can stop waiting for a schema,
but an external validator still owns its resources. The parent owns Worker shutdown; each realm needs its own optional
polyfill imports.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding        | Contract owner or source                                           |
| ----------------------- | ------------------------------------------------------------------ |
| `EventBus`              | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts) |
| `contextCore`           | [context contracts](../context/API.md)                             |
| `Context`               | [context contracts](../context/API.md)                             |
| `failure`               | [failure contracts](../failure/API.md)                             |
| `faultCore`             | [fault contracts](../fault/API.md)                                 |
| `EncodedFailure`        | [failure contracts](../failure/API.md)                             |
| `schema`                | [schema contracts](../schema/API.md)                               |
| `RawWorker`             | [Source](types.ts)                                                 |
| `RawWorkerScope`        | [Source](types.ts)                                                 |
| `WorkerEventType`       | [Source](types.ts)                                                 |
| `WorkerHandle`          | [Source](types.ts)                                                 |
| `WorkerMessageOptions`  | [Source](types.ts)                                                 |
| `WorkerOpenOptions`     | [Source](types.ts)                                                 |
| `WorkerProtocol`        | [Source](types.ts)                                                 |
| `WorkerProtocolOptions` | [Source](types.ts)                                                 |
| `WorkerReply`           | [Source](types.ts)                                                 |
| `WorkerRequestControl`  | [Source](types.ts)                                                 |
| `WorkerRequestEnvelope` | [Source](types.ts)                                                 |
| `WorkerRequestOptions`  | [Source](types.ts)                                                 |
| `WorkerServeOptions`    | [Source](types.ts)                                                 |
| `WorkerServer`          | [Source](types.ts)                                                 |

### root: open

[Declaration source](mod.ts#L906)

```text
function open<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(ctx: Context, options: WorkerOpenOptions<Request, Response, Notice, CallRequest, CallResponse>): WorkerHandle<Request, Response>
  Open one owned Worker with correlated, validated, abort-aware requests.

  The handle can observe non-terminal notices and answer Worker-to-parent calls
  without settling the owning request. `pause()` and `resume()` only control the
  Worker's next cooperative checkpoint. `stop()` first requests cooperative
  shutdown and then terminates the Worker when the acknowledgement exceeds the
  configured grace period.
```

### root: protocol

[Declaration source](mod.ts#L137)

```text
function protocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(input: WorkerProtocolOptions<Request, Response, Notice, CallRequest, CallResponse>): WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>
  Define one immutable validated Worker protocol.
```

### root: reply

[Declaration source](mod.ts#L152)

```text
function reply<Response>(response: Response, transfer: readonly Transferable[]): WorkerReply<Response>
  Wrap a Worker response with an explicit transfer list.
```

### root: serve

[Declaration source](mod.ts#L891)

````text
function serve<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(options: WorkerServeOptions<Request, Response, Notice, CallRequest, CallResponse>): WorkerServer
  Serve one validated Worker protocol inside a Worker thread.

  Every request restores a new local context. Cancellation crosses the Worker
  seam as a control frame instead of a serialized `AbortSignal`. Pause is
  cooperative: `control.checkpoint()` waits while paused, but an indivisible
  provider call is allowed to finish before the next checkpoint.

  Notices never settle a request. Reverse calls are correlated request/result
  work back to the parent and can be used for host-owned services such as
  permission decisions or effect acceptance.

  @example
      ```ts
      await using server = worker.serve({
        protocol: ActivityProtocol,
        async run(request, ctx, control) {
          await control.checkpoint();
          await control.notify({ phase: 'started' });
          return runActivity(request, ctx);
        },
      });
      ```
````

### root: WorkerFailureError

[Declaration source](mod.ts#L48)

```text
class WorkerFailureError extends Error
  Worker returned an expected encoded failure.

  constructor(failure: EncodedFailure)
    Create this WorkerFailureError from the explicit contract values supplied by its caller.
  readonly failure: EncodedFailure
    Expected failure data retained under its declared contract.
```

### root: WorkerFaultError

[Declaration source](mod.ts#L61)

```text
class WorkerFaultError extends Error
  Worker returned or raised an unexpected fault.

  constructor(fault: unknown)
    Create this WorkerFaultError from the explicit contract values supplied by its caller.
  readonly fault: unknown
    Unexpected diagnostic data projected for this boundary.
```

### root: WorkerProtocolError

[Declaration source](mod.ts#L74)

```text
class WorkerProtocolError extends Error
  Worker wire protocol was violated.

  constructor(message: string, messageValue?: unknown)
    Create this WorkerProtocolError from the explicit contract values supplied by its caller.
  readonly messageValue: unknown
    Original invalid protocol frame retained for diagnostics.
```

### root: WorkerStoppedError

[Declaration source](mod.ts#L87)

```text
class WorkerStoppedError extends Error
  Worker stopped before a pending request completed.

  constructor(reason?: unknown)
    Create this WorkerStoppedError from the explicit contract values supplied by its caller.
  readonly reason: unknown
    Caller or runtime reason retained for cancellation or failure diagnostics.
```

### root: RawWorker

[Declaration source](types.ts#L61)

```text
interface RawWorker
  Minimum raw Worker surface used by the handle and test adapters.

  postMessage(message: unknown, transfer?: readonly Transferable[]): void
    Send one protocol value with its explicit transferable ownership list.
  terminate(): void
    Terminate the raw Worker; pending correlation must be settled by its owner.
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
```

### root: RawWorkerScope

[Declaration source](types.ts#L133)

```text
interface RawWorkerScope
  Worker-global message surface used by the server and test adapters.

  postMessage(message: unknown, transfer?: readonly Transferable[]): void
    Send one protocol value with its explicit transferable ownership list.
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
```

### root: WorkerCallProtocol

[Declaration source](types.ts#L6)

```text
interface WorkerCallProtocol<Request, Response>
  Optional Worker-to-parent request/response contract used inside one active request.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates Worker-to-host reverse-call requests.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this worker call.
```

### root: WorkerHandle

[Declaration source](types.ts#L117)

```text
interface WorkerHandle<Request, Response> extends AsyncDisposable
  Owned Worker request endpoint.

  readonly id: string
    Parent execution identity retained by the opened Worker handle.
  readonly events: EventBus<WorkerEventType>["events"]
    Read-only observation stream for local worker handle lifecycle changes.
  request(ctx: Context, request: Request, options?: WorkerRequestOptions): Promise<Response>
    Send one schema-validated correlated request to the Worker.
  pause(id: string): void
    Block the next cooperative checkpoint for one active request.
  resume(id: string): void
    Release one paused request checkpoint.
  stop(reason?: unknown): Promise<void>
    Stop owned work and join the termination contract; the reason remains available for diagnostics.
```

### root: WorkerMessageOptions

[Declaration source](types.ts#L40)

```text
interface WorkerMessageOptions
  Transfer options for one Worker notice or reverse call.

  readonly transfer?: readonly Transferable[]
    Transferable values moved with this Worker message instead of cloned.
```

### root: WorkerOpenOptions

[Declaration source](types.ts#L95)

```text
interface WorkerOpenOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while opening one standard Worker.

  readonly module: URL
    Module URL loaded by the owned Worker.
  readonly name?: string
    Optional Worker name forwarded to the platform for diagnostics.
  readonly protocol: WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact request/response/failure/notice/reverse-call schemas for this Worker.
  readonly shutdownMs?: number
    Grace period for cooperative Worker shutdown before termination.
  readonly id?: string
    Parent execution identity associated with the owned Worker transport.
  readonly requestId?: () => string
    Optional factory used when a request does not supply its own Worker request ID.
  readonly create?: WorkerFactory
    Optional Worker constructor seam used by tests or specialized hosts.
  readonly notice?: WorkerNoticeSink<Notice>
    Optional observation contract or callback for this worker open.
  readonly call?: WorkerCallRun<CallRequest, CallResponse>
    Make one correlated reverse request while this worker open remains active.
```

### root: WorkerProtocol

[Declaration source](types.ts#L14)

```text
interface WorkerProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Validated request, terminal response, notice, reverse-call, and expected-failure wire schemas.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates caller-to-Worker request payloads.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this worker.
  readonly failure?: StandardSchemaV1<unknown, EncodedFailure>
    Optional schema for encoded declared failures returned by Worker requests.
  readonly notice?: StandardSchemaV1<unknown, Notice>
    Optional non-authoritative progress or lifecycle message emitted by active work.
  readonly call?: WorkerCallProtocol<CallRequest, CallResponse>
    Optional Worker-to-parent request/result contract for authoritative host services.
```

### root: WorkerProtocolOptions

[Declaration source](types.ts#L28)

```text
interface WorkerProtocolOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> extends WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>
  Input accepted by `workers.protocol()`.
```

### root: WorkerReply

[Declaration source](types.ts#L147)

```text
interface WorkerReply<Response>
  Explicit response wrapper for transferring ownership of response values.

  readonly kind: "worker-reply"
    Stable discriminant for this worker reply value.
  readonly response: Response
    Response schema or payload associated with this worker reply.
  readonly transfer: readonly Transferable[]
    Transferable values returned with a successful Worker reply.
```

### root: WorkerRequestControl

[Declaration source](types.ts#L157)

```text
interface WorkerRequestControl<Notice = never, CallRequest = never, CallResponse = never>
  Controls owned by one active Worker request.

  checkpoint(): Promise<void>
    Wait while the parent has this request cooperatively paused.
  notify(notice: Notice, options?: WorkerMessageOptions): Promise<void>
    Emit optional progress or lifecycle information to the parent.
  call(request: CallRequest, options?: WorkerMessageOptions): Promise<CallResponse>
    Ask the parent for one authoritative request/result service.
```

### root: WorkerRequestEnvelope

[Declaration source](types.ts#L194)

```text
interface WorkerRequestEnvelope<Request>
  Parent-to-Worker request envelope.

  readonly type: "request"
    Stable discriminant for this worker request envelope variant.
  readonly id: string
    Correlation ID that uniquely identifies this Worker request envelope.
  readonly context: Snapshot
    Serializable execution-context snapshot restored by the receiving host.
  readonly request: Request
    Schema-validated request payload delivered to the Worker implementation.
```

### root: WorkerRequestOptions

[Declaration source](types.ts#L32)

```text
interface WorkerRequestOptions
  Explicit transfer and correlation options for one Worker request.

  readonly id?: string
    Optional caller-supplied correlation ID for one Worker request.
  readonly transfer?: readonly Transferable[]
    Transferable values moved with this request instead of cloned.
```

### root: WorkerServeOptions

[Declaration source](types.ts#L174)

```text
interface WorkerServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while serving one Worker protocol.

  readonly protocol: WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact protocol contract served by this Worker.
  readonly run: WorkerRequestRun<Request, Response, Notice, CallRequest, CallResponse>
    Worker-side implementation for one correlated request.
  readonly scope?: RawWorkerScope
    Optional Worker global scope override used by tests or specialized hosts.
  readonly callId?: () => string
    Optional factory used to create Worker-to-host reverse-call IDs.
```

### root: WorkerServer

[Declaration source](types.ts#L186)

```text
interface WorkerServer extends AsyncDisposable
  Owned Worker-side protocol server.

  readonly closed: Promise<void>
    Terminal Promise that resolves after this worker server has stopped and cleaned up.
  stop(reason?: unknown): Promise<void>
    Stop owned work and join the termination contract; the reason remains available for diagnostics.
```

### root: WorkerCallRun

[Declaration source](types.ts#L84)

```text
type WorkerCallRun<CallRequest, CallResponse> = (request: CallRequest, ctx: Context, requestId: string, callId: string) => CallResponse | Promise<CallResponse>
  Parent-side reverse-call implementation for one active Worker request.
```

### root: WorkerControlEnvelope

[Declaration source](types.ts#L206)

```text
type WorkerControlEnvelope<CallResponse = unknown> = Readonly<{ readonly type: "cancel"; readonly id: string; readonly reason?: unknown; }> | Readonly<{ readonly type: "pause"; readonly id: string; }> | Readonly<{ readonly type: "resume"; readonly id: string; }> | Readonly<{ readonly type: "call-result"; readonly id: string; readonly callId: string; readonly response: CallResponse; }> | Readonly<{ readonly type: "call-fault"; readonly id: string; readonly callId: string; readonly fault: unknown; }> | Readonly<{ readonly type: "shutdown"; readonly reason?: unknown; }>
  Parent-to-Worker control and reverse-call result envelopes.
```

### root: WorkerEventType

[Declaration source](types.ts#L46)

```text
type WorkerEventType = Readonly<{ readonly type: "opened"; readonly id: string; }> | Readonly<{ readonly type: "request"; readonly id: string; }> | Readonly<{ readonly type: "notice"; readonly id: string; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; }> | Readonly<{ readonly type: "paused"; readonly id: string; }> | Readonly<{ readonly type: "resumed"; readonly id: string; }> | Readonly<{ readonly type: "result"; readonly id: string; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failureId: string; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly reason: unknown; }> | Readonly<{ readonly type: "cancelled"; readonly id: string; }> | Readonly<{ readonly type: "stopping"; readonly reason?: unknown; }> | Readonly<{ readonly type: "stopped"; readonly forced: boolean; }>
  Worker lifecycle and correlated request observations.
```

### root: WorkerFactory

[Declaration source](types.ts#L81)

```text
type WorkerFactory = (module: URL, options: WorkerOptions) => RawWorker
  Creates one raw Worker for the generic request protocol owner.
```

### root: WorkerNoticeSink

[Declaration source](types.ts#L92)

```text
type WorkerNoticeSink<Notice> = (notice: Notice, ctx: Context, requestId: string) => void | Promise<void>
  Parent-side notice observer. Notice delivery is not terminal authority.
```

### root: WorkerRequestRun

[Declaration source](types.ts#L167)

```text
type WorkerRequestRun<Request, Response, Notice = never, CallRequest = never, CallResponse = never> = (request: Request, ctx: Owned, control: WorkerRequestControl<Notice, CallRequest, CallResponse>) => Response | WorkerReply<Response> | Promise<Response | WorkerReply<Response>>
  Worker-side request operation.
```

### root: WorkerResponseEnvelope

[Declaration source](types.ts#L217)

```text
type WorkerResponseEnvelope<Response, Notice = unknown, CallRequest = unknown> = Readonly<{ readonly type: "result"; readonly id: string; readonly response: Response; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failure: EncodedFailure; }> | Readonly<{ readonly type: "notice"; readonly id: string; readonly notice: Notice; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; readonly request: CallRequest; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly fault: unknown; }> | Readonly<{ readonly type: "stopped"; }>
  Worker-to-parent response, notice, and reverse-call envelopes.
```

## deno

Import `@okikio/worker/deno`. [Source](./deno.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding    | Contract owner or source               |
| ------------------- | -------------------------------------- |
| `Context`           | [context contracts](../context/API.md) |
| `worker`            | [Source](mod.ts)                       |
| `RawWorker`         | [Source](types.ts)                     |
| `WorkerHandle`      | [Source](types.ts)                     |
| `WorkerOpenOptions` | [Source](types.ts)                     |

### deno: open

[Declaration source](deno.ts#L18)

```text
function open<Request, Response>(ctx: Context, options: DenoOptions<Request, Response>): WorkerHandle<Request, Response>
  Opens one Deno Worker while keeping permission policy out of the generic Worker API.

  Request correlation, validation, cancellation, and shutdown still belong to
  `@okikio/worker`. This adapter only adds the Deno-specific `permissions` option
  when the raw Worker is constructed.
```

### deno: DenoOptions

[Declaration source](deno.ts#L6)

```text
interface DenoOptions<Request, Response> extends Omit<WorkerOpenOptions<Request, Response>, "create">
  Options that add Deno Worker permissions to the standard Worker protocol.

  readonly permissions?: Deno.PermissionOptions
    Explicit Deno Worker permissions for this realm; the host grants only what its work needs.
```

## types

Import `@okikio/worker/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| `EventBus`         | [External source](https://jsr.io/@okikio/observables/1.4.0/mod.ts)         |
| `StandardSchemaV1` | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `Context`          | [context contracts](../context/API.md)                                     |
| `Owned`            | [context contracts](../context/API.md)                                     |
| `Snapshot`         | [context contracts](../context/API.md)                                     |
| `EncodedFailure`   | [failure contracts](../failure/API.md)                                     |

### types: RawWorker

[Declaration source](types.ts#L61)

```text
interface RawWorker
  Minimum raw Worker surface used by the handle and test adapters.

  postMessage(message: unknown, transfer?: readonly Transferable[]): void
    Send one protocol value with its explicit transferable ownership list.
  terminate(): void
    Terminate the raw Worker; pending correlation must be settled by its owner.
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
```

### types: RawWorkerScope

[Declaration source](types.ts#L133)

```text
interface RawWorkerScope
  Worker-global message surface used by the server and test adapters.

  postMessage(message: unknown, transfer?: readonly Transferable[]): void
    Send one protocol value with its explicit transferable ownership list.
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Attach a protocol listener; the owner removes it when its lifetime ends.
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
    Remove a previously attached protocol listener without settling unrelated requests.
```

### types: WorkerCallProtocol

[Declaration source](types.ts#L6)

```text
interface WorkerCallProtocol<Request, Response>
  Optional Worker-to-parent request/response contract used inside one active request.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates Worker-to-host reverse-call requests.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this worker call.
```

### types: WorkerHandle

[Declaration source](types.ts#L117)

```text
interface WorkerHandle<Request, Response> extends AsyncDisposable
  Owned Worker request endpoint.

  readonly id: string
    Parent execution identity retained by the opened Worker handle.
  readonly events: EventBus<WorkerEventType>["events"]
    Read-only observation stream for local worker handle lifecycle changes.
  request(ctx: Context, request: Request, options?: WorkerRequestOptions): Promise<Response>
    Send one schema-validated correlated request to the Worker.
  pause(id: string): void
    Block the next cooperative checkpoint for one active request.
  resume(id: string): void
    Release one paused request checkpoint.
  stop(reason?: unknown): Promise<void>
    Stop owned work and join the termination contract; the reason remains available for diagnostics.
```

### types: WorkerMessageOptions

[Declaration source](types.ts#L40)

```text
interface WorkerMessageOptions
  Transfer options for one Worker notice or reverse call.

  readonly transfer?: readonly Transferable[]
    Transferable values moved with this Worker message instead of cloned.
```

### types: WorkerOpenOptions

[Declaration source](types.ts#L95)

```text
interface WorkerOpenOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while opening one standard Worker.

  readonly module: URL
    Module URL loaded by the owned Worker.
  readonly name?: string
    Optional Worker name forwarded to the platform for diagnostics.
  readonly protocol: WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact request/response/failure/notice/reverse-call schemas for this Worker.
  readonly shutdownMs?: number
    Grace period for cooperative Worker shutdown before termination.
  readonly id?: string
    Parent execution identity associated with the owned Worker transport.
  readonly requestId?: () => string
    Optional factory used when a request does not supply its own Worker request ID.
  readonly create?: WorkerFactory
    Optional Worker constructor seam used by tests or specialized hosts.
  readonly notice?: WorkerNoticeSink<Notice>
    Optional observation contract or callback for this worker open.
  readonly call?: WorkerCallRun<CallRequest, CallResponse>
    Make one correlated reverse request while this worker open remains active.
```

### types: WorkerProtocol

[Declaration source](types.ts#L14)

```text
interface WorkerProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Validated request, terminal response, notice, reverse-call, and expected-failure wire schemas.

  readonly request: StandardSchemaV1<unknown, Request>
    Schema that validates caller-to-Worker request payloads.
  readonly response: StandardSchemaV1<unknown, Response>
    Response schema or payload associated with this worker.
  readonly failure?: StandardSchemaV1<unknown, EncodedFailure>
    Optional schema for encoded declared failures returned by Worker requests.
  readonly notice?: StandardSchemaV1<unknown, Notice>
    Optional non-authoritative progress or lifecycle message emitted by active work.
  readonly call?: WorkerCallProtocol<CallRequest, CallResponse>
    Optional Worker-to-parent request/result contract for authoritative host services.
```

### types: WorkerProtocolOptions

[Declaration source](types.ts#L28)

```text
interface WorkerProtocolOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> extends WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>
  Input accepted by `workers.protocol()`.
```

### types: WorkerReply

[Declaration source](types.ts#L147)

```text
interface WorkerReply<Response>
  Explicit response wrapper for transferring ownership of response values.

  readonly kind: "worker-reply"
    Stable discriminant for this worker reply value.
  readonly response: Response
    Response schema or payload associated with this worker reply.
  readonly transfer: readonly Transferable[]
    Transferable values returned with a successful Worker reply.
```

### types: WorkerRequestControl

[Declaration source](types.ts#L157)

```text
interface WorkerRequestControl<Notice = never, CallRequest = never, CallResponse = never>
  Controls owned by one active Worker request.

  checkpoint(): Promise<void>
    Wait while the parent has this request cooperatively paused.
  notify(notice: Notice, options?: WorkerMessageOptions): Promise<void>
    Emit optional progress or lifecycle information to the parent.
  call(request: CallRequest, options?: WorkerMessageOptions): Promise<CallResponse>
    Ask the parent for one authoritative request/result service.
```

### types: WorkerRequestEnvelope

[Declaration source](types.ts#L194)

```text
interface WorkerRequestEnvelope<Request>
  Parent-to-Worker request envelope.

  readonly type: "request"
    Stable discriminant for this worker request envelope variant.
  readonly id: string
    Correlation ID that uniquely identifies this Worker request envelope.
  readonly context: Snapshot
    Serializable execution-context snapshot restored by the receiving host.
  readonly request: Request
    Schema-validated request payload delivered to the Worker implementation.
```

### types: WorkerRequestOptions

[Declaration source](types.ts#L32)

```text
interface WorkerRequestOptions
  Explicit transfer and correlation options for one Worker request.

  readonly id?: string
    Optional caller-supplied correlation ID for one Worker request.
  readonly transfer?: readonly Transferable[]
    Transferable values moved with this request instead of cloned.
```

### types: WorkerServeOptions

[Declaration source](types.ts#L174)

```text
interface WorkerServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
  Inputs accepted while serving one Worker protocol.

  readonly protocol: WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>
    Exact protocol contract served by this Worker.
  readonly run: WorkerRequestRun<Request, Response, Notice, CallRequest, CallResponse>
    Worker-side implementation for one correlated request.
  readonly scope?: RawWorkerScope
    Optional Worker global scope override used by tests or specialized hosts.
  readonly callId?: () => string
    Optional factory used to create Worker-to-host reverse-call IDs.
```

### types: WorkerServer

[Declaration source](types.ts#L186)

```text
interface WorkerServer extends AsyncDisposable
  Owned Worker-side protocol server.

  readonly closed: Promise<void>
    Terminal Promise that resolves after this worker server has stopped and cleaned up.
  stop(reason?: unknown): Promise<void>
    Stop owned work and join the termination contract; the reason remains available for diagnostics.
```

### types: WorkerCallRun

[Declaration source](types.ts#L84)

```text
type WorkerCallRun<CallRequest, CallResponse> = (request: CallRequest, ctx: Context, requestId: string, callId: string) => CallResponse | Promise<CallResponse>
  Parent-side reverse-call implementation for one active Worker request.
```

### types: WorkerControlEnvelope

[Declaration source](types.ts#L206)

```text
type WorkerControlEnvelope<CallResponse = unknown> = Readonly<{ readonly type: "cancel"; readonly id: string; readonly reason?: unknown; }> | Readonly<{ readonly type: "pause"; readonly id: string; }> | Readonly<{ readonly type: "resume"; readonly id: string; }> | Readonly<{ readonly type: "call-result"; readonly id: string; readonly callId: string; readonly response: CallResponse; }> | Readonly<{ readonly type: "call-fault"; readonly id: string; readonly callId: string; readonly fault: unknown; }> | Readonly<{ readonly type: "shutdown"; readonly reason?: unknown; }>
  Parent-to-Worker control and reverse-call result envelopes.
```

### types: WorkerEventType

[Declaration source](types.ts#L46)

```text
type WorkerEventType = Readonly<{ readonly type: "opened"; readonly id: string; }> | Readonly<{ readonly type: "request"; readonly id: string; }> | Readonly<{ readonly type: "notice"; readonly id: string; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; }> | Readonly<{ readonly type: "paused"; readonly id: string; }> | Readonly<{ readonly type: "resumed"; readonly id: string; }> | Readonly<{ readonly type: "result"; readonly id: string; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failureId: string; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly reason: unknown; }> | Readonly<{ readonly type: "cancelled"; readonly id: string; }> | Readonly<{ readonly type: "stopping"; readonly reason?: unknown; }> | Readonly<{ readonly type: "stopped"; readonly forced: boolean; }>
  Worker lifecycle and correlated request observations.
```

### types: WorkerFactory

[Declaration source](types.ts#L81)

```text
type WorkerFactory = (module: URL, options: WorkerOptions) => RawWorker
  Creates one raw Worker for the generic request protocol owner.
```

### types: WorkerNoticeSink

[Declaration source](types.ts#L92)

```text
type WorkerNoticeSink<Notice> = (notice: Notice, ctx: Context, requestId: string) => void | Promise<void>
  Parent-side notice observer. Notice delivery is not terminal authority.
```

### types: WorkerRequestRun

[Declaration source](types.ts#L167)

```text
type WorkerRequestRun<Request, Response, Notice = never, CallRequest = never, CallResponse = never> = (request: Request, ctx: Owned, control: WorkerRequestControl<Notice, CallRequest, CallResponse>) => Response | WorkerReply<Response> | Promise<Response | WorkerReply<Response>>
  Worker-side request operation.
```

### types: WorkerResponseEnvelope

[Declaration source](types.ts#L217)

```text
type WorkerResponseEnvelope<Response, Notice = unknown, CallRequest = unknown> = Readonly<{ readonly type: "result"; readonly id: string; readonly response: Response; }> | Readonly<{ readonly type: "failure"; readonly id: string; readonly failure: EncodedFailure; }> | Readonly<{ readonly type: "notice"; readonly id: string; readonly notice: Notice; }> | Readonly<{ readonly type: "call"; readonly id: string; readonly callId: string; readonly request: CallRequest; }> | Readonly<{ readonly type: "fault"; readonly id?: string; readonly fault: unknown; }> | Readonly<{ readonly type: "stopped"; }>
  Worker-to-parent response, notice, and reverse-call envelopes.
```
