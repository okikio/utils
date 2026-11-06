/** Read-only observations whose subscriber failures cannot change the work they describe. @module */
import { Observable } from '@okikio/observables/observable';
import type { Observer, Subscription } from '@okikio/observables/types';

/** Optional diagnostics for subscriber failures. A failing diagnostic is contained too. */
export interface ObserveOptions {
	readonly onError?: (error: unknown) => void | PromiseLike<void>;
}

/**
 * Borrow a source without exposing its writer. Subscriber callbacks keep their
 * receiver, cancellation, and completion semantics. Synchronous exceptions and
 * returned promise rejections go to onError without changing the source outcome.
 * The returned observation never closes the borrowed source.
 */
export function observe<Value>(source: Observable<Value>, options: ObserveOptions = {}): Observable<Value> {
	return new Observation(source, (reason) => {
		try {
			void Promise.resolve(options.onError?.(reason)).catch(() => {});
		} catch { /* Diagnostics cannot own work. */ }
	});
}

/** Leave subscription ownership to Observable while containing user callbacks. */
class Observation<Value> extends Observable<Value> {
	readonly #error: (error: unknown) => void;
	constructor(source: Observable<Value>, error: (error: unknown) => void) {
		super((subscriber) => source.subscribe(subscriber));
		this.#error = error;
	}
	/** Subscribe without exposing source writes. Callback failures go to diagnostics, not back into the work. */
	override subscribe(observer: Observer<Value>, options?: { signal?: AbortSignal }): Subscription;
	override subscribe(
		next: (value: Value) => void,
		error?: (error: unknown) => void,
		complete?: () => void,
		options?: { signal?: AbortSignal },
	): Subscription;
	override subscribe(
		input: Observer<Value> | ((value: Value) => void),
		errorOrOptions?: ((error: unknown) => void) | { signal?: AbortSignal },
		complete?: () => void,
		options?: { signal?: AbortSignal },
	): Subscription {
		const observer = typeof input === 'function'
			? { next: input, error: typeof errorOrOptions === 'function' ? errorOrOptions : undefined, complete }
			: input;
		/** Invoke with the observer receiver intact; observe a returned rejection without delaying source delivery. */
		const call = (action: () => unknown) => {
			try {
				void Promise.resolve(action()).catch(this.#error);
			} catch (error) {
				this.#error(error);
			}
		};
		return super.subscribe({
			start: (subscription) => call(() => observer.start?.(subscription)),
			next: (value) => call(() => observer.next?.(value)),
			error: (reason) => call(() => observer.error === undefined ? this.#error(reason) : observer.error(reason)),
			complete: () => call(() => observer.complete?.()),
		}, typeof input === 'function' ? options : errorOrOptions as { signal?: AbortSignal } | undefined);
	}
}
