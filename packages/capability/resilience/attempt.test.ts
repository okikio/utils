import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import { attempt, retry } from './mod.ts';

/** Advances only when the tested retry asks to sleep; avoids elapsed-wall-time assertions. */
function immediateClock() {
	const logical = new context.TestClock();
	const sleeps: number[] = [];
	const clock: context.Clock = {
		now: () => logical.now(),
		async sleep(milliseconds, signal) {
			signal?.throwIfAborted();
			sleeps.push(milliseconds);
			logical.advance({ milliseconds });
		},
	};
	return { clock, sleeps };
}

describe('ordinary retry attempts', () => {
	it('returns the ordinary value and uses an explicit classifier and clock', async () => {
		const { clock, sleeps } = immediateClock();
		const transient = new Error('Temporary read failure.');
		const notices: unknown[] = [];
		const signal = new AbortController().signal;
		const result = await attempt(({ attempt: number, signal: supplied }) => {
			expect(supplied).toBe(signal);
			if (number < 3) throw transient;
			return 'Ready';
		}, {
			signal,
			clock,
			policy: retry({
				maximumAttempts: 3,
				initialDelay: { milliseconds: 2 },
				maximumDelay: { milliseconds: 10 },
				jitter: false,
			}),
			isRetryable: (error) => error === transient,
			onRetry: ({ error }) => {
				notices.push(error);
			},
		});
		expect(result).toBe('Ready');
		expect(sleeps).toEqual([2, 4]);
		expect(notices).toEqual([transient, transient]);
	});

	it('preserves permanent, exhausted, hook, classifier, and timer failures', async () => {
		for (const selected of ['permanent', 'exhausted', 'hook', 'classifier', 'timer'] as const) {
			const operationError = Object.freeze({ source: 'operation' });
			const infrastructureError = Object.freeze({ source: selected });
			let attempts = 0;
			const { clock } = immediateClock();
			const result = attempt(() => {
				attempts++;
				throw operationError;
			}, {
				signal: new AbortController().signal,
				clock: selected === 'timer' ? { now: clock.now, sleep: () => Promise.reject(infrastructureError) } : clock,
				policy: retry({ maximumAttempts: 2, jitter: false }),
				isRetryable() {
					if (selected === 'classifier') throw infrastructureError;
					return selected !== 'permanent';
				},
				onRetry() {
					if (selected === 'hook') throw infrastructureError;
				},
			});
			await expect(result).rejects.toBe(
				['permanent', 'exhausted'].includes(selected) ? operationError : infrastructureError,
			);
			expect(attempts).toBe(selected === 'exhausted' ? 2 : 1);
		}
	});

	it('honors exact cancellation before work, during the retry delay, and after a late result', async () => {
		const policy = retry({ jitter: false });
		const before = new AbortController();
		before.abort(null);
		let calls = 0;
		await expect(attempt(() => {
			calls++;
			return 1;
		}, { signal: before.signal, policy, isRetryable: () => true })).rejects.toBe(null);
		expect(calls).toBe(0);
		const after = new AbortController();
		await expect(attempt(() => {
			after.abort(null);
			return 1;
		}, { signal: after.signal, policy, isRetryable: () => true })).rejects.toBe(null);
		const waiting = new AbortController();
		const clock = new context.TestClock();
		let release!: () => void;
		const sleeping = new Promise<void>((resolve) => {
			release = resolve;
		});
		const work = attempt(() => {
			throw new Error('Transient');
		}, {
			signal: waiting.signal,
			policy,
			isRetryable: () => true,
			clock: {
				now: () => clock.now(),
				sleep(milliseconds, signal) {
					const promise = clock.sleep(milliseconds, signal);
					release();
					return promise;
				},
			},
		});
		await sleeping;
		waiting.abort(null);
		await expect(work).rejects.toBe(null);
	});

	it('requires explicit jitter entropy and never starts work with an invalid policy', async () => {
		let calls = 0;
		await expect(attempt(() => {
			calls++;
			return 1;
		}, {
			signal: new AbortController().signal,
			policy: retry(),
			isRetryable: () => true,
		})).rejects.toThrow('sample source');
		expect(calls).toBe(0);
	});
});
