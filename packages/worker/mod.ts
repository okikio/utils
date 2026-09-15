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

/** Worker-side owner for restored request contexts and correlated reverse calls. */
class Server<Request, Response, Notice, CallRequest, CallResponse> {
	readonly #options: WorkerServeOptions<Request, Response, Notice, CallRequest, CallResponse>;
	readonly #scope: RawWorkerScope;
	readonly #active = new Map<string, ActiveRequest<CallResponse>>();
	readonly #ended = new Map<string, ReturnType<typeof setTimeout>>();
	readonly #createCallId: () => string;
	#state: 'active' | 'stopping' | 'stopped' = 'active';
	#stopPromise: Promise<void> | undefined;
	#resolveClosed: (() => void) | undefined;
	readonly #closed: Promise<void>;
	readonly server: WorkerServer;

	/** Stable message listener retained so shutdown can detach the Worker-global scope exactly once. */
	readonly #message = (event: MessageEvent<unknown>): void => {
		void this.#receive(event.data).catch((error) => {
			const fault = error instanceof Error
				? error
				: new WorkerProtocolError('Worker request processing failed.', error);
			void this.#fault(fault).catch(() => {});
		});
	};

	/** Deserialization failure invalidates correlation because the original frame identity is unavailable. */
	readonly #messageError = (event: MessageEvent<unknown>): void => {
		void this.#fault(new WorkerProtocolError('Parent message could not be deserialized.', event.data)).catch(() => {});
	};

	constructor(options: WorkerServeOptions<Request, Response, Notice, CallRequest, CallResponse>) {
		this.#options = options;
		this.#scope = options.scope ?? getWorkerScope();
		this.#createCallId = options.callId ?? (() => crypto.randomUUID());
		this.#closed = new Promise<void>((resolve) => this.#resolveClosed = resolve);
		this.#scope.addEventListener('message', this.#message);
		this.#scope.addEventListener('messageerror', this.#messageError);
		this.server = Object.freeze({
			closed: this.#closed,
			stop: (reason?: unknown) => this.#close(reason),
			[Symbol.asyncDispose]: async () => await this.#close('Worker server was disposed.'),
		});
	}

	/** Route one parent frame without allowing one message class to impersonate another. */
	async #receive(message: unknown): Promise<void> {
		if (this.#state === 'stopped') return;
		if (!isRecord(message) || typeof message.type !== 'string') {
			await this.#fault(new WorkerProtocolError('Parent sent a non-envelope message.', message));
			return;
		}

		if (message.type === 'request') {
			if (this.#state !== 'active') {
				this.#post(Object.freeze({
					type: 'fault',
					...(typeof message.id === 'string' ? { id: message.id } : {}),
					fault: serializeFault(new WorkerStoppedError('Worker server is stopping.')),
				}));
				return;
			}
			await this.#start(message);
			return;
		}

		if (message.type === 'shutdown') {
			this.#stopPromise ??= this.#stop(message.reason, true);
			await this.#stopPromise;
			return;
		}

		if (typeof message.id !== 'string') {
			await this.#fault(new WorkerProtocolError(`${message.type} envelope is missing a request ID.`, message));
			return;
		}
		const requestId = message.id;
		const request = this.#active.get(requestId);

		// A parent response can race cancellation after the Worker has already
		// released local request state. Ignore that late response rather than
		// invalidating an otherwise healthy Worker correlation channel.
		if (request === undefined && this.#ended.has(requestId) && (message.type === 'call-result' || message.type === 'call-fault')) {
			return;
		}
		if (request === undefined) {
			await this.#fault(new WorkerProtocolError(`Unknown active request ID ${JSON.stringify(requestId)}.`, message));
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
			await this.#settleCall(requestId, request, message);
			return;
		}

		await this.#fault(new WorkerProtocolError(`Unsupported parent message type ${JSON.stringify(message.type)}.`, message));
	}

	/** Validate one request envelope before creating its local cancellation and cleanup lifetime. */
	async #start(message: Record<string, unknown>): Promise<void> {
		if (typeof message.id !== 'string') {
			await this.#fault(new WorkerProtocolError('Request envelope is missing a request ID.', message));
			return;
		}
		const requestId = message.id;
		try {
			assertId(requestId, 'Worker request');
		} catch (error) {
			await this.#fault(error instanceof Error ? error : new WorkerProtocolError('Worker request ID is invalid.', message));
			return;
		}
		if (this.#active.has(requestId)) {
			await this.#fault(new WorkerProtocolError(`Request ID ${JSON.stringify(requestId)} is already active.`, message));
			return;
		}
		this.#forget(requestId);
		if (!isSnapshot(message.context)) {
			await this.#fault(new WorkerProtocolError('Request context snapshot is invalid.', message.context));
			return;
		}

		let request: Request;
		try {
			request = await schema.parse(this.#options.protocol.request, message.request);
		} catch (error) {
			this.#post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(error) }));
			return;
		}

		let requestCtx: contextCore.Owned;
		try {
			requestCtx = contextCore.restore(message.context);
			contextCore.check(requestCtx);
		} catch (error) {
			this.#post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(error) }));
			return;
		}

		const pause: PauseState = { paused: false, waiters: new Set() };
		const calls = new Map<string, PendingCall<CallResponse>>();
		const settled = this.#run(requestId, request, requestCtx, pause, calls);
		this.#active.set(requestId, { ctx: requestCtx, pause, calls, settled });
		await settled;
	}

	/** Execute one request while preserving terminal-result, notice, and reverse-call authority separately. */
	async #run(
		requestId: string,
		request: Request,
		requestCtx: contextCore.Owned,
		pause: PauseState,
		calls: Map<string, PendingCall<CallResponse>>,
	): Promise<void> {
		const control = Object.freeze({
			checkpoint: async () => {
				contextCore.check(requestCtx);
				if (pause.paused) await wait(requestCtx, pause);
				contextCore.check(requestCtx);
			},
			notify: async (notice: Notice, messageOptions: WorkerMessageOptions = {}) => {
				if (this.#options.protocol.notice === undefined) {
					throw new WorkerProtocolError('This Worker protocol does not declare notices.');
				}
				contextCore.check(requestCtx);
				const validated = await schema.parse(this.#options.protocol.notice, notice);
				contextCore.check(requestCtx);
				this.#post(Object.freeze({ type: 'notice', id: requestId, notice: validated }), messageOptions.transfer);
			},
			call: async (callRequest: CallRequest, messageOptions: WorkerMessageOptions = {}) => {
				const contract = this.#options.protocol.call;
				if (contract === undefined) throw new WorkerProtocolError('This Worker protocol does not declare reverse calls.');
				contextCore.check(requestCtx);
				const validated = await schema.parse(contract.request, callRequest);
				const callId = this.#createCallId();
				assertId(callId, 'Worker reverse call');
				if (calls.has(callId)) throw new WorkerProtocolError(`Reverse call ID ${JSON.stringify(callId)} is already active.`);

				const result = new Promise<CallResponse>((resolve, reject) => calls.set(callId, { resolve, reject }));
				try {
					this.#post(Object.freeze({ type: 'call', id: requestId, callId, request: validated }), messageOptions.transfer);
					return await result;
				} finally {
					calls.delete(callId);
				}
			},
		} satisfies WorkerRequestControl<Notice, CallRequest, CallResponse>);

		try {
			const handled = await this.#options.run(request, requestCtx, control);
			if (requestCtx.signal.aborted) return;
			contextCore.check(requestCtx);
			const response = isReply(handled) ? handled.response : handled;
			const validated = await schema.parse(this.#options.protocol.response, response);
			if (requestCtx.signal.aborted) return;
			this.#post(Object.freeze({ type: 'result', id: requestId, response: validated }), isReply(handled) ? handled.transfer : undefined);
		} catch (error) {
			if (requestCtx.signal.aborted) return;
			if (failure.isOccurrence(error)) {
				try {
					const encoded = await failure.encode(error);
					const validated = this.#options.protocol.failure === undefined
						? encoded
						: await schema.parse(this.#options.protocol.failure, encoded);
					this.#post(Object.freeze({ type: 'failure', id: requestId, failure: validated }));
				} catch (encodingError) {
					this.#post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(encodingError) }));
				}
				return;
			}
			this.#post(Object.freeze({ type: 'fault', id: requestId, fault: serializeFault(error) }));
		} finally {
			resume(pause);
			for (const entry of calls.values()) entry.reject(new WorkerStoppedError('Worker request ended before the reverse call completed.'));
			calls.clear();
			this.#active.delete(requestId);
			this.#remember(requestId);
			await requestCtx[Symbol.asyncDispose]();
		}
	}

	/** Settle one Worker-to-parent call only when both request and call identities still match. */
	async #settleCall(
		requestId: string,
		request: ActiveRequest<CallResponse>,
		message: Record<string, unknown>,
	): Promise<void> {
		if (typeof message.callId !== 'string') {
			await this.#fault(new WorkerProtocolError('Reverse-call response is missing a call ID.', message));
			return;
		}
		const callId = message.callId;
		const entry = request.calls.get(callId);
		if (entry === undefined) {
			await this.#fault(new WorkerProtocolError(`Unknown reverse call ID ${JSON.stringify(callId)} for request ${JSON.stringify(requestId)}.`, message));
			return;
		}

		if (message.type === 'call-fault') {
			request.calls.delete(callId);
			entry.reject(new WorkerFaultError(message.fault));
			return;
		}
		const contract = this.#options.protocol.call;
		if (contract === undefined) {
			await this.#fault(new WorkerProtocolError('Parent returned a reverse-call result for a protocol without reverse calls.', message));
			return;
		}
		try {
			const value = await schema.parse(contract.response, message.response);
			request.calls.delete(callId);
			entry.resolve(value);
		} catch (error) {
			await this.#fault(error instanceof Error ? error : new WorkerProtocolError('Reverse-call response validation failed.', message));
		}
	}

	/** Invalidate the Worker-side protocol when correlation can no longer be trusted. */
	async #fault(error: Error): Promise<void> {
		if (this.#state === 'stopped') return;
		try {
			this.#post(Object.freeze({ type: 'fault', fault: serializeFault(error) }));
		} catch {
			// The parent is already unreachable. Local shutdown still owns cleanup.
		}
		this.#stopPromise ??= this.#stop(error, false);
		await this.#stopPromise;
	}

	/** Share one cooperative stop Promise across explicit disposal and parent shutdown. */
	#close(reason?: unknown): Promise<void> {
		this.#stopPromise ??= this.#stop(reason, false);
		return this.#stopPromise;
	}

	/** Stop admission, cancel active requests, join them, and then detach the Worker scope. */
	async #stop(reason: unknown, acknowledge: boolean): Promise<void> {
		if (this.#state === 'stopped') return;
		this.#state = 'stopping';
		for (const request of this.#active.values()) {
			contextCore.cancel(request.ctx, reason);
			resume(request.pause);
		}
		await Promise.allSettled([...this.#active.values()].map((request) => request.settled));
		this.#state = 'stopped';
		this.#scope.removeEventListener('message', this.#message);
		this.#scope.removeEventListener('messageerror', this.#messageError);
		for (const requestId of this.#ended.keys()) this.#forget(requestId);
		if (acknowledge) {
			try {
				this.#post(Object.freeze({ type: 'stopped' }));
			} catch {
				// Parent-side timeout owns forced termination when acknowledgement fails.
			}
		}
		this.#resolveClosed?.();
		this.#resolveClosed = undefined;
	}

	/** Post one protocol frame while preserving any explicit transfer ownership. */
	#post(message: unknown, transfer?: readonly Transferable[]): void {
		if (transfer === undefined || transfer.length === 0) this.#scope.postMessage(message);
		else this.#scope.postMessage(message, transfer);
	}

	/** Keep recently ended request identities long enough to ignore raced reverse-call responses. */
	#remember(requestId: string): void {
		this.#forget(requestId);
		this.#ended.set(requestId, setTimeout(() => this.#forget(requestId), 60_000));
	}

	/** Remove one recently ended request identity and its cleanup timer. */
	#forget(requestId: string): void {
		const timer = this.#ended.get(requestId);
		if (timer !== undefined) clearTimeout(timer);
		this.#ended.delete(requestId);
	}
}

