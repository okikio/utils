import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { asyncDispose, SuppressedError } from '@okikio/dispose';
import * as context from './mod.ts';

describe('Context cleanup ownership', () => {
	it('releases a partially registered parent listener when construction fails', () => {
		const parent = new AbortController();
		const setupFailure = new Error('registration failed after attachment');
		const add = parent.signal.addEventListener.bind(parent.signal);
		const remove = parent.signal.removeEventListener.bind(parent.signal);
		let attached = 0;
		Object.defineProperties(parent.signal, {
			addEventListener: {
				value: (...args: Parameters<AbortSignal['addEventListener']>) => {
					add(...args);
					attached++;
					throw setupFailure;
				},
			},
			removeEventListener: {
				value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
					remove(...args);
					attached--;
				},
			},
		});
		expect(() => context.create({ id: 'partial-parent', signal: parent.signal })).toThrow(setupFailure);
		expect(attached).toBe(0);
		expect(parent.signal.aborted).toBe(false);
	});

	it('retains setup and cleanup failures when removing a partially registered parent listener also fails', () => {
		const parent = new AbortController();
		const setupFailure = new Error('registration failed');
		const cleanupFailure = new Error('unlink failed');
		const add = parent.signal.addEventListener.bind(parent.signal);
		const remove = parent.signal.removeEventListener.bind(parent.signal);
		Object.defineProperties(parent.signal, {
			addEventListener: {
				value: (...args: Parameters<AbortSignal['addEventListener']>) => {
					add(...args);
					throw setupFailure;
				},
			},
			removeEventListener: {
				value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
					remove(...args);
					throw cleanupFailure;
				},
			},
		});
		let failure: unknown;
		try {
			context.create({ id: 'failed-parent-cleanup', signal: parent.signal });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(SuppressedError);
		if (!(failure instanceof SuppressedError)) throw new Error('Expected both construction failures.');
		expect(failure.error).toBe(cleanupFailure);
		expect(failure.suppressed).toBe(setupFailure);
	});

	it('gives reentrant abort and cleanup observers the same complete disposal promise', async () => {
		const parent = new AbortController();
		const owned = context.create({ id: 'reentrant-close', signal: parent.signal });
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let fromAbort: Promise<void> | undefined;
		let fromCleanup: Promise<void> | undefined;
		let closed = false;
		let calls = 0;
		void owned.closed.then(() => {
			closed = true;
		});
		owned.signal.addEventListener('abort', () => {
			fromAbort = owned[asyncDispose]();
		}, { once: true });
		owned.defer(async () => {
			calls += 1;
			fromCleanup = owned[asyncDispose]();
			started.resolve();
			await release.promise;
		});

		const closing = owned[asyncDispose]();
		try {
			expect(owned.signal.aborted).toBe(true);
			expect(fromAbort).toBe(closing);
			expect(owned[asyncDispose]()).toBe(closing);
			await started.promise;
			expect(fromCleanup).toBe(closing);
			expect(closed).toBe(false);
			expect(parent.signal.aborted).toBe(false);
		} finally {
			release.resolve();
			await closing;
		}
		await owned.closed;
		expect(calls).toBe(1);
		expect(closed).toBe(true);
	});

	it('attempts cleanup and settles closed when a structural parent unlink and a resource both fail', async () => {
		const parent = new AbortController();
		const unlinkFailure = new Error('parent unlink failed');
		const cleanupFailure = new Error('resource cleanup failed');
		const owned = context.create({ id: 'fallible-parent', signal: parent.signal });
		const remove = parent.signal.removeEventListener.bind(parent.signal);
		Object.defineProperty(parent.signal, 'removeEventListener', {
			configurable: true,
			value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
				remove(...args);
				throw unlinkFailure;
			},
		});
		owned.defer(() => {
			throw cleanupFailure;
		});

		const closing = owned[asyncDispose]();
		const failure = await closing.catch((error: unknown) => error);
		await owned.closed;
		expect(owned.signal.aborted).toBe(true);
		expect(parent.signal.aborted).toBe(false);
		expect(failure).toBeInstanceOf(SuppressedError);
		if (!(failure instanceof SuppressedError)) throw new Error('Expected both cleanup failures.');
		expect(failure.error).toBe(cleanupFailure);
		expect(failure.suppressed).toBe(unlinkFailure);
		expect(owned[asyncDispose]()).toBe(closing);
	});
});

describe('Context gate cleanup', () => {
	it('waits for synchronous registration to return its cleanup before reporting success', async () => {
		const cleanupFailure = new Error('unsubscribe failed');
		const signal = new AbortController().signal;
		const waiting = context.waitFor({ signal }, (resume) => {
			resume();
			return () => {
				throw cleanupFailure;
			};
		});
		await expect(waiting).rejects.toBe(cleanupFailure);
	});

	it('rejects after cleanup failure instead of throwing through the resume callback and leaving a pending Promise', async () => {
		const cleanupFailure = new Error('unsubscribe failed');
		let resume!: () => void;
		const waiting = context.waitFor({ signal: new AbortController().signal }, (callback) => {
			resume = callback;
			return () => {
				throw cleanupFailure;
			};
		});
		expect(() => resume()).not.toThrow();
		await expect(waiting).rejects.toBe(cleanupFailure);
	});

	it('retains cancellation together with failed gate cleanup and ignores later resume calls', async () => {
		const parent = new AbortController();
		const cleanupFailure = new Error('unsubscribe failed');
		let resume!: () => void;
		let cleanups = 0;
		const waiting = context.waitFor({ signal: parent.signal }, (callback) => {
			resume = callback;
			return () => {
				cleanups += 1;
				throw cleanupFailure;
			};
		});
		parent.abort('request stopped');
		const failure = await waiting.catch((error: unknown) => error);
		resume();
		expect(failure).toBeInstanceOf(SuppressedError);
		if (!(failure instanceof SuppressedError)) throw new Error('Expected cancellation and cleanup failures.');
		expect(failure.error).toBe(cleanupFailure);
		expect(failure.suppressed).toBeInstanceOf(context.ContextCancelledError);
		expect((failure.suppressed as context.ContextCancelledError).reason).toBe('request stopped');
		expect(cleanups).toBe(1);
	});

	it('reports a registration failure that happens after an immediate resume', async () => {
		const failure = new Error('registration failed');
		await expect(context.waitFor({ signal: new AbortController().signal }, (resume) => {
			resume();
			throw failure;
		})).rejects.toBe(failure);
	});
});
