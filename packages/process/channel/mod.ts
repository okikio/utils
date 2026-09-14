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

/** Parent-side owner for framed request correlation above one borrowed process. */
class Channel<Request, Response, Notice, CallRequest, CallResponse> {
	readonly #ctx: Context;
	readonly #child: ProcessChannelSource;
	readonly #options: ProcessChannelOptions<Request, Response, Notice, CallRequest, CallResponse>;
	readonly #maximumFrameBytes: number;
	readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
	readonly #pending = new Map<string, Pending<Response>>();
	readonly #cancelled = new Map<string, ReturnType<typeof setTimeout>>();
	readonly #events = new EventBus<ProcessEventType>();
	readonly #receiveController = new AbortController();
	readonly #createRequestId: () => string;
	#state: 'open' | 'closing' | 'closed' = 'open';
	#closePromise: Promise<void> | undefined;
	#writeQueue = Promise.resolve();
	readonly #loop: Promise<void>;
	readonly channel: ProcessChannel<Request, Response>;

	/** Parent cancellation closes only this framed protocol; the caller still owns the Process. */
	readonly #parentAbort = (): void => void this.#closeOnce(this.#ctx.signal.reason).catch(() => {});

	constructor(
		ctx: Context,
		child: ProcessChannelSource,
		options: ProcessChannelOptions<Request, Response, Notice, CallRequest, CallResponse>,
	) {
		contextCore.check(ctx);
		this.#ctx = ctx;
		this.#child = child;
		this.#options = options;
		this.#maximumFrameBytes = limit(options.maximumFrameBytes);
		this.#writer = child.stdin.getWriter();
		this.#createRequestId = options.requestId ?? (() => crypto.randomUUID());
		this.#loop = this.#listen();
		this.#events.emit(Object.freeze({ type: 'opened', pid: child.pid }));
		ctx.signal.addEventListener('abort', this.#parentAbort, { once: true });

		this.channel = Object.freeze({
			pid: child.pid,
			events: this.#events.events,
			request: (requestCtx, request, requestOptions = {}) => this.#request(requestCtx, request, requestOptions),
			pause: (id) => this.#pause(id),
			resume: (id) => this.#resume(id),
			close: (reason?: unknown) => this.#closeOnce(reason),
			[Symbol.asyncDispose]: async () => await this.#closeOnce('Process channel was disposed.'),
		} satisfies ProcessChannel<Request, Response>);
	}

	/** Validate, correlate, and send one parent request under the caller-owned request context. */
	async #request(requestCtx: Context, request: Request, requestOptions: ProcessRequestOptions): Promise<Response> {
		contextCore.check(requestCtx);
		if (this.#state !== 'open') throw new ChannelClosedError();
		const id = requestOptions.id ?? this.#createRequestId();
		assertId(id, 'Process channel request');
		if (this.#pending.has(id) || this.#cancelled.has(id)) {
			throw new TypeError(`Process channel request ${JSON.stringify(id)} is already active or recently cancelled.`);
		}
		const value = await schema.parse(this.#options.protocol.request, request);
		const response = new Promise<Response>((resolve, reject) => {
			const abort = () => this.#cancel(id, requestCtx, reject);
			const unlink = () => requestCtx.signal.removeEventListener('abort', abort);
			this.#pending.set(id, { ctx: requestCtx, resolve, reject, unlink });
			requestCtx.signal.addEventListener('abort', abort, { once: true });
			if (requestCtx.signal.aborted) abort();
		});
		if (!this.#pending.has(id)) return await response;

		const frame: ProcessRequestFrame<Request> = {
			type: 'request',
			id,
			context: contextCore.snapshot(requestCtx),
			request: value,
		};
		try {
			await this.#send(frame);
			this.#events.emit(Object.freeze({ type: 'request', id }));
		} catch (error) {
			this.#settle(id, (entry) => entry.reject(error));
		}
		return await response;
	}

	/** Forward request cancellation and retain its ID long enough to discard one raced child response. */
	#cancel(id: string, requestCtx: Context, reject: (reason: unknown) => void): void {
		const current = this.#pending.get(id);
		if (current === undefined) return;
		this.#pending.delete(id);
		current.unlink();
		this.#remember(id);
		void this.#send({ type: 'cancel', id, reason: requestCtx.signal.reason }).catch((error) => this.#invalidate(error));
		this.#events.emit(Object.freeze({ type: 'cancelled', id }));
		reject(new contextCore.ContextCancelledError(requestCtx.signal.reason));
	}

	/** Ask one active child request to block at its next cooperative checkpoint. */
	async #pause(id: string): Promise<void> {
		this.#assert(id, 'pause');
		await this.#send({ type: 'pause', id });
		this.#events.emit(Object.freeze({ type: 'paused', id }));
	}

	/** Release one active child request from its cooperative pause checkpoint. */
	async #resume(id: string): Promise<void> {
		this.#assert(id, 'resume');
		await this.#send({ type: 'resume', id });
		this.#events.emit(Object.freeze({ type: 'resumed', id }));
	}

