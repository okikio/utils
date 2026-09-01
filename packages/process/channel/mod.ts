/**
 * Bounded newline-framed JSON request channels above `@okikio/process`.
 *
 * `@okikio/process` remains the sole owner of spawn, signals, process-tree
 * behavior, exit, and shutdown. This subpath only owns framing, request
 * correlation, validation, optional notices, reverse calls, and cooperative
 * pause controls carried through the child process streams.
 *
 * Stdout must be reserved for protocol frames. Use the child process stderr
 * policy for diagnostics so arbitrary logs cannot corrupt framing.
 *
 * @module
 */
import { EventBus } from '@okikio/observables';
import * as contextCore from '@okikio/context';
import type { Context } from '@okikio/context';
import * as failure from '@okikio/failure';
import * as faultCore from '@okikio/fault';
import type { Encoded as EncodedFailure } from '@okikio/failure';
import * as schema from '@okikio/schema';

import type {
	ProcessChannel,
	ProcessChannelSource,
	ProcessChannelProtocol,
	ProcessEventType,
	ProcessChannelOptions,
	ProcessProtocolOptions,
	ProcessRequestControl,
	ProcessRequestFrame,
	ProcessRequestOptions,
	ProcessServeOptions,
	ProcessServer,
} from './types.ts';

/** Default hard limit for one newline-framed protocol message. */
const DEFAULT_MAXIMUM_FRAME_BYTES = 1_048_576;

/** A framed process peer returned an expected encoded failure. */
export class ChannelFailureError extends Error {
	/** Encoded declared failure returned by the child request. */
	readonly failure: EncodedFailure;

	/** Create one parent-side error for a declared child failure envelope. */
	constructor(failure: EncodedFailure) {
		super(failure.message);
		this.name = 'ChannelFailureError';
		this.failure = failure;
	}
}

/** The child process reported an unexpected request fault. */
export class ChannelFaultError extends Error {
	/** Cloneable unexpected fault reported by the child process. */
	readonly fault: unknown;

	/** Create one parent-side error for an unexpected child fault. */
	constructor(fault: unknown) {
		super('Process channel request faulted.', { cause: fault });
		this.name = 'ChannelFaultError';
		this.fault = fault;
	}
}

/** Framing, correlation, or schema validation no longer makes the process channel trustworthy. */
export class ChannelProtocolError extends Error {
	/** Invalid frame or payload value that made request correlation untrustworthy. */
	readonly value: unknown;

	/** Create one protocol error and retain the invalid value for local diagnostics. */
	constructor(message: string, value?: unknown) {
		super(message);
		this.name = 'ChannelProtocolError';
		this.value = value;
	}
}

/** The channel closed before one pending request reached a terminal response. */
export class ChannelClosedError extends Error {
	/** Local or remote reason associated with channel shutdown. */
	readonly reason: unknown;

	/** Create one terminal error for a request attempted after channel shutdown. */
	constructor(reason?: unknown) {
		super('Process channel closed before the request completed.', reason === undefined ? undefined : { cause: reason });
		this.name = 'ChannelClosedError';
		this.reason = reason;
	}
}

/** Parent-side pending request state retained only until terminal settlement. */
interface Pending<Response> {
	/** Request context whose cancellation is forwarded to the matching child request. */
	readonly ctx: Context;
	/** Resolve the parent Promise with the validated terminal response. */
	readonly resolve: (value: Response) => void;
	/** Reject the parent Promise when the request fails, faults, cancels, or loses its channel. */
	readonly reject: (reason: unknown) => void;
	/** Remove the request-local cancellation listener after terminal settlement. */
	readonly unlink: () => void;
}

/** Child-side reverse call waiting for one parent response. */
interface PendingCall<Response> {
	/** Resolve one child-to-parent reverse call with the validated parent response. */
	readonly resolve: (value: Response) => void;
	/** Reject the reverse call when the parent reports a fault or the channel closes. */
	readonly reject: (reason: unknown) => void;
}

