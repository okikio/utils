import type { ProcessChannelEventType as ProcessEventType } from '@okikio/telemetry/events';
import type * as protocol from '../../protocol.ts';
import type { EventBus } from '@okikio/observables/events';

import type { Context, Owned } from '@okikio/context';

import type { Process } from '../types.ts';

/** Reverse-call schema pair shared with thread requests. */
export interface ProcessCallProtocol<Request, Response> extends protocol.Call<Request, Response> {}

/** Exact payload schemas shared with thread requests. */
export interface ProcessChannelProtocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends protocol.Protocol<Request, Response, Notice, CallRequest, CallResponse> {}

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
export type { ProcessChannelEventType as ProcessEventType } from '@okikio/telemetry/events';

/** Inputs accepted while opening one framed channel above an owned process. */
export interface ProcessChannelOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Maximum local requests, including validating/negotiating admissions and cancellation awaiting cleanup. Defaults to 1,000; excess rejects before payload validation. */
	readonly maximumRequests?: number;
	/** Opt-in logical payload limits. Unsupported host objects must be encoded into the documented inert/binary wire model. */
	readonly budget?: protocol.PayloadBudgetType;
	/** Exact schemas for requests, responses, notices, failures, and reverse calls. */
	readonly protocol: ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse>;
	/** Maximum UTF-8 bytes in one JSON frame, excluding the newline delimiter. */
	readonly maximumFrameBytes?: number;
	/** Maximum wait for a cancellation receipt before asking the process owner to stop the child. Defaults to 1000ms. */
	readonly cancelMs?: number;
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
	/** Close the protocol after cleanup; delegate emergency retirement to the Process owner when acknowledgement fails. */
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
	ctx: Owned,
	control: ProcessRequestControl<Notice, CallRequest, CallResponse>,
) => Response | Promise<Response>;

/** Inputs accepted while serving one framed process protocol. */
export interface ProcessServeOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never> {
	/** Join host-owned cleanup after requests settle and before shutdown acknowledgement. Borrowed resources remain caller-owned. Failure rejects closed and withholds acknowledgement. */
	readonly finalize?: () => void | Promise<void>;
	/** Maximum local requests, including validating/negotiating admissions and cancellation awaiting cleanup. Defaults to 1,000; excess rejects before payload validation. */
	readonly maximumRequests?: number;
	/** Opt-in logical payload limits. Unsupported host objects must be encoded into the documented inert/binary wire model. */
	readonly budget?: protocol.PayloadBudgetType;
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
	/** Terminal promise after request and host cleanup. Rejects if finalize fails; no successful close acknowledgement is sent. */
	readonly closed: Promise<void>;
	/** Stop accepting frames and close the child-side protocol owner. */
	close(reason?: unknown): Promise<void>;
}

/** Parent request frame shared with thread transport. */
export interface ProcessRequestFrame<Request> extends protocol.Request<Request> {}

/** Request controls plus the process-channel close command. */
export type ProcessControlFrame<CallResponse = unknown> =
	| protocol.Control<CallResponse>
	| Readonly<{ readonly type: 'close'; readonly reason?: unknown }>;

/** Request receipts and observations plus the channel-wide close receipt. */
export type ProcessResponseFrame<Response, Notice = unknown, CallRequest = unknown> =
	| protocol.Response<Response, Notice, CallRequest>
	| Readonly<{ readonly type: 'closed' }>;

/** Process shape required by `channel.open()`. */
export type ProcessChannelSource = Process & Required<Pick<Process, 'stdin' | 'stdout'>>;
