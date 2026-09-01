/**
 * Validated correlated request/response protocols for standard Worker threads.
 *
 * The module owns request correlation, schema validation, cancellation,
 * cooperative pause checkpoints, optional notices, reverse request/result
 * calls, expected failure encoding, transfer lists, protocol invalidation, and
 * shutdown. It does not treat notices or reverse calls as terminal request
 * results.
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
	WorkerEventType,
	WorkerOpenOptions,
	WorkerProtocol,
	WorkerProtocolOptions,
	RawWorker,
	RawWorkerScope,
	WorkerReply,
	WorkerRequestControl,
	WorkerRequestEnvelope,
	WorkerRequestOptions,
	WorkerMessageOptions,
	WorkerServeOptions,
	WorkerHandle,
	WorkerServer,
} from './types.ts';

/** Worker returned an expected encoded failure. */
export class WorkerFailureError extends Error {
	readonly failure: EncodedFailure;

	constructor(failure: EncodedFailure) {
		super(failure.message);
		this.name = 'WorkerFailureError';
		this.failure = failure;
	}
}

/** Worker returned or raised an unexpected fault. */
export class WorkerFaultError extends Error {
	readonly fault: unknown;

	constructor(fault: unknown) {
		super(fault instanceof Error ? fault.message : 'Worker faulted.', { cause: fault });
		this.name = 'WorkerFaultError';
		this.fault = fault;
	}
}

/** Worker wire protocol was violated. */
export class WorkerProtocolError extends Error {
	readonly messageValue: unknown;

	constructor(message: string, messageValue?: unknown) {
		super(message);
		this.name = 'WorkerProtocolError';
		this.messageValue = messageValue;
	}
}

/** Worker stopped before a pending request completed. */
export class WorkerStoppedError extends Error {
	readonly reason: unknown;

	constructor(reason?: unknown) {
		super('Worker stopped before the request completed.', reason === undefined ? undefined : { cause: reason });
		this.name = 'WorkerStoppedError';
		this.reason = reason;
	}
}

/** Parent-side state for one correlated request that has not reached a terminal response. */
interface Pending<Response> {
	/** Request context whose cancellation is forwarded to the matching Worker request. */
	readonly ctx: Context;
	readonly resolve: (value: Response) => void;
	readonly reject: (reason: unknown) => void;
	readonly unlink: () => void;
}

/** Worker-side reverse call waiting for one correlated parent response. */
interface PendingCall<Response> {
	/** Resolve one Worker-to-host reverse call with the validated host response. */
	readonly resolve: (value: Response) => void;
	/** Reject the reverse call when the host reports a fault or the Worker stops. */
	readonly reject: (reason: unknown) => void;
}

/** Cooperative pause state owned by one active Worker request. */
interface PauseState {
	/** Whether Worker checkpoints must wait for a resume message. */
	paused: boolean;
	/** Checkpoint continuations released together on resume or cancellation. */
	readonly waiters: Set<() => void>;
}

/** Worker-side state that remains live until one request runner and its owned reverse calls settle. */
interface ActiveRequest<CallResponse> {
	/** Owned Worker request context restored from the caller snapshot. */
	readonly ctx: contextCore.Owned;
	/** Cooperative pause state shared by every checkpoint in this request. */
	readonly pause: PauseState;
	/** Reverse calls awaiting matching host call-result messages. */
	readonly calls: Map<string, PendingCall<CallResponse>>;
	/** Request-handler settlement used to make Worker shutdown wait for owned work. */
	readonly settled: Promise<void>;
}

/** Define one immutable validated Worker protocol. */
export function protocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	input: WorkerProtocolOptions<Request, Response, Notice, CallRequest, CallResponse>,
): WorkerProtocol<Request, Response, Notice, CallRequest, CallResponse> {
	schema.assert(input.request, 'Worker request schema');
	schema.assert(input.response, 'Worker response schema');
	if (input.failure !== undefined) schema.assert(input.failure, 'Worker failure schema');
	if (input.notice !== undefined) schema.assert(input.notice, 'Worker notice schema');
	if (input.call !== undefined) {
		schema.assert(input.call.request, 'Worker reverse-call request schema');
		schema.assert(input.call.response, 'Worker reverse-call response schema');
	}
	return Object.freeze({ ...input });
}

