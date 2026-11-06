/** Cold source construction for Input's optional Observable surface. @module */
import { Observable } from '@okikio/observables/observable';
import type { BindingHandle } from './types.ts';

/**
 * Start one listener lifetime per subscriber. Source abort completes the
 * observation; unsubscribe releases only that subscriber's owned listeners.
 * Observable itself handles a source completing synchronously during setup.
 */
export function from<Value>(
	start: (next: (value: Value) => void, error: (error: unknown) => void) => BindingHandle,
	signal?: AbortSignal,
): Observable<Value> {
	return new Observable<Value>((observer) => {
		if (signal?.aborted) {
			observer.complete();
			return;
		}
		const abort = () => observer.complete();
		signal?.addEventListener('abort', abort, { once: true });
		let stop: BindingHandle | undefined;
		try {
			if (signal?.aborted) {
				observer.complete();
				return;
			}
			stop = start((value) => observer.next(value), (error) => observer.error(error));
		} catch (error) {
			signal?.removeEventListener('abort', abort);
			throw error;
		}
		return () => {
			signal?.removeEventListener('abort', abort);
			stop?.();
		};
	});
}
