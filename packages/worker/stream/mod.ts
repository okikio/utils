/** Credit-driven byte streams over owned dedicated native MessagePorts. @module */
import * as context from '@okikio/context';
import type { Context } from '@okikio/context';
import { EventBus } from '@okikio/observables/events';
import { FrameSchema, header } from './wire.ts';
import type { FrameType } from './wire.ts';
import type { EventType, LimitsType, OpenOptionsType, OutcomeType, Port, Producer, Receiver, Source } from './types.ts';
export type { EventType, LimitsType, OpenOptionsType, OutcomeType, Port, Producer, Receiver, Source } from './types.ts';

/** A malformed/out-of-order frame or remote producer fault ended the stream. Details stay local to the sender. */
export class StreamProtocolError extends Error {
	/** Retain a bounded protocol diagnostic without serializing remote source errors. */
	constructor(message: string) {
		super(message);
		this.name = 'StreamProtocolError';
	}
}
/** No valid remote terminal receipt arrived; closing a local port does not prove remote cleanup. */
export class StreamTimeoutError extends Error {
	/** Preserve a preceding local cancellation reason as the cause of missing remote confirmation. */
	constructor(cause?: unknown) {
		super('Stream peer did not respond before timeout; remote cleanup is unconfirmed.', { cause });
		this.name = 'StreamTimeoutError';
	}
}

/** Snapshot all policy before registering listeners; mutation cannot widen a live connection. */
function limits(options: LimitsType): LimitsType {
	const { maximumChunkBytes, maximumChunks, maximumBytes } = options;
	for (const value of [maximumChunkBytes, maximumChunks, maximumBytes]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('Stream limits must be positive safe integers.');
		}
	}
	return Object.freeze({ maximumChunkBytes, maximumChunks, maximumBytes });
}
/** Compare before addition so aggregate accounting never loses integer precision. */
function charge(
	value: Uint8Array,
	count: number,
	bytes: number,
	policy: LimitsType,
): asserts value is Uint8Array<ArrayBuffer> {
	if (
		!(value instanceof Uint8Array) || value.byteLength > policy.maximumChunkBytes ||
		value.buffer.byteLength > policy.maximumChunkBytes || count >= policy.maximumChunks ||
		value.byteLength > policy.maximumBytes - bytes || !(value.buffer instanceof ArrayBuffer)
	) {
		throw new StreamProtocolError('Chunk exceeds negotiated count/byte limits or uses a shared backing store.');
	}
}
/** Attempt every listener/port release even if a custom native adapter throws during one step. */
function retire(port: Port, message: (event: Event) => void, messageerror: (event: Event) => void): unknown[] {
	const errors: unknown[] = [];
	for (
		const action of [
			() => port.removeEventListener('message', message),
			() => port.removeEventListener('messageerror', messageerror),
			() => port.close(),
		]
	) {
		try {
			action();
		} catch (error) {
			errors.push(error);
		}
	}
	return errors;
}

/** Deliver the same immutable projection through both native and Observable listeners, without event history. */
function observations() {
	const target = new EventTarget();
	const bus = new EventBus<EventType>();
	return {
		target,
		bus,
		emit(type: EventType['type'], chunks: number, bytes: number): void {
			const value = Object.freeze({ type, chunks, bytes });
			target.dispatchEvent(new CustomEvent('state', { detail: value }));
			bus.emit(value);
		},
	};
}

/**
 * Receive one version-one byte stream on a dedicated port whose ownership is transferred here.
 * Each read grants exactly one chunk, with no prefetch or receive queue. Pipe
 * cancellation joins a terminal cleanup receipt or the explicit unconfirmed
 * timeout result; inspect closed to distinguish them. No request replay, Worker
 * termination, multiplexing or application authentication is implicit.
 */