	/** Memoize protocol shutdown so concurrent callers share one close handshake. */
	#closeOnce(reason?: unknown): Promise<void> {
		this.#closePromise ??= this.#close(reason);
		return this.#closePromise;
	}

	/** Consume child frames until protocol closure or stream integrity loss. */
	async #listen(): Promise<void> {
		try {
			for await (const message of frames(this.#child.stdout, this.#maximumFrameBytes, this.#receiveController.signal)) {
				await this.#receive(message);
				// Protocol closure is independent from process stdout lifetime. Stop
				// pulling as soon as the child acknowledges channel closure.
				if (this.#state === 'closed') return;
			}
			if (this.#state === 'open') this.#invalidate(new ChannelClosedError('Child stdout closed.'));
		} catch (error) {
			this.#invalidate(error);
		}
	}

	/** Route one child frame while keeping notices and reverse calls non-terminal. */
	async #receive(message: unknown): Promise<void> {
		if (!isRecord(message) || typeof message.type !== 'string') {
			throw new ChannelProtocolError('Child sent a non-envelope frame.', message);
		}
		if (message.type === 'closed') {
			if (this.#state === 'open') throw new ChannelProtocolError('Child closed the protocol without a parent close request.', message);
			this.#finish(undefined);
			return;
		}
		if (message.type === 'fault' && message.id === undefined) throw new ChannelFaultError(message.fault);
		if (typeof message.id !== 'string') throw new ChannelProtocolError('Child frame is missing a request ID.', message);
		const id = message.id;
		if (this.#cancelled.has(id)) {
			this.#forget(id);
			return;
		}
		const entry = this.#pending.get(id);
		if (entry === undefined) throw new ChannelProtocolError(`Child used unknown request ID ${JSON.stringify(id)}.`, message);

		if (message.type === 'notice') {
			if (this.#options.protocol.notice === undefined) {
				throw new ChannelProtocolError('Child emitted a notice for a protocol without notices.', message);
			}
			const notice = await schema.parse(this.#options.protocol.notice, message.notice);
			this.#events.emit(Object.freeze({ type: 'notice', id }));
			if (this.#options.notice !== undefined) void Promise.resolve(this.#options.notice(notice, entry.ctx, id)).catch(() => {});
			return;
		}
		if (message.type === 'call') {
			await this.#call(id, entry, message);
			return;
		}
		if (message.type === 'result') {
			const value = await schema.parse(this.#options.protocol.response, message.response);
			this.#settle(id, (current) => current.resolve(value));
			this.#events.emit(Object.freeze({ type: 'result', id }));
			return;
		}
		if (message.type === 'failure') {
			const encoded = this.#options.protocol.failure === undefined
				? encodedFailure(message.failure)
				: await schema.parse(this.#options.protocol.failure, message.failure);
			this.#settle(id, (current) => current.reject(new ChannelFailureError(encoded)));
			this.#events.emit(Object.freeze({ type: 'failure', id, failureId: encoded.id }));
			return;
		}
		if (message.type === 'fault') {
			this.#settle(id, (current) => current.reject(new ChannelFaultError(message.fault)));
			this.#events.emit(Object.freeze({ type: 'fault', id, reason: message.fault }));
			return;
		}
		throw new ChannelProtocolError(`Unsupported child frame type ${JSON.stringify(message.type)}.`, message);
	}

	/** Answer one child-to-parent call while its parent request still owns correlation. */
	async #call(id: string, entry: Pending<Response>, message: Record<string, unknown>): Promise<void> {
		const contract = this.#options.protocol.call;
		if (contract === undefined || this.#options.call === undefined) {
			throw new ChannelProtocolError('Child requested a reverse call that the parent does not provide.', message);
		}
		if (typeof message.callId !== 'string') throw new ChannelProtocolError('Child reverse call is missing a call ID.', message);
		const callId = message.callId;
		assertId(callId, 'Process channel reverse call');
		const request = await schema.parse(contract.request, message.request);
		this.#events.emit(Object.freeze({ type: 'call', id, callId }));
		try {
			const response = await this.#options.call(request, entry.ctx, id, callId);
			const value = await schema.parse(contract.response, response);
			if (this.#pending.get(id) !== entry || entry.ctx.signal.aborted) return;
			await this.#send({ type: 'call-result', id, callId, response: value });
		} catch (error) {
			if (this.#pending.get(id) !== entry || entry.ctx.signal.aborted) return;
			await this.#send({ type: 'call-fault', id, callId, fault: fault(error) });
		}
	}

	/** Serialize parent frames through one writer so newline-delimited JSON cannot interleave. */
	#send(frame: unknown): Promise<void> {
		const next = this.#writeQueue.then(async () => {
			if (this.#state === 'closed') throw new ChannelClosedError();
			await writeFrame(this.#writer, frame, this.#maximumFrameBytes);
		});
		this.#writeQueue = next.catch(() => {});
		return next;
	}

	/** Close channel-local stream and request ownership without stopping the child process. */
	async #close(reason: unknown): Promise<void> {
		if (this.#state === 'closed') return;
		if (this.#state === 'open') {
			this.#state = 'closing';
			this.#events.emit(Object.freeze({ type: 'closing', ...(reason === undefined ? {} : { reason }) }));
			try {
				await this.#send({ type: 'close', ...(reason === undefined ? {} : { reason }) });
			} catch (error) {
				// A write failure means the child cannot acknowledge this close request.
				this.#finish(error);
				return;
			}
		}
		await settles(this.#loop);
		this.#finish(reason);
	}

	/** End a channel whose framing or correlation can no longer be trusted. */
	#invalidate(reason: unknown): void {
		if (this.#state === 'closed') return;
		this.#events.emit(Object.freeze({ type: 'fault', reason }));
		this.#finish(reason);
	}

	/** Settle every local owner once, then release protocol stream locks and observers. */
	#finish(reason: unknown): void {
		if (this.#state === 'closed') return;
		this.#state = 'closed';
		if (!this.#receiveController.signal.aborted) this.#receiveController.abort(reason);
		this.#ctx.signal.removeEventListener('abort', this.#parentAbort);
		for (const [id, entry] of this.#pending) {
			this.#pending.delete(id);
			entry.unlink();
			entry.reject(new ChannelClosedError(reason));
		}
		for (const id of this.#cancelled.keys()) this.#forget(id);
		try { this.#writer.releaseLock(); } catch { /* peer failure can release the writer first */ }
		this.#events.emit(Object.freeze({ type: 'closed' }));
		this.#events[Symbol.dispose]();
	}

	/** Remove one pending request exactly once before its terminal resolver runs. */
	#settle(id: string, settleEntry: (entry: Pending<Response>) => void): void {
		const entry = this.#pending.get(id);
		if (entry === undefined) return;
		this.#pending.delete(id);
		entry.unlink();
		settleEntry(entry);
	}

	/** Require pause and resume controls to target a currently owned request. */
	#assert(id: string, operation: 'pause' | 'resume'): void {
		assertId(id, 'Process channel request');
		if (this.#state !== 'open') throw new ChannelClosedError();
		if (!this.#pending.has(id)) throw new TypeError(`Cannot ${operation} unknown process channel request ${JSON.stringify(id)}.`);
	}

	/** Retain a cancelled request ID briefly so one raced child response can be ignored. */
	#remember(id: string): void {
		this.#forget(id);
		this.#cancelled.set(id, setTimeout(() => this.#forget(id), 60_000));
	}

	/** Release late-response protection for one cancelled request. */
	#forget(id: string): void {
		const timer = this.#cancelled.get(id);
		if (timer !== undefined) clearTimeout(timer);
		this.#cancelled.delete(id);
	}
}

/** Child-side owner for restored request contexts and framed reverse-call correlation. */
class Server<Request, Response, Notice, CallRequest, CallResponse> {
	readonly #options: ProcessServeOptions<Request, Response, Notice, CallRequest, CallResponse>;
	readonly #maximumFrameBytes: number;
	readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
	readonly #active = new Map<string, Active<CallResponse>>();
	readonly #ended = new Map<string, ReturnType<typeof setTimeout>>();
	readonly #receiveController = new AbortController();
	readonly #createCallId: () => string;
	#state: 'open' | 'closing' | 'closed' = 'open';
	#closePromise: Promise<void> | undefined;
	#writeQueue = Promise.resolve();
	#resolveClosed: (() => void) | undefined;
	readonly #closed: Promise<void>;
	readonly #loop: Promise<void>;
	readonly server: ProcessServer;

	constructor(options: ProcessServeOptions<Request, Response, Notice, CallRequest, CallResponse>) {
		this.#options = options;
		this.#maximumFrameBytes = limit(options.maximumFrameBytes);
		this.#writer = options.output.getWriter();
		this.#createCallId = options.callId ?? (() => crypto.randomUUID());
		this.#closed = new Promise<void>((resolve) => this.#resolveClosed = resolve);
		this.#loop = this.#listen();
		this.server = Object.freeze({
			closed: this.#closed,
			close: (reason?: unknown) => this.#closeServer(reason),
			[Symbol.asyncDispose]: async () => await this.#closeServer('Process channel server was disposed.'),
		});
	}

	/** Memoize locally initiated server shutdown while preserving remote acknowledgement semantics. */
	#closeServer(reason?: unknown): Promise<void> {
		this.#closePromise ??= this.#close(reason, false);
		return this.#closePromise;
	}

	/** Consume parent frames until close or one integrity failure ends the server. */
	async #listen(): Promise<void> {
		try {
			for await (const message of frames(this.#options.input, this.#maximumFrameBytes, this.#receiveController.signal)) {
				await this.#receive(message);
				// Protocol closure is independent from stdin lifetime. Stop after the
				// close handshake instead of waiting for process shutdown.
				if (this.#state === 'closed') return;
			}
			if (this.#state === 'open') await this.#close(new ChannelClosedError('Parent input closed.'), false);
		} catch (error) {
			try { await this.#send({ type: 'fault', fault: fault(error) }); } catch { /* parent may already be gone */ }
			await this.#close(error, false);
		}
	}

	/** Route one parent frame to request, cancellation, pause, reverse-call, or close state. */
	async #receive(message: unknown): Promise<void> {
		if (!isRecord(message) || typeof message.type !== 'string') {
			throw new ChannelProtocolError('Parent sent a non-envelope frame.', message);
		}
		if (message.type === 'request') {
			if (this.#state !== 'open') {
				await this.#send({
					type: 'fault',
					...(typeof message.id === 'string' ? { id: message.id } : {}),
					fault: fault(new ChannelClosedError()),
				});
				return;
			}
			await this.#startRequest(message);
			return;
		}
		if (message.type === 'close') {
			await this.#close(message.reason, true);
			return;
		}
		if (typeof message.id !== 'string') throw new ChannelProtocolError(`${message.type} frame is missing a request ID.`, message);
		const id = message.id;
		const request = this.#active.get(id);
		if (request === undefined && this.#ended.has(id) && (message.type === 'call-result' || message.type === 'call-fault')) return;
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
			await this.#settleCall(id, request, message);
			return;
		}
		throw new ChannelProtocolError(`Unsupported parent frame type ${JSON.stringify(message.type)}.`, message);
	}

	/** Validate one request before restoring its child-local cancellation lifetime. */
	async #startRequest(message: Record<string, unknown>): Promise<void> {
		if (typeof message.id !== 'string') throw new ChannelProtocolError('Request frame is missing an ID.', message);
		const id = message.id;
		assertId(id, 'Process channel request');
		if (this.#active.has(id)) throw new ChannelProtocolError(`Request ${JSON.stringify(id)} is already active.`, message);
		this.#forgetEnded(id);
		if (!snapshot(message.context)) throw new ChannelProtocolError('Request context snapshot is invalid.', message.context);
		const request = await schema.parse(this.#options.protocol.request, message.request);
		const ctx = contextCore.restore(message.context);
		const pause: PauseState = { paused: false, waiters: new Set() };
		const calls = new Map<string, PendingCall<CallResponse>>();
		const settled = this.#runRequest(id, request, ctx, pause, calls);
		this.#active.set(id, { ctx, pause, calls, settled });
		// Request work stays owned by `active` but is not awaited here. The frame
		// reader must remain available for cancel, pause, and reverse-call results.
	}

	/** Execute one child request while optional notices and reverse calls remain non-terminal. */
	async #runRequest(
		id: string,
		request: Request,
		ctx: contextCore.Owned,
		pause: PauseState,
		calls: Map<string, PendingCall<CallResponse>>,
	): Promise<void> {
		const control = Object.freeze({
			checkpoint: async () => {
				contextCore.check(ctx);
				if (pause.paused) await wait(ctx, pause);
				contextCore.check(ctx);
			},
			notify: async (notice: Notice) => {
				if (this.#options.protocol.notice === undefined) throw new ChannelProtocolError('This process protocol does not declare notices.');
				const value = await schema.parse(this.#options.protocol.notice, notice);
				await this.#send({ type: 'notice', id, notice: value });
			},
			call: async (callRequest: CallRequest) => {
				const contract = this.#options.protocol.call;
				if (contract === undefined) throw new ChannelProtocolError('This process protocol does not declare reverse calls.');
				const value = await schema.parse(contract.request, callRequest);
				const callId = this.#createCallId();
				assertId(callId, 'Process channel reverse call');
				if (calls.has(callId)) throw new ChannelProtocolError(`Reverse call ${JSON.stringify(callId)} is already active.`);
				const result = new Promise<CallResponse>((resolve, reject) => calls.set(callId, { resolve, reject }));
				try {
					await this.#send({ type: 'call', id, callId, request: value });
					return await result;
				} finally {
					calls.delete(callId);
				}
			},
		} satisfies ProcessRequestControl<Notice, CallRequest, CallResponse>);

		try {
			const response = await this.#options.run(request, ctx, control);
			if (ctx.signal.aborted) return;
			const value = await schema.parse(this.#options.protocol.response, response);
			if (ctx.signal.aborted) return;
			await this.#send({ type: 'result', id, response: value });
		} catch (error) {
			if (ctx.signal.aborted) return;
			if (failure.isOccurrence(error)) {
				try {
					const encoded = await failure.encode(error);
					const value = this.#options.protocol.failure === undefined
						? encoded
						: await schema.parse(this.#options.protocol.failure, encoded);
					await this.#send({ type: 'failure', id, failure: value });
				} catch (encodingError) {
					await this.#send({ type: 'fault', id, fault: fault(encodingError) });
				}
				return;
			}
			await this.#send({ type: 'fault', id, fault: fault(error) });
		} finally {
			resume(pause);
			for (const entry of calls.values()) entry.reject(new ChannelClosedError('Request ended before reverse call completion.'));
			calls.clear();
			this.#active.delete(id);
			this.#rememberEnded(id);
			await ctx[Symbol.asyncDispose]();
		}
	}

	/** Settle one reverse call only while both request and call identities remain current. */
	async #settleCall(id: string, request: Active<CallResponse>, message: Record<string, unknown>): Promise<void> {
		if (typeof message.callId !== 'string') throw new ChannelProtocolError('Reverse-call result is missing a call ID.', message);
		const callId = message.callId;
		const entry = request.calls.get(callId);
		if (entry === undefined) {
			throw new ChannelProtocolError(`Unknown reverse call ${JSON.stringify(callId)} for request ${JSON.stringify(id)}.`, message);
		}
		request.calls.delete(callId);
		if (message.type === 'call-fault') {
			entry.reject(new ChannelFaultError(message.fault));
			return;
		}
		const contract = this.#options.protocol.call;
		if (contract === undefined) throw new ChannelProtocolError('Parent returned a reverse-call result for a protocol without calls.', message);
		entry.resolve(await schema.parse(contract.response, message.response));
	}

	/** Serialize child frames through one writer to preserve newline framing. */
	#send(frame: unknown): Promise<void> {
		const next = this.#writeQueue.then(() => writeFrame(this.#writer, frame, this.#maximumFrameBytes));
		this.#writeQueue = next.catch(() => {});
		return next;
	}

	/** Cancel active request ownership, optionally acknowledge peer close, and release stream locks. */
	async #close(reason: unknown, acknowledge: boolean): Promise<void> {
		if (this.#state === 'closed') return;
		this.#state = 'closing';
		for (const request of this.#active.values()) {
			contextCore.cancel(request.ctx, reason);
			resume(request.pause);
		}
		await Promise.allSettled([...this.#active.values()].map((request) => request.settled));
		if (acknowledge) {
			try { await this.#send({ type: 'closed' }); } catch { /* parent already disconnected */ }
		}
		this.#state = 'closed';
		if (!this.#receiveController.signal.aborted) this.#receiveController.abort(reason);
		for (const id of this.#ended.keys()) this.#forgetEnded(id);
		try { this.#writer.releaseLock(); } catch { /* writer may already be released */ }
		this.#resolveClosed?.();
		this.#resolveClosed = undefined;
		void this.#loop;
	}

	/** Bound late reverse-call response races after one request has already settled. */
	#rememberEnded(id: string): void {
		this.#forgetEnded(id);
		this.#ended.set(id, setTimeout(() => this.#forgetEnded(id), 60_000));
	}

	/** Remove one ended request ID and its retention timer. */
	#forgetEnded(id: string): void {
		const timer = this.#ended.get(id);
		if (timer !== undefined) clearTimeout(timer);
		this.#ended.delete(id);
	}
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
	return new Channel(ctx, child, options).channel;
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
	return new Server(options).server;
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

export type * from './types.ts';