/** Cooperative pause state for one child-side request. */
interface PauseState {
	/** Whether future checkpoints must wait for a resume control frame. */
	paused: boolean;
	/** Checkpoint continuations released together when the request resumes or cancels. */
	readonly waiters: Set<() => void>;
}

/** Child-side state for one request and every reverse call it owns. */
interface Active<Response> {
	/** Owned child request context restored from the parent snapshot. */
	readonly ctx: contextCore.Owned;
	/** Cooperative pause state shared by every checkpoint in this request. */
	readonly pause: PauseState;
	/** Reverse calls awaiting matching parent call-result frames. */
	readonly calls: Map<string, PendingCall<Response>>;
	/** Request-handler settlement used to keep protocol shutdown from abandoning live work. */
	readonly settled: Promise<void>;
}

/** Define and validate one immutable process channel protocol. */
export function protocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	options: ProcessProtocolOptions<Request, Response, Notice, CallRequest, CallResponse>,
): ProcessChannelProtocol<Request, Response, Notice, CallRequest, CallResponse> {
	schema.assert(options.request, 'Process channel request schema');
	schema.assert(options.response, 'Process channel response schema');
	if (options.failure !== undefined) schema.assert(options.failure, 'Process channel failure schema');
	if (options.notice !== undefined) schema.assert(options.notice, 'Process channel notice schema');
	if (options.call !== undefined) {
		schema.assert(options.call.request, 'Process channel reverse-call request schema');
		schema.assert(options.call.response, 'Process channel reverse-call response schema');
	}
	return Object.freeze({ ...options });
}

/**
 * Open one request channel above a child process with piped stdin and stdout.
 *
 * Closing the channel does not replace process lifetime ownership. It asks the
 * child protocol server to close, settles channel-local requests, and releases
 * stream locks. The caller still owns the `Process` and decides when to stop or
 * dispose it.
 */