export function open(ctx: Context, port: Port, options: OpenOptionsType): Receiver {
	context.check(ctx);
	let policy = limits(options);
	const { id, timeout } = options;
	if (!Number.isSafeInteger(timeout) || timeout < 1) throw new RangeError('Invalid stream timeout.');
	// Reuse the wire schema for local ID validation, before ownership transfers.
	FrameSchema.parse({ ...header(id), kind: 'open', ...policy });
	const observed = observations();
	const ready = Promise.withResolvers<void>();
	void ready.promise.catch(() => {});
	const terminal = Promise.withResolvers<OutcomeType>();
	let controller: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
	/** Only one pull credit exists; the stream serializes subsequent reader demand. */
	let credit: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	/** Validated frame count doubles as the next expected sequence. */
	let chunks = 0;
	/** Payload accounting excludes native message envelopes and downstream-owned chunks. */
	let bytes = 0;
	/** No pull is sent until the peer returns an exact-version limits agreement. */
	let accepted = false;
	/** Local retirement is idempotent, including timeout and reentrant observer cancellation. */
	let finished = false;
	/** Cancellation errors the readable immediately but keeps listening for joined cleanup evidence. */
	let cancelling = false;
	/** Local failure/cancellation stays exact, including undefined; wire cancellation sends no secret reason. */
	let reason: unknown;
	let desired: 'cancelled' | 'fault' = 'cancelled';
	/** Replaced only after aborting the previous clock wait, so no timer survives retirement. */
	let timer: AbortController | undefined;
	const disarm = (): void => {
		timer?.abort();
		timer = undefined;
	};
	const release = (): unknown[] => {
		disarm();
		ctx.signal.removeEventListener('abort', abort);
		return retire(port, message, messageerror);
	};
	const finish = (status: OutcomeType['status'], cause: unknown): void => {
		if (finished) return;
		finished = true;
		const cleanup = release();
		if (cleanup.length > 0) {
			cause = new AggregateError(status === 'complete' ? cleanup : [cause, ...cleanup], 'Stream retirement failed.');
			if (status !== 'unconfirmed') status = 'fault';
		}
		if (!accepted) ready.reject(cause);
		if (!cancelling) {
			if (status === 'complete') controller.close();
			else controller.error(cause);
		}
		credit?.resolve();
		observed.emit(status, chunks, bytes);
		observed.bus.close();
		terminal.resolve(Object.freeze({ status, chunks, bytes, reason: cause }));
	};
	const arm = (): void => {
		disarm();
		const current = timer = new AbortController();
		void ctx.clock.sleep(timeout, current.signal).then(() => {
			if (!current.signal.aborted) finish('unconfirmed', new StreamTimeoutError(cancelling ? reason : undefined));
		}, (error: unknown) => {
			if (!current.signal.aborted) finish('unconfirmed', error);
		});
	};
	const cancel = (cause?: unknown, status: 'cancelled' | 'fault' = 'cancelled'): Promise<OutcomeType> => {
		if (finished || cancelling) return terminal.promise;
		cancelling = true;
		reason = cause;
		desired = status;
		controller.error(cause);
		if (!accepted) ready.reject(cause);
		try {
			port.postMessage({ ...header(id), kind: 'cancel' });
			arm();
		} catch (error) {
			finish('unconfirmed', error);
		}
		return terminal.promise;
	};
	const abort = (): void => {
		void cancel(ctx.signal.reason);
	};
	const messageerror: (event: Event) => void = () => {
		void cancel(new StreamProtocolError('Message could not be decoded.'), 'fault');
	};
	const message: (event: Event) => void = (event) => {
		if (finished) return;
		try {
			const frame = FrameSchema.parse((event as Event & { readonly data: unknown }).data);
			if (frame.id !== id) throw new StreamProtocolError('Stream identity mismatch.');
			if (frame.kind === 'ready' && !accepted && !cancelling) {
				if (
					frame.maximumChunkBytes > policy.maximumChunkBytes || frame.maximumChunks > policy.maximumChunks ||
					frame.maximumBytes > policy.maximumBytes
				) throw new StreamProtocolError('Peer widened stream limits.');
				policy = limits(frame);
				accepted = true;
				disarm();
				ready.resolve();
				observed.emit('ready', chunks, bytes);
			} else if (frame.kind === 'chunk' && accepted && credit !== undefined && frame.sequence === chunks) {
				charge(frame.bytes, chunks, bytes, policy);
				chunks++;
				bytes += frame.bytes.byteLength;
				const waiting = credit;
				credit = undefined;
				if (!cancelling) {
					disarm();
					controller.enqueue(frame.bytes);
				}
				waiting.resolve();
				observed.emit('chunk', chunks, bytes);
			} else if (
				frame.kind === 'end' && frame.sequence === chunks && (accepted || cancelling || frame.status === 'fault')
			) {
				if (frame.status === 'complete' && !cancelling && credit === undefined) {
					throw new StreamProtocolError('Unsolicited EOF.');
				}
				const cause = cancelling
					? reason
					: frame.status === 'complete'
					? undefined
					: new StreamProtocolError('Remote producer ended with ' + frame.status + '.');
				// Cancellation keeps its exact local reason, but cannot hide a remote cleanup fault.
				finish(frame.status === 'fault' ? 'fault' : cancelling ? desired : frame.status, cause);
			} else throw new StreamProtocolError('Unexpected stream frame or sequence.');
		} catch (error) {
			void cancel(error, 'fault');
		}
	};
	// highWaterMark zero keeps demand at the caller: there is no extra chunk
	// requested merely because this stream was constructed.
	const readable = new ReadableStream<Uint8Array<ArrayBuffer>>({
		start(value) {
			controller = value;
		},
		async pull() {
			await ready.promise;
			if (finished || cancelling) return;
			credit = Promise.withResolvers<void>();
			const waiting = credit.promise;
			try {
				port.postMessage({ ...header(id), kind: 'pull', sequence: chunks });
				arm();
			} catch (error) {
				finish('unconfirmed', error);
			}
			await waiting;
		},
		async cancel(cause) {
			await cancel(cause);
		},
	}, { highWaterMark: 0 });
	try {
		port.addEventListener('message', message);
		port.addEventListener('messageerror', messageerror);
		ctx.signal.addEventListener('abort', abort, { once: true });
		port.start();
		port.postMessage({ ...header(id), kind: 'open', ...policy });
		arm();
		if (ctx.signal.aborted) abort();
	} catch (error) {
		finish('unconfirmed', error);
	}
	return Object.freeze({
		readable,
		ready: ready.promise,
		closed: terminal.promise,
		target: observed.target,
		events: observed.bus.events,
		cancel,
		async [Symbol.asyncDispose]() {
			await cancel();
		},
	});
}