/** Wrap a Worker response with an explicit transfer list. */
export function reply<Response>(response: Response, transfer: readonly Transferable[] = []): WorkerReply<Response> {
	return Object.freeze({ kind: 'worker-reply', response, transfer: Object.freeze([...transfer]) });
}

/**
 * Serve one validated Worker protocol inside a Worker thread.
 *
 * Every request restores a new local context. Cancellation crosses the Worker
 * seam as a control frame instead of a serialized `AbortSignal`. Pause is
 * cooperative: `control.checkpoint()` waits while paused, but an indivisible
 * provider call is allowed to finish before the next checkpoint.
 *
 * Notices never settle a request. Reverse calls are correlated request/result
 * work back to the parent and can be used for host-owned services such as
 * permission decisions or required effect acceptance.
 *
 * @example
 * ```ts
 * await using server = worker.serve({
 *   protocol: ActivityProtocol,
 *   async run(request, ctx, control) {
 *     await control.checkpoint();
 *     await control.notify({ phase: 'started' });
 *     return runActivity(request, ctx);
 *   },
 * });
 * ```
 */
export function serve<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	options: WorkerServeOptions<Request, Response, Notice, CallRequest, CallResponse>,
): WorkerServer {
	const scope = options.scope ?? getWorkerScope();
	const active = new Map<string, ActiveRequest<CallResponse>>();
	const ended = new Map<string, ReturnType<typeof setTimeout>>();
	const createCallId = options.callId ?? (() => crypto.randomUUID());
	let state: 'active' | 'stopping' | 'stopped' = 'active';
	let stopPromise: Promise<void> | undefined;
	let resolveClosed: (() => void) | undefined;
	const closed = new Promise<void>((resolve) => resolveClosed = resolve);

	const onMessage = (event: MessageEvent<unknown>): void => {
		void receive(event.data).catch((error) => {
			const fault = error instanceof Error
				? error
				: new WorkerProtocolError('Worker request processing failed.', error);
			void protocolFault(fault).catch(() => {});
		});
	};
	const onMessageError = (event: MessageEvent<unknown>): void => {
		void protocolFault(new WorkerProtocolError('Parent message could not be deserialized.', event.data)).catch(() => {});
	};
	scope.addEventListener('message', onMessage);
	scope.addEventListener('messageerror', onMessageError);

	const stopServer = (reason?: unknown): Promise<void> => {
		stopPromise ??= stop(reason, false);
		return stopPromise;
	};

	const server: WorkerServer = Object.freeze({
		closed,
		stop(reason?: unknown) {
			return stopServer(reason);
		},
		async [Symbol.asyncDispose]() {
			await stopServer('Worker server was disposed.');
		},
	});
	return server;

	/** Route one parent frame without allowing one message class to impersonate another. */
	async function receive(message: unknown): Promise<void> {
		if (state === 'stopped') return;
		if (!isRecord(message) || typeof message.type !== 'string') {
			await protocolFault(new WorkerProtocolError('Parent sent a non-envelope message.', message));
			return;
		}

		if (message.type === 'request') {
			if (state !== 'active') {
				post(Object.freeze({
					type: 'fault',
					...(typeof message.id === 'string' ? { id: message.id } : {}),
					fault: serializeFault(new WorkerStoppedError('Worker server is stopping.')),
				}));
				return;
			}
			await startRequest(message);
			return;
		}

		if (message.type === 'shutdown') {
			stopPromise ??= stop(message.reason, true);
			await stopPromise;
			return;
		}

		if (typeof message.id !== 'string') {
			await protocolFault(new WorkerProtocolError(`${message.type} envelope is missing a request ID.`, message));
			return;
		}
		const requestId = message.id;
		const request = active.get(requestId);

		// A parent response can race cancellation after the Worker has already
		// released local request state. Ignore that late response rather than
		// invalidating an otherwise healthy Worker correlation channel.
		if (request === undefined && ended.has(requestId) && (message.type === 'call-result' || message.type === 'call-fault')) {
			return;
		}
		if (request === undefined) {
			await protocolFault(new WorkerProtocolError(`Unknown active request ID ${JSON.stringify(requestId)}.`, message));
			return;
		}

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
			await settleCall(requestId, request, message);
			return;
		}

		await protocolFault(new WorkerProtocolError(`Unsupported parent message type ${JSON.stringify(message.type)}.`, message));
	}

	/** Validate one request envelope before creating its local cancellation and cleanup lifetime. */
	async function startRequest(message: Record<string, unknown>): Promise<void> {
		if (typeof message.id !== 'string') {
			await protocolFault(new WorkerProtocolError('Request envelope is missing a request ID.', message));
			return;
		}
		const requestId = message.id;
		try {
			assertId(requestId, 'Worker request');
		} catch (error) {
			await protocolFault(error instanceof Error ? error : new WorkerProtocolError('Worker request ID is invalid.', message));
			return;
		}
		if (active.has(requestId)) {
			await protocolFault(new WorkerProtocolError(`Request ID ${JSON.stringify(requestId)} is already active.`, message));
			return;
		}
		forgetEnded(requestId);
		if (!isSnapshot(message.context)) {
			await protocolFault(new WorkerProtocolError('Request context snapshot is invalid.', message.context));
			return;
		}

		let request: Request;
		try {
			request = await schema.parse(options.protocol.request, message.request);
		} catch (error) {
			post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(error) }));
			return;
		}

		let requestCtx: contextCore.Owned;
		try {
			requestCtx = contextCore.restore(message.context);
			contextCore.check(requestCtx);
		} catch (error) {
			post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(error) }));
			return;
		}

		const pause: PauseState = { paused: false, waiters: new Set() };
		const calls = new Map<string, PendingCall<CallResponse>>();
		const settled = runRequest(requestId, request, requestCtx, pause, calls);
		active.set(requestId, { ctx: requestCtx, pause, calls, settled });
		await settled;
	}

	/** Execute one request while preserving terminal-result, notice, and reverse-call authority separately. */
	async function runRequest(
		requestId: string,
		request: Request,
		requestCtx: contextCore.Owned,
		pause: PauseState,
		calls: Map<string, PendingCall<CallResponse>>,
	): Promise<void> {
		const control: WorkerRequestControl<Notice, CallRequest, CallResponse> = Object.freeze({
			async checkpoint() {
				contextCore.check(requestCtx);
				if (pause.paused) await waitForResume(requestCtx, pause);
				contextCore.check(requestCtx);
			},
			async notify(notice: Notice, messageOptions: WorkerMessageOptions = {}) {
				if (options.protocol.notice === undefined) {
					throw new WorkerProtocolError('This Worker protocol does not declare notices.');
				}
				contextCore.check(requestCtx);
				const validated = await schema.parse(options.protocol.notice, notice);
				contextCore.check(requestCtx);
				post(Object.freeze({ type: 'notice', id: requestId, notice: validated }), messageOptions.transfer);
			},
			async call(callRequest: CallRequest, messageOptions: WorkerMessageOptions = {}) {
				const contract = options.protocol.call;
				if (contract === undefined) {
					throw new WorkerProtocolError('This Worker protocol does not declare reverse calls.');
				}
				contextCore.check(requestCtx);
				const validated = await schema.parse(contract.request, callRequest);
				const callId = createCallId();
				assertId(callId, 'Worker reverse call');
				if (calls.has(callId)) throw new WorkerProtocolError(`Reverse call ID ${JSON.stringify(callId)} is already active.`);

				const result = new Promise<CallResponse>((resolve, reject) => calls.set(callId, { resolve, reject }));
				try {
					post(Object.freeze({ type: 'call', id: requestId, callId, request: validated }), messageOptions.transfer);
					return await result;
				} finally {
					calls.delete(callId);
				}
			},
		});

		try {
			const handled = await options.run(request, requestCtx, control);
			if (requestCtx.signal.aborted) return;
			contextCore.check(requestCtx);
			const response = isReply(handled) ? handled.response : handled;
			const validated = await schema.parse(options.protocol.response, response);
			if (requestCtx.signal.aborted) return;
			post(Object.freeze({ type: 'result', id: requestId, response: validated }), isReply(handled) ? handled.transfer : undefined);
		} catch (error) {
			if (requestCtx.signal.aborted) return;
			if (failure.isOccurrence(error)) {
				try {
					const encoded = await failure.encode(error);
					const validated = options.protocol.failure === undefined
						? encoded
						: await schema.parse(options.protocol.failure, encoded);
					post(Object.freeze({ type: 'failure', id: requestId, failure: validated }));
				} catch (encodingError) {
					post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(encodingError) }));
				}
				return;
			}
			post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(error) }));
		} finally {
			resume(pause);
			for (const entry of calls.values()) entry.reject(new WorkerStoppedError('Worker request ended before the reverse call completed.'));
			calls.clear();
			active.delete(requestId);
			rememberEnded(requestId);
			await requestCtx[Symbol.asyncDispose]();
		}
	}

	/** Settle one Worker-to-parent call only when both request and call identities still match. */
	async function settleCall(
		requestId: string,
		request: ActiveRequest<CallResponse>,
		message: Record<string, unknown>,
	): Promise<void> {
		if (typeof message.callId !== 'string') {
			await protocolFault(new WorkerProtocolError('Reverse-call response is missing a call ID.', message));
			return;
		}
		const callId = message.callId;
		const entry = request.calls.get(callId);
		if (entry === undefined) {
			await protocolFault(new WorkerProtocolError(`Unknown reverse call ID ${JSON.stringify(callId)} for request ${JSON.stringify(requestId)}.`, message));
			return;
		}

		if (message.type === 'call-fault') {
			request.calls.delete(callId);
			entry.reject(new WorkerFaultError(message.fault));
			return;
		}
		const contract = options.protocol.call;
		if (contract === undefined) {
			await protocolFault(new WorkerProtocolError('Parent returned a reverse-call result for a protocol without reverse calls.', message));
			return;
		}
		try {
			const value = await schema.parse(contract.response, message.response);
			request.calls.delete(callId);
			entry.resolve(value);
		} catch (error) {
			await protocolFault(error instanceof Error ? error : new WorkerProtocolError('Reverse-call response validation failed.', message));
		}
	}

	/** Invalidate the Worker-side protocol when correlation can no longer be trusted. */
	async function protocolFault(error: Error): Promise<void> {
		if (state === 'stopped') return;
		try {
			post(Object.freeze({ type: 'fault', fault: serializeFault(error) }));
		} catch {
			// The parent is already unreachable. Local shutdown still owns cleanup.
		}
		stopPromise ??= stop(error, false);
		await stopPromise;
	}

	/** Stop admission, cancel active requests, join them, and then detach the Worker scope. */
	async function stop(reason: unknown, acknowledge: boolean): Promise<void> {
		if (state === 'stopped') return;
		state = 'stopping';
		for (const request of active.values()) {
			contextCore.cancel(request.ctx, reason);
			resume(request.pause);
		}
		await Promise.allSettled([...active.values()].map((request) => request.settled));
		state = 'stopped';
		scope.removeEventListener('message', onMessage);
		scope.removeEventListener('messageerror', onMessageError);
		for (const requestId of ended.keys()) forgetEnded(requestId);
		if (acknowledge) {
			try {
				post(Object.freeze({ type: 'stopped' }));
			} catch {
				// Parent-side timeout owns forced termination when acknowledgement fails.
			}
		}
		resolveClosed?.();
		resolveClosed = undefined;
	}

	/** Post one protocol frame while preserving any explicit transfer ownership. */
	function post(message: unknown, transfer?: readonly Transferable[]): void {
		if (transfer === undefined || transfer.length === 0) scope.postMessage(message);
		else scope.postMessage(message, transfer);
	}

	/** Keep recently ended request identities long enough to ignore raced reverse-call responses. */
	function rememberEnded(requestId: string): void {
		forgetEnded(requestId);
		ended.set(requestId, setTimeout(() => forgetEnded(requestId), 60_000));
	}

	/** Remove one recently ended request identity and its cleanup timer. */
	function forgetEnded(requestId: string): void {
		const timer = ended.get(requestId);
		if (timer !== undefined) clearTimeout(timer);
		ended.delete(requestId);
	}
}

