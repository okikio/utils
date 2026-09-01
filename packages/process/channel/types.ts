import type { EventBus } from '@okikio/observables';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Snapshot } from '@okikio/context';
import type { Encoded as EncodedFailure } from '@okikio/failure';
import type { Process } from '../types.ts';

/** Optional child-to-parent request/result contract used inside one active process request. */
export interface ProcessCallProtocol<Request, Response> {
	/** Schema that validates child-to-parent reverse-call requests. */
	readonly request: StandardSchemaV1<unknown, Request>;
	/** Response schema or payload associated with this process call. */
	readonly response: StandardSchemaV1<unknown, Response>;
}

/** Schemas that define one framed child-process request protocol. */
export interface ProcessChannelProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Schema that validates parent-to-child request payloads. */
	readonly request: StandardSchemaV1<unknown, Request>;
	/** Response schema or payload associated with this process channel. */
	readonly response: StandardSchemaV1<unknown, Response>;
	/** Optional schema for encoded declared failures returned by child requests. */
	readonly failure?: StandardSchemaV1<unknown, EncodedFailure>;
	/** Optional observation contract or callback for this process channel. */
	readonly notice?: StandardSchemaV1<unknown, Notice>;
	/** Make one correlated reverse request while this process channel remains active. */
	readonly call?: ProcessCallProtocol<CallRequest, CallResponse>;
}

/** Input accepted by `channel.protocol()`. */
export interface ProcessProtocolOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse> {}

/** Correlation options for one process-channel request. */
export interface ProcessRequestOptions {
	/** Optional caller-supplied correlation ID for one process request. */
	readonly id?: string;
}

/** Parent-side reverse-call implementation for one active process request. */
export type ProcessCallRun<CallRequest, CallResponse> = (
	request: CallRequest,
	ctx: Context,
	requestId: string,
	callId: string,
) => CallResponse | Promise<CallResponse>;

/** Parent-side observer for optional non-authoritative process notices. */
export type ProcessNoticeSink<Notice> = (notice: Notice, ctx: Context, requestId: string) => void | Promise<void>;

/** Process channel lifecycle and correlated request observations. */
export type ProcessEventType =
	| Readonly<{ readonly type: 'opened'; readonly pid: number }>
	| Readonly<{ readonly type: 'request'; readonly id: string }>
	| Readonly<{ readonly type: 'notice'; readonly id: string }>
	| Readonly<{ readonly type: 'call'; readonly id: string; readonly callId: string }>
	| Readonly<{ readonly type: 'paused'; readonly id: string }>
	| Readonly<{ readonly type: 'resumed'; readonly id: string }>
	| Readonly<{ readonly type: 'result'; readonly id: string }>
	| Readonly<{ readonly type: 'failure'; readonly id: string; readonly failureId: string }>
	| Readonly<{ readonly type: 'fault'; readonly id?: string; readonly reason: unknown }>
	| Readonly<{ readonly type: 'cancelled'; readonly id: string }>
	| Readonly<{ readonly type: 'closing'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'closed' }>;

/** Inputs accepted while opening one framed channel above an owned process. */
export interface ProcessChannelOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Exact schemas for requests, responses, notices, failures, and reverse calls. */
	readonly protocol: ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>;
	/** Maximum UTF-8 bytes in one JSON frame, excluding the newline delimiter. */
	readonly maximumFrameBytes?: number;
	/** Optional factory used when the caller does not supply a process request ID. */
	readonly requestId?: () => string;
	/** Optional observation contract or callback for this process channel. */
	readonly notice?: ProcessNoticeSink<Notice>;
	/** Make one correlated reverse request while this process channel remains active. */
	readonly call?: ProcessCallRun<CallRequest, CallResponse>;
}

/** Owned parent-side framed request endpoint. The underlying Process keeps process lifetime authority. */
export interface ProcessChannel<Request, Response> extends AsyncDisposable {
	/** Operating-system process ID used only for diagnostics and process ownership. */
	readonly pid: number;
	/** Read-only local observations for request and channel lifecycle changes. */
	readonly events: EventBus<ProcessEventType>['events'];
	/** Send one correlated request and await its sole terminal response. */
	request(ctx: Context, request: Request, options?: ProcessRequestOptions): Promise<Response>;
	/** Block the matching child request at its next cooperative checkpoint. */
	pause(id: string): Promise<void>;
	/** Release the matching paused checkpoint generation. */
	resume(id: string): Promise<void>;
	/** Stop new requests and close the framed protocol without taking process-lifecycle authority. */
	close(reason?: unknown): Promise<void>;
}

