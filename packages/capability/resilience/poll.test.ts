import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { poll, retry } from './mod.ts';

const policy = () =>
	retry({ maximumAttempts: 3, initialDelay: { milliseconds: 2 }, maximumDelay: { milliseconds: 8 }, jitter: false });

describe('poll', () => {
	it('resets consecutive failure backoff after successful work and waits only on idle', async () => {
		const controller = new AbortController();
		const delays: number[] = [];
		const health: boolean[] = [];
		let calls = 0;
		await poll(() => {
			calls++;
			if ([1, 2, 4].includes(calls)) return Promise.reject(new Error('transient'));
			if (calls === 6) controller.abort();
			return Promise.resolve(calls !== 5);
		}, {
			signal: controller.signal,
			isRetryable: () => true,
			policy: policy(),
			intervalMs: 7,
			onPoll: (success) => {
				health.push(success);
			},
			delay: (ms) => {
				delays.push(ms);
				return Promise.resolve();
			},
		});
		expect(delays).toEqual([2, 4, 2, 7]);
		expect(health).toEqual([false, false, true, false, true]);
	});
	it('preserves permanent and exhausted failures', async () => {
		const error = new Error('outage');
		for (const retryable of [false, true]) {
			let calls = 0;
			await expect(poll(() => {
				calls++;
				return Promise.reject(error);
			}, {
				signal: new AbortController().signal,
				isRetryable: () => retryable,
				policy: policy(),
				delay: () => Promise.resolve(),
			})).rejects.toBe(error);
			expect(calls).toBe(retryable ? 3 : 1);
		}
	});
	it('does not retry observer or timer failures', async () => {
		const error = new Error('observer');
		let classified = 0;
		await expect(poll(() => Promise.resolve(true), {
			signal: new AbortController().signal,
			isRetryable: () => {
				classified++;
				return true;
			},
			onPoll: () => {
				throw error;
			},
		})).rejects.toBe(error);
		await expect(poll(() => Promise.resolve(false), {
			signal: new AbortController().signal,
			isRetryable: () => {
				classified++;
				return true;
			},
			delay: () => Promise.reject(error),
		})).rejects.toBe(error);
		expect(classified).toBe(0);
	});
	it('yields active work to real timers and cancellation', async () => {
		const controller = new AbortController();
		let calls = 0;
		const timer = setTimeout(() => controller.abort(), 0);
		try {
			await poll(() => {
				if (++calls > 100) throw new Error('Active loop did not yield to the timer.');
				return Promise.resolve(true);
			}, {
				signal: controller.signal,
				isRetryable: () => false,
				yieldEvery: 2,
			});
		} finally {
			clearTimeout(timer);
		}
		expect(calls).toBe(2);
	});
	it('interrupts an idle wait and accepts a pre-cancelled loop', async () => {
		const controller = new AbortController();
		await poll(() => Promise.resolve(false), {
			signal: controller.signal,
			isRetryable: () => false,
			delay: (_ms, signal) => {
				controller.abort();
				return Promise.reject(signal.reason);
			},
		});
		await poll(() => {
			throw new Error('must not run');
		}, {
			signal: controller.signal,
			isRetryable: () => false,
		});
	});
	it('admits timing and entropy policy before work starts', async () => {
		for (
			const [options, error] of [[{ intervalMs: 0 }, RangeError], [{ intervalMs: 60001 }, RangeError], [{
				yieldEvery: 0,
			}, RangeError], [{ policy: retry() }, TypeError]] as const
		) {
			await expect(poll(() => {
				throw new Error('must not run');
			}, {
				signal: new AbortController().signal,
				isRetryable: () => true,
				...options,
			})).rejects.toThrow(error);
		}
	});
});