/**
 * Open one owned Worker with correlated, validated, abort-aware requests.
 *
 * The handle can observe non-terminal notices and answer Worker-to-parent calls
 * without settling the owning request. `pause()` and `resume()` only control the
 * Worker's next cooperative checkpoint. `stop()` first requests cooperative
 * shutdown and then terminates the Worker when the acknowledgement exceeds the
 * configured grace period.
 */
export function open<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	ctx: Context,
	options: WorkerOpenOptions<Request, Response, Notice, CallRequest, CallResponse>,
): WorkerHandle<Request, Response> {
	contextCore.check(ctx);
	const id = options.id ?? crypto.randomUUID();
	assertId(id, 'Worker');
	const createRaw = options.create ?? ((module, workerOptions) => new Worker(module, workerOptions) as RawWorker);
	const raw = createRaw(options.module, { type: 'module', ...(options.name === undefined ? {} : { name: options.name }) });
	const events = new EventBus<WorkerEventType>();
	const pending = new Map<string, Pending<Response>>();
	const cancelledIds = new Map<string, ReturnType<typeof setTimeout>>();
	const createRequestId = options.requestId ?? (() => crypto.randomUUID());
	const shutdownMs = options.shutdownMs ?? 1_000;
	if (!Number.isSafeInteger(shutdownMs) || shutdownMs < 0) {
		throw new TypeError('shutdownMs must be a non-negative safe integer.');
	}
	let state: 'active' | 'stopping' | 'stopped' = 'active';
	let stopPromise: Promise<void> | undefined;
	let resolveStopped: (() => void) | undefined;
	const stopped = new Promise<void>((resolve) => resolveStopped = resolve);

	const onMessage = (event: MessageEvent<unknown>): void => void receive(event.data);
	const onError = (event: ErrorEvent): void => invalidate(new WorkerFaultError(event.error ?? event.message));
	const onMessageError = (event: MessageEvent<unknown>): void =>
		invalidate(new WorkerProtocolError('Worker message could not be deserialized.', event.data));
	raw.addEventListener('message', onMessage);
	raw.addEventListener('error', onError);
	raw.addEventListener('messageerror', onMessageError);
	events.emit(Object.freeze({ type: 'opened', id }));

	const stop = (reason?: unknown): Promise<void> => {
		if (stopPromise !== undefined) return stopPromise;
		stopPromise = (async () => {
			if (state === 'stopped') return;
			state = 'stopping';
			events.emit(Object.freeze({ type: 'stopping', ...(reason === undefined ? {} : { reason }) }));
			try {
				raw.postMessage(Object.freeze({ type: 'shutdown', ...(reason === undefined ? {} : { reason }) }));
			} catch {
				// Forced termination below still owns cleanup when the channel is already broken.
			}
			const cooperative = await settlesWithin(stopped, shutdownMs);
			if (!cooperative) raw.terminate();
			finishStop(reason, !cooperative);
		})();
		return stopPromise;
	};
	const parentAbort = () => void stop(ctx.signal.reason).catch(() => {});

	const handle: WorkerHandle<Request, Response> = Object.freeze({
		id,
		events: events.events,
		async request(requestCtx: Context, request: Request, requestOptions: WorkerRequestOptions = {}) {
			contextCore.check(requestCtx);
			if (state !== 'active') throw new WorkerStoppedError();
			const requestId = requestOptions.id ?? createRequestId();
			assertId(requestId, 'Worker request');
			if (pending.has(requestId) || cancelledIds.has(requestId)) {
				throw new TypeError(`Worker request ID ${JSON.stringify(requestId)} is already active or recently cancelled.`);
			}
			const validated = await schema.parse(options.protocol.request, request);
			contextCore.check(requestCtx);
			const envelope: WorkerRequestEnvelope<Request> = Object.freeze({
				type: 'request',
				id: requestId,
				context: contextCore.snapshot(requestCtx),
				request: validated,
			});
			const response = new Promise<Response>((resolve, reject) => {
				const abort = () => {
					const current = pending.get(requestId);
					if (current === undefined) return;
					pending.delete(requestId);
					current.unlink();
					rememberCancelled(requestId);
					try {
						raw.postMessage(Object.freeze({ type: 'cancel', id: requestId, reason: requestCtx.signal.reason }));
					} catch (error) {
						invalidate(new WorkerFaultError(error));
					}
					events.emit(Object.freeze({ type: 'cancelled', id: requestId }));
					reject(new contextCore.ContextCancelledError(requestCtx.signal.reason));
				};
				const unlink = () => requestCtx.signal.removeEventListener('abort', abort);
				pending.set(requestId, { ctx: requestCtx, resolve, reject, unlink });
				requestCtx.signal.addEventListener('abort', abort, { once: true });
				if (requestCtx.signal.aborted) abort();
			});
			if (!pending.has(requestId)) return await response;
			try {
				raw.postMessage(envelope, requestOptions.transfer);
				events.emit(Object.freeze({ type: 'request', id: requestId }));
			} catch (error) {
				settle(requestId, (entry) => entry.reject(error));
			}
			return await response;
		},
		pause(requestId: string) {
			assertActive(requestId, 'pause');
			raw.postMessage(Object.freeze({ type: 'pause', id: requestId }));
			events.emit(Object.freeze({ type: 'paused', id: requestId }));
		},
		resume(requestId: string) {
			assertActive(requestId, 'resume');
			raw.postMessage(Object.freeze({ type: 'resume', id: requestId }));
			events.emit(Object.freeze({ type: 'resumed', id: requestId }));
		},
		stop(reason?: unknown) {
			return stop(reason);
		},
		async [Symbol.asyncDispose]() {
			await stop('Worker handle was disposed.');
		},
	});
	ctx.signal.addEventListener('abort', parentAbort, { once: true });
	return handle;

	/** Route Worker output while keeping optional messages separate from terminal settlement. */
	async function receive(message: unknown): Promise<void> {
		if (!isRecord(message) || typeof message.type !== 'string') {
			invalidate(new WorkerProtocolError('Worker sent a non-envelope message.', message));
			return;
		}
		if (message.type === 'stopped') {
			if (state === 'active') {
				invalidate(new WorkerStoppedError('Worker stopped without a shutdown request.'));
				return;
			}
			resolveStopped?.();
			resolveStopped = undefined;
			return;
		}
		if (message.type === 'fault' && message.id === undefined) {
			invalidate(new WorkerFaultError(message.fault));
			return;
		}
		if (typeof message.id !== 'string') {
			invalidate(new WorkerProtocolError('Worker response is missing a request ID.', message));
			return;
		}
		const requestId = message.id;
		if (cancelledIds.has(requestId)) {
			forgetCancelled(requestId);
			return;
		}
		const entry = pending.get(requestId);
		if (entry === undefined) {
			invalidate(new WorkerProtocolError(`Worker responded with unknown request ID ${JSON.stringify(requestId)}.`, message));
			return;
		}

		try {
			if (message.type === 'notice') {
				if (options.protocol.notice === undefined) {
					invalidate(new WorkerProtocolError('Worker emitted a notice for a protocol without notices.', message));
					return;
				}
				const notice = await schema.parse(options.protocol.notice, message.notice);
				events.emit(Object.freeze({ type: 'notice', id: requestId }));
				if (options.notice !== undefined) {
					// Observation callbacks cannot decide request correctness. A failing
					// observer is therefore isolated from terminal request settlement.
					void Promise.resolve(options.notice(notice, entry.ctx, requestId)).catch(() => {});
				}
				return;
			}
			if (message.type === 'call') {
				await answerCall(requestId, entry, message);
				return;
			}
			if (message.type === 'result') {
				const value = await schema.parse(options.protocol.response, message.response);
				settle(requestId, (current) => current.resolve(value));
				events.emit(Object.freeze({ type: 'result', id: requestId }));
				return;
			}
			if (message.type === 'failure') {
				const encoded = options.protocol.failure === undefined
					? assertEncodedFailure(message.failure)
					: await schema.parse(options.protocol.failure, message.failure);
				settle(requestId, (current) => current.reject(new WorkerFailureError(encoded)));
				events.emit(Object.freeze({ type: 'failure', id: requestId, failureId: encoded.id }));
				return;
			}
			if (message.type === 'fault') {
				settle(requestId, (current) => current.reject(new WorkerFaultError(message.fault)));
				events.emit(Object.freeze({ type: 'fault', id: requestId, reason: message.fault }));
				return;
			}
			invalidate(new WorkerProtocolError(`Unsupported Worker response type ${JSON.stringify(message.type)}.`, message));
		} catch (error) {
			invalidate(error instanceof Error ? error : new WorkerProtocolError('Worker response validation failed.', message));
		}
	}

	/** Answer one Worker-to-parent call without treating the answer as the terminal activity response. */
	async function answerCall(requestId: string, entry: Pending<Response>, message: Record<string, unknown>): Promise<void> {
		const contract = options.protocol.call;
		if (contract === undefined || options.call === undefined) {
			invalidate(new WorkerProtocolError('Worker requested a reverse call that this parent does not provide.', message));
			return;
		}
		if (typeof message.callId !== 'string') {
			invalidate(new WorkerProtocolError('Worker reverse call is missing a call ID.', message));
			return;
		}
		const callId = message.callId;
		assertId(callId, 'Worker reverse call');
		const request = await schema.parse(contract.request, message.request);
		events.emit(Object.freeze({ type: 'call', id: requestId, callId }));
		try {
			const response = await options.call(request, entry.ctx, requestId, callId);
			const validated = await schema.parse(contract.response, response);
			// Cancellation can remove the parent request while the reverse service
			// is running. Do not send an answer back into work the caller abandoned.
			if (pending.get(requestId) !== entry || entry.ctx.signal.aborted) return;
			raw.postMessage(Object.freeze({ type: 'call-result', id: requestId, callId, response: validated }));
		} catch (error) {
			if (pending.get(requestId) !== entry || entry.ctx.signal.aborted) return;
			raw.postMessage(Object.freeze({ type: 'call-fault', id: requestId, callId, fault: serializeFault(error) }));
		}
	}

	/** Remove one pending request exactly once before invoking its terminal resolver. */
	function settle(requestId: string, settleEntry: (entry: Pending<Response>) => void): void {
		const entry = pending.get(requestId);
		if (entry === undefined) return;
		pending.delete(requestId);
		entry.unlink();
		settleEntry(entry);
	}

	/** Reject pause/resume calls that do not identify currently owned work. */
	function assertActive(requestId: string, operation: 'pause' | 'resume'): void {
		assertId(requestId, 'Worker request');
		if (state !== 'active') throw new WorkerStoppedError();
		if (!pending.has(requestId)) {
			throw new TypeError(`Cannot ${operation} unknown Worker request ${JSON.stringify(requestId)}.`);
		}
	}

	/** Retain cancelled IDs long enough to ignore one cooperative late response safely. */
	function rememberCancelled(requestId: string): void {
		forgetCancelled(requestId);
		cancelledIds.set(requestId, setTimeout(() => forgetCancelled(requestId), 60_000));
	}

	/** Release the late-response protection for one cancelled request. */
	function forgetCancelled(requestId: string): void {
		const timer = cancelledIds.get(requestId);
		if (timer !== undefined) clearTimeout(timer);
		cancelledIds.delete(requestId);
	}

	/** Invalidate the complete Worker channel when correlation or framing can no longer be trusted. */
	function invalidate(reason: unknown): void {
		if (state === 'stopped') return;
		events.emit(Object.freeze({ type: 'fault', reason }));
		state = 'stopping';
		finishStop(reason, true);
		stopPromise ??= Promise.resolve();
	}

	/** Finish shutdown only after all parent-side request ownership has been settled. */
	function finishStop(reason: unknown, forced: boolean): void {
		if (state === 'stopped') return;
		state = 'stopped';
		raw.terminate();
		ctx.signal.removeEventListener('abort', parentAbort);
		raw.removeEventListener('message', onMessage);
		raw.removeEventListener('error', onError);
		raw.removeEventListener('messageerror', onMessageError);
		for (const [requestId, entry] of pending) {
			pending.delete(requestId);
			entry.unlink();
			entry.reject(new WorkerStoppedError(reason));
		}
		for (const requestId of cancelledIds.keys()) forgetCancelled(requestId);
		events.emit(Object.freeze({ type: 'stopped', forced }));
		events[Symbol.dispose]();
		resolveStopped?.();
		resolveStopped = undefined;
	}
}

