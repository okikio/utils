/**
 * Borrow the exclusive read lock of a Web Stream and keep its cleanup result.
 * A reader asks for values; the source owns producing them. Releasing the lock
 * permits another reader, while cancellation asks the source to stop. These can
 * finish at different times, so read cancellation and source cleanup have
 * separate results. This matters when a tee sibling delays underlying cleanup.
 * @module
 */
import { DisposableStack, dispose, SuppressedError } from '@okikio/dispose';

/** Eventual source cleanup is separate from cancellation of the caller's read. */
export type CleanupOutcome =
	| Readonly<{ status: 'completed' | 'cancelled' | 'released' }>
	| Readonly<{ status: 'failed'; error: unknown }>;

/** Ownership policy shared by byte readers, line readers and format parsers. */
export interface ReaderOptions {
	/** Abort interrupts a pending read and releases its lock immediately. */
	readonly signal?: AbortSignal;
	/** Release only, keeping the underlying source available to its owner. Defaults to false. */
	readonly preventCancel?: boolean;
	/** Retain the eventual cleanup result when the enclosing operation cannot return the reader owner. */
	readonly onCleanup?: (completion: Promise<CleanupOutcome>) => void;
}

/** Caller-owned reader; close initiates cleanup synchronously without waiting for the source's cancel hook. */
export interface Reader<Value> extends Disposable {
	/** Resolves after underlying cancellation settles, preserving a late failure as data. Never rejects. */
	readonly cleanup: Promise<CleanupOutcome>;
	/** Read under the selected signal. EOF releases the lock and completes cleanup. */
	read(): Promise<ReadableStreamReadResult<Value>>;
	/** Start cancellation and release the lock before returning the eventual cleanup outcome. */
	close(reason?: unknown): Promise<CleanupOutcome>;
}

/**
 * Acquire one reader after checking cancellation, without consuming a value.
 *
 * close() releases the lock immediately even when a tee sibling keeps source
 * cancellation pending. Await cleanup only when the source owner needs to join
 * that work. The outcome remains available if cancellation later fails. Native
 * backpressure is unchanged; read() requests exactly one source value.
 */
export function open<Value>(source: ReadableStream<Value>, options: ReaderOptions = {}): Reader<Value> {
	options.signal?.throwIfAborted();
	const reader = source.getReader();
	const resources = new DisposableStack();
	resources.defer(() => reader.releaseLock());
	// Late registration cleanup may finish after a reentrant close began. Keep
	// its failure list shared with the already-published cleanup continuation.
	const releaseFailures: unknown[] = [];
	let state: 'open' | 'completed' | 'closed' = 'open';
	let reason: unknown;
	let rejectRead!: (error: unknown) => void;
	let resolveCleanup!: (outcome: CleanupOutcome) => void;
	const interrupted = new Promise<never>((_resolve, reject) => {
		rejectRead = reject;
	});
	// close() is valid before the first read; consume that branch's rejection too.
	void interrupted.catch(() => {});
	const cleanup = new Promise<CleanupOutcome>((resolve) => {
		resolveCleanup = resolve;
	});

	/** Release local ownership independently of the source's asynchronous cancel hook. */
	const release = (): unknown[] => {
		try {
			resources.dispose();
		} catch (error) {
			releaseFailures.push(error);
		}
		return releaseFailures;
	};
	/**
	 * Stop reads and release local resources now, while one shared outcome joins
	 * source cancellation. Cleanup failures stay in that outcome instead of rejecting.
	 */
	const close = (
		cause: unknown = new DOMException('Stream reader was closed.', 'AbortError'),
	): Promise<CleanupOutcome> => {
		if (state !== 'open') return cleanup;
		state = 'closed';
		reason = cause;
		rejectRead(cause);
		let cancellation: Promise<void>;
		try {
			cancellation = options.preventCancel ? Promise.resolve() : reader.cancel(cause);
		} catch (error) {
			cancellation = Promise.reject(error);
		}
		const failures = release();
		void cancellation.then(() => {
			resolveCleanup(
				failures.length === 0
					? Object.freeze({ status: options.preventCancel ? 'released' : 'cancelled' })
					: Object.freeze({ status: 'failed', error: failures[0] }),
			);
		}, (error: unknown) => {
			resolveCleanup(
				Object.freeze({
					status: 'failed',
					error: failures.length === 0
						? error
						: new SuppressedError(failures[0], error, 'Source cancellation and reader release failed.'),
				}),
			);
		});
		return cleanup;
	};
	/** Abort ends local observation immediately; close retains the separate source-cleanup outcome. */
	const abort = (): void => {
		void close(options.signal!.reason);
	};
	try {
		if (options.signal !== undefined) {
			const signal = options.signal;
			// Register removal before acquisition so a host that retains then throws
			// still releases both its listener and the independently owned reader lock.
			let attaching = true;
			let removalPending = false;
			resources.defer(() => {
				if (attaching) removalPending = true;
				else signal.removeEventListener('abort', abort);
			});
			using registration = new DisposableStack();
			registration.defer(() => {
				attaching = false;
				if (!removalPending) return;
				try {
					signal.removeEventListener('abort', abort);
				} catch (error) {
					if (releaseFailures.length === 0) releaseFailures.push(error);
					else {
						releaseFailures[0] = new SuppressedError(
							error,
							releaseFailures[0],
							'Late listener removal and reader release failed.',
						);
					}
					throw error;
				}
			});
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
		}
		options.onCleanup?.(cleanup);
	} catch (error) {
		void close(error);
		throw error;
	}

	/** Check mutable state after awaited reads without assuming asynchronous code cannot close it. */
	const closed = (): boolean => state === 'closed';

	return Object.freeze({
		cleanup,
		async read(): Promise<ReadableStreamReadResult<Value>> {
			if (state === 'completed') return { done: true, value: undefined };
			if (closed()) throw reason;
			try {
				const next = await Promise.race([reader.read(), interrupted]);
				if (closed()) throw reason;
				if (next.done && state === 'open') {
					state = 'completed';
					const failures = release();
					resolveCleanup(
						failures.length === 0
							? Object.freeze({ status: 'completed' })
							: Object.freeze({ status: 'failed', error: failures[0] }),
					);
				}
				return next;
			} catch (error) {
				void close(error);
				throw error;
			}
		},
		close,
		[dispose](): void {
			void close();
		},
	});
}