export function open<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	ctx: Context,
	child: ProcessChannelSource,
	options: ProcessChannelOptions<Request, Response, Notice, CallRequest, CallResponse>,
): ProcessChannel<Request, Response> {
	contextCore.check(ctx);
	const maximumFrameBytes = limit(options.maximumFrameBytes);
	const writer = child.stdin.getWriter();
	const pending = new Map<string, Pending<Response>>();
	const cancelled = new Map<string, ReturnType<typeof setTimeout>>();
	const events = new EventBus<ProcessEventType>();
	const receiveController = new AbortController();
	const createRequestId = options.requestId ?? (() => crypto.randomUUID());
	let state: 'open' | 'closing' | 'closed' = 'open';
	let closePromise: Promise<void> | undefined;
	let writeQueue = Promise.resolve();
	void listen();
	events.emit(Object.freeze({ type: 'opened', pid: child.pid }));

	const closeChannel = (reason?: unknown): Promise<void> => {
		closePromise ??= close(reason);
		return closePromise;
	};
	const parentAbort = () => void closeChannel(ctx.signal.reason).catch(() => {});
	ctx.signal.addEventListener('abort', parentAbort, { once: true });

	const channel: ProcessChannel<Request, Response> = Object.freeze({
		pid: child.pid,
		events: events.events,
		async request(requestCtx: Context, request: Request, requestOptions: ProcessRequestOptions = {}) {
			contextCore.check(requestCtx);
			if (state !== 'open') throw new ChannelClosedError();
			const id = requestOptions.id ?? createRequestId();
			assertId(id, 'Process channel request');
			if (pending.has(id) || cancelled.has(id)) throw new TypeError(`Process channel request ${JSON.stringify(id)} is already active or recently cancelled.`);
			const value = await schema.parse(options.protocol.request, request);
			const response = new Promise<Response>((resolve, reject) => {
				const abort = () => {
					const current = pending.get(id);
					if (current === undefined) return;
					pending.delete(id);
					current.unlink();
					rememberCancelled(id);
					void send({ type: 'cancel', id, reason: requestCtx.signal.reason }).catch(invalidate);
					events.emit(Object.freeze({ type: 'cancelled', id }));
					reject(new contextCore.ContextCancelledError(requestCtx.signal.reason));
				};
				const unlink = () => requestCtx.signal.removeEventListener('abort', abort);
				pending.set(id, { ctx: requestCtx, resolve, reject, unlink });
				requestCtx.signal.addEventListener('abort', abort, { once: true });
				if (requestCtx.signal.aborted) abort();
			});
			if (!pending.has(id)) return await response;
			const frame: ProcessRequestFrame<Request> = { type: 'request', id, context: contextCore.snapshot(requestCtx), request: value };
			try {
				await send(frame);
				events.emit(Object.freeze({ type: 'request', id }));
			} catch (error) {
				settle(id, (entry) => entry.reject(error));
			}
			return await response;
		},
		async pause(id: string) {
			assertActive(id, 'pause');
			await send({ type: 'pause', id });
			events.emit(Object.freeze({ type: 'paused', id }));
		},
		async resume(id: string) {
			assertActive(id, 'resume');
			await send({ type: 'resume', id });
			events.emit(Object.freeze({ type: 'resumed', id }));
		},
		close(reason?: unknown) {
			return closeChannel(reason);
		},
		async [Symbol.asyncDispose]() {
			await closeChannel('Process channel was disposed.');
		},
	});
	return channel;

	/** Consume child frames until the protocol closes or stream integrity fails. */
	async function listen(): Promise<void> {
		try {
			for await (const message of frames(child.stdout, maximumFrameBytes, receiveController.signal)) {
				await receive(message);
				// A protocol `closed` frame is terminal even when the underlying
				// process stdout stream remains open for unrelated lifetime reasons.
				// Stop pulling immediately so `close()` does not wait for process exit.
				if (state === 'closed') return;
			}
			if (state === 'open') invalidate(new ChannelClosedError('Child stdout closed.'));
		} catch (error) {
			invalidate(error);
		}
	}

	/** Route one validated JSON object without allowing optional frames to settle requests. */
	async function receive(message: unknown): Promise<void> {
		if (!isRecord(message) || typeof message.type !== 'string') throw new ChannelProtocolError('Child sent a non-envelope frame.', message);
		if (message.type === 'closed') {
			if (state === 'open') throw new ChannelProtocolError('Child closed the protocol without a parent close request.', message);
			finish(undefined);
			return;
		}
		if (message.type === 'fault' && message.id === undefined) throw new ChannelFaultError(message.fault);
		if (typeof message.id !== 'string') throw new ChannelProtocolError('Child frame is missing a request ID.', message);
		const id = message.id;
		if (cancelled.has(id)) {
			forgetCancelled(id);
			return;
		}
		const entry = pending.get(id);
		if (entry === undefined) throw new ChannelProtocolError(`Child used unknown request ID ${JSON.stringify(id)}.`, message);

		if (message.type === 'notice') {
			if (options.protocol.notice === undefined) throw new ChannelProtocolError('Child emitted a notice for a protocol without notices.', message);
			const notice = await schema.parse(options.protocol.notice, message.notice);
			events.emit(Object.freeze({ type: 'notice', id }));
			if (options.notice !== undefined) void Promise.resolve(options.notice(notice, entry.ctx, id)).catch(() => {});
			return;
		}
		if (message.type === 'call') {
			await answerCall(id, entry, message);
			return;
		}
		if (message.type === 'result') {
			const value = await schema.parse(options.protocol.response, message.response);
			settle(id, (current) => current.resolve(value));
			events.emit(Object.freeze({ type: 'result', id }));
			return;
		}
		if (message.type === 'failure') {
			const encoded = options.protocol.failure === undefined
				? encodedFailure(message.failure)
				: await schema.parse(options.protocol.failure, message.failure);
			settle(id, (current) => current.reject(new ChannelFailureError(encoded)));
			events.emit(Object.freeze({ type: 'failure', id, failureId: encoded.id }));
			return;
		}
		if (message.type === 'fault') {
			settle(id, (current) => current.reject(new ChannelFaultError(message.fault)));
			events.emit(Object.freeze({ type: 'fault', id, reason: message.fault }));
			return;
		}
		throw new ChannelProtocolError(`Unsupported child frame type ${JSON.stringify(message.type)}.`, message);
	}

	/** Answer one child-to-parent call while preserving request cancellation and correlation. */
	async function answerCall(id: string, entry: Pending<Response>, message: Record<string, unknown>): Promise<void> {
		const contract = options.protocol.call;
		if (contract === undefined || options.call === undefined) throw new ChannelProtocolError('Child requested a reverse call that the parent does not provide.', message);
		if (typeof message.callId !== 'string') throw new ChannelProtocolError('Child reverse call is missing a call ID.', message);
		const callId = message.callId;
		assertId(callId, 'Process channel reverse call');
		const request = await schema.parse(contract.request, message.request);
		events.emit(Object.freeze({ type: 'call', id, callId }));
		try {
			const response = await options.call(request, entry.ctx, id, callId);
			const value = await schema.parse(contract.response, response);
			if (pending.get(id) !== entry || entry.ctx.signal.aborted) return;
			await send({ type: 'call-result', id, callId, response: value });
		} catch (error) {
			if (pending.get(id) !== entry || entry.ctx.signal.aborted) return;
			await send({ type: 'call-fault', id, callId, fault: fault(error) });
		}
	}

	/** Serialize every parent frame through one writer so JSON lines never interleave. */
	function send(frame: unknown): Promise<void> {
		const next = writeQueue.then(async () => {
			if (state === 'closed') throw new ChannelClosedError();
			await writeFrame(writer, frame, maximumFrameBytes);
		});
		writeQueue = next.catch(() => {});
		return next;
	}

	/** Close channel-local ownership without claiming to own the child process itself. */
	async function close(reason: unknown): Promise<void> {
		if (state === 'closed') return;
		if (state === 'open') {
			state = 'closing';
			events.emit(Object.freeze({ type: 'closing', ...(reason === undefined ? {} : { reason }) }));
			try {
				await send({ type: 'close', ...(reason === undefined ? {} : { reason }) });
			} catch (error) {
				// A local framing/write failure means the child cannot acknowledge this
				// close request. End channel-local ownership immediately instead of
				// waiting forever for a response that was never delivered.
				finish(error);
				return;
			}
		}
		await settles(loop);
		finish(reason);
	}

	/** Mark the channel unusable when framing or correlation becomes untrustworthy. */
	function invalidate(reason: unknown): void {
		if (state === 'closed') return;
		events.emit(Object.freeze({ type: 'fault', reason }));
		finish(reason);
	}

	/** Settle all local ownership once, then release stream locks and observers. */
	function finish(reason: unknown): void {
		if (state === 'closed') return;
		state = 'closed';
		if (!receiveController.signal.aborted) receiveController.abort(reason);
		ctx.signal.removeEventListener('abort', parentAbort);
		for (const [id, entry] of pending) {
			pending.delete(id);
			entry.unlink();
			entry.reject(new ChannelClosedError(reason));
		}
		for (const id of cancelled.keys()) forgetCancelled(id);
		try { writer.releaseLock(); } catch { /* already released by peer failure */ }
		events.emit(Object.freeze({ type: 'closed' }));
		events[Symbol.dispose]();
	}

	/** Remove one pending request exactly once before its terminal resolver runs. */
	function settle(id: string, resolve: (entry: Pending<Response>) => void): void {
		const entry = pending.get(id);
		if (entry === undefined) return;
		pending.delete(id);
		entry.unlink();
		resolve(entry);
	}

	/** Require pause/resume to identify a currently owned request. */
	function assertActive(id: string, operation: 'pause' | 'resume'): void {
		assertId(id, 'Process channel request');
		if (state !== 'open') throw new ChannelClosedError();
		if (!pending.has(id)) throw new TypeError(`Cannot ${operation} unknown process channel request ${JSON.stringify(id)}.`);
	}

	/** Retain a cancelled request ID briefly so one raced child response can be discarded. */
	function rememberCancelled(id: string): void {
		forgetCancelled(id);
		cancelled.set(id, setTimeout(() => forgetCancelled(id), 60_000));
	}

	/** Release late-response protection for one cancelled request. */
	function forgetCancelled(id: string): void {
		const timer = cancelled.get(id);
		if (timer !== undefined) clearTimeout(timer);
		cancelled.delete(id);
	}
}

