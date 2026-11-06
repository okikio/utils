/** Bounded process-local polling with explicit failure classification. @module */

import { delay as wait } from '@okikio/context';
import { retry, retryDelay } from './policy.ts';
import type { RetryPolicy } from './types.ts';

/** Caller-owned cancellation, timing and failure policy for one polling loop. */
export interface PollOptions {
	/** Stop the local loop. Cancellation does not roll back an iteration's effects. */
	readonly signal: AbortSignal;
	/** Return true only for failures that can safely repeat the iteration. */
	readonly isRetryable: (error: unknown) => boolean;
	/** Observe a retry after a failed iteration. Throwing stops the loop. */
	readonly onError?: (error: unknown, attempt: number) => void;
	/** Observe iteration health, including successful empty polls. Throwing stops the loop. */
	readonly onPoll?: (successful: boolean) => void;
	/** Idle interval in milliseconds, from 1 through 60000; evaluated before each idle wait. */
	readonly intervalMs?: number | (() => number);
	/** Consecutive failure budget. Success resets it; the default is 12 attempts, 1s to 30s without jitter. */
	readonly policy?: RetryPolicy;
	/** Supply a unit-interval sample for each jittered retry. Required when policy.jitter is true. */
	readonly jitter?: () => number;
	/** Yield after this many active iterations so timers and cancellation can run. Defaults to 64. */
	readonly yieldEvery?: number;
	/** Borrowed abortable timer, also used for zero-delay fairness yields. Defaults to context.delay. */
	readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Poll work until cancelled or a permanent/exhausted failure escapes.
 *
 * Return true when an iteration did work, or false to wait for the idle interval.
 * Only iteration failures are classified for retry. Observer, configuration and
 * timer failures escape unchanged. Every successful iteration resets the consecutive
 * failure budget. Cancellation during the iteration or a wait ends the loop normally;
 * the iteration must cooperate with the signal to interrupt its own pending I/O.
 *
 * This loop does not persist work, claims or progress. A process crash loses local
 * state. Callers own durable queues and must make partially completed iterations
 * safe to repeat. Inject a timer and jitter source for deterministic tests.
 */
export async function poll(iteration: () => Promise<boolean>, options: PollOptions): Promise<void> {
	const policy = retry(
		options.policy ?? {
			maximumAttempts: 12,
			initialDelay: { seconds: 1 },
			maximumDelay: { seconds: 30 },
			jitter: false,
		},
	);
	if (policy.jitter && options.jitter === undefined) {
		throw new TypeError('Polling retry jitter requires a sample source.');
	}
	const yieldEvery = options.yieldEvery ?? 64;
	if (!Number.isSafeInteger(yieldEvery) || yieldEvery < 1) {
		throw new RangeError('Polling yieldEvery must be a positive safe integer.');
	}
	const interval = (): number => {
		const milliseconds = typeof options.intervalMs === 'function' ? options.intervalMs() : options.intervalMs ?? 1000;
		if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 60000) {
			throw new RangeError('Polling interval must be between 1 and 60000 milliseconds.');
		}
		return milliseconds;
	};
	interval();
	const delay = options.delay ?? wait;
	const pause = async (milliseconds: number): Promise<void> => {
		try {
			await delay(milliseconds, options.signal);
		} catch (error) {
			if (!options.signal.aborted) throw error;
		}
	};
	let failures = 0;
	let activeCount = 0;
	while (!options.signal.aborted) {
		let active: boolean;
		try {
			active = await iteration();
		} catch (error) {
			if (options.signal.aborted) return;
			options.onPoll?.(false);
			if (!options.isRetryable(error) || ++failures >= policy.maximumAttempts) throw error;
			options.onError?.(error, failures);
			if (options.signal.aborted) return;
			await pause(
				retryDelay(policy, failures, { jitter: policy.jitter ? options.jitter!() : undefined }).total('milliseconds'),
			);
			activeCount = 0;
			continue;
		}
		if (options.signal.aborted) return;
		options.onPoll?.(true);
		failures = 0;
		if (!active) {
			activeCount = 0;
			await pause(interval());
		} else if (++activeCount >= yieldEvery) {
			// Resolved Promises alone can monopolize the microtask queue. A timer turn
			// lets host cancellation and other native events run during continuous work.
			activeCount = 0;
			await pause(0);
		}
	}
}
