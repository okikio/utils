import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { SuppressedError } from '@okikio/dispose';
import { open } from './reader.ts';

describe('reader cleanup ownership', () => {
	it('removes a listener retained after signal registration reenters close', async () => {
		const controller = new AbortController();
		const signal = controller.signal;
		const add = signal.addEventListener;
		const remove = signal.removeEventListener;
		const retained = new Set<unknown>();
		signal.addEventListener = function (...args: Parameters<typeof add>) {
			controller.abort('during registration');
			if (typeof args[1] === 'function') args[1].call(this, new Event('abort'));
			add.apply(this, args);
			retained.add(args[1]);
		};
		signal.removeEventListener = function (...args: Parameters<typeof remove>) {
			remove.apply(this, args);
			retained.delete(args[1]);
		};
		const source = new ReadableStream<number>();
		const reader = open(source, { signal, preventCancel: true });
		expect(retained.size).toBe(0);
		expect(source.locked).toBe(false);
		expect(await reader.cleanup).toEqual({ status: 'released' });
		await expect(reader.read()).rejects.toBe('during registration');
	});
	it('releases the reader if signal registration retains a listener and then throws', () => {
		const controller = new AbortController();
		const signal = controller.signal;
		const add = signal.addEventListener;
		const remove = signal.removeEventListener;
		const failure = new Error('signal registration failed');
		let retained = 0;
		signal.addEventListener = function (...args: Parameters<typeof add>) {
			add.apply(this, args);
			retained++;
			throw failure;
		};
		signal.removeEventListener = function (...args: Parameters<typeof remove>) {
			remove.apply(this, args);
			retained--;
		};
		const source = new ReadableStream<number>();
		expect(() => open(source, { signal, preventCancel: true })).toThrow(failure);
		expect(source.locked).toBe(false);
		expect(retained).toBe(0);
	});

	it('releases the lock even when listener removal fails and retains a late cancellation failure', async () => {
		const controller = new AbortController();
		const signal = controller.signal;
		const remove = signal.removeEventListener;
		const failure = new Error('listener removal failed');
		signal.removeEventListener = function (...args: Parameters<typeof remove>) {
			remove.apply(this, args);
			throw failure;
		};
		const source = new ReadableStream<number>({
			cancel() {
				throw undefined;
			},
		});
		const reader = open(source, { signal });
		const pending = reader.close();
		expect(source.locked).toBe(false);
		const outcome = await pending;
		expect(outcome.status).toBe('failed');
		if (outcome.status === 'failed') {
			expect(outcome.error).toBeInstanceOf(SuppressedError);
			expect((outcome.error as SuppressedError).error).toBe(failure);
			expect((outcome.error as SuppressedError).suppressed).toBe(undefined);
		}
		expect(reader.close()).toBe(pending);
	});
	it('releases immediately while cancellation is pending and preserves a late failure', async () => {
		let reject!: (error: unknown) => void;
		const source = new ReadableStream<Uint8Array>({
			cancel() {
				return new Promise<void>((_resolve, no) => {
					reject = no;
				});
			},
		});
		const reader = open(source);
		const pending = reader.read().catch((error: unknown) => error);
		const reason = new Error('caller stopped');
		const cleanup = reader.close(reason);
		expect(source.locked).toBe(false);
		expect(await pending).toBe(reason);
		const failure = new Error('late source cleanup');
		reject(failure);
		expect(await cleanup).toEqual({ status: 'failed', error: failure });
		expect(reader.close()).toBe(cleanup);
	});

	it('aborts a stalled read and retains eventual cleanup independently', async () => {
		const controller = new AbortController();
		let complete!: () => void;
		const source = new ReadableStream<number>({
			cancel() {
				return new Promise<void>((resolve) => {
					complete = resolve;
				});
			},
		});
		const reader = open(source, { signal: controller.signal });
		const pending = reader.read().catch((error: unknown) => error);
		controller.abort('stopped');
		expect(await pending).toBe('stopped');
		expect(source.locked).toBe(false);
		complete();
		expect(await reader.cleanup).toEqual({ status: 'cancelled' });
	});

	it('does not acquire an already aborted source and honors explicit borrowed ownership', async () => {
		let cancels = 0;
		const source = new ReadableStream<number>({
			cancel() {
				cancels++;
			},
		});
		expect(() => open(source, { signal: AbortSignal.abort(new Error('pre-aborted')) })).toThrow();
		expect(source.locked).toBe(false);
		const reader = open(source, { preventCancel: true });
		expect(await reader.close()).toEqual({ status: 'released' });
		expect(cancels).toBe(0);
		expect(source.locked).toBe(false);
		await source.cancel();
	});

	it('completes at EOF without calling cancel and publishes the same cleanup promise', async () => {
		let cancels = 0, observed: unknown;
		const source = new ReadableStream<number>({
			start(controller) {
				controller.close();
			},
			cancel() {
				cancels++;
			},
		});
		const reader = open(source, {
			onCleanup: (cleanup) => {
				observed = cleanup;
			},
		});
		expect(observed).toBe(reader.cleanup);
		expect((await reader.read()).done).toBe(true);
		expect(await reader.cleanup).toEqual({ status: 'completed' });
		expect(source.locked).toBe(false);
		expect(cancels).toBe(0);
	});
});
