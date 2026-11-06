/** Cooperative event-loop turns; this does not preempt synchronous JavaScript. @module */

/**
 * Give ready host events and other admitted activities an opportunity to run.
 * Call between bounded CPU chunks, with the activity's AbortSignal. This uses a
 * timer turn rather than a resolved-promise microtask and checks cancellation
 * before and after the turn. It retains the activity's attempt and resources;
 * it neither parks durable work nor moves a live stack to another executor.
 * Timer scheduling latency depends on the runtime and load.
 *
 * @example
 * ```ts
 * import * as scheduler from '@okikio/scheduler';
 * for (let offset = 0; offset < values.length; offset += 128) {
 *   consume(values.slice(offset, offset + 128));
 *   await scheduler.yield(signal);
 * }
 * ```
 */
export async function yieldTurn(signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	await new Promise<void>((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', abort);
			resolve();
		}, 0);
		signal?.addEventListener('abort', abort, { once: true });
	});
	signal?.throwIfAborted();
}