/**
 * Serve one framed protocol over child-process stdin/stdout streams.
 *
 * The server owns only request contexts and stream locks. The executable that
 * calls this function remains responsible for its process lifetime and exit
 * code. `close()` cancels active requests, rejects pending reverse calls, sends
 * the close acknowledgement, and releases stream locks.
 */
export function serve<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	options: ProcessServeOptions<Request, Response, Notice, CallRequest, CallResponse>,
): ProcessServer {
	const maximumFrameBytes = limit(options.maximumFrameBytes);
	const writer = options.output.getWriter();
	const active = new Map<string, Active<CallResponse>>();
	const ended = new Map<string, ReturnType<typeof setTimeout>>();
	const receiveController = new AbortController();
	const createCallId = options.callId ?? (() => crypto.randomUUID());
	let state: 'open' | 'closing' | 'closed' = 'open';
	let closePromise: Promise<void> | undefined;
	let writeQueue = Promise.resolve();
	let resolveClosed!: () => void;
	const closed = new Promise<void>((resolve) => resolveClosed = resolve);
	void listen();

	const closeServer = (reason?: unknown): Promise<void> => {
		closePromise ??= close(reason, false);
		return closePromise;
	};
	return Object.freeze({
		closed,
		close(reason?: unknown) {
			return closeServer(reason);
		},
		async [Symbol.asyncDispose]() {
			await closeServer('Process channel server was disposed.');
		},
	});

	/** Consume parent frames until close or an integrity failure ends the server. */
	async function listen(): Promise<void> {
		try {
			for await (const message of frames(options.input, maximumFrameBytes, receiveController.signal)) {
				await receive(message);
				// Protocol closure is independent from stdin lifetime. A real child can
				// keep the pipe open until process shutdown, so do not keep this server
				// alive after the close handshake is complete.
				if (state === 'closed') return;
			}
			if (state === 'open') await close(new ChannelClosedError('Parent input closed.'), false);
		} catch (error) {
			try { await send({ type: 'fault', fault: fault(error) }); } catch { /* parent may already be gone */ }
			await close(error, false);
		}
	}

	/** Route one parent frame to request, cancellation, pause, reverse-call, or close state. */
	async function receive(message: unknown): Promise<void> {
		if (!isRecord(message) || typeof message.type !== 'string') throw new ChannelProtocolError('Parent sent a non-envelope frame.', message);
		if (message.type === 'request') {
			if (state !== 'open') {
				await send({ type: 'fault', ...(typeof message.id === 'string' ? { id: message.id } : {}), fault: fault(new ChannelClosedError()) });
				return;
			}
			await startRequest(message);
			return;
		}
		if (message.type === 'close') {
			await close(message.reason, true);
			return;
		}
		if (typeof message.id !== 'string') throw new ChannelProtocolError(`${message.type} frame is missing a request ID.`, message);
		const id = message.id;
		const request = active.get(id);
		if (request === undefined && ended.has(id) && (message.type === 'call-result' || message.type === 'call-fault')) return;
		if (request === undefined) throw new ChannelProtocolError(`Parent used unknown request ID ${JSON.stringify(id)}.`, message);

		if (message.type === 'cancel') {
			contextCore.cancel(request.ctx, message.reason);
			resume(request.pause);
			return;
		}
		if (message.type === 'pause') {
			request.pause.paused = true;
			return;
		}
		if (message.type === 'resume') {
			resume(request.pause);
			return;
		}
		if (message.type === 'call-result' || message.type === 'call-fault') {
			await settleCall(id, request, message);
			return;
		}
		throw new ChannelProtocolError(`Unsupported parent frame type ${JSON.stringify(message.type)}.`, message);
	}

	/** Validate one request before restoring its process-local cancellation state. */
	async function startRequest(message: Record<string, unknown>): Promise<void> {
		if (typeof message.id !== 'string') throw new ChannelProtocolError('Request frame is missing an ID.', message);
		const id = message.id;
		assertId(id, 'Process channel request');
		if (active.has(id)) throw new ChannelProtocolError(`Request ${JSON.stringify(id)} is already active.`, message);
		forgetEnded(id);
		if (!snapshot(message.context)) throw new ChannelProtocolError('Request context snapshot is invalid.', message.context);
		const request = await schema.parse(options.protocol.request, message.request);
		const ctx = contextCore.restore(message.context);
		const pause: PauseState = { paused: false, waiters: new Set() };
		const calls = new Map<string, PendingCall<CallResponse>>();
		const settled = runRequest(id, request, ctx, pause, calls);
		active.set(id, { ctx, pause, calls, settled });
		// Request execution is intentionally detached from the frame reader but
		// remains owned by `active`. The reader must stay free to receive cancel,
		// pause/resume, and reverse-call result frames while the request is still
		// running. `close()` joins every `settled` promise before releasing the
		// server, so this does not create detached work.
	}

	/** Execute one child request while optional messages remain non-terminal. */
	async function runRequest(
		id: string,
		request: Request,
		ctx: contextCore.Owned,
		pause: PauseState,
		calls: Map<string, PendingCall<CallResponse>>,
	): Promise<void> {
		const control: ProcessRequestControl<Notice, CallRequest, CallResponse> = Object.freeze({
			async checkpoint() {
				contextCore.check(ctx);
				if (pause.paused) await wait(ctx, pause);
				contextCore.check(ctx);
			},
			async notify(notice: Notice) {
				if (options.protocol.notice === undefined) throw new ChannelProtocolError('This process protocol does not declare notices.');
				const value = await schema.parse(options.protocol.notice, notice);
				await send({ type: 'notice', id, notice: value });
			},
			async call(callRequest: CallRequest) {
				const contract = options.protocol.call;
				if (contract === undefined) throw new ChannelProtocolError('This process protocol does not declare reverse calls.');
				const value = await schema.parse(contract.request, callRequest);
				const callId = createCallId();
				assertId(callId, 'Process channel reverse call');
				if (calls.has(callId)) throw new ChannelProtocolError(`Reverse call ${JSON.stringify(callId)} is already active.`);
				const result = new Promise<CallResponse>((resolve, reject) => calls.set(callId, { resolve, reject }));
				try {
					await send({ type: 'call', id, callId, request: value });
					return await result;
				} finally {
					calls.delete(callId);
				}
			},
		});

		try {
			const response = await options.run(request, ctx, control);
			if (ctx.signal.aborted) return;
			const value = await schema.parse(options.protocol.response, response);
			if (ctx.signal.aborted) return;
			await send({ type: 'result', id, response: value });
		} catch (error) {
			if (ctx.signal.aborted) return;
			if (failure.isOccurrence(error)) {
				try {
					const encoded = await failure.encode(error);
					const value = options.protocol.failure === undefined ? encoded : await schema.parse(options.protocol.failure, encoded);
					await send({ type: 'failure', id, failure: value });
				} catch (encodingError) {
					await send({ type: 'fault', id, fault: fault(encodingError) });
				}
				return;
			}
			await send({ type: 'fault', id, fault: fault(error) });
		} finally {
			resume(pause);
			for (const entry of calls.values()) entry.reject(new ChannelClosedError('Request ended before reverse call completion.'));
			calls.clear();
			active.delete(id);
			rememberEnded(id);
			await ctx[Symbol.asyncDispose]();
		}
	}

	/** Settle one reverse call only when its request and call IDs both remain current. */
	async function settleCall(id: string, request: Active<CallResponse>, message: Record<string, unknown>): Promise<void> {
		if (typeof message.callId !== 'string') throw new ChannelProtocolError('Reverse-call result is missing a call ID.', message);
		const callId = message.callId;
		const entry = request.calls.get(callId);
		if (entry === undefined) throw new ChannelProtocolError(`Unknown reverse call ${JSON.stringify(callId)} for request ${JSON.stringify(id)}.`, message);
		request.calls.delete(callId);
		if (message.type === 'call-fault') {
			entry.reject(new ChannelFaultError(message.fault));
			return;
		}
		const contract = options.protocol.call;
		if (contract === undefined) throw new ChannelProtocolError('Parent returned a reverse-call result for a protocol without calls.', message);
		entry.resolve(await schema.parse(contract.response, message.response));
	}

	/** Serialize child frames through one writer to preserve newline framing. */
	function send(frame: unknown): Promise<void> {
		const next = writeQueue.then(() => writeFrame(writer, frame, maximumFrameBytes));
		writeQueue = next.catch(() => {});
		return next;
	}

	/** Cancel active requests and release child-side stream ownership exactly once. */
	async function close(reason: unknown, acknowledge: boolean): Promise<void> {
		if (state === 'closed') return;
		state = 'closing';
		for (const request of active.values()) {
			contextCore.cancel(request.ctx, reason);
			resume(request.pause);
		}
		await Promise.allSettled([...active.values()].map((request) => request.settled));
		if (acknowledge) {
			try { await send({ type: 'closed' }); } catch { /* parent already disconnected */ }
		}
		state = 'closed';
		if (!receiveController.signal.aborted) receiveController.abort(reason);
		for (const id of ended.keys()) forgetEnded(id);
		try { writer.releaseLock(); } catch { /* writer may already be released */ }
		resolveClosed();
	}

	/** Bound late reverse-call response races after one request has already settled. */
	function rememberEnded(id: string): void {
		forgetEnded(id);
		ended.set(id, setTimeout(() => forgetEnded(id), 60_000));
	}

	/** Remove one ended request ID and its retention timer. */
	function forgetEnded(id: string): void {
		const timer = ended.get(id);
		if (timer !== undefined) clearTimeout(timer);
		ended.delete(id);
	}
}

