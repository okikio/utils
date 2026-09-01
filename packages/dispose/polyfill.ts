/**
 * Explicit resource-management globals for runtimes that do not provide them yet.
 *
 * Import this side-effect module once from an executable or validation root when
 * the runtime lacks the current ECMAScript disposal globals. Library code can
 * then use `DisposableStack` and `AsyncDisposableStack` directly.
 *
 * @module
 */

const global = globalThis as typeof globalThis & {
	DisposableStack?: typeof DisposableStack;
	AsyncDisposableStack?: typeof AsyncDisposableStack;
	SuppressedError?: typeof SuppressedError;
};

const symbols = Symbol as SymbolConstructor & {
	dispose?: typeof Symbol.dispose;
	asyncDispose?: typeof Symbol.asyncDispose;
};

if (typeof symbols.dispose !== 'symbol') {
	Object.defineProperty(Symbol, 'dispose', {
		value: Symbol('Symbol.dispose'),
		enumerable: false,
		configurable: false,
		writable: false,
	});
}

if (typeof symbols.asyncDispose !== 'symbol') {
	Object.defineProperty(Symbol, 'asyncDispose', {
		value: Symbol('Symbol.asyncDispose'),
		enumerable: false,
		configurable: false,
		writable: false,
	});
}

function install<Name extends 'SuppressedError' | 'DisposableStack' | 'AsyncDisposableStack'>(
	name: Name,
	value: (typeof global)[Name],
): void {
	Object.defineProperty(globalThis, name, {
		value,
		enumerable: false,
		configurable: true,
		writable: true,
	});
}

if (global.SuppressedError === undefined) {
	function SuppressedErrorPolyfill(error: unknown, suppressed: unknown, message = ''): SuppressedError {
		const value = new Error(message) as SuppressedError;
		Object.setPrototypeOf(value, SuppressedErrorPolyfill.prototype);
		value.name = 'SuppressedError';
		value.error = error;
		value.suppressed = suppressed;
		return value;
	}
	SuppressedErrorPolyfill.prototype = Object.create(Error.prototype, {
		constructor: { value: SuppressedErrorPolyfill, configurable: true, writable: true },
	});
	install('SuppressedError', SuppressedErrorPolyfill as SuppressedErrorConstructor);
}

if (global.DisposableStack === undefined) {
	class DisposableStackPolyfill implements DisposableStack {
		#entries: (() => void)[] = [];
		#disposed = false;

		get disposed(): boolean {
			return this.#disposed;
		}

		get [Symbol.toStringTag](): string {
			return 'DisposableStack';
		}

		use<Value extends Disposable | null | undefined>(value: Value): Value {
			this.#assertOpen();
			if (value == null) return value;
			const dispose = value[Symbol.dispose];
			if (typeof dispose !== 'function') throw new TypeError('DisposableStack.use() requires Symbol.dispose.');
			this.#entries.push(() => dispose.call(value));
			return value;
		}

		adopt<Value>(value: Value, onDispose: (value: Value) => void): Value {
			this.#assertOpen();
			if (typeof onDispose !== 'function') throw new TypeError('DisposableStack.adopt() requires a disposer function.');
			this.#entries.push(() => onDispose(value));
			return value;
		}

		defer(onDispose: () => void): void {
			this.#assertOpen();
			if (typeof onDispose !== 'function') throw new TypeError('DisposableStack.defer() requires a disposer function.');
			this.#entries.push(onDispose);
		}

		move(): DisposableStack {
			this.#assertOpen();
			const moved = new DisposableStackPolyfill();
			moved.#entries = this.#entries;
			this.#entries = [];
			this.#disposed = true;
			return moved;
		}

		dispose(): void {
			if (this.#disposed) return;
			this.#disposed = true;
			let error: unknown;
			while (this.#entries.length > 0) {
				const dispose = this.#entries.pop()!;
				try {
					dispose();
				} catch (next) {
					error = error === undefined ? next : new global.SuppressedError!(next, error, 'An error was suppressed during disposal.');
				}
			}
			if (error !== undefined) throw error;
		}

		[Symbol.dispose](): void {
			this.dispose();
		}

		#assertOpen(): void {
			if (this.#disposed) throw new ReferenceError('DisposableStack is already disposed.');
		}
	}
	install('DisposableStack', DisposableStackPolyfill as typeof DisposableStack);
}

if (global.AsyncDisposableStack === undefined) {
	class AsyncDisposableStackPolyfill implements AsyncDisposableStack {
		#entries: (() => void | PromiseLike<void>)[] = [];
		#disposed = false;

		get disposed(): boolean {
			return this.#disposed;
		}


		get [Symbol.toStringTag](): string {
			return 'AsyncDisposableStack';
		}
		use<Value extends Disposable | AsyncDisposable | null | undefined>(value: Value): Value {
			this.#assertOpen();
			if (value == null) return value;
			const asyncDispose = (value as Partial<AsyncDisposable>)[Symbol.asyncDispose];
			if (typeof asyncDispose === 'function') {
				this.#entries.push(() => asyncDispose.call(value));
				return value;
			}
			const dispose = (value as Partial<Disposable>)[Symbol.dispose];
			if (typeof dispose !== 'function') {
				throw new TypeError('AsyncDisposableStack.use() requires Symbol.asyncDispose or Symbol.dispose.');
			}
			this.#entries.push(() => dispose.call(value));
			return value;
		}

		adopt<Value>(value: Value, onDispose: (value: Value) => void | PromiseLike<void>): Value {
			this.#assertOpen();
			if (typeof onDispose !== 'function') throw new TypeError('AsyncDisposableStack.adopt() requires a disposer function.');
			this.#entries.push(() => onDispose(value));
			return value;
		}

		defer(onDispose: () => void | PromiseLike<void>): void {
			this.#assertOpen();
			if (typeof onDispose !== 'function') throw new TypeError('AsyncDisposableStack.defer() requires a disposer function.');
			this.#entries.push(onDispose);
		}

		move(): AsyncDisposableStack {
			this.#assertOpen();
			const moved = new AsyncDisposableStackPolyfill();
			moved.#entries = this.#entries;
			this.#entries = [];
			this.#disposed = true;
			return moved;
		}

		async disposeAsync(): Promise<void> {
			if (this.#disposed) return;
			this.#disposed = true;
			let error: unknown;
			while (this.#entries.length > 0) {
				const dispose = this.#entries.pop()!;
				try {
					await dispose();
				} catch (next) {
					error = error === undefined ? next : new global.SuppressedError!(next, error, 'An error was suppressed during disposal.');
				}
			}
			if (error !== undefined) throw error;
		}

		[Symbol.asyncDispose](): Promise<void> {
			return this.disposeAsync();
		}

		#assertOpen(): void {
			if (this.#disposed) throw new ReferenceError('AsyncDisposableStack is already disposed.');
		}
	}
	install('AsyncDisposableStack', AsyncDisposableStackPolyfill as typeof AsyncDisposableStack);
}

export {};
