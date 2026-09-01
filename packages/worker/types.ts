import type { EventBus } from '@okikio/observables';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Snapshot } from '@okikio/context';
import type { Encoded as EncodedFailure } from '@okikio/failure';

/** Optional Worker-to-parent request/response contract used inside one active request. */
export interface WorkerCallProtocol<Request, Response> {
	/** Schema that validates Worker-to-host reverse-call requests. */
	readonly request: StandardSchemaV1<unknown, Request>;
	/** Response schema or payload associated with this worker call. */
	readonly response: StandardSchemaV1<unknown, Response>;
}

/** Validated request, terminal response, notice, reverse-call, and expected-failure wire schemas. */
export interface WorkerProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Schema that validates caller-to-Worker request payloads. */
	readonly request: StandardSchemaV1<unknown, Request>;
	/** Response schema or payload associated with this worker. */
	readonly response: StandardSchemaV1<unknown, Response>;
	/** Optional schema for encoded declared failures returned by Worker requests. */
	readonly failure?: StandardSchemaV1<unknown, EncodedFailure>;
	/** Optional non-authoritative progress or lifecycle message emitted by active work. */
	readonly notice?: StandardSchemaV1<unknown, Notice>;
	/** Optional Worker-to-parent request/result contract for authoritative host services. */
	readonly call?: WorkerCallProtocol<CallRequest, CallResponse>;
}

/** Input accepted by `workers.protocol()`. */
export interface WorkerProtocolOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse> {}

/** Explicit transfer and correlation options for one Worker request. */
export interface WorkerRequestOptions {
	/** Optional caller-supplied correlation ID for one Worker request. */
	readonly id?: string;
	/** Transferable values moved with this request instead of cloned. */
	readonly transfer?: readonly Transferable[];
}

/** Transfer options for one Worker notice or reverse call. */
export interface WorkerMessageOptions {
	/** Transferable values moved with this Worker message instead of cloned. */
	readonly transfer?: readonly Transferable[];
}

/** Worker lifecycle and correlated request observations. */
export type WorkerEventType =
	| Readonly<{ readonly type: 'opened'; readonly id: string }>
	| Readonly<{ readonly type: 'request'; readonly id: string }>
	| Readonly<{ readonly type: 'notice'; readonly id: string }>
	| Readonly<{ readonly type: 'call'; readonly id: string; readonly callId: string }>
	| Readonly<{ readonly type: 'paused'; readonly id: string }>
	| Readonly<{ readonly type: 'resumed'; readonly id: string }>
	| Readonly<{ readonly type: 'result'; readonly id: string }>
	| Readonly<{ readonly type: 'failure'; readonly id: string; readonly failureId: string }>
	| Readonly<{ readonly type: 'fault'; readonly id?: string; readonly reason: unknown }>
	| Readonly<{ readonly type: 'cancelled'; readonly id: string }>
	| Readonly<{ readonly type: 'stopping'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'stopped'; readonly forced: boolean }>;

/** Minimum raw Worker surface used by the handle and test adapters. */
export interface RawWorker {
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	terminate(): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
}

/** Creates one raw Worker for the generic request protocol owner. */
export type WorkerFactory = (module: URL, options: WorkerOptions) => RawWorker;

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
	/** Module URL loaded by the owned Worker. */
	readonly module: URL;
	/** Optional Worker name forwarded to the platform for diagnostics. */
	readonly name?: string;
	/** Exact request/response/failure/notice/reverse-call schemas for this Worker. */
	readonly protocol: WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse>;
	/** Grace period for cooperative Worker shutdown before termination. */
	readonly shutdownMs?: number;
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
	stop(reason?: unknown): Promise<void>;
}

/** Worker-global message surface used by the server and test adapters. */
export interface RawWorkerScope {
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
}

/** Explicit response wrapper for transferring ownership of response values. */
export interface WorkerReply<Response> {
	/** Stable discriminant for this worker reply value. */
	readonly kind: 'worker-reply';
	/** Response schema or payload associated with this worker reply. */
	readonly response: Response;
	/** Transferable values returned with a successful Worker reply. */
	readonly transfer: readonly Transferable[];
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
	ctx: Context,
	control: WorkerRequestControl<Notice, CallRequest, CallResponse>,
) => Response | WorkerReply<Response> | Promise<Response | WorkerReply<Response>>;

/** Inputs accepted while serving one Worker protocol. */
export interface WorkerServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
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
	/** Terminal Promise that resolves after this worker server has stopped and cleaned up. */
	readonly closed: Promise<void>;
	stop(reason?: unknown): Promise<void>;
}

/** Parent-to-Worker request envelope. */
export interface WorkerRequestEnvelope<Request> {
	/** Stable discriminant for this worker request envelope variant. */
	readonly type: 'request';
	/** Correlation ID that uniquely identifies this Worker request envelope. */
	readonly id: string;
	/** Serializable execution-context snapshot restored by the receiving host. */
	readonly context: Snapshot;
	/** Schema-validated request payload delivered to the Worker implementation. */
	readonly request: Request;
}

/** Parent-to-Worker control and reverse-call result envelopes. */
export type WorkerControlEnvelope<CallResponse = unknown> =
	| Readonly<{ readonly type: 'cancel'; readonly id: string; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'pause'; readonly id: string }>
	| Readonly<{ readonly type: 'resume'; readonly id: string }>
	| Readonly<{ readonly type: 'call-result'; readonly id: string; readonly callId: string; readonly response: CallResponse }>
	| Readonly<{ readonly type: 'call-fault'; readonly id: string; readonly callId: string; readonly fault: unknown }>
	| Readonly<{ readonly type: 'shutdown'; readonly reason?: unknown }>;

/** Worker-to-parent response, notice, and reverse-call envelopes. */
export type WorkerResponseEnvelope<Response, Notice = unknown, CallRequest = unknown> =
	| Readonly<{ readonly type: 'result'; readonly id: string; readonly response: Response }>
	| Readonly<{ readonly type: 'failure'; readonly id: string; readonly failure: EncodedFailure }>
	| Readonly<{ readonly type: 'notice'; readonly id: string; readonly notice: Notice }>
	| Readonly<{ readonly type: 'call'; readonly id: string; readonly callId: string; readonly request: CallRequest }>
	| Readonly<{ readonly type: 'fault'; readonly id?: string; readonly fault: unknown }>
	| Readonly<{ readonly type: 'stopped' }>;
