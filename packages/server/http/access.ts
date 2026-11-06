import type { AccessEventType, Middleware } from './types.ts';

/**
 * Observe request start, response creation and thrown failures.
 * Response timing stops when a Response exists, before its body finishes. Use
 * onComplete() for body outcomes. Observer rejections are contained, but their
 * Promises are awaited; observers must bound their own delivery and redact the
 * supplied request/error before logging.
 */
export function access(
	observe: (event: AccessEventType) => void | Promise<void>,
): Middleware {
	if (typeof observe !== 'function') throw new TypeError('HTTP access observer must be a function.');
	return async (request, next) => {
		const method = request.method.toUpperCase();
		const pathname = new URL(request.url).pathname;
		const started = performance.now();
		await safeObserve(observe, Object.freeze({ kind: 'start', request, method, pathname }));
		try {
			const response = await next(request);
			await safeObserve(
				observe,
				Object.freeze({
					kind: 'response',
					request,
					method,
					pathname,
					durationMs: Math.max(0, performance.now() - started),
					status: response.status,
				}),
			);
			return response;
		} catch (error) {
			await safeObserve(
				observe,
				Object.freeze({
					kind: 'failed',
					request,
					method,
					pathname,
					durationMs: Math.max(0, performance.now() - started),
					error: normalizeError(error),
				}),
			);
			throw error;
		}
	};
}

/** Contain observer rejection while still waiting for its Promise to settle. */
async function safeObserve(
	observe: (event: AccessEventType) => void | Promise<void>,
	event: AccessEventType,
): Promise<void> {
	try {
		await observe(event);
	} catch { /* observer rejection cannot replace the request result */ }
}

/** Preserve Error instances while retaining a thrown non-Error as cause. */
function normalizeError(value: unknown): Error {
	return value instanceof Error ? value : new Error('Non-Error value was thrown.', { cause: value });
}
