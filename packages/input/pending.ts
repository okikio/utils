/** Cancellation of waits for host APIs that cannot cancel their underlying operation. @module */

/**
 * Stop delivery after abort and observe both outcomes of late host settlement.
 * This does not dismiss a native dialog or undo a clipboard write. Callers must
 * check the signal before invoking the host so a pre-aborted request acquires nothing.
 */
export function wait<Value>(pending: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
	if (!signal) return Promise.resolve(pending);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		/** Choose one delivered result; the host Promise still has both outcomes observed after abort. */
		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			action();
		};
		const abort = () => finish(() => reject(signal.reason));
		signal.addEventListener('abort', abort, { once: true });
		Promise.resolve(pending).then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error)),
		);
		if (signal.aborted) abort();
	});
}
