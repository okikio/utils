/** Construct and validate inspectable resilience policies without owning timers, admission, or storage. @module */

import * as durationCore from '@okikio/duration';
import { type Temporal, temporal } from '@okikio/duration/temporal';
import type {
	BodyLimitPolicy,
	BulkheadPolicy,
	CircuitBreakerPolicy,
	IdempotencyPolicy,
	RateLimitPolicy,
	RetryPolicy,
	TimeoutPolicy,
} from './types.ts';

/** Define an absolute request timeout. */
export function timeout(duration: Temporal.Duration | Temporal.DurationLike | string): TimeoutPolicy {
	return Object.freeze({ kind: 'resilience', type: 'timeout', duration: positiveDuration(duration, 'timeout') });
}

/** Define a request idempotency-key protocol. */
export function idempotent(options: Readonly<{
	readonly header?: string;
	readonly required?: boolean;
	readonly maximumKeyBytes?: number;
	readonly ttl?: Temporal.Duration | Temporal.DurationLike | string;
}> = {}): IdempotencyPolicy {
	const header = options.header ?? 'Idempotency-Key';
	const maximumKeyBytes = options.maximumKeyBytes ?? 256;
	assertHeaderName(header);
	assertPositiveInteger(maximumKeyBytes, 'idempotency maximumKeyBytes');
	return Object.freeze({
		kind: 'resilience',
		type: 'idempotency',
		header,
		required: options.required ?? true,
		maximumKeyBytes,
		...(options.ttl !== undefined ? { ttl: positiveDuration(options.ttl, 'idempotency ttl') } : {}),
	});
}

/** Define bounded automatic retry behavior. */
export function retry(options: Readonly<{
	readonly maximumAttempts?: number;
	readonly initialDelay?: Temporal.Duration | Temporal.DurationLike | string;
	readonly maximumDelay?: Temporal.Duration | Temporal.DurationLike | string;
	readonly multiplier?: number;
	readonly jitter?: boolean;
	readonly retryOn?: readonly string[];
}> = {}): RetryPolicy {
	const maximumAttempts = options.maximumAttempts ?? 3;
	const multiplier = options.multiplier ?? 2;
	assertPositiveInteger(maximumAttempts, 'maximumAttempts');
	if (!Number.isFinite(multiplier) || multiplier < 1) throw new TypeError('Retry multiplier must be at least 1.');
	const initialDelay = positiveDuration(options.initialDelay ?? { milliseconds: 100 }, 'initial retry delay');
	const maximumDelay = positiveDuration(options.maximumDelay ?? { seconds: 5 }, 'maximum retry delay');
	if (durationCore.elapsed(maximumDelay) < durationCore.elapsed(initialDelay)) {
		throw new TypeError('Maximum retry delay must not be shorter than the initial retry delay.');
	}
	return Object.freeze({
		kind: 'resilience',
		type: 'retry',
		maximumAttempts,
		initialDelay,
		maximumDelay,
		multiplier,
		jitter: options.jitter ?? true,
		...(options.retryOn !== undefined ? { retryOn: Object.freeze([...options.retryOn]) } : {}),
	});
}

/**
 * Compute the delay after one failed attempt without allocating a timer.
 *
 * Durable queues and schedulers can use the same retry-policy math while they
 * retain ownership of persistence, clocks, cancellation, and wake-up behavior.
 * Jittered policies require an explicit unit-interval sample so replay-sensitive
 * runtimes can provide deterministic entropy instead of inheriting randomness.
 * The maximum is applied again after jitter, so a high sample cannot exceed the
 * caller's final delay budget.
 */
export function retryDelay(
	policy: RetryPolicy,
	failedAttempt: number,
	options: Readonly<{ readonly jitter?: number }> = {},
): Temporal.Duration {
	assertPositiveInteger(failedAttempt, 'failedAttempt');
	const initial = durationCore.elapsed(policy.initialDelay);
	const maximum = durationCore.elapsed(policy.maximumDelay);
	let milliseconds = Math.min(
		maximum,
		initial * Math.pow(policy.multiplier, failedAttempt - 1),
	);
	if (policy.jitter) {
		const jitter = options.jitter;
		if (jitter === undefined || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
			throw new TypeError('Retry jitter sample must be a finite number between 0 and 1.');
		}
		milliseconds *= 0.5 + jitter;
	}
	return temporal.Duration.from({ milliseconds: Math.max(0, Math.floor(Math.min(maximum, milliseconds))) });
}

/** Define a circuit breaker around a provider or resource capability. */
export function circuitBreaker(options: Readonly<{
	readonly failureThreshold?: number;
	readonly resetAfter?: Temporal.Duration | Temporal.DurationLike | string;
	readonly halfOpenPermits?: number;
}> = {}): CircuitBreakerPolicy {
	const failureThreshold = options.failureThreshold ?? 5;
	const halfOpenPermits = options.halfOpenPermits ?? 1;
	assertPositiveInteger(failureThreshold, 'failureThreshold');
	assertPositiveInteger(halfOpenPermits, 'halfOpenPermits');
	return Object.freeze({
		kind: 'resilience',
		type: 'circuit-breaker',
		failureThreshold,
		resetAfter: positiveDuration(options.resetAfter ?? { seconds: 30 }, 'circuit-breaker reset'),
		halfOpenPermits,
	});
}

/** Define bounded concurrent admission and queueing. */
export function bulkhead(
	options: Readonly<{
		readonly concurrency: number;
		readonly queue?: number;
	}>,
): BulkheadPolicy {
	assertPositiveInteger(options.concurrency, 'bulkhead concurrency');
	assertNonNegative(options.queue ?? 0, 'bulkhead queue');
	return Object.freeze({
		kind: 'resilience',
		type: 'bulkhead',
		concurrency: options.concurrency,
		queue: options.queue ?? 0,
	});
}

/** Define request-rate admission. */
export function rateLimit(
	options: Readonly<{
		readonly limit: number;
		readonly window: Temporal.Duration | Temporal.DurationLike | string;
		readonly key?: string;
	}>,
): RateLimitPolicy {
	assertPositiveInteger(options.limit, 'rate limit');
	return Object.freeze({
		kind: 'resilience',
		type: 'rate-limit',
		limit: options.limit,
		window: positiveDuration(options.window, 'rate-limit window'),
		...(options.key !== undefined ? { key: options.key } : {}),
	});
}

/** Define a maximum accepted request-body size. */
export function bodyLimit(bytes: number): BodyLimitPolicy {
	assertPositiveInteger(bytes, 'body limit');
	return Object.freeze({ kind: 'resilience', type: 'body-limit', bytes });
}

/**
 * Validates and normalizes positive duration for the timing rules used by resilience policy normalization.
 *
 * @internal
 */
function positiveDuration(
	value: Temporal.Duration | Temporal.DurationLike | string,
	name: string,
): Temporal.Duration {
	const duration = temporal.Duration.from(value);
	if (!(durationCore.elapsed(duration) > 0)) throw new TypeError(`${name} must be positive.`);
	return duration;
}

/**
 * Require a positive integral count. This constructor does not enforce a safe-integer upper bound.
 *
 * @internal
 */
function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer.`);
}

/**
 * Allow a zero queue while refusing fractional or negative admission counts.
 *
 * @internal
 */
function assertNonNegative(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer.`);
}

/**
 * Accept HTTP token characters only; request lookup remains case-insensitive in the host.
 *
 * @internal
 */
function assertHeaderName(value: string): void {
	if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)) {
		throw new TypeError(`Invalid HTTP header name ${JSON.stringify(value)}.`);
	}
}