/** Parse bounded newline-delimited JSON frames without materializing an unbounded child stdout buffer. */
async function* frames(
	input: ReadableStream<Uint8Array>,
	maximumBytes: number,
	signal?: AbortSignal,
): AsyncIterable<unknown> {
	const reader = input.getReader();
	const decoder = new TextDecoder();
	let parts: Uint8Array[] = [];
	let size = 0;
	const abort = (): void => {
		// Cancelling the dedicated protocol reader releases a pending `read()`.
		// The process owner still owns the process lifetime itself.
		void reader.cancel(signal?.reason).catch(() => {});
	};
	try {
		if (signal !== undefined) {
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
		}
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			let start = 0;
			for (let index = 0; index < next.value.byteLength; index++) {
				if (next.value[index] !== 10) continue;
				const part = next.value.subarray(start, index);
				size += part.byteLength;
				if (size > maximumBytes) throw new ChannelProtocolError(`Process channel frame exceeds ${maximumBytes} bytes.`);
				if (part.byteLength > 0) parts.push(part);
				const bytes = concat(parts, size);
				parts = [];
				size = 0;
				start = index + 1;
				if (bytes.byteLength === 0) continue;
				let value: unknown;
				try { value = JSON.parse(decoder.decode(bytes)); }
				catch (error) { throw new ChannelProtocolError('Process channel frame is not valid JSON.', error); }
				yield value;
			}
			if (start < next.value.byteLength) {
				const rest = next.value.subarray(start);
				size += rest.byteLength;
				if (size > maximumBytes) throw new ChannelProtocolError(`Process channel frame exceeds ${maximumBytes} bytes.`);
				parts.push(rest);
			}
		}
		if (size !== 0) throw new ChannelProtocolError('Process channel closed with an unterminated JSON frame.');
	} finally {
		signal?.removeEventListener('abort', abort);
		reader.releaseLock();
	}
}

