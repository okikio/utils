import type { AccessEventType, Middleware } from './types.ts';

/** Observe request start, response creation, and failure without selecting a logging implementation. */
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
			await safeObserve(observe, Object.freeze({
				kind: 'response', request, method, pathname,
				durationMs: Math.max(0, performance.now() - started), status: response.status,
			}));
			return response;
		} catch (error) {
			await safeObserve(observe, Object.freeze({
				kind: 'failed', request, method, pathname,
				durationMs: Math.max(0, performance.now() - started), error: normalizeError(error),
			}));
			throw error;
		}
	};
}

/** Prevent observational failures from changing request execution. */
async function safeObserve(
	observe: (event: AccessEventType) => void | Promise<void>,
	event: AccessEventType,
): Promise<void> {
	try { await observe(event); } catch { /* observers do not control request completion */ }
}

/** Preserve Error instances while retaining a thrown non-Error as cause. */
function normalizeError(value: unknown): Error {
	return value instanceof Error ? value : new Error('Non-Error value was thrown.', { cause: value });
}
