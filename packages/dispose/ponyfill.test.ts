/** Assert resource ownership and language disposal contracts through direct imports. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { AsyncDisposableStack, asyncDispose, DisposableStack, dispose, SuppressedError } from './ponyfill.ts';

describe('direct disposal constructors', () => {
	it('captures methods and receivers, moves ownership, and closes exactly once in LIFO order', () => {
		const events: string[] = [];
		const resource = {
			[dispose]() {
				expect(this).toBe(resource);
				events.push('resource');
			},
		};
		const stack = new DisposableStack();
		expect(stack.use(resource)).toBe(resource);
		resource[dispose] = () => {
			throw new Error('A changed method must not replace captured cleanup.');
		};
		const adopted = { value: 1 };
		expect(stack.adopt(adopted, (value) => {
			expect(value).toBe(adopted);
			events.push('adopted');
		})).toBe(adopted);
		stack.defer(() => {
			events.push('deferred');
		});
		const moved = stack.move();
		expect(stack.disposed).toBe(true);
		expect(moved.disposed).toBe(false);
		expect(() => stack.defer(() => {})).toThrow(ReferenceError);
		stack.dispose();
		expect(events).toEqual([]);
		expect(moved[dispose]).toBe(moved.dispose);
		moved.dispose();
		moved.dispose();
		expect(events).toEqual(['deferred', 'adopted', 'resource']);
	});
	it('continues all cleanup and retains a thrown undefined inside the failure chain', () => {
		const stack = new DisposableStack();
		const current = new Error('current');
		let cleaned = false;
		stack.defer(() => {
			cleaned = true;
		});
		stack.defer(() => {
			throw current;
		});
		stack.defer(() => {
			throw undefined;
		});
		let failed = false;
		let failure: unknown;
		try {
			stack.dispose();
		} catch (error) {
			failed = true;
			failure = error;
		}
		expect(failed).toBe(true);
		expect(cleaned).toBe(true);
		expect(failure).toBeInstanceOf(SuppressedError);
		if (failure instanceof SuppressedError) {
			expect(failure.error).toBe(current);
			expect(failure.suppressed).toBeUndefined();
		}
	});
	it('awaits asynchronous cleanup in order and preserves ownership across a move', async () => {
		const events: string[] = [];
		const stack = new AsyncDisposableStack();
		const resource = {
			async [asyncDispose]() {
				expect(this).toBe(resource);
				await Promise.resolve();
				events.push('resource');
			},
		};
		stack.use(resource);
		stack.defer(async () => {
			events.push('start');
			await Promise.resolve();
			events.push('finish');
		});
		const moved = stack.move();
		await stack.disposeAsync();
		expect(events).toEqual([]);
		const closing = moved.disposeAsync();
		expect(moved.disposed).toBe(true);
		expect(() => moved.move()).toThrow(ReferenceError);
		expect(moved[asyncDispose]).toBe(moved.disposeAsync);
		await closing;
		await moved.disposeAsync();
		expect(events).toEqual(['start', 'finish', 'resource']);
	});
	it('rejects an invalid asynchronous method instead of silently falling back', () => {
		const resource = { [asyncDispose]: 1, [dispose]() {} };
		expect(() => new AsyncDisposableStack().use(resource)).toThrow(TypeError);
	});
	it('ignores a synchronous fallback return value while awaiting explicit asynchronous callbacks', async () => {
		let observed = false;
		const returned = {
			then() {
				observed = true;
			},
		};
		const stack = new AsyncDisposableStack();
		stack.use({
			[dispose]() {
				return returned;
			},
		});
		await stack.disposeAsync();
		expect(observed).toBe(false);
	});
	it('treats a sole asynchronous thrown undefined as rejection while attempting earlier cleanup', async () => {
		const stack = new AsyncDisposableStack();
		let cleaned = false;
		stack.defer(() => {
			cleaned = true;
		});
		stack.defer(async () => {
			await Promise.resolve();
			throw undefined;
		});
		let failed = false;
		let failure: unknown;
		try {
			await stack.disposeAsync();
		} catch (error) {
			failed = true;
			failure = error;
		}
		expect(failed).toBe(true);
		expect(failure).toBeUndefined();
		expect(cleaned).toBe(true);
	});
});