/** Write one JSON frame after enforcing the configured UTF-8 byte limit. */
async function writeFrame(writer: WritableStreamDefaultWriter<Uint8Array>, frame: unknown, maximumBytes: number): Promise<void> {
	let json: string;
	try { json = JSON.stringify(frame); }
	catch (error) { throw new ChannelProtocolError('Process channel frame is not JSON serializable.', error); }
	const bytes = new TextEncoder().encode(`${json}\n`);
	if (bytes.byteLength - 1 > maximumBytes) throw new ChannelProtocolError(`Process channel frame exceeds ${maximumBytes} bytes.`, frame);
	await writer.write(bytes);
}

/** Validate the configured frame bound before any stream ownership is acquired. */
function limit(value: number | undefined): number {
	const resolved = value ?? DEFAULT_MAXIMUM_FRAME_BYTES;
	if (!Number.isSafeInteger(resolved) || resolved < 1) throw new TypeError('maximumFrameBytes must be a positive safe integer.');
	return resolved;
}

/** Release all waiters blocked at one cooperative process request checkpoint. */
function resume(state: PauseState): void {
	state.paused = false;
	for (const release of state.waiters) release();
	state.waiters.clear();
}

/** Wait until resume or cancellation without claiming the process can suspend an arbitrary provider call. */
async function wait(ctx: Context, state: PauseState): Promise<void> {
	if (!state.paused) return;
	await new Promise<void>((resolve, reject) => {
		let done = false;
		const finish = (error?: unknown) => {
			if (done) return;
			done = true;
			state.waiters.delete(release);
			ctx.signal.removeEventListener('abort', abort);
			if (error === undefined) resolve();
			else reject(error);
		};
		const release = () => finish();
		const abort = () => finish(new contextCore.ContextCancelledError(ctx.signal.reason));
		state.waiters.add(release);
		ctx.signal.addEventListener('abort', abort, { once: true });
		if (!state.paused) release();
		else if (ctx.signal.aborted) abort();
	});
}