/** Parent-side owner for one raw Worker, its request correlations, and shutdown lifecycle. */
class Handle<Request, Response, Notice, CallRequest, CallResponse> {
	readonly #ctx: Context;
	readonly #options: WorkerOpenOptions<Request, Response, Notice, CallRequest, CallResponse>;
	readonly #id: string;
	readonly #raw: RawWorker;
	readonly #events = new EventBus<WorkerEventType>();
	readonly #pending = new Map<string, Pending<Response>>();
	readonly #cancelledIds = new Map<string, ReturnType<typeof setTimeout>>();
	readonly #createRequestId: () => string;
	readonly #shutdownMs: number;
	#state: 'active' | 'stopping' | 'stopped' = 'active';
	#stopPromise: Promise<void> | undefined;
	#resolveStopped: (() => void) | undefined;
	readonly #stopped: Promise<void>;
	readonly handle: WorkerHandle<Request, Response>;

	/** Stable response listener retained until the raw Worker transport is terminated. */
	readonly #message = (event: MessageEvent<unknown>): void => void this.#receive(event.data);

	/** A raw Worker error destroys correlation authority for every pending request. */
	readonly #error = (event: ErrorEvent): void => this.#invalidate(new WorkerFaultError(event.error ?? event.message));

	/** Deserialization failure destroys correlation because no trustworthy request identity remains. */
	readonly #messageError = (event: MessageEvent<unknown>): void =>
		this.#invalidate(new WorkerProtocolError('Worker message could not be deserialized.', event.data));

