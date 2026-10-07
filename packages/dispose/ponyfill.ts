/**
 * Own resources through direct imports without installing disposal globals.
 *
 * Call dispose() or await disposeAsync() in finally. The exported protocol keys reuse host
 * symbols or provide local fallback keys. Native using syntax requires host well-known symbols
 * or the explicit polyfill; local keys alone cannot change the language's disposal protocol.
 * @example
 * ```ts
 * import { AsyncDisposableStack } from '@okikio/dispose/ponyfill';
 * const owned = new AsyncDisposableStack();
 * owned.defer(() => console.log('connection closed'));
 * await owned.disposeAsync();
 * ```
 * @module
 */

/** Register synchronous cleanup through a host symbol or a local key without installing a global. */
export const dispose: typeof Symbol.dispose = typeof Symbol.dispose === 'symbol'
	? Symbol.dispose
	: Symbol('Symbol.dispose') as typeof Symbol.dispose;
/** Register asynchronous cleanup through a host symbol or a local key without installing a global. */
export const asyncDispose: typeof Symbol.asyncDispose = typeof Symbol.asyncDispose === 'symbol'
	? Symbol.asyncDispose
	: Symbol('Symbol.asyncDispose') as typeof Symbol.asyncDispose;

/** Preserve both failure values on a real Error, whether called, constructed, or subclassed. */
function Suppressed(error: unknown, suppressed: unknown, message?: string): SuppressedError {
	const value = Reflect.construct(
		Error,
		message === undefined ? [] : [message],
		new.target ?? Suppressed,
	) as SuppressedError;
	Object.defineProperties(value, {
		error: { value: error, configurable: true, writable: true },
		suppressed: { value: suppressed, configurable: true, writable: true },
	});
	return value;
}
Object.setPrototypeOf(Suppressed, Error);
Suppressed.prototype = Object.create(Error.prototype, {
	constructor: { value: Suppressed, configurable: true, writable: true },
	name: { value: 'SuppressedError', configurable: true, writable: true },
	message: { value: '', configurable: true, writable: true },
});
Object.defineProperty(Suppressed, 'name', { value: 'SuppressedError', configurable: true });
Object.defineProperty(Suppressed, 'prototype', { writable: false });
// Capture once: a partial native host retains its error identity throughout local cleanup.
const existingError = globalThis.SuppressedError;
/**
 * Keep the current cleanup failure in error and the previous failure in suppressed.
 * The binding uses the existing native constructor or a local callable constructor, without
 * installing a global. Stacks capture this binding rather than reading a mutable global later.
 */
export const SuppressedError: SuppressedErrorConstructor = typeof existingError === 'function'
	? existingError
	: Suppressed as SuppressedErrorConstructor;

/**
 * Own synchronous resources until one explicit LIFO disposal.
 * Only register owned values. move() transfers pending cleanup and closes the old owner.
 * All cleanup is attempted after failure; a thrown undefined remains a failure.
 */
export class DisposableStack implements globalThis.DisposableStack {
	/** Captured callbacks in acquisition order; popping ends this owner's claim to each resource. */
	#entries: (() => unknown)[] = [];
	/** Close registration before invoking callbacks, so reentrant cleanup cannot acquire new ownership. */
	#disposed = false;
	/** Report whether disposal or ownership transfer has started. */
	get disposed(): boolean {
		return this.#disposed;
	}
	/** Identify the standard stack without exposing its resource list. */
	get [Symbol.toStringTag](): string {
		return 'DisposableStack';
	}
	/** Capture the resource method and receiver now, and return the same value. */
	use<Value extends Disposable | null | undefined>(value: Value): Value {
		this.#assertOpen();
		if (value == null) return value;
		object(value);
		const callback = method(value, dispose);
		if (callback === undefined) throw new TypeError('The resource needs a synchronous disposer.');
		this.#entries.push(() => Reflect.apply(callback, value, []));
		return value;
	}
	/** Own an arbitrary value through a callback receiving that value once. */
	adopt<Value>(value: Value, onDispose: (value: Value) => void): Value {
		this.#assertOpen();
		callable(onDispose);
		this.#entries.push(() => onDispose(value));
		return value;
	}
	/** Register cleanup that needs no value, in reverse disposal order. */
	defer(onDispose: () => void): void {
		this.#assertOpen();
		callable(onDispose);
		this.#entries.push(onDispose);
	}
	/** Transfer pending cleanup into a new base stack without invoking it. */
	move(): DisposableStack {
		this.#assertOpen();
		const moved = new DisposableStack();
		moved.#entries = this.#entries;
		this.#entries = [];
		this.#disposed = true;
		return moved;
	}
	/** Close ownership once and attempt every callback, preserving the complete failure chain. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		let failure: unknown;
		// Separate presence from the value: undefined can be a thrown failure.
		let failed = false;
		while (this.#entries.length > 0) {
			const callback = this.#entries.pop()!;
			try {
				callback();
			} catch (next) {
				failure = failed ? new SuppressedError(next, failure, 'An error was suppressed during disposal.') : next;
				failed = true;
			}
		}
		if (failed) throw failure;
	}
	/** Participate in the imported protocol; the prototype aliases this method to dispose(). */
	[dispose](): void {
		this.dispose();
	}
	/** Reject registration or transfer after the owner's lifetime ends. */
	#assertOpen(): void {
		if (this.#disposed) throw new ReferenceError('The stack is already disposed.');
	}
}