/** Controls available to one child-side active request. */
export interface ProcessRequestControl<Notice = never, CallRequest = never, CallResponse = never> {
	/** Wait while the parent has paused this request and recheck cancellation before returning. */
	checkpoint(): Promise<void>;
	/** Publish one optional non-authoritative notice to the parent. */
	notify(notice: Notice): Promise<void>;
	/** Make one correlated reverse call to the parent and await its result. */
	call(request: CallRequest): Promise<CallResponse>;
}

/** Child-side request implementation. */
export type ProcessRequestRun<Request, Response, Notice = never, CallRequest = never, CallResponse = never> = (
	request: Request,
	ctx: Context,
	control: ProcessRequestControl<Notice, CallRequest, CallResponse>,
) => Response | Promise<Response>;

/** Inputs accepted while serving one framed process protocol. */
export interface ProcessServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Exact framed protocol contract accepted by the child server. */
	readonly protocol: ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>;
	/** Readable protocol stream consumed by the child-side channel server. */
	readonly input: ReadableStream<Uint8Array>;
	/** Protocol-only byte stream used for framed responses; diagnostics belong on stderr. */
	readonly output: WritableStream<Uint8Array>;
	/** Child-side implementation for one correlated request. */
	readonly run: ProcessRequestRun<Request, Response, Notice, CallRequest, CallResponse>;
	/** Maximum UTF-8 bytes accepted in one framed protocol message. */
	readonly maximumFrameBytes?: number;
	/** Optional factory used to create child-to-parent reverse-call IDs. */
	readonly callId?: () => string;
}

/** Owned child-side process channel server. */
export interface ProcessServer extends AsyncDisposable {
	/** Terminal Promise for child-side protocol shutdown. */
	readonly closed: Promise<void>;
	/** Stop accepting frames and close the child-side protocol owner. */
	close(reason?: unknown): Promise<void>;
}

/** Parent-to-child request frame. */
export interface ProcessRequestFrame<Request> {
	/** Stable discriminant for this process request variant. */
	readonly type: 'request';
	/** Optional caller-supplied correlation ID for one process request. */
	readonly id: string;
	/** Serializable execution-context snapshot restored by the receiving host. */
	readonly context: Snapshot;
	/** Request payload validated before child-side execution begins. */
	readonly request: Request;
}

/** Parent-to-child control frames. */
export type ProcessControlFrame<CallResponse = unknown> =
	| Readonly<{ readonly type: 'cancel'; readonly id: string; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'pause'; readonly id: string }>
	| Readonly<{ readonly type: 'resume'; readonly id: string }>
	| Readonly<{ readonly type: 'call-result'; readonly id: string; readonly callId: string; readonly response: CallResponse }>
	| Readonly<{ readonly type: 'call-fault'; readonly id: string; readonly callId: string; readonly fault: unknown }>
	| Readonly<{ readonly type: 'close'; readonly reason?: unknown }>;

/** Child-to-parent terminal, notice, reverse-call, and close frames. */
export type ProcessResponseFrame<Response, Notice = unknown, CallRequest = unknown> =
	| Readonly<{ readonly type: 'result'; readonly id: string; readonly response: Response }>
	| Readonly<{ readonly type: 'failure'; readonly id: string; readonly failure: EncodedFailure }>
	| Readonly<{ readonly type: 'notice'; readonly id: string; readonly notice: Notice }>
	| Readonly<{ readonly type: 'call'; readonly id: string; readonly callId: string; readonly request: CallRequest }>
	| Readonly<{ readonly type: 'fault'; readonly id?: string; readonly fault: unknown }>
	| Readonly<{ readonly type: 'closed' }>;

/** Process shape required by `channel.open()`. */
export type ProcessChannelSource = Process & Required<Pick<Process, 'stdin' | 'stdout'>>;
