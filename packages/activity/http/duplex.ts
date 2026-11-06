/**
 * Paired HTTP requests carry activity reverse calls without streaming uploads.
 * The start response streams calls; authenticated reply/cancel POSTs address its
 * exact temporary session. Sessions cannot reconnect, resume or replay.
 * @module
 */
import * as context from '@okikio/context';
import type { Context } from '@okikio/context';
import * as schema from '@okikio/schema';
import * as json from '@okikio/streams/json';
import type {
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
	EngineProvider,
} from '@okikio/workflow';
import type { ClientOptions, HandlerOptions } from '../http.ts';
import { HttpActivityError } from '../http.ts';
import * as remote from '../remote.ts';
import * as transport from '../transport.ts';

/** Finite budgets shared by both ends of an ephemeral activity session. */
export interface Options {
	/** Maximum reverse calls over one attempt; default 128, maximum 1024. */
	readonly maximumCalls?: number;
	/** Maximum unanswered calls per attempt; default 8, maximum 64. */
	readonly maximumPending?: number;
	/** Total streamed bytes per attempt; default 8 MiB, maximum 64 MiB. */
	readonly maximumStreamBytes?: number;
	/** Session lifetime in milliseconds; default 30 seconds, maximum one hour. */
	readonly timeoutMs?: number;
	/** Client wait for cancellation and joined remote cleanup; default 5 seconds. */
	readonly cleanupMs?: number;
}
/** HTTP client options with finite reverse-call and cleanup budgets. */
export interface DuplexClientOptions extends ClientOptions, Options {}
/** Receiving provider borrows caller authority instead of configuring a second control owner. */
export interface DuplexHandlerOptions extends Omit<HandlerOptions, 'control'>, Options {}
/** Stop new sessions, cancel existing attempts, and join their actual cleanup before shutdown. */
export interface Handler {
	(request: Request): Promise<Response>;
	/** Application closes its listener first, then joins owned sessions. Uncooperative code can delay this promise. */
	close(): Promise<void>;
}

