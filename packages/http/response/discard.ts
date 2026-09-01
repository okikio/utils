/**
 * Release an HTTP response body that the caller intentionally will not read.
 *
 * Cancellation is best-effort cleanup. A failure while discarding an unused
 * body must not replace the response status, validation error, or other result
 * that caused the caller to abandon the body. If a reader already owns the
 * stream, that reader remains responsible for cancellation and this operation
 * does nothing.
 */
export async function discard(value: Response, reason?: unknown): Promise<void> {
	const body = value.body;
	if (body === null || body.locked) return;
	try {
		await body.cancel(reason);
	} catch {
		// The caller is intentionally abandoning this body; cleanup is secondary.
	}
}
