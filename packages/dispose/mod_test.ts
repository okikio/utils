import './polyfill.ts';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';

describe('@okikio/dispose', () => {
	it('installs disposal globals without replacing existing well-known symbols', async () => {
		expect(typeof Symbol.dispose).toBe('symbol');
		expect(typeof Symbol.asyncDispose).toBe('symbol');
		expect(typeof DisposableStack).toBe('function');
		expect(typeof AsyncDisposableStack).toBe('function');
		expect(typeof SuppressedError).toBe('function');
	});

	it('disposes synchronous entries in reverse order and suppresses earlier cleanup failures', () => {
		const events: string[] = [];
		const first = new Error('first');
		const second = new Error('second');
		const stack = new DisposableStack();
		stack.defer(() => { events.push('first'); throw first; });
		stack.defer(() => { events.push('second'); throw second; });
		let thrown: unknown;
		try { stack.dispose(); } catch (error) { thrown = error; }
		expect(events).toEqual(['second', 'first']);
		expect(thrown).toBeInstanceOf(SuppressedError);
		if (thrown instanceof SuppressedError) {
			expect(thrown.error).toBe(first);
			expect(thrown.suppressed).toBe(second);
		}
		expect(() => stack.defer(() => {})).toThrow(ReferenceError);
	});

	it('disposes asynchronous entries in reverse registration order', async () => {
		const order: string[] = [];
		const stack = new AsyncDisposableStack();
		stack.defer(() => void order.push('first'));
		stack.defer(async () => void order.push('second'));
		await stack.disposeAsync();
		expect(order).toEqual(['second', 'first']);
	});

	it('awaits asynchronous disposal failures and keeps the later failure as suppressed context', async () => {
		const first = new Error('first-async');
		const second = new Error('second-async');
		const stack = new AsyncDisposableStack();
		stack.defer(async () => { await Promise.resolve(); throw first; });
		stack.defer(async () => { await Promise.resolve(); throw second; });
		let thrown: unknown;
		try { await stack.disposeAsync(); } catch (error) { thrown = error; }
		expect(thrown).toBeInstanceOf(SuppressedError);
		if (thrown instanceof SuppressedError) {
			expect(thrown.error).toBe(first);
			expect(thrown.suppressed).toBe(second);
		}
	});

	it('moves ownership without disposing the moved entries', async () => {
		let disposed = 0;
		const stack = new AsyncDisposableStack();
		stack.defer(() => void disposed++);
		const moved = stack.move();
		await stack.disposeAsync();
		expect(disposed).toBe(0);
		await moved.disposeAsync();
		expect(disposed).toBe(1);
	});
});