/** Validate the serializable context representation before creating a local child lifetime. */
function snapshot(value: unknown): value is contextCore.Snapshot {
	return isRecord(value) && typeof value.id === 'string' && typeof value.startedAt === 'string' &&
		(value.traceId === undefined || typeof value.traceId === 'string') &&
		(value.deploymentId === undefined || typeof value.deploymentId === 'string') &&
		(value.idempotencyKey === undefined || typeof value.idempotencyKey === 'string') &&
		(value.deadline === undefined || typeof value.deadline === 'string');
}

/** Convert unexpected local faults to bounded JSON-compatible diagnostic data. */
function fault(value: unknown): Readonly<Record<string, unknown>> {
	const diagnostic = faultCore.encode(value);
	if (value instanceof Error && faultCore.isRecord(diagnostic)) return diagnostic;
	return Object.freeze({
		name: 'Error',
		message: typeof diagnostic === 'string' ? diagnostic : 'Process channel faulted.',
		value: diagnostic,
	});
}

/** Validate an expected failure frame when the protocol does not supply a stricter schema. */
function encodedFailure(value: unknown): EncodedFailure {
	if (!failure.isEncoded(value)) throw new ChannelProtocolError('Process channel failure frame is invalid.', value);
	return Object.freeze({ id: value.id, data: value.data, message: value.message });
}

/** Reject empty or excessively large protocol identifiers before correlation state stores them. */
function assertId(value: string, label: string): void {
	if (value.trim().length === 0) throw new TypeError(`${label} ID must not be empty.`);
	if (value.length > 512) throw new TypeError(`${label} ID must not exceed 512 characters.`);
}

/** Narrow unknown JSON before channel frame property access. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Concatenate one already-bounded process protocol frame. */
function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
}

/** Observe promise settlement without propagating it into the caller's cleanup path. */
async function settles(value: Promise<unknown>): Promise<void> {
	try { await value; } catch { /* close already records the local reason */ }
}

export type {
	ProcessCallProtocol,
	ProcessChannelProtocol,
	ProcessProtocolOptions,
	ProcessRequestOptions,
	ProcessCallRun,
	ProcessNoticeSink,
	ProcessEventType,
	ProcessChannelOptions,
	ProcessChannel,
	ProcessRequestControl,
	ProcessRequestRun,
	ProcessServeOptions,
	ProcessServer,
	ProcessRequestFrame,
	ProcessControlFrame,
	ProcessResponseFrame,
	ProcessChannelSource,
} from './types.ts';
