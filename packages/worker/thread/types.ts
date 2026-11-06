import type { WorkerEventType } from '@okikio/telemetry/events';
/** Portable Worker transport contracts; runtime leaves supply native construction and transfer behavior. @module */
import type * as protocol from '../protocol.ts';
import type { EventBus } from '@okikio/observables/events';

import type { Context, Owned } from '@okikio/context';

/**
 * Transfer-list items from the caller's standard structuredClone declaration.
 *
 * Browser, Worker and Node consumers retain their own native transfer types.
 * The selected host validates actual transferability when postMessage is called;
 * a structural TypeScript type cannot prove that an object is a native handle.
 */
export type WorkerTransferable = NonNullable<NonNullable<Parameters<typeof structuredClone>[1]>['transfer']>[number];

/** Message payload consumed by the protocol, without requiring DOM event metadata from an adapter. */
export interface WorkerMessageEvent<Value = unknown> {
	/** Unvalidated host payload; the protocol validates it before reading envelope fields. */
	readonly data: Value;
}

/** Failure payload consumed by the protocol; native events and small adapters satisfy this shape. */
export interface WorkerErrorEvent {
	/** Original host failure, when available. */
	readonly error?: unknown;
	/** Host diagnostic used when no original failure is supplied. */
	readonly message?: string;
}

/** Construction choices supplied by the shared protocol; runtime-specific options stay in their adapter. */
export interface WorkerFactoryOptions {
	/** The shared protocol always creates an ECMAScript module Worker. */
	readonly type: 'module';
	/** Optional host-visible name for diagnostics. */
	readonly name?: string;
}

/** Reverse-call schema pair shared by thread and process requests. */
export interface WorkerCallProtocol<Request, Response> extends protocol.Call<Request, Response> {}

/** Exact payload schemas shared with framed process requests. */
export interface WorkerProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends protocol.Protocol<Request, Response, Notice, CallRequest, CallResponse> {}

/** Input accepted by `workers.protocol()`. */
export interface WorkerProtocolOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse> {}

/** Explicit transfer and correlation options for one Worker request. */
export interface WorkerRequestOptions {
	/** Optional caller-supplied correlation ID for one Worker request. */
	readonly id?: string;
	/** Transferable values moved with this request instead of cloned. */
	readonly transfer?: readonly WorkerTransferable[];
}

/** Transfer options for one Worker notice or reverse call. */
export interface WorkerMessageOptions {
	/** Transferable values moved with this Worker message instead of cloned. */
	readonly transfer?: readonly WorkerTransferable[];
}

/** Worker lifecycle and correlated request observations. */
export type { WorkerEventType } from '@okikio/telemetry/events';

/** Minimum raw Worker surface used by the handle and test adapters. */
export interface RawWorker {
	/** Send one protocol value with its explicit transferable ownership list. */
	postMessage(message: unknown, transfer?: readonly WorkerTransferable[]): void;
	/** Terminate the raw Worker; pending correlation must be settled by its owner. */
	terminate(): void | Promise<void>;
	/** Attach a protocol listener; the owner removes it when its lifetime ends. */
	addEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
	/** Attach a protocol listener; the owner removes it when its lifetime ends. */
	addEventListener(type: 'error', listener: (event: WorkerErrorEvent) => void): void;
	/** Attach a protocol listener; the owner removes it when its lifetime ends. */
	addEventListener(type: 'messageerror', listener: (event: WorkerMessageEvent) => void): void;
	/** Remove a previously attached protocol listener without settling unrelated requests. */
	removeEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
	/** Remove a previously attached protocol listener without settling unrelated requests. */
	removeEventListener(type: 'error', listener: (event: WorkerErrorEvent) => void): void;
	/** Remove a previously attached protocol listener without settling unrelated requests. */
	removeEventListener(type: 'messageerror', listener: (event: WorkerMessageEvent) => void): void;
}

/** Creates one raw Worker for the generic request protocol owner. */
export type WorkerFactory = (module: URL, options: WorkerFactoryOptions) => RawWorker;

/** Parent-side reverse-call implementation for one active Worker request. */
export type WorkerCallRun<CallRequest, CallResponse> = (
	request: CallRequest,
	ctx: Context,
	requestId: string,
	callId: string,
) => CallResponse | Promise<CallResponse>;

/** Parent-side notice observer. Notice delivery is not terminal authority. */
export type WorkerNoticeSink<Notice> = (notice: Notice, ctx: Context, requestId: string) => void | Promise<void>;

/** Inputs accepted while opening one standard Worker. */
export interface WorkerOpenOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Maximum local requests, including validating/negotiating admissions and cancellation awaiting cleanup. Defaults to 1,000; excess rejects before payload validation. */
	readonly maximumRequests?: number;
	/** Opt-in logical payload limits. Unsupported host objects must be encoded into the documented inert/binary wire model. */
	readonly budget?: protocol.PayloadBudgetType;
	/** Module URL loaded by the owned Worker. */
	readonly module: URL;
	/** Optional Worker name forwarded to the platform for diagnostics. */
	readonly name?: string;
	/** Exact request/response/failure/notice/reverse-call schemas for this Worker. */
	readonly protocol: WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>;
	/** Grace period for cooperative Worker shutdown before termination. */
	readonly shutdownMs?: number;
	/** Maximum wait for cancelled work to finish cleanup before retiring the entire host. Defaults to shutdownMs. */
	readonly cancelMs?: number;
	/** Parent execution identity associated with the owned Worker transport. */
	readonly id?: string;
	/** Optional factory used when a request does not supply its own Worker request ID. */
	readonly requestId?: () => string;
	/** Optional Worker constructor seam used by tests or specialized hosts. */
	readonly create?: WorkerFactory;
	/** Optional observation contract or callback for this worker open. */
	readonly notice?: WorkerNoticeSink<Notice>;
	/** Make one correlated reverse request while this worker open remains active. */
	readonly call?: WorkerCallRun<CallRequest, CallResponse>;
}