	/** Owner-context cancellation stops the complete Worker handle rather than only one child request. */
	readonly #abort = (): void => void this.#close(this.#ctx.signal.reason).catch(() => {});

	constructor(ctx: Context, options: WorkerOpenOptions<Request, Response, Notice, CallRequest, CallResponse>) {
		contextCore.check(ctx);
		this.#ctx = ctx;
		this.#options = options;
		this.#id = options.id ?? crypto.randomUUID();
		assertId(this.#id, 'Worker');
		const createRaw = options.create ?? ((module, workerOptions) => new Worker(module, workerOptions) as RawWorker);
		this.#raw = createRaw(options.module, { type: 'module', ...(options.name === undefined ? {} : { name: options.name }) });
		this.#createRequestId = options.requestId ?? (() => crypto.randomUUID());
		this.#shutdownMs = options.shutdownMs ?? 1_000;
		if (!Number.isSafeInteger(this.#shutdownMs) || this.#shutdownMs < 0) {
			throw new TypeError('shutdownMs must be a non-negative safe integer.');
		}
		this.#stopped = new Promise<void>((resolve) => this.#resolveStopped = resolve);
		this.#raw.addEventListener('message', this.#message);
		this.#raw.addEventListener('error', this.#error);
		this.#raw.addEventListener('messageerror', this.#messageError);
		this.#events.emit(Object.freeze({ type: 'opened', id: this.#id }));
		this.handle = Object.freeze({
			id: this.#id,
			events: this.#events.events,
			request: (requestCtx: Context, request: Request, requestOptions?: WorkerRequestOptions) =>
				this.#request(requestCtx, request, requestOptions),
			pause: (requestId: string) => this.#pause(requestId),
			resume: (requestId: string) => this.#resume(requestId),
			stop: (reason?: unknown) => this.#close(reason),
			[Symbol.asyncDispose]: async () => await this.#close('Worker handle was disposed.'),
		});
		this.#ctx.signal.addEventListener('abort', this.#abort, { once: true });
	}

	/** Validate, correlate, and send one request while forwarding its cancellation independently. */
	async #request(requestCtx: Context, request: Request, requestOptions: WorkerRequestOptions = {}): Promise<Response> {
		contextCore.check(requestCtx);
		if (this.#state !== 'active') throw new WorkerStoppedError();
		const requestId = requestOptions.id ?? this.#createRequestId();
		assertId(requestId, 'Worker request');
		if (this.#pending.has(requestId) || this.#cancelledIds.has(requestId)) {
			throw new TypeError(`Worker request ID ${JSON.stringify(requestId)} is already active or recently cancelled.`);
		}
		const validated = await schema.parse(this.#options.protocol.request, request);
		contextCore.check(requestCtx);
		const envelope = Object.freeze({
			type: 'request',
			id: requestId,
			context: contextCore.snapshot(requestCtx),
			request: validated,
		} satisfies WorkerRequestEnvelope<Request>);
		const response = new Promise<Response>((resolve, reject) => {
			const abort = () => this.#cancel(requestId, requestCtx, reject);
			const unlink = () => requestCtx.signal.removeEventListener('abort', abort);
			this.#pending.set(requestId, { ctx: requestCtx, resolve, reject, unlink });
			requestCtx.signal.addEventListener('abort', abort, { once: true });
			if (requestCtx.signal.aborted) abort();
		});
		if (!this.#pending.has(requestId)) return await response;
		try {
			this.#raw.postMessage(envelope, requestOptions.transfer);
			this.#events.emit(Object.freeze({ type: 'request', id: requestId }));
		} catch (error) {
			this.#settle(requestId, (entry) => entry.reject(error));
		}
		return await response;
	}

	/** Cancel exactly one parent request and remember its ID long enough to ignore one raced terminal response. */
	#cancel(requestId: string, requestCtx: Context, reject: (reason: unknown) => void): void {
		const current = this.#pending.get(requestId);
		if (current === undefined) return;
		this.#pending.delete(requestId);
		current.unlink();
		this.#remember(requestId);
		try {
			this.#raw.postMessage(Object.freeze({ type: 'cancel', id: requestId, reason: requestCtx.signal.reason }));
		} catch (error) {
			this.#invalidate(new WorkerFaultError(error));
		}
		this.#events.emit(Object.freeze({ type: 'cancelled', id: requestId }));
		reject(new contextCore.ContextCancelledError(requestCtx.signal.reason));
	}

	/** Cooperatively pause one currently owned request at its next Worker checkpoint. */
	#pause(requestId: string): void {
		this.#assert(requestId, 'pause');
		this.#raw.postMessage(Object.freeze({ type: 'pause', id: requestId }));
		this.#events.emit(Object.freeze({ type: 'paused', id: requestId }));
	}

	/** Release one currently owned request from its next Worker checkpoint. */
	#resume(requestId: string): void {
		this.#assert(requestId, 'resume');
		this.#raw.postMessage(Object.freeze({ type: 'resume', id: requestId }));
		this.#events.emit(Object.freeze({ type: 'resumed', id: requestId }));
	}

	/** Share one shutdown attempt across explicit stop, disposal, and owner-context cancellation. */
	#close(reason?: unknown): Promise<void> {
		if (this.#stopPromise !== undefined) return this.#stopPromise;
		this.#stopPromise = this.#stop(reason);
		return this.#stopPromise;
	}

	/** Ask the Worker to stop cooperatively, then force termination after the configured grace period. */
	async #stop(reason?: unknown): Promise<void> {
		if (this.#state === 'stopped') return;
		this.#state = 'stopping';
		this.#events.emit(Object.freeze({ type: 'stopping', ...(reason === undefined ? {} : { reason }) }));
		try {
			this.#raw.postMessage(Object.freeze({ type: 'shutdown', ...(reason === undefined ? {} : { reason }) }));
		} catch {
			// Forced termination below still owns cleanup when the channel is already broken.
		}
		const cooperative = await contextCore.settles(this.#stopped, this.#shutdownMs);
		if (!cooperative) this.#raw.terminate();
		this.#finish(reason, !cooperative);
	}

	/** Route Worker output while keeping optional messages separate from terminal settlement. */
	async #receive(message: unknown): Promise<void> {
		if (!isRecord(message) || typeof message.type !== 'string') {
			this.#invalidate(new WorkerProtocolError('Worker sent a non-envelope message.', message));
			return;
		}
		if (message.type === 'stopped') {
			if (this.#state === 'active') {
				this.#invalidate(new WorkerStoppedError('Worker stopped without a shutdown request.'));
				return;
			}
			this.#resolveStopped?.();
			this.#resolveStopped = undefined;
			return;
		}
		if (message.type === 'fault' && message.id === undefined) {
			this.#invalidate(new WorkerFaultError(message.fault));
			return;
		}
		if (typeof message.id !== 'string') {
			this.#invalidate(new WorkerProtocolError('Worker response is missing a request ID.', message));
			return;
		}
		const requestId = message.id;
		if (this.#cancelledIds.has(requestId)) {
			this.#forget(requestId);
			return;
		}
		const entry = this.#pending.get(requestId);
		if (entry === undefined) {
			this.#invalidate(new WorkerProtocolError(`Worker responded with unknown request ID ${JSON.stringify(requestId)}.`, message));
			return;
		}

		try {
			if (message.type === 'notice') {
				await this.#notice(requestId, entry, message);
				return;
			}
			if (message.type === 'call') {
				await this.#call(requestId, entry, message);
				return;
			}
			if (message.type === 'result') {
				const value = await schema.parse(this.#options.protocol.response, message.response);
				this.#settle(requestId, (current) => current.resolve(value));
				this.#events.emit(Object.freeze({ type: 'result', id: requestId }));
				return;
			}
			if (message.type === 'failure') {
				const encoded = this.#options.protocol.failure === undefined
					? assertEncodedFailure(message.failure)
					: await schema.parse(this.#options.protocol.failure, message.failure);
				this.#settle(requestId, (current) => current.reject(new WorkerFailureError(encoded)));
				this.#events.emit(Object.freeze({ type: 'failure', id: requestId, failureId: encoded.id }));
				return;
			}
			if (message.type === 'fault') {
				this.#settle(requestId, (current) => current.reject(new WorkerFaultError(message.fault)));
				this.#events.emit(Object.freeze({ type: 'fault', id: requestId, reason: message.fault }));
				return;
			}
			this.#invalidate(new WorkerProtocolError(`Unsupported Worker response type ${JSON.stringify(message.type)}.`, message));
		} catch (error) {
			this.#invalidate(error instanceof Error ? error : new WorkerProtocolError('Worker response validation failed.', message));
		}
	}

	/** Validate and forward one non-terminal notice without giving the observer terminal authority. */
	async #notice(requestId: string, entry: Pending<Response>, message: Record<string, unknown>): Promise<void> {
		if (this.#options.protocol.notice === undefined) {
			this.#invalidate(new WorkerProtocolError('Worker emitted a notice for a protocol without notices.', message));
			return;
		}
		const notice = await schema.parse(this.#options.protocol.notice, message.notice);
		this.#events.emit(Object.freeze({ type: 'notice', id: requestId }));
		if (this.#options.notice !== undefined) {
			// Observation callbacks cannot decide request correctness. A failing
			// observer is therefore isolated from terminal request settlement.
			void Promise.resolve(this.#options.notice(notice, entry.ctx, requestId)).catch(() => {});
		}
	}

	/** Answer one Worker-to-parent call without treating the answer as the terminal request response. */
	async #call(requestId: string, entry: Pending<Response>, message: Record<string, unknown>): Promise<void> {
		const contract = this.#options.protocol.call;
		if (contract === undefined || this.#options.call === undefined) {
			this.#invalidate(new WorkerProtocolError('Worker requested a reverse call that this parent does not provide.', message));
			return;
		}
		if (typeof message.callId !== 'string') {
			this.#invalidate(new WorkerProtocolError('Worker reverse call is missing a call ID.', message));
			return;
		}
		const callId = message.callId;
		assertId(callId, 'Worker reverse call');
		const request = await schema.parse(contract.request, message.request);
		this.#events.emit(Object.freeze({ type: 'call', id: requestId, callId }));
		try {
			const response = await this.#options.call(request, entry.ctx, requestId, callId);
			const validated = await schema.parse(contract.response, response);
			// Cancellation can remove the parent request while the reverse service
			// is running. Do not send an answer back into work the caller abandoned.
			if (this.#pending.get(requestId) !== entry || entry.ctx.signal.aborted) return;
			this.#raw.postMessage(Object.freeze({ type: 'call-result', id: requestId, callId, response: validated }));
		} catch (error) {
			if (this.#pending.get(requestId) !== entry || entry.ctx.signal.aborted) return;
			this.#raw.postMessage(Object.freeze({ type: 'call-fault', id: requestId, callId, fault: serializeFault(error) }));
		}
	}

	/** Remove one pending request exactly once before invoking its terminal resolver. */
	#settle(requestId: string, settleEntry: (entry: Pending<Response>) => void): void {
		const entry = this.#pending.get(requestId);
		if (entry === undefined) return;
		this.#pending.delete(requestId);
		entry.unlink();
		settleEntry(entry);
	}

	/** Reject pause/resume calls that do not identify currently owned work. */
	#assert(requestId: string, operation: 'pause' | 'resume'): void {
		assertId(requestId, 'Worker request');
		if (this.#state !== 'active') throw new WorkerStoppedError();
		if (!this.#pending.has(requestId)) {
			throw new TypeError(`Cannot ${operation} unknown Worker request ${JSON.stringify(requestId)}.`);
		}
	}

	/** Retain cancelled IDs long enough to ignore one cooperative late response safely. */
	#remember(requestId: string): void {
		this.#forget(requestId);
		this.#cancelledIds.set(requestId, setTimeout(() => this.#forget(requestId), 60_000));
	}

	/** Release the late-response protection for one cancelled request. */
	#forget(requestId: string): void {
		const timer = this.#cancelledIds.get(requestId);
		if (timer !== undefined) clearTimeout(timer);
		this.#cancelledIds.delete(requestId);
	}

	/** Invalidate the complete Worker channel when correlation or framing can no longer be trusted. */
	#invalidate(reason: unknown): void {
		if (this.#state === 'stopped') return;
		this.#events.emit(Object.freeze({ type: 'fault', reason }));
		this.#state = 'stopping';
		this.#finish(reason, true);
		this.#stopPromise ??= Promise.resolve();
	}

	/** Finish shutdown only after all parent-side request ownership has been settled. */
	#finish(reason: unknown, forced: boolean): void {
		if (this.#state === 'stopped') return;
		this.#state = 'stopped';
		this.#raw.terminate();
		this.#ctx.signal.removeEventListener('abort', this.#abort);
		this.#raw.removeEventListener('message', this.#message);
		this.#raw.removeEventListener('error', this.#error);
		this.#raw.removeEventListener('messageerror', this.#messageError);
		for (const [requestId, entry] of this.#pending) {
			this.#pending.delete(requestId);
			entry.unlink();
			entry.reject(new WorkerStoppedError(reason));
		}
		for (const requestId of this.#cancelledIds.keys()) this.#forget(requestId);
		this.#events.emit(Object.freeze({ type: 'stopped', forced }));
		this.#events[Symbol.dispose]();
		this.#resolveStopped?.();
		this.#resolveStopped = undefined;
	}
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
 * permission decisions or effect acceptance.
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
	return new Server(options).server;
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
	return new Handle(ctx, options).handle;
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

/** Wait for a Worker resume message or context cancellation at one cooperative checkpoint. */
function wait(ctx: Context, state: PauseState): Promise<void> {
	if (!state.paused) return Promise.resolve();
	return contextCore.waitFor(ctx, (resume) => {
		if (!state.paused) {
			resume();
			return () => {};
		}
		state.waiters.add(resume);
		return () => {
			state.waiters.delete(resume);
		};
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

export type * from './types.ts';
