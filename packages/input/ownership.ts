/** One listener lifetime shared by keyboard, touch and pointer bindings. @module */
import { DisposableStack, dispose, SuppressedError } from '@okikio/dispose';
import type { BindingHandle, ListenerOptions, ListenerTarget } from './types.ts';

/** Private listener owner keeps teardown independent of AbortSignal support on a mock target. */
export interface ListenerOwner {
	/** Caller-facing idempotent teardown capability. */
	readonly handle: BindingHandle;
	/** Attach a listener and retain its exact removal identity and capture mode. */
	listen(target: ListenerTarget, type: string, listener: (event: unknown) => void, options?: ListenerOptions): void;
	/** Add operation-local teardown, including sequence timers and pointer capture. */
	defer(cleanup: () => void): void;
}

/** Create a listener owner; an already aborted signal never acquires host listeners. */
export function create(signal?: AbortSignal): ListenerOwner {
	const resources = new DisposableStack();
	const stop = (() => resources.dispose()) as BindingHandle;
	Object.defineProperties(stop, {
		closed: { get: () => resources.disposed },
		[dispose]: { value: stop },
	});
	if (signal?.aborted) stop();
	else if (signal !== undefined) {
		signal.addEventListener('abort', stop, { once: true });
		resources.defer(() => signal.removeEventListener('abort', stop));
		if (signal.aborted) stop();
	}
	return {
		handle: Object.freeze(stop),
		/** Register the exact callback and options needed for later removal, including reentrant mock hosts. */
		listen(target, type, listener, options) {
			if (resources.disposed) return;
			// A small host may call back or abort before addEventListener finishes retaining the listener.
			// Wait for that registration to unwind so cleanup cannot run too early and leave a late listener behind.
			let attaching = true;
			let removalPending = false;
			resources.defer(() => {
				if (attaching) removalPending = true;
				else target.removeEventListener(type, listener, options);
			});
			let failed = false;
			let failure: unknown;
			try {
				target.addEventListener(type, listener, options);
			} catch (error) {
				failed = true;
				failure = error;
			}
			attaching = false;
			if (removalPending) {
				try {
					target.removeEventListener(type, listener, options);
				} catch (cleanup) {
					if (failed) throw new SuppressedError(cleanup, failure, 'Listener registration and cleanup failed.');
					throw cleanup;
				}
			}
			if (failed) throw failure;
		},
		defer(cleanup) {
			if (resources.disposed) cleanup();
			else resources.defer(cleanup);
		},
	};
}

/** Unwind partial acquisition while retaining the operation failure if teardown also fails. */
export function fail(owner: ListenerOwner, error: unknown): never {
	try {
		owner.handle();
	} catch (cleanup) {
		throw new SuppressedError(cleanup, error, 'Input setup and cleanup failed.');
	}
	throw error;
}
