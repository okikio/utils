/** Retry one ordinary operation with explicit safety, time, and cancellation. @module */
import type { Temporal } from '@okikio/duration/temporal';
import { SystemClock, wait } from '@okikio/context';
import type { Clock } from '@okikio/context';
import { retry, retryDelay } from './policy.ts';
import type { RetryPolicy } from './types.ts';

/** The caller forwards this borrowed signal into each provider operation. */
export interface Attempt {
	/** One-based attempt number, including the initial call. */
	readonly attempt: number;
	/** Cancels cooperative work and intervening waits; cancellation does not undo prior effects. */
	readonly signal: AbortSignal;
}

/** A failed attempt selected for repetition, before its delay begins. */
export interface RetryNotice {
	/** Exact value rejected by the operation. */
	readonly error: unknown;
	/** Attempt that failed; the next attempt is this value plus one. */
	readonly attempt: number;
	/** Fixed elapsed delay chosen by the retry policy and explicit jitter sample. */
	readonly delay: Temporal.Duration;
}

/** Caller-owned policy for safely repeating one operation. */
export interface AttemptOptions {
	/** Cancellation is checked before and after work, the retry hook, and waits. */
	readonly signal: AbortSignal;
	/** Maximum attempts and delay calculation. The attempt count includes the first call. */
	readonly policy: RetryPolicy;
	/** Return true only when repeating this failed operation is safe. No error is implicitly retryable. */
	readonly isRetryable: (error: unknown, attempt: number) => boolean;
	/** Borrowed clock for waits. Defaults to the system clock; no global clock is replaced. */
	readonly clock?: Clock;
	/** A unit-interval sample source, required when the selected policy enables jitter. */
	readonly jitter?: () => number;
	/** Awaited hook before each retry wait. A hook failure stops execution and is not retried. */
	readonly onRetry?: (notice: RetryNotice) => void | PromiseLike<void>;
}

/**
 * Return one operation's result after explicitly classified transient failures.
 *
 * The operation receives each attempt number and the same borrowed signal.
 * Permanent and exhausted failures retain their exact rejected value. A signal
 * abort wins over a late result and retains its exact reason, including null.
 * Classifier, hook, entropy, and timer failures escape without entering retry
 * classification. The callback must cooperate with cancellation during I/O.
 *
 * Use this for a read or an application-protected idempotent operation. This
 * function supplies no idempotency storage, durable history, or rollback.
 */
export async function attempt<Value>(
	operation: (current: Attempt) => Value | PromiseLike<Value>,
	options: AttemptOptions,
): Promise<Value> {
	if (typeof operation !== 'function' || typeof options.isRetryable !== 'function') {
		throw new TypeError('Retry requires an operation and an explicit failure classifier.');
	}
	const policy = retry(options.policy);
	if (policy.jitter && options.jitter === undefined) throw new TypeError('Retry jitter requires a sample source.');
	const signal = options.signal;
	const clock = options.clock ?? SystemClock;
	for (let number = 1;; number++) {
		signal.throwIfAborted();
		let failure: unknown;
		try {
			const value = await operation({ attempt: number, signal });
			signal.throwIfAborted();
			return value;
		} catch (error) {
			signal.throwIfAborted();
			failure = error;
		}
		if (number >= policy.maximumAttempts || !options.isRetryable(failure, number)) throw failure;
		signal.throwIfAborted();
		const delay = retryDelay(policy, number, { jitter: policy.jitter ? options.jitter!() : undefined });
		await options.onRetry?.({ error: failure, attempt: number, delay });
		signal.throwIfAborted();
		try {
			await wait({ signal, clock }, delay);
		} catch (error) {
			signal.throwIfAborted();
			throw error;
		}
		signal.throwIfAborted();
	}
}
