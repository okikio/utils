/** Final outcome of delivering a response body to the host/client. */
export interface ResponseCompletion {
	/** Whether the response body completed, was cancelled or failed. */
	readonly outcome: 'completed' | 'cancelled' | 'errored';
	/** Response-body bytes observed before its terminal outcome. */
	readonly bytes: number;
	/** Cancellation or stream failure reason retained for diagnostics. */
	readonly reason?: unknown;
}

/**
 * Return a response whose body reports EOF, cancellation or read failure.
 *
 * The wrapper owns the original body's reader and forwards chunks without
 * collecting them. Counted bytes reached this wrapper, not necessarily a remote
 * client. The observer is diagnostic: its failure cannot replace the response.
 * It is invoked once, and its returned Promise is not a shutdown receipt.
 */
export function onComplete(
	response: Response,
	observe: (completion: ResponseCompletion) => void | Promise<void>,
): Response {
	if (!(response instanceof Response)) throw new TypeError('Response completion requires a Response.');
	if (typeof observe !== 'function') throw new TypeError('Response completion observer must be a function.');
	let settled = false;
	// EOF, read failure and cancellation race to report one terminal result.
	const notify = (completion: ResponseCompletion): void => {
		if (settled) return;
		settled = true;
		try {
			Promise.resolve(observe(Object.freeze(completion))).catch(() => {
				// Completion observation is diagnostic/cleanup behavior and cannot
				// replace an already produced response.
			});
		} catch {
			// Synchronous observer failures are non-authoritative too.
		}
	};
	if (response.body === null || response.status === 101 || 'webSocket' in response) {
		queueMicrotask(() => notify({ outcome: 'completed', bytes: 0 }));
		return response;
	}
	const reader = response.body.getReader();
	let released = false;
	// Terminal actors submit native release once, even if that release throws.
	const release = (): void => {
		if (released) return;
		released = true;
		reader.releaseLock();
	};
	let bytes = 0;
	const body = new ReadableStream<Uint8Array>({
		/**
		 * Forward one native body chunk and count it only after the read succeeds.
		 * EOF releases the reader before publishing completion. A read failure
		 * retains any release failure alongside the original reason.
		 *
		 * @internal
		 */
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					release();
					controller.close();
					notify({ outcome: 'completed', bytes });
					return;
				}
				bytes += value.byteLength;
				controller.enqueue(value);
			} catch (reason) {
				let failure = reason;
				try {
					release();
				} catch (cleanup) {
					failure = new AggregateError([reason, cleanup], 'Response read and reader release failed.', {
						cause: reason,
					});
				}
				controller.error(failure);
				notify({ outcome: 'errored', bytes, reason: failure });
			}
		},
		/**
		 * Cancel the original body, then release its reader even if cancellation fails.
		 *
		 * @internal
		 */
		async cancel(reason) {
			const failures: unknown[] = [];
			try {
				await reader.cancel(reason);
			} catch (failure) {
				failures.push(failure);
			}
			try {
				release();
			} catch (failure) {
				failures.push(failure);
			}
			notify({ outcome: 'cancelled', bytes, reason });
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) {
				throw new AggregateError(failures, 'Response cancellation and reader release failed.', { cause: failures[0] });
			}
		},
	});
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
