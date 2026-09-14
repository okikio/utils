import { retry as retryAsync, RetryError } from '@std/async/retry';
import * as durationCore from '@okikio/duration';
import type { EmptyEndpointHost } from '@okikio/server/endpoint/types';
import type { RetryPolicy, ResiliencePolicy } from '@okikio/resilience';
import * as fault from '@okikio/fault';

import type {
	ServiceRequestValues,
	ServiceRequestState,
	ServiceResilienceAdapter,
	ServiceStageResult,
} from './types.ts';

/**
 * Error wrapper used when a caller deliberately classifies an operation failure
 * as safe to retry.
 *
 * Ordinary errors are not retried by default. A provider adapter may either
 * throw this wrapper or supply an explicit classifier to {@link retry}.
 */
export class RetryableOperationError extends Error {
	readonly code?: string;

	constructor(cause: Error, options: Readonly<{ readonly code?: string; readonly message?: string }> = {}) {
		super(options.message ?? fault.message(cause), { cause });
		this.name = 'RetryableOperationError';
		if (options.code !== undefined) this.code = options.code;
	}
}

/** Configuration for the standard-library-backed retry runtime. */
export interface ServiceRetryOptions<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
> {
	/**
	 * Override retry classification for provider/domain-specific errors.
	 * Returning `true` asserts that replaying the wrapped operation is safe.
	 */
	readonly isRetriable?: (
		error: Error,
		policy: RetryPolicy,
		state: ServiceRequestState<Host, Values>,
	) => boolean;
}

/**
 * Create a service resilience adapter backed by `@std/async/retry`.
 *
 * This adapter supports only `retry` policies. Compose it with a durable
 * idempotency, rate-limit, circuit-breaker, or bulkhead adapter through
 * {@link resilience} when an operation declares several policies.
 */
export function retry<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
>(options: ServiceRetryOptions<Host, Values> = {}): ServiceResilienceAdapter<Host, Values> {
	return Object.freeze({
		/**
		 * Return whether this adapter owns the declared policy.
		 *
		 * @internal
		 */
		supports(policy: ResiliencePolicy): boolean {
			return policy.type === 'retry';
		},

		/**
		 * Run one retry-controlled operation phase.
		 *
		 * @internal
		 */
		async run(
			policies: readonly ResiliencePolicy[],
			state: ServiceRequestState<Host, Values>,
			next: () => Promise<ServiceStageResult>,
		): Promise<ServiceStageResult> {
			const policy = exactlyOneRetry(policies);
			try {
				return await retryAsync(next, {
					maxAttempts: policy.maximumAttempts,
					minTimeout: durationCore.milliseconds(policy.initialDelay),
					maxTimeout: durationCore.milliseconds(policy.maximumDelay),
					multiplier: policy.multiplier,
					jitter: policy.jitter ? 1 : 0,
					signal: state.ctx.signal,
					isRetriable: (reason: unknown) => {
						const error = normalizeError(reason);
						return options.isRetriable?.(error, policy, state) ?? defaultRetryDecision(error, policy);
					},
				});
			} catch (reason) {
				if (reason instanceof RetryError) throw normalizeError(reason.cause);
				throw normalizeError(reason);
			}
		},
	});
}

/**
 * Compose focused resilience adapters into one deterministic onion.
 *
 * Every adapter-owned policy must be owned by exactly one adapter. Adapters execute
 * in the order of the first policy they own. After-work unwinds in reverse
 * order, matching middleware and resource-lifecycle expectations.
 */
export function resilience<
	Host extends object = EmptyEndpointHost,
	Values extends ServiceRequestValues = ServiceRequestValues,
>(
	...adapters: readonly ServiceResilienceAdapter<Host, Values>[]
): ServiceResilienceAdapter<Host, Values> {
	return Object.freeze({
		/**
		 * Return whether this adapter owns the declared policy.
		 *
		 * @internal
		 */
		supports(policy: ResiliencePolicy): boolean {
			return matchingAdapters(policy, adapters).length === 1;
		},

		/**
		 * Run the supplied stage through the adapters that own its policies.
		 *
		 * @internal
		 */
		async run(
			policies: readonly ResiliencePolicy[],
			state: ServiceRequestState<Host, Values>,
			next: () => Promise<ServiceStageResult>,
		): Promise<ServiceStageResult> {
			const plans: Array<Readonly<{
				readonly adapter: ServiceResilienceAdapter<Host, Values>;
				readonly policies: ResiliencePolicy[];
			}>> = [];
			const byAdapter = new Map<ServiceResilienceAdapter<Host, Values>, ResiliencePolicy[]>();

			for (const policy of policies) {
				const matched = matchingAdapters(policy, adapters);
				if (matched.length !== 1) {
					throw new TypeError(
						matched.length === 0
							? `No resilience adapter supports ${policy.type}.`
							: `More than one resilience adapter claims ${policy.type}.`,
					);
				}
				const adapter = matched[0]!;
				let owned = byAdapter.get(adapter);
				if (owned === undefined) {
					owned = [];
					byAdapter.set(adapter, owned);
					plans.push(Object.freeze({ adapter, policies: owned }));
				}
				owned.push(policy);
			}

			let invoke = next;
			for (let index = plans.length - 1; index >= 0; index -= 1) {
				const plan = plans[index]!;
				const inner = invoke;
				invoke = async () => await plan.adapter.run(Object.freeze([...plan.policies]), state, inner);
			}
			return await invoke();
		},
	});
}

/**
 * Collect the adapters that claim one policy so composition can reject missing or ambiguous ownership.
 *
 * @internal
 */
function matchingAdapters<Host extends object, Values extends ServiceRequestValues>(
	policy: ResiliencePolicy,
	adapters: readonly ServiceResilienceAdapter<Host, Values>[],
): readonly ServiceResilienceAdapter<Host, Values>[] {
	return adapters.filter((adapter) => adapter.supports(policy));
}

/**
 * Require one retry policy when the retry adapter must receive an unambiguous configuration.
 *
 * @internal
 */
function exactlyOneRetry(policies: readonly ResiliencePolicy[]): RetryPolicy {
	if (policies.length !== 1 || policies[0]?.type !== 'retry') {
		throw new TypeError('The standard retry adapter requires exactly one retry policy.');
	}
	return policies[0];
}

/**
 * Create the fallback retry decision when no application classifier accepts the failure.
 *
 * @internal
 */
function defaultRetryDecision(error: Error, policy: RetryPolicy): boolean {
	if (!(error instanceof RetryableOperationError)) return false;
	return policy.retryOn === undefined || (error.code !== undefined && policy.retryOn.includes(error.code));
}


/**
 * Normalizes error into the canonical internal form used by later phases.
 *
 * @internal
 */
function normalizeError(reason: unknown): Error {
	return reason instanceof Error ? reason : new Error(fault.message(reason), { cause: reason });
}