/** Return the current Worker global scope after verifying the required message operations exist. */
function getWorkerScope(): RawWorkerScope {
	const value = globalThis as Partial<RawWorkerScope>;
	if (
		typeof value.postMessage !== 'function' || typeof value.addEventListener !== 'function' ||
		typeof value.removeEventListener !== 'function'
	) {
		throw new TypeError('The current runtime does not expose a Worker global message scope.');
	}
	return value as RawWorkerScope;
}

/** Narrow an explicit transfer response without treating ordinary objects as transport metadata. */
function isReply<Response>(value: Response | WorkerReply<Response>): value is WorkerReply<Response> {
	return isRecord(value) && value.kind === 'worker-reply' && Array.isArray(value.transfer);
}

/** Validate the serializable subset of a context before restoring local cancellation state. */
function isSnapshot(value: unknown): value is contextCore.Snapshot {
	return isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.startedAt === 'string' &&
		(value.traceId === undefined || typeof value.traceId === 'string') &&
		(value.deploymentId === undefined || typeof value.deploymentId === 'string') &&
		(value.idempotencyKey === undefined || typeof value.idempotencyKey === 'string') &&
		(value.deadline === undefined || typeof value.deadline === 'string');
}

/** Release every waiter blocked at the next cooperative request checkpoint. */
function resume(state: PauseState): void {
	state.paused = false;
	for (const release of state.waiters) release();
	state.waiters.clear();
}

