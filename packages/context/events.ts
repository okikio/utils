/**
 * Observe native or structural event targets for one context lifetime.
 *
 * Each subscription owns one listener. The target remains borrowed, so closing
 * the observation never closes a socket, Worker, or other event producer.
 * Compose the returned Observable with the existing @okikio/observables
 * operators; this module adds context ownership, not another operator system.
 * @module
 */
import { Observable } from '@okikio/observables/observable';

/** Small event target contract for native targets and typed test adapters. */
export interface Source<Value> {
	/** Register this exact listener without transferring ownership of the producer. */
	addEventListener(type: string, listener: (value: Value) => void, options?: boolean | Options): void;
	/** Remove the same listener using its original capture mode. */
	removeEventListener(type: string, listener: (value: Value) => void, options?: boolean | Options): void;
}

/** Standard listener policies; context cancellation is always supplied separately. */
export interface Options {
	/** Use the target's capture phase; defaults to false. */
	readonly capture?: boolean;
	/** Promise not to cancel the native default action when true. */
	readonly passive?: boolean;
	/** Deliver at most one event per subscriber, then complete; enforced even by minimal mocks. */
	readonly once?: boolean;
}

/** Event payload carried by a structural target's ordinary listener. */
export type SourceValue<Target> = Target extends Source<infer Value> ? Value : never;

/**
 * Infer native payloads from the target's onkeydown/onmessage-style properties.
 *
 * The target supplies its own realm types. This avoids forcing the DOM library
 * into Node or Worker consumers, where Window declarations are incorrect or
 * conflict with WebWorker declarations. Targets without such properties retain
 * the payload declared by their structural listener contract. Native DOM error
 * listeners use ErrorEvent rather than the legacy onerror callback's string argument.
 */
export type EventValue<Target, Name extends string> = `on${Name}` extends keyof Target
	? NonNullable<Target[`on${Name}`]> extends (...args: infer Arguments) => unknown
		? Name extends 'error' ? Target extends (
				typeof globalThis[
					Extract<
						keyof typeof globalThis,
						'Window' | 'Document' | 'HTMLElement' | 'SVGElement' | 'MathMLElement'
					>
				] extends infer Constructor
					? Constructor extends { readonly prototype: infer NativeTarget } ? NativeTarget : never
					: never
			) ? typeof globalThis extends { readonly ErrorEvent: { readonly prototype: infer NativeEvent } } ? NativeEvent
				: Arguments[0]
			: Arguments[0]
		: Arguments[0]
	: SourceValue<Target>
	: SourceValue<Target>;
/**
 * Create a cold Observable for one native or structural target.
 *
 * Nothing is attached until subscribe(). A context abort completes the
 * observation; explicit unsubscribe only detaches that subscription. An
 * already-aborted context completes without touching the target. Listener
 * options are snapshotted when this function is called.
 *
 * @example Observe a borrowed target within a screen lifetime
 * ```ts
 * import * as events from '@okikio/context/events';
 * const screen = new AbortController();
 * const target = new EventTarget();
 * const updates = events.from({ signal: screen.signal }, target, 'update');
 * using subscription = updates.subscribe({ next: (event) => console.log(event.type) });
 * target.dispatchEvent(new Event('update'));
 * screen.abort();
 * ```
 */
export function from<Target extends Source<unknown>, Name extends string>(
	ctx: { readonly signal: AbortSignal },
	target: Target,
	type: Name,
	options?: Options,
): Observable<EventValue<Target, Name>>;
/** Observe a structural source's declared payload and release each listener when its context ends. */
export function from<Value>(
	ctx: { readonly signal: AbortSignal },
	target: Source<Value>,
	type: string,
	options: Options = {},
): Observable<Value> {
	const { capture = false, passive, once = false } = options;
	const signal = ctx.signal;
	return new Observable<Value>((observer) => {
		if (signal.aborted) {
			observer.complete();
			return;
		}
		let stopped = false;
		let attached = false;
		// Completion waits for registration to unwind, so a mock cannot retain a
		// listener after a completion callback has already announced its cleanup.
		let registering = false;
		let completionRequested = false;

		/** Detach before notifying completion so reentrant dispatch cannot re-enter a once listener. */
		const detach = (): void => {
			signal.removeEventListener('abort', abort);
			if (!attached) return;
			attached = false;
			target.removeEventListener(type, receive, capture);
		};
		const stop = (): void => {
			stopped = true;
			detach();
		};
		const complete = (): void => {
			completionRequested = true;
			if (registering) return;
			try {
				stop();
			} catch (error) {
				observer.error(error);
				return;
			}
			observer.complete();
		};
		const abort = (): void => {
			if (stopped) return;
			stopped = true;
			complete();
		};
		const receive = (value: Value): void => {
			if (stopped || observer.closed) return;
			if (once) {
				try {
					stop();
				} catch (error) {
					observer.error(error);
					return;
				}
			}
			observer.next(value);
			if (once) complete();
		};

		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
			return;
		}
		try {
			// A structural adapter can emit or abort synchronously while registering.
			// Mark attachment after return, then honor any stop requested during setup.
			registering = true;
			target.addEventListener(type, receive, passive === undefined ? capture : { capture, passive });
		} catch (error) {
			// A failing adapter may have registered before throwing. Try removing that
			// exact listener, while preserving both failures if removal also fails.
			registering = false;
			attached = true;
			try {
				stop();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], 'Event listener setup and cleanup failed.');
			}
			throw error;
		}
		registering = false;
		attached = true;
		if (completionRequested) complete();
		else if (stopped || observer.closed) stop();
		return stop;
	});
}
