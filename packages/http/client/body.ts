/**
 * Transfer a byte stream and its operation cleanup to the response consumer.
 *
 * The returned stream reads at most one chunk ahead. End of stream, a producer
 * error, consumer cancellation or the supplied signal starts cleanup once.
 * An aborted signal reports its reason immediately, even if cleanup is pending.
 * Cleanup errors do not replace the body result or cancellation reason.
 *
 * The caller transfers the body and must not read it separately. This function
 * acquires its reader, cancels that reader and releases its lock at completion.
 * The caller retains control of the signal. This function does not start a timer.
 *
 * @param body - Unlocked upstream byte stream whose reader ownership is transferred.
 * @param signal - Caller cancellation or an operation's total deadline signal.
 * @param dispose - Release the producing operation. Called once with the failure
 * or cancellation reason, or without a reason at end of stream. Disposal starts
 * before reader cancellation; reader release does not wait for disposal to finish.
 */
export function ownBody(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
	dispose: (reason?: unknown) => void | PromiseLike<void>,
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	/** A terminal result prevents a late read from publishing more bytes. */
	let ended = false;
	/** Native consumer cancellation closes its controller while operation cleanup may still be pending. */
	let cancelled = false;
	/** Reuse the same cleanup promise when more than one terminal path runs. */
	let closing: Promise<void> | undefined;
	let controller: ReadableStreamDefaultController<Uint8Array>;
	/** Start operation disposal, then release the reader before awaiting disposal. */
	function finish(reason?: unknown): Promise<void> {
		if (closing) return closing;
		signal.removeEventListener('abort', aborted);
		return closing ??= (async () => {
			let cleanup: Promise<void> = Promise.resolve();
			try {
				cleanup = Promise.resolve(dispose(reason)).catch(() => {});
			} catch { /* Preserve the primary result. */ }
			// Disposal can await producer shutdown. Start it before cancelling the
			// reader, then release the reader independently of that pending cleanup.
			try {
				await reader.cancel(reason);
			} catch {
				/* Keep the primary upstream error. */
			} finally {
				reader.releaseLock();
			}
			await cleanup;
		})();
	}
	/** Report cancellation without waiting for producer shutdown. */
	function aborted(): void {
		if (ended) return;
		ended = true;
		const reason = signal.reason;
		controller.error(reason);
		void finish(reason);
	}
	return new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
			signal.addEventListener('abort', aborted, { once: true });
			if (signal.aborted) aborted();
		},
		async pull(value) {
			try {
				signal.throwIfAborted();
				const next = await reader.read();
				if (ended) return;
				if (next.done) {
					ended = true;
					await finish();
					if (!cancelled) value.close();
				} else value.enqueue(next.value);
			} catch (error) {
				if (!ended) {
					ended = true;
					await finish(error);
					if (!cancelled) value.error(error);
				}
			}
		},
		async cancel(reason) {
			cancelled = true;
			ended = true;
			await finish(reason ?? new DOMException('Response consumption was cancelled.', 'AbortError'));
		},
	}, { highWaterMark: 1 });
}
