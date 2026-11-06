/** Join cleanup callers without changing standard disposal stack behavior. @module */
import { asyncDispose } from './ponyfill.ts';

/** One cleanup owner whose callers share a stable completion receipt. */
export interface JoinedDisposer extends AsyncDisposable {
	/** Invoke cleanup once and join it on every call, preserving the exact failure. */
	close(): Promise<void>;
}

/**
 * Create a lazy one-time asynchronous disposer. Cleanup starts in a microtask
 * after the first close publishes its promise; reentrant calls therefore see
 * that same receipt. Success and failure are both retained for later callers,
 * including a thrown undefined. No callback runs during construction.
 *
 * The callback must not await its own close receipt: that is a dependency cycle.
 * No timeout or cancellation implies that cleanup stopped. Use run() for an
 * explicit wait deadline and keep this receipt when later joining is necessary.
 * The callback's captured resources are owned by the caller until close begins.
 */
export function once(cleanup: () => void | PromiseLike<void>): JoinedDisposer {
	if (typeof cleanup !== 'function') throw new TypeError('Joined disposal requires a cleanup callback.');
	/** Published before user code runs; undefined means cleanup has never started. */
	let completion: Promise<void> | undefined;
	/** Schedule cleanup after publishing its promise, so reentrant callers join the same result. */
	const close = (): Promise<void> => completion ??= Promise.resolve().then(cleanup);
	return Object.freeze({ close, [asyncDispose]: close });
}
