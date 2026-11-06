import { bytes } from '@okikio/streams/bytes';
import type { CleanupOutcome } from '@okikio/streams/reader';

const cleanups = new WeakMap<Response, Promise<CleanupOutcome>>();

/** Observe eventual source cancellation without replacing the response body operation's primary result. */
export function bodyCleanup(response: Response): Promise<CleanupOutcome> {
	return cleanups.get(response) ?? Promise.resolve({ status: 'completed' });
}

/**
 * Read one HTTP response body without allowing an upstream peer to force unbounded buffering.
 *
 * The declared Content-Length is rejected before reading when it exceeds the limit. The
 * streaming byte count remains authoritative because peers can omit or misstate that header.
 * Cancellation rejects with the caller reason and releases the reader lock. Source cleanup
 * is requested and observed, but a stalled cleanup promise does not delay refusal. The caller
 * must pass a signal to interrupt a stalled read; the byte limit alone is not a deadline.
 */
export async function readBytes(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
	signal?.throwIfAborted();
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
		throw new RangeError('Response body maximumBytes must be a non-negative safe integer.');
	}
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		const bytes = Number(declared);
		if (Number.isFinite(bytes) && bytes > maximumBytes) {
			const error = new RangeError(`HTTP response body exceeds ${maximumBytes} bytes.`);
			if (response.body !== null) {
				try {
					cleanups.set(
						response,
						response.body.cancel(error).then(
							() => ({ status: 'cancelled' as const }),
							(error: unknown) => ({ status: 'failed' as const, error }),
						),
					);
				} catch (error) {
					cleanups.set(response, Promise.resolve({ status: 'failed', error }));
				}
			}
			throw error;
		}
	}
	if (response.body === null) return new Uint8Array();

	return await bytes(response.body, maximumBytes, {
		...(signal === undefined ? {} : { signal }),
		onCleanup: (completion) => {
			cleanups.set(response, completion);
		},
	});
}

/** Decode one bounded HTTP response body as UTF-8 using the same cancellation and byte admission as binary reads. */
export async function readText(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<string> {
	return new TextDecoder().decode(await readBytes(response, maximumBytes, signal));
}