/**
 * Own asynchronous resources and await each cleanup before starting the next one.
 * A callable async method takes precedence. A nullish async method permits a synchronous
 * fallback; a non-callable async method is an error. The fallback's return value is ignored.
 * Use defer() or adopt() when cleanup returns a promise that must be awaited.
 */
export class AsyncDisposableStack implements globalThis.AsyncDisposableStack {
	/** Captured callbacks in acquisition order; the owner awaits each one after removing it. */
	#entries: (() => unknown)[] = [];
	/** Close registration synchronously before the first asynchronous cleanup starts. */
	#disposed = false;
	/** Report whether asynchronous disposal or ownership transfer has started. */
	get disposed(): boolean {
		return this.#disposed;
	}
	/** Identify the asynchronous owner without exposing resources. */
	get [Symbol.toStringTag](): string {
		return 'AsyncDisposableStack';
	}
	/** Capture an owned resource's method and receiver; nullish values retain an await boundary. */
	use<Value extends Disposable | AsyncDisposable | null | undefined>(value: Value): Value {
		this.#assertOpen();
		if (value == null) {
			this.#entries.push(() => undefined);
			return value;
		}
		object(value);
		const asynchronous = method(value, asyncDispose);
		if (asynchronous !== undefined) this.#entries.push(() => Reflect.apply(asynchronous, value, []));
		else {
			const synchronous = method(value, dispose);
			if (synchronous === undefined) throw new TypeError('The resource needs a disposal method.');
			// The standard sync-to-async adapter discards the synchronous method's result.
			this.#entries.push(() => {
				Reflect.apply(synchronous, value, []);
			});
		}
		return value;
	}
	/** Own a value whose cleanup promise must finish before the next callback starts. */
	adopt<Value>(value: Value, onDispose: (value: Value) => void | PromiseLike<void>): Value {
		this.#assertOpen();
		callable(onDispose);
		this.#entries.push(() => onDispose(value));
		return value;
	}
	/** Register cleanup without a value and await any promise it returns. */
	defer(onDispose: () => void | PromiseLike<void>): void {
		this.#assertOpen();
		callable(onDispose);
		this.#entries.push(onDispose);
	}
	/** Move all pending cleanup into a new base stack without starting asynchronous work. */
	move(): AsyncDisposableStack {
		this.#assertOpen();
		const moved = new AsyncDisposableStack();
		moved.#entries = this.#entries;
		this.#entries = [];
		this.#disposed = true;
		return moved;
	}
	/** Close ownership synchronously, then await every LIFO callback and reject on accumulated failure. */
	async disposeAsync(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		let failure: unknown;
		// A rejection with undefined must not be mistaken for successful disposal.
		let failed = false;
		while (this.#entries.length > 0) {
			const callback = this.#entries.pop()!;
			try {
				await callback();
			} catch (next) {
				failure = failed ? new SuppressedError(next, failure, 'An error was suppressed during disposal.') : next;
				failed = true;
			}
		}
		if (failed) throw failure;
	}
	/** Participate in asynchronous protocol disposal; aliases disposeAsync() on the prototype. */
	[asyncDispose](): Promise<void> {
		return this.disposeAsync();
	}
	/** Reject registration and transfer as soon as cleanup or a move starts. */
	#assertOpen(): void {
		if (this.#disposed) throw new ReferenceError('The stack is already disposed.');
	}
}

// Configure only local prototypes; these definitions never write Symbol or globalThis.
Object.defineProperty(DisposableStack.prototype, dispose, {
	value: DisposableStack.prototype.dispose,
	configurable: true,
	writable: true,
});
Object.defineProperty(AsyncDisposableStack.prototype, asyncDispose, {
	value: AsyncDisposableStack.prototype.disposeAsync,
	configurable: true,
	writable: true,
});
for (
	const [prototype, tag] of [[DisposableStack.prototype, 'DisposableStack'], [
		AsyncDisposableStack.prototype,
		'AsyncDisposableStack',
	]] as const
) {
	Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
}

/** Reject primitive resources before reading methods; callable objects are valid resources. */
function object(value: unknown): asserts value is object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('A disposable resource must be an object.');
	}
}
/** Read once, preserving getter failures and the precedence of invalid asynchronous methods. */
function method(value: object, key: symbol): ((...args: never[]) => unknown) | undefined {
	const callback: unknown = Reflect.get(value, key);
	if (callback == null) return undefined;
	callable(callback);
	return callback;
}
/** Validate registration without invoking the callback. */
function callable(value: unknown): asserts value is (...args: never[]) => unknown {
	if (typeof value !== 'function') throw new TypeError('A disposer must be callable.');
}