const NameSchema = schema.string({ minLength: 1, maxLength: 256 });
const SessionSchema = schema.string({ minLength: 32, maxLength: 64 });
const CountSchema = schema.number({ integer: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
/** Session and attempt fences are present on every frame and control message. */
const FenceSchema = {
	/** Unpredictable per-start correlation token; never a durable identity or URL segment. */
	session: SessionSchema,
	/** Scheduler claim identity; a different claim cannot settle this session's calls. */
	claimId: NameSchema,
	/** Registration generation rejects messages from a replaced live registration. */
	generation: CountSchema,
};
const HelloSchema = schema.object({ type: schema.literal('hello'), ...FenceSchema });
const CallSchema = schema.object({
	type: schema.literal('call'),
	...FenceSchema,
	callId: CountSchema,
	request: schema.unknown(),
});
const TerminalSchema = schema.object({ type: schema.literal('terminal'), ...FenceSchema, result: schema.unknown() });
const FrameSchema = schema.union([HelloSchema, CallSchema, TerminalSchema]);
const ReplySchema = schema.object({
	type: schema.literal('reply'),
	...FenceSchema,
	callId: CountSchema,
	reply: schema.unknown(),
	failed: schema.optional(schema.literal(true)),
});
const CancelSchema = schema.object({ type: schema.literal('cancel'), ...FenceSchema });
const ControlSchema = schema.union([ReplySchema, CancelSchema]);
type Fence = schema.Output<typeof HelloSchema>;

/** One unresolved reverse call; deletion occurs before resolving to reject duplicates atomically. */
interface Pending {
	readonly type: transport.HostCallType['type'];
	readonly resolve: (reply: transport.HostReplyType) => void;
	readonly reject: (reason: unknown) => void;
	readonly settled: Promise<void>;
}
/** State belongs to exactly one start response and is never reused after retirement. */
interface Session {
	readonly attempt: ActivityAttemptType;
	readonly controller: AbortController;
	readonly pending: Map<number, Pending>;
	readonly done: Promise<void>;
}

/** Create an inert provider; each run opens one fresh session and never retries it. */
export function create(options: DuplexClientOptions): EngineProvider {
	const bounds = limits(options);
	remote.engine(options.engine, 'Duplex HTTP provider');
	const definitions = remote.definitions(options.activities, 'Duplex HTTP provider');
	const url = endpoint(options);
	return Object.freeze({
		activities: Object.freeze([...definitions.values()]),
		async run(
			ctx: Context,
			attempt: ActivityAttemptType,
			control: ActivityAttemptControl,
		): Promise<ActivityAttemptResultType> {
			if (ctx.signal.aborted) return { type: 'cancelled', reason: ctx.signal.reason };
			if (attempt.location?.host) {
				return { type: 'lost', reason: new HttpActivityError('Duplex HTTP does not select physical hosts.') };
			}
			const definition = remote.definition(
				definitions,
				options.engine,
				attempt,
				(id, version) => new TypeError(`Unknown HTTP activity ${id}@${version}.`),
			);
			const lifetime = new AbortController();
			const pending = new Set<Promise<void>>();
			let fence: Fence | undefined;
			let terminal: ActivityAttemptResultType | undefined;
			let cancelled = false;
			let cancelAcknowledged = false;
			// A reply can become stale while its independent cancel POST joins this exact session.
			let cancelledReplyConflict: HttpActivityError | undefined;
			let callCount = 0;
			let lastCall = 0;
			let cleanup: ReturnType<typeof setTimeout> | undefined;
			const timeout = setTimeout(
				() => lifetime.abort(new HttpActivityError('Duplex HTTP session expired.')),
				bounds.timeoutMs,
			);
			/** Every control POST obtains fresh credentials and the same protocol version. */
			async function post(operation: string, value: unknown): Promise<Response> {
				const headers = new Headers(await options.headers(attempt));
				headers.set('content-type', 'application/json');
				headers.set('x-okikio-activity-version', '2');
				headers.set('x-okikio-activity-operation', operation);
				return await fetch(url, {
					method: 'POST',
					headers,
					body: new Uint8Array(json.encode(value, bounds.maximumBytes)),
					signal: lifetime.signal,
					redirect: 'error',
				});
			}
			/** Cancel once, then retain the response stream long enough to observe joined cleanup. */
			function cancel(): void {
				if (cancelled) return;
				cancelled = true;
				cleanup = setTimeout(
					() => lifetime.abort(new HttpActivityError('Remote cleanup was not acknowledged.')),
					bounds.cleanupMs,
				);
				if (fence) track(sendCancel());
			}
			/** A cancel request is only evidence of acceptance after its own successful response. */
			async function sendCancel(): Promise<void> {
				if (!fence) throw new HttpActivityError('Cancellation requires the exact session fence.');
				const response = await post('cancel', { ...fence, type: 'cancel' });
				await response.body?.cancel();
				if (!response.ok) throw new HttpActivityError('Remote cancellation was rejected.', response.status);
				cancelAcknowledged = true;
			}
			/** Retain control requests until completion; a lost acknowledgement makes the whole session uncertain. */
			function track(task: Promise<void>): void {
				pending.add(task);
				void task.catch((reason) => lifetime.abort(reason)).finally(() => pending.delete(task));
			}
			ctx.signal.addEventListener('abort', cancel, { once: true });
			if (ctx.signal.aborted) cancel();
			try {
				const response = await post('start', attempt);
				if (!response.ok || response.headers.get('x-okikio-activity-version') !== '2' || !response.body) {
					await response.body?.cancel();
					throw new HttpActivityError('Duplex HTTP start was rejected.', response.status);
				}
				for await (
					const value of json.lines(response.body, {
						maximumBytes: bounds.maximumStreamBytes,
						maximumLineBytes: bounds.maximumBytes,
						maximumItems: bounds.maximumCalls + 2,
						signal: lifetime.signal,
					})
				) {
					const frame = await schema.parse(FrameSchema, value);
					if (
						frame.claimId !== attempt.claimId || frame.generation !== attempt.generation ||
						(fence && frame.session !== fence.session)
					) throw new HttpActivityError('Mismatched duplex attempt fence.');
					if (frame.type === 'hello') {
						if (fence) throw new HttpActivityError('Duplicate duplex session hello.');
						fence = frame;
						if (cancelled) {
							// Cancellation can arrive before headers. Send it once the session identity is known.
							track(sendCancel());
						}
						continue;
					}
					if (!fence || terminal) throw new HttpActivityError('Unexpected duplex frame order.');
					if (frame.type === 'terminal') {
						terminal = await transport.result(definition, await schema.parse(transport.ResultSchema, frame.result));
						continue;
					}
					if (cancelled) continue;
					if (++callCount > bounds.maximumCalls || frame.callId <= lastCall || pending.size >= bounds.maximumPending) {
						throw new HttpActivityError('Duplex call budget or sequence exceeded.');
					}
					lastCall = frame.callId;
					const call = await schema.parse(transport.CallSchema, frame.request);
					// Do not block stream consumption while authority runs: other replies and cancellation must progress.
					const task = (async () => {
						let reply: transport.HostReplyType | undefined;
						let failed = false;
						try {
							reply = await transport.answer(ctx, definition, control, {}, call);
						} catch {
							failed = true;
						}
						if (cancelled || lifetime.signal.aborted) return;
						const result = await post('reply', {
							...fence,
							type: 'reply',
							callId: frame.callId,
							reply: reply ?? null,
							...(failed ? { failed: true } : {}),
						});
						// Capture ordering before awaiting body cleanup: a later abort cannot excuse an earlier rejection.
						const staleAfterCancel = result.status === 409 && cancelled;
						await result.body?.cancel();
						if (!result.ok) {
							const conflict = new HttpActivityError('Reverse-call acknowledgement rejected.', result.status);
							if (staleAfterCancel) cancelledReplyConflict ??= conflict;
							else throw conflict;
						}
					})();
					track(task);
				}
				if (!terminal) throw new HttpActivityError('Duplex response ended without joined cleanup.');
				// Join in-flight authority and reply acknowledgements. EOF is not a substitute for them.
				await Promise.race([
					Promise.all([...pending]),
					new Promise<never>((_resolve, reject) => {
						if (lifetime.signal.aborted) reject(lifetime.signal.reason);
						else lifetime.signal.addEventListener('abort', () => reject(lifetime.signal.reason), { once: true });
					}),
				]);
				// A settled task may have aborted lifetime and left the Set before this join snapshot.
				// Promise.all([]) must not let that earlier acknowledgement failure become terminal success.
				lifetime.signal.throwIfAborted();
				// A stale reply is harmless only when this exact cancellation was acknowledged and joined.
				// Neither an abort request nor an unrelated successful terminal can discharge that uncertainty.
				if (cancelledReplyConflict && (!cancelAcknowledged || terminal.type !== 'cancelled')) {
					throw cancelledReplyConflict;
				}
				if (cancelled) {
					if (!cancelAcknowledged || terminal.type !== 'cancelled') {
						throw new HttpActivityError('Remote cancellation lacks a matching joined acknowledgement.');
					}
					return { type: 'cancelled', reason: ctx.signal.reason };
				}
				return terminal;
			} catch (reason) {
				return { type: 'lost', reason };
			} finally {
				clearTimeout(timeout);
				if (cleanup) clearTimeout(cleanup);
				ctx.signal.removeEventListener('abort', cancel);
				lifetime.abort();
				// Authority callbacks are borrowed and cannot be forcibly joined. Rejections remain observed.
			}
		},
	});
}

/** Create a dedicated route owner with bounded sessions and authenticated control POSTs. */
export function handler(options: DuplexHandlerOptions): Handler {
	const bounds = limits(options);
	const capacity = integer(options.concurrency, 16, 10_000);
	const definitions = remote.definitions(options.activities, 'Duplex HTTP handler');
	const sessions = new Map<string, Session>();
	// The live claim index rejects duplicate starts without pretending to persist a replay history.
	const claims = new Set<string>();
	const uploads = new Set<AbortController>();
	let readers = 0;
	let closed = false;
	const serve = async (request: Request): Promise<Response> => {
		if (request.method !== 'POST') return status(405);
		try {
			if (!await options.authenticate(request)) return status(401);
		} catch {
			return status(500);
		}
		if (closed) return status(503);
		if (
			request.headers.get('x-okikio-activity-version') !== '2' ||
			request.headers.get('content-type')?.split(';')[0] !== 'application/json'
		) return status(415);
		if (readers >= capacity * (bounds.maximumPending + 1)) return status(503);
		readers++;
		try {
			if (!request.body) return status(400);
			const upload = new AbortController();
			uploads.add(upload);
			let value: unknown;
			try {
				value = await json.read(request.body, bounds.maximumBytes, AbortSignal.any([request.signal, upload.signal]));
			} finally {
				uploads.delete(upload);
			}
			const operation = request.headers.get('x-okikio-activity-operation');
			if (operation !== 'start') {
				const command = await schema.parse(ControlSchema, value);
				if (operation !== command.type) return status(400);
				const session = sessions.get(command.session);
				if (
					!session || session.attempt.claimId !== command.claimId || session.attempt.generation !== command.generation
				) return status(409);
				try {
					if (!await options.authorize(request, session.attempt)) return status(403);
				} catch {
					return status(500);
				}
				if (sessions.get(command.session) !== session) return status(409);
				if (command.type === 'cancel') {
					session.controller.abort(new HttpActivityError('Caller cancelled the session.'));
					return status(204);
				}
				if (session.controller.signal.aborted) return status(409);
				const pending = session.pending.get(command.callId);
				if (!pending) return status(409);
				if (command.failed) {
					session.pending.delete(command.callId);
					pending.reject(new HttpActivityError('Caller authority rejected the reverse call.'));
					return status(204);
				}
				const reply = await schema.parse(transport.ReplySchema, command.reply);
				if (session.controller.signal.aborted || session.pending.get(command.callId) !== pending) return status(409);
				if (reply.type !== pending.type) return status(400);
				session.pending.delete(command.callId);
				pending.resolve(reply);
				return status(204);
			}
			const attempt = await schema.parse(transport.AttemptSchema, value);
			try {
				if (!await options.authorize(request, attempt)) return status(403);
			} catch {
				return status(500);
			}
			if (closed || sessions.size >= capacity) return status(503);
			if (request.signal.aborted) return status(408);
			const claimKey = JSON.stringify([attempt.registrationId, attempt.generation, attempt.claimId]);
			if (claims.has(claimKey)) return status(409);
			const definition = definitions.get(remote.identity(attempt.activityId, attempt.activityVersion));
			if (!definition) return status(404);
			const sessionId = crypto.randomUUID();
			const fence = { session: sessionId, claimId: attempt.claimId, generation: attempt.generation };
			const controller = new AbortController();
			const pending = new Map<number, Pending>();
			let output!: TransformStreamDefaultController<Uint8Array>;
			const stream = new TransformStream<Uint8Array, Uint8Array>({
				start(controller) {
					output = controller;
				},
			});
			let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
			const writer = stream.writable.getWriter();
			let calls = 0;
			let written = 0;
			// A rejection may carry undefined, so retain its presence separately from its reason.
			let controlFailure: { readonly reason: unknown } | undefined;
			let finish!: () => void;
			const done = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const session: Session = { attempt, controller, pending, done };
			sessions.set(sessionId, session);
			claims.add(claimKey);
			/** Serialized writes obey native backpressure; pending calls cap retained frames. */
			const write = async (value: unknown): Promise<void> => {
				const bytes = json.encode(value, bounds.maximumBytes);
				written += bytes.byteLength;
				if (written > bounds.maximumStreamBytes) throw new HttpActivityError('Duplex stream byte budget exceeded.');
				await writer.write(bytes);
			};
			const disconnected = () => controller.abort(new HttpActivityError('Duplex start request disconnected.'));
			request.signal.addEventListener('abort', disconnected, { once: true });
			if (request.signal.aborted) disconnected();
			void writer.closed.catch(disconnected);
			controller.signal.addEventListener('abort', () => {
				// Give cooperative cleanup a terminal frame, then break a stalled response writer.
				cleanupTimer = setTimeout(() => output.error(controller.signal.reason), bounds.cleanupMs);
				for (const value of pending.values()) value.reject(controller.signal.reason);
				pending.clear();
			}, { once: true });
			const timer = setTimeout(
				() => controller.abort(new HttpActivityError('Duplex session expired.')),
				bounds.timeoutMs,
			);
			/** One call ID belongs to one unresolved authority request and can be settled once only. */
			const call = async (request: transport.HostCallType): Promise<transport.HostReplyType> => {
				controller.signal.throwIfAborted();
				if (++calls > bounds.maximumCalls || pending.size >= bounds.maximumPending) {
					throw new HttpActivityError('Duplex reverse-call budget exceeded.');
				}
				const callId = calls;
				let resolve!: (value: transport.HostReplyType) => void;
				let reject!: (reason: unknown) => void;
				const reply = new Promise<transport.HostReplyType>((yes, no) => {
					resolve = yes;
					reject = no;
				});
				const settled = reply.then(() => undefined, (reason) => {
					controlFailure = { reason };
				});
				pending.set(callId, { type: request.type, resolve, reject, settled });
				// Observe rejection immediately while a blocked socket write is still awaiting demand.
				void reply.catch(() => undefined);
				try {
					await write({ ...fence, type: 'call', callId, request });
					return await reply;
				} finally {
					pending.delete(callId);
				}
			};
			void (async () => {
				try {
					await write({ ...fence, type: 'hello' });
					let result: ActivityAttemptResultType;
					try {
						controller.signal.throwIfAborted();
						await using ctx = context.restore(attempt.context, { signal: controller.signal });
						const checker = transport.checker(call, 1000);
						const emitter = transport.emitter(call);
						/** Detached controls still have an owner for rejection and terminal fault reporting. */
						const observe = <Value>(operation: Promise<Value>): Promise<Value> => {
							void operation.catch((reason) => {
								controlFailure = { reason };
							});
							return operation;
						};
						result = await options.provider.run(ctx, attempt, {
							heartbeat: (value) => observe(transport.heartbeat(call, value)),
							permission: {
								maximumChecks: checker.maximumChecks,
								check: (ctx, requests) => observe(checker.check(ctx, requests)),
							},
							effect: { emit: (ctx, value) => observe(emitter.emit(ctx, value)) },
						});
						// Keep borrowed Context resources alive through detached reverse calls too.
						await Promise.all([...pending.values()].map((value) => value.settled));
					} catch (error) {
						// An abort flag does not explain an unrelated failure or a disposal error.
						const cancelled = context.cancelled(error) ||
							(controller.signal.aborted && error === controller.signal.reason);
						result = cancelled
							? { type: 'cancelled', reason: controller.signal.reason ?? error }
							: { type: 'fault', fault: error };
					}
					// A provider may start a control call without awaiting it. Its terminal result
					// cannot outrun that authority call; session expiry releases abandoned calls.
					await Promise.all([...pending.values()].map((value) => value.settled));
					// A joined failure remains a failure even when cancellation arrived first.
					// Only successful/explicitly cancelled work can become a clean cancellation.
					if (controller.signal.aborted && (result.type === 'success' || result.type === 'cancelled')) {
						result = { type: 'cancelled', reason: controller.signal.reason };
					} else if (!controller.signal.aborted && controlFailure !== undefined) {
						result = { type: 'fault', fault: controlFailure.reason };
					}
					await write({ ...fence, type: 'terminal', result: await transport.wire(definition, result) });
					await writer.close();
				} catch (error) {
					controller.abort(error);
					await writer.abort(error).catch(() => undefined);
				} finally {
					clearTimeout(timer);
					if (cleanupTimer) clearTimeout(cleanupTimer);
					request.signal.removeEventListener('abort', disconnected);
					sessions.delete(sessionId);
					claims.delete(claimKey);
					finish();
				}
			})();
			return new Response(stream.readable, {
				headers: {
					'content-type': 'application/x-ndjson',
					'x-okikio-activity-version': '2',
					'cache-control': 'no-store',
				},
			});
		} catch (error) {
			return status(error instanceof RangeError ? 413 : 400);
		} finally {
			readers--;
		}
	};
	return Object.assign(serve, {
		async close(): Promise<void> {
			closed = true;
			for (const upload of uploads) upload.abort(new HttpActivityError('HTTP host is closing.'));
			const active = [...sessions.values()];
			for (const session of active) session.controller.abort(new HttpActivityError('HTTP host is closing.'));
			await Promise.all(active.map((session) => session.done));
		},
	});
}

/** One endpoint is reused for all operations; session secrets stay in bodies, never URLs. */
function endpoint(options: ClientOptions): URL {
	const url = new URL(options.url);
	if (
		url.username || url.password ||
		(url.protocol !== 'https:' &&
			!(options.allowLoopbackHttp && url.protocol === 'http:' &&
				['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
	) throw new TypeError('Duplex HTTP requires HTTPS or explicit loopback HTTP.');
	return url;
}
/** Validate finite limits before allocating sessions, streams or timers. */
function integer(value: number | undefined, fallback: number, maximum: number): number {
	const number = value ?? fallback;
	if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
		throw new TypeError(`Expected a positive integer no greater than ${maximum}.`);
	}
	return number;
}
/** Defaults bound bytes, in-flight authority requests and both active/cleanup waiting periods. */
function limits(options: Options & { readonly maximumBytes?: number }) {
	return {
		maximumBytes: integer(options.maximumBytes, 1_048_576, 16_777_216),
		maximumCalls: integer(options.maximumCalls, 128, 1024),
		maximumPending: integer(options.maximumPending, 8, 64),
		maximumStreamBytes: integer(options.maximumStreamBytes, 8_388_608, 67_108_864),
		timeoutMs: integer(options.timeoutMs, 30_000, 3_600_000),
		cleanupMs: integer(options.cleanupMs, 5_000, 60_000),
	};
}
/** Errors deliberately omit secret-bearing body data and server exceptions. */
function status(code: number): Response {
	return new Response(null, { status: code, headers: { 'cache-control': 'no-store' } });
}