/**
 * Serve a lazy byte producer on an explicitly owned dedicated port. A cooperative
 * child Context and the source iterator are joined before the terminal frame.
 * One pending next() is retained; cancellation does not pretend to preempt a
 * hung producer. In that case closed/stop remain pending and the receiver can
 * report unconfirmed and let its Worker owner terminate the host.
 */
export function serve(ctx: Context, port: Port, source: Source, options: LimitsType): Producer {
	context.check(ctx);
	let policy = limits(options);
	const owner = context.child(ctx);
	const observed = observations();
	const terminal = Promise.withResolvers<OutcomeType>();
	let id: string | undefined;
	/** Sent frame count is also the next accepted receive-credit sequence. */
	let chunks = 0;
	/** Sent payload bytes, checked by subtraction before incrementing. */
	let bytes = 0;
	/** Busy includes a queued credit and the outstanding next(); duplicate credit never queues another read. */
	let busy = false, ending = false;
	let status: 'complete' | 'cancelled' | 'fault' = 'complete';
	let reason: unknown;
	/** The loop has one wake continuation; no control-frame queue can grow behind a slow producer. */
	let wake: (() => void) | undefined;
	const stop = (cause?: unknown): Promise<OutcomeType> => {
		if (!ending) {
			ending = true;
			status = 'cancelled';
			reason = cause;
			context.cancel(owner, cause);
			wake?.();
		}
		return terminal.promise;
	};
	const fail = (cause: unknown): void => {
		if (ending) return;
		ending = true;
		status = 'fault';
		reason = cause;
		context.cancel(owner, cause);
		wake?.();
	};
	const abort = (): void => {
		void stop(owner.signal.reason);
	};
	const messageerror: (event: Event) => void = () => fail(new StreamProtocolError('Message could not be decoded.'));
	const message: (event: Event) => void = (event) => {
		if (ending) return;
		try {
			const frame: FrameType = FrameSchema.parse((event as Event & { readonly data: unknown }).data);
			if (frame.kind === 'open' && id === undefined) {
				id = frame.id;
				policy = limits({
					maximumChunkBytes: Math.min(policy.maximumChunkBytes, frame.maximumChunkBytes),
					maximumChunks: Math.min(policy.maximumChunks, frame.maximumChunks),
					maximumBytes: Math.min(policy.maximumBytes, frame.maximumBytes),
				});
				port.postMessage({ ...header(id), kind: 'ready', ...policy });
				observed.emit('ready', chunks, bytes);
			} else if (frame.id !== id) throw new StreamProtocolError('Stream identity mismatch.');
			else if (frame.kind === 'cancel') void stop();
			else if (frame.kind === 'pull' && frame.sequence === chunks && !busy) {
				busy = true;
				wake?.();
			} else throw new StreamProtocolError('Unexpected stream frame or duplicate credit.');
		} catch (error) {
			fail(error);
		}
	};
	const run = async (): Promise<void> => {
		let iterator: AsyncIterator<Uint8Array> | undefined;
		try {
			while (!ending) {
				if (!busy) {
					await new Promise<void>((resolve) => {
						wake = resolve;
						if (busy || ending) resolve();
					});
				}
				wake = undefined;
				if (ending) break;
				iterator ??= source(owner)[Symbol.asyncIterator]();
				if (ending) break;
				const next = await iterator.next();
				if (ending) break;
				if (next.done) {
					ending = true;
					break;
				}
				charge(next.value, chunks, bytes, policy);
				// Never transfer a caller's backing store. Copy exactly the payload, then transfer our owned copy.
				const copy = new Uint8Array(next.value);
				port.postMessage({ ...header(id!), kind: 'chunk', sequence: chunks, bytes: copy }, [copy.buffer]);
				chunks++;
				bytes += next.value.byteLength;
				busy = false;
				observed.emit('chunk', chunks, bytes);
			}
		} catch (error) {
			// A cooperative next() rejection after cancellation is not a new producer fault.
			if (!ending) {
				status = 'fault';
				reason = error;
				ending = true;
			}
		} finally {
			// Primary failure and later cleanup failure both survive in the producer's local receipt.
			try {
				await iterator?.return?.();
			} catch (error) {
				reason = status === 'fault'
					? new AggregateError([reason, error], 'Stream work and iterator cleanup failed.')
					: error;
				status = 'fault';
			}
			try {
				await owner[Symbol.asyncDispose]();
			} catch (error) {
				reason = status === 'fault'
					? new AggregateError([reason, error], 'Stream work and Context cleanup failed.')
					: error;
				status = 'fault';
			}
			owner.signal.removeEventListener('abort', abort);

			try {
				if (id !== undefined) port.postMessage({ ...header(id), kind: 'end', sequence: chunks, status });
			} catch (error) {
				status = 'fault';
				reason = error;
			}
			const cleanup = retire(port, message, messageerror);
			if (cleanup.length > 0) {
				reason = new AggregateError(
					status === 'fault' ? [reason, ...cleanup] : cleanup,
					'Producer port retirement failed.',
				);
				status = 'fault';
			}
			observed.emit(status, chunks, bytes);
			observed.bus.close();
			terminal.resolve(Object.freeze({ status, chunks, bytes, reason }));
		}
	};
	try {
		port.addEventListener('message', message);
		port.addEventListener('messageerror', messageerror);
		owner.signal.addEventListener('abort', abort, { once: true });
		port.start();
		if (owner.signal.aborted) abort();
	} catch (error) {
		fail(error);
	}
	void run();
	return Object.freeze({
		closed: terminal.promise,
		target: observed.target,
		events: observed.bus.events,
		stop,
		async [Symbol.asyncDispose]() {
			await stop();
		},
	});
}
