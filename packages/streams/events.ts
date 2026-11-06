/** Native EventTarget observation and explicitly bounded push-to-stream conversion. @module */
import { Observable } from '@okikio/observables/observable';

/** Native listener policy captured when observe() is called, not when a subscription starts. */
export interface EventOptionsType {
	/** Preserve native capture ordering; defaults to false. */
	readonly capture?: boolean;
	/** Preserve native passive behavior, including the host's default when omitted. */
	readonly passive?: boolean;
	/** Deliver one event per subscription, then remove its listener and complete. */
	readonly once?: boolean;
	/** Abort completes observation and removes only this adapter's listeners. */
	readonly signal?: AbortSignal;
}

/**
 * Observe original native events synchronously, with one listener per subscription.
 * The target is borrowed. No event is redispatched, cloned, prevented or stopped.
 * During a synchronous next callback, target/currentTarget, composedPath() and
 * preventDefault() retain native meaning. After dispatch, currentTarget and path
 * may be cleared by the host; capture any needed values in that callback before
 * introducing an asynchronous operator or stream. A generic event type is a
 * caller assertion about that target/name pair, not runtime validation.
 */
export function observe<Value extends Event = Event>(
	target: EventTarget,
	type: string,
	options: EventOptionsType = {},
): Observable<Value> {
	const { capture = false, passive, once = false, signal } = options;
	return new Observable<Value>((observer) => {
		if (signal?.aborted) {
			observer.complete();
			return;
		}
		const abort = (): void => observer.complete();
		const listener = (event: Event): void => {
			// Native once removes before invocation; completion releases the abort listener too.
			observer.next(event as Value);
			if (once) observer.complete();
		};
		signal?.addEventListener('abort', abort, { once: true });
		try {
			target.addEventListener(type, listener, { capture, ...(passive === undefined ? {} : { passive }), once });
		} catch (error) {
			signal?.removeEventListener('abort', abort);
			throw error;
		}
		if (signal?.aborted) observer.complete();
		return () => {
			target.removeEventListener(type, listener, capture);
			signal?.removeEventListener('abort', abort);
		};
	});
}

/** Explicit retention and loss policy for sources that cannot wait for downstream demand. */
export interface QueueOptionsType {
	/** Maximum queued values, a positive safe integer. This counts values, not their heap size. */
	readonly maximumItems: number;
	/** Error without silent loss, retain the old queue, or retain the newest values. */
	readonly overflow: 'error' | 'drop-newest' | 'drop-oldest';
	/** Abort errors the stream with the exact signal reason and unsubscribes. */
	readonly signal?: AbortSignal;
}

/** A push producer outran the explicitly bounded stream queue. */
export class EventOverflowError extends Error {
	/** Configured queue capacity in values. */
	readonly maximumItems: number;
	/** Record the explicit value capacity that rejected the next queued event. */
	constructor(maximumItems: number) {
		super(`Event stream exceeds maximumItems (${maximumItems}).`);
		this.name = 'EventOverflowError';
		this.maximumItems = maximumItems;
	}
}

/**
 * Convert an Observable or EventBus.events into a Web Stream for pipeThrough/pipeTo.
 * Subscribe immediately; cancel, abort, error and normal completion unsubscribe.
 * A hot event source has no upstream backpressure: overflow must error or drop
 * according to explicit policy. No hidden Observable.pull() queue is introduced.
 * Retention is at most maximumItems plus one value handed to an outstanding read.
 * Byte size and native producer allocations remain caller/source responsibilities.
 * Source errors are terminal here; ObservableError values remain ordinary values.
 */
export function readable<Value>(source: Observable<Value>, options: QueueOptionsType): ReadableStream<Value> {
	const { maximumItems, overflow, signal } = options;
	if (!Number.isSafeInteger(maximumItems) || maximumItems < 1) throw new RangeError('Invalid maximumItems.');
	if (!['error', 'drop-newest', 'drop-oldest'].includes(overflow)) throw new TypeError('Invalid overflow policy.');
	/** Ring storage is allocated only as values arrive; a caller's large limit is not an eager allocation. */
	const queue = new Map<number, Value>();
	let head = 0, tail = 0;
	let controller: ReadableStreamDefaultController<Value>;
	let waiting = false, finished = false, completed = false;
	let subscription: ReturnType<Observable<Value>['subscribe']> | undefined;
	const release = (): void => {
		subscription?.unsubscribe();
		signal?.removeEventListener('abort', abort);
	};
	const fail = (error: unknown): void => {
		if (finished) return;
		finished = true;
		queue.clear();
		release();
		controller.error(error);
	};
	const abort = (): void => fail(signal?.reason);
	/** Give at most one value to an outstanding read; EOF waits until retained events are delivered. */
	const drain = (): void => {
		if (finished) return;
		if (waiting && queue.size > 0) {
			const value = queue.get(head)!;
			queue.delete(head);
			head = (head + 1) % maximumItems;
			if (queue.size === 0) head = tail = 0;
			waiting = false;
			controller.enqueue(value);
		}
		if (completed && queue.size === 0) {
			finished = true;
			release();
			controller.close();
		}
	};
	return new ReadableStream<Value>({
		start(value) {
			controller = value;
			if (signal?.aborted) {
				fail(signal.reason);
				return;
			}
			signal?.addEventListener('abort', abort, { once: true });
			subscription = source.subscribe({
				start(value) {
					subscription = value;
				},
				next(value) {
					if (finished || completed) return;
					// A push source cannot wait for demand. Apply the authored loss policy before retaining more.
					if (queue.size === maximumItems) {
						if (overflow === 'error') {
							fail(new EventOverflowError(maximumItems));
							return;
						}
						if (overflow === 'drop-newest') return;
						queue.delete(head);
						head = (head + 1) % maximumItems;
					}
					queue.set(tail, value);
					tail = (tail + 1) % maximumItems;
					drain();
				},
				error: fail,
				complete() {
					completed = true;
					release();
					drain();
				},
			});
			// Synchronous completion/error can precede assignment of the returned subscription.
			if (finished || completed) release();
		},
		pull() {
			waiting = true;
			drain();
		},
		cancel() {
			finished = true;
			queue.clear();
			release();
		},
	}, { highWaterMark: 0 });
}