/** Wait for resume or cancellation without claiming that arbitrary provider work can be suspended. */
async function waitForResume(ctx: Context, state: PauseState): Promise<void> {
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

/** Serialize a fault into bounded cloneable diagnostics without creating an application failure contract. */
function serializeFault(value: unknown): Readonly<Record<string, unknown>> {
	const diagnostic = faultCore.encode(value);
	if (value instanceof Error && faultCore.isRecord(diagnostic)) return diagnostic;
	return Object.freeze({
		name: 'Error',
		message: typeof diagnostic === 'string' ? diagnostic : 'Worker faulted.',
		value: diagnostic,
	});
}

/** Reject malformed expected failures before they enter the parent request's terminal state. */
function assertEncodedFailure(value: unknown): EncodedFailure {
	if (!failure.isEncoded(value)) throw new WorkerProtocolError('Worker failure envelope is invalid.', value);
	return Object.freeze({ id: value.id, data: value.data, message: value.message });
}

/** Reject empty or excessively large correlation identifiers before protocol state stores them. */
function assertId(value: string, label: string): void {
	if (value.trim().length === 0) throw new TypeError(`${label} ID must not be empty.`);
	if (value.length > 512) throw new TypeError(`${label} ID must not exceed 512 characters.`);
}

/** Narrow unknown values before protocol envelope property access. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Wait for cooperative shutdown for no longer than the configured grace period. */
async function settlesWithin(value: Promise<unknown>, milliseconds: number): Promise<boolean> {
	if (milliseconds <= 0) return false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			value.then(() => true, () => true),
			new Promise<boolean>((resolve) => timer = setTimeout(() => resolve(false), milliseconds)),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export type {
	WorkerCallProtocol,
	WorkerProtocol,
	WorkerProtocolOptions,
	WorkerRequestOptions,
	WorkerMessageOptions,
	WorkerEventType,
	RawWorker,
	WorkerFactory,
	WorkerCallRun,
	WorkerNoticeSink,
	WorkerOpenOptions,
	WorkerHandle,
	RawWorkerScope,
	WorkerReply,
	WorkerRequestControl,
	WorkerRequestRun,
	WorkerServeOptions,
	WorkerServer,
	WorkerRequestEnvelope,
	WorkerControlEnvelope,
	WorkerResponseEnvelope,
} from './types.ts';