/** Owned Worker request endpoint. */
export interface WorkerHandle<Request, Response> extends AsyncDisposable {
	/** Terminal receipt after native termination and local correlation release; observations are not this authority. */
	readonly closed: Promise<WorkerTerminationType>;
	/** Parent execution identity retained by the opened Worker handle. */
	readonly id: string;
	/** Read-only observation stream for local worker handle lifecycle changes. */
	readonly events: EventBus<WorkerEventType>['events'];
	/** Send one schema-validated correlated request to the Worker. */
	request(ctx: Context, request: Request, options?: WorkerRequestOptions): Promise<Response>;
	/** Block the next cooperative checkpoint for one active request. */
	pause(id: string): void;
	/** Release one paused request checkpoint. */
	resume(id: string): void;
	/** Stop owned work and join the termination contract; the reason remains available for diagnostics. */
	stop(reason?: unknown): Promise<void>;
}

/** Confirmed termination is distinct from a host termination failure. */
export interface WorkerTerminationType {
	/** Failed means the runtime did not confirm termination; do not acquire a replacement automatically. */
	readonly status: 'stopped' | 'failed';
	/** True when graceful shutdown did not complete before forced termination. */
	readonly forced: boolean;
	/** Original terminal reason or aggregate termination failure, without redaction. */
	readonly reason: unknown;
}

/** Worker-global message surface used by the server and test adapters. */
export interface RawWorkerScope {
	/** Send one protocol value with its explicit transferable ownership list. */
	postMessage(message: unknown, transfer?: readonly WorkerTransferable[]): void;
	/** Attach a protocol listener; the owner removes it when its lifetime ends. */
	addEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
	/** Attach a protocol listener; the owner removes it when its lifetime ends. */
	addEventListener(type: 'messageerror', listener: (event: WorkerMessageEvent) => void): void;
	/** Remove a previously attached protocol listener without settling unrelated requests. */
	removeEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
	/** Remove a previously attached protocol listener without settling unrelated requests. */
	removeEventListener(type: 'messageerror', listener: (event: WorkerMessageEvent) => void): void;
}

/** Explicit response wrapper for transferring ownership of response values. */
export interface WorkerReply<Response> {
	/** Stable discriminant for this worker reply value. */
	readonly kind: 'worker-reply';
	/** Response schema or payload associated with this worker reply. */
	readonly response: Response;
	/** Transferable values returned with a successful Worker reply. */
	readonly transfer: readonly WorkerTransferable[];
}

/** Controls owned by one active Worker request. */
export interface WorkerRequestControl<Notice = never, CallRequest = never, CallResponse = never> {
	/** Wait while the parent has this request cooperatively paused. */
	checkpoint(): Promise<void>;
	/** Emit optional progress or lifecycle information to the parent. */
	notify(notice: Notice, options?: WorkerMessageOptions): Promise<void>;
	/** Ask the parent for one authoritative request/result service. */
	call(request: CallRequest, options?: WorkerMessageOptions): Promise<CallResponse>;
}

/** Worker-side request operation. */
export type WorkerRequestRun<Request, Response, Notice = never, CallRequest = never, CallResponse = never> = (
	request: Request,
	ctx: Owned,
	control: WorkerRequestControl<Notice, CallRequest, CallResponse>,
) => Response | WorkerReply<Response> | Promise<Response | WorkerReply<Response>>;

/** Inputs accepted while serving one Worker protocol. */
export interface WorkerServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Join host-owned cleanup after requests settle and before shutdown acknowledgement. Borrowed resources remain caller-owned. Failure rejects closed and withholds acknowledgement. */
	readonly finalize?: () => void | Promise<void>;
	/** Maximum local requests, including validating/negotiating admissions and cancellation awaiting cleanup. Defaults to 1,000; excess rejects before payload validation. */
	readonly maximumRequests?: number;
	/** Opt-in logical payload limits. Unsupported host objects must be encoded into the documented inert/binary wire model. */
	readonly budget?: protocol.PayloadBudgetType;
	/** Exact protocol contract served by this Worker. */
	readonly protocol: WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>;
	/** Worker-side implementation for one correlated request. */
	readonly run: WorkerRequestRun<Request, Response, Notice, CallRequest, CallResponse>;
	/** Optional Worker global scope override used by tests or specialized hosts. */
	readonly scope?: RawWorkerScope;
	/** Optional factory used to create Worker-to-host reverse-call IDs. */
	readonly callId?: () => string;
}

/** Owned Worker-side protocol server. */
export interface WorkerServer extends AsyncDisposable {
	/** Terminal promise after request and host cleanup. Rejects if finalize fails; no successful shutdown acknowledgement is sent. */
	readonly closed: Promise<void>;
	/** Stop owned work and join the termination contract; the reason remains available for diagnostics. */
	stop(reason?: unknown): Promise<void>;
}

/** Parent request envelope shared with process transport. */
export interface WorkerRequestEnvelope<Request> extends protocol.Request<Request> {}

/** Request controls plus the thread-wide shutdown command. */
export type WorkerControlEnvelope<CallResponse = unknown> =
	| protocol.Control<CallResponse>
	| Readonly<{ readonly type: 'shutdown'; readonly reason?: unknown }>;

/** Request receipts and observations plus the thread-wide shutdown receipt. */
export type WorkerResponseEnvelope<Response, Notice = unknown, CallRequest = unknown> =
	| protocol.Response<Response, Notice, CallRequest>
	| Readonly<{ readonly type: 'stopped' }>;
