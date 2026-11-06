/**
 * Repeat ordinary work under an explicit retry classifier, poll for available
 * work, or describe protection policy for another execution owner.
 *
 * attempt() returns the operation's ordinary result and uses a borrowed signal
 * and clock. poll() owns a continuing local loop. Pure policy constructors and
 * retryDelay() start no work, so a queue or workflow can persist its own waits.
 * The caller supplies operation safety and idempotency; timing alone cannot
 * make a partially completed write safe to repeat.
 *
 * @example
 * ```ts
 * import { attempt, retry } from '@okikio/capability/resilience';
 * let calls = 0;
 * const temporary = new Error('Try again');
 * const value = await attempt(() => {
 *   if (++calls === 1) throw temporary;
 *   return 'ready';
 * }, {
 *   signal: new AbortController().signal,
 *   policy: retry({ maximumAttempts: 2, jitter: false }),
 *   isRetryable: (error) => error === temporary,
 * });
 * console.log(value);
 * ```
 * @module
 */

import type {
	ResilienceDocument,
	ResilienceInput,
	ResilienceOperationSafety,
	ResilienceOwner,
	ResiliencePolicy,
	ResilienceStage,
	ResilienceValidationIssue,
	ResilienceValidationResult,
} from './types.ts';

/** Return which runtime owns the concrete behavior for one policy. */
export function owner(policy: ResiliencePolicy): ResilienceOwner {
	switch (policy.type) {
		case 'timeout':
		case 'body-limit':
			return 'server';
		case 'idempotency':
		case 'rate-limit':
		case 'bulkhead':
		case 'retry':
		case 'circuit-breaker':
			return 'adapter';
	}
}

/**
 * Return when one policy runs in the service request lifecycle.
 *
 * Request policies protect raw request execution. Admission policies run once
 * after validation before application requirements and the handler. Operation
 * policies wrap endpoint execution and can therefore control retry attempts or
 * circuit state.
 */
export function stage(policy: ResiliencePolicy): ResilienceStage {
	switch (policy.type) {
		case 'timeout':
		case 'body-limit':
			return 'request';
		case 'idempotency':
		case 'rate-limit':
		case 'bulkhead':
			return 'admission';
		case 'retry':
		case 'circuit-breaker':
			return 'operation';
	}
}

/** Flatten nested policy inputs while preserving authored order. */
export function compose(...input: readonly ResilienceInput[]): readonly ResiliencePolicy[] {
	const result: ResiliencePolicy[] = [];
	const visit = (value: ResilienceInput): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		result.push(value as ResiliencePolicy);
	};
	for (const value of input) visit(value);
	return Object.freeze(result);
}

/** Validate and normalize a resilience plan. */
export function validate(
	input: ResilienceInput | undefined,
	options: Readonly<{ readonly safety?: ResilienceOperationSafety }> = {},
): ResilienceValidationResult {
	const contributed = input === undefined ? Object.freeze([]) : compose(input);
	const policies: ResiliencePolicy[] = [];
	const issues: ResilienceValidationIssue[] = [];
	const byType = new Map<ResiliencePolicy['type'], ResiliencePolicy>();
	for (const policy of contributed) {
		if (!is(policy)) {
			issues.push({ code: 'invalid-policy', message: 'Resilience input contains an invalid policy.' });
			continue;
		}
		const existing = byType.get(policy.type);
		// Re-importing the exact same immutable policy is harmless. Contribution
		// layers frequently share one exported policy value.
		if (existing === policy) continue;
		if (existing !== undefined) {
			issues.push({
				code: 'conflicting-policy',
				message: `${policy.type} has more than one effective configuration.`,
				policy,
			});
			continue;
		}
		byType.set(policy.type, policy);
		policies.push(policy);
	}
	if (byType.has('retry') && options.safety === 'unsafe' && !byType.has('idempotency')) {
		const retryPolicy = byType.get('retry')!;
		issues.push({
			code: 'unsafe-retry',
			message: 'Unsafe operations may not be retried without an explicit idempotency protocol.',
			policy: retryPolicy,
		});
	}
	return issues.length === 0
		? Object.freeze({ valid: true, policies: Object.freeze(policies) })
		: Object.freeze({ valid: false, issues: Object.freeze(issues) });
}

/** Check only the resilience discriminator and string type; construct trusted policies with the policy builders. */
export function is(value: unknown): value is ResiliencePolicy {
	return typeof value === 'object' && value !== null &&
		(value as { kind?: unknown }).kind === 'resilience' &&
		typeof (value as { type?: unknown }).type === 'string';
}

/** Create deterministic JSON-safe documentation. */
export function document(input: ResilienceInput): readonly ResilienceDocument[] {
	return Object.freeze(
		compose(input).map((policy) =>
			Object.freeze(
				{
					type: policy.type,
					owner: owner(policy),
					stage: stage(policy),
					configuration: Object.freeze(configuration(policy)),
				} satisfies ResilienceDocument,
			)
		),
	);
}

/**
 * Project declared policy settings into JSON-safe documentation. This does not
 * inspect a running adapter or prove that the declared protection is enforced.
 *
 * @internal
 */
function configuration(policy: ResiliencePolicy): Record<string, string | number | boolean | readonly string[]> {
	switch (policy.type) {
		case 'timeout':
			return { duration: policy.duration.toString() };
		case 'idempotency':
			return {
				header: policy.header,
				required: policy.required,
				...(policy.ttl !== undefined ? { ttl: policy.ttl.toString() } : {}),
			};
		case 'retry':
			return {
				maximumAttempts: policy.maximumAttempts,
				initialDelay: policy.initialDelay.toString(),
				maximumDelay: policy.maximumDelay.toString(),
				multiplier: policy.multiplier,
				jitter: policy.jitter,
				...(policy.retryOn !== undefined ? { retryOn: policy.retryOn } : {}),
			};
		case 'circuit-breaker':
			return {
				failureThreshold: policy.failureThreshold,
				resetAfter: policy.resetAfter.toString(),
				halfOpenPermits: policy.halfOpenPermits,
			};
		case 'bulkhead':
			return { concurrency: policy.concurrency, queue: policy.queue };
		case 'rate-limit':
			return {
				limit: policy.limit,
				window: policy.window.toString(),
				...(policy.key !== undefined ? { key: policy.key } : {}),
			};
		case 'body-limit':
			return { bytes: policy.bytes };
	}
}

export type {
	BodyLimitPolicy,
	BulkheadPolicy,
	CircuitBreakerPolicy,
	IdempotencyPolicy,
	RateLimitPolicy,
	ResilienceDocument,
	ResilienceInput,
	ResilienceOperationSafety,
	ResilienceOwner,
	ResiliencePolicy,
	ResilienceStage,
	ResilienceValidationIssue,
	ResilienceValidationResult,
	RetryPolicy,
	TimeoutPolicy,
} from './types.ts';

export { poll } from './poll.ts';
export type { PollOptions } from './poll.ts';

export { attempt } from './attempt.ts';
export type { Attempt, AttemptOptions, RetryNotice } from './attempt.ts';

export { bodyLimit, bulkhead, circuitBreaker, idempotent, rateLimit, retry, retryDelay, timeout } from './policy.ts';

/** A deployment's claim about the concrete owner of one policy type; no runtime is acquired or probed. */
export interface EnforcementType {
	/** Policy variant selected by this claim. */
	readonly type: ResiliencePolicy['type'];
	/** Expected server or adapter boundary, checked against owner(policy). */
	readonly owner: ResilienceOwner;
	/** Public deployment identity, without credentials or live runtime objects. */
	readonly id: string;
}
/** Declaration/owner evidence never proves that an execution passed through the claimed runtime. */
export interface InspectionType {
	/** Existing resilience validation result, including operation safety. */
	readonly valid: boolean;
	/** Redacted stable validation codes; raw policy objects are excluded. */
	readonly issues: readonly ResilienceValidationIssue['code'][];
	/** Bounded one-row-per-policy-type ownership comparison. */
	readonly policies: readonly PolicyInspectionType[];
}

/** Public metadata for one selected policy type, excluding live policy/runtime objects. */
export interface PolicyInspectionType {
	/** Declared resilience behavior. */
	readonly type: ResiliencePolicy['type'];
	/** Request, admission or operation stage selected by existing policy semantics. */
	readonly stage: ResilienceStage;
	/** Boundary that must own the concrete execution. */
	readonly expectedOwner: ResilienceOwner;
	/** Caller-declared public runtime identities. */
	readonly owners: readonly string[];
	/** Matching claims still need actual execution evidence. */
	readonly outcome: 'claimed' | 'missing' | 'conflicting' | 'wrong-owner';
}

/**
 * Compare finite flat declarations with explicit deployment-owner claims, without starting enforcement.
 * Existing validate() owns conflicts and unsafe-retry rules. Missing/competing/wrong-boundary claims
 * remain visible. claimed means matching metadata only; callers still need host integration proof.
 * No new retry loop, policy executor, resource, timer or ambient backend is created.
 */
export function inspect(
	declarations: readonly ResiliencePolicy[],
	enforcement: readonly EnforcementType[],
	options: Readonly<
		{ readonly maximumPolicies: number; readonly maximumOwners: number; readonly safety?: ResilienceOperationSafety }
	>,
): InspectionType {
	if (
		!Number.isSafeInteger(options.maximumPolicies) || options.maximumPolicies < 0 ||
		declarations.length > options.maximumPolicies ||
		!Number.isSafeInteger(options.maximumOwners) || options.maximumOwners < 0 ||
		enforcement.length > options.maximumOwners
	) throw new RangeError('Resilience inspection exceeds its declaration or owner limit.');
	for (const policy of declarations) {
		if (!is(policy)) throw new TypeError('Resilience inspection requires flat valid policy values.');
	}
	const byType = new Map<ResiliencePolicy['type'], EnforcementType[]>();
	for (const entry of enforcement) {
		if (
			!['server', 'adapter'].includes(entry.owner) || typeof entry.id !== 'string' || !entry.id ||
			!['timeout', 'body-limit', 'idempotency', 'rate-limit', 'bulkhead', 'retry', 'circuit-breaker'].includes(
				entry.type,
			)
		) throw new TypeError('Invalid resilience enforcement claim.');
		const group = byType.get(entry.type) ?? [];
		group.push(entry);
		byType.set(entry.type, group);
	}
	const checked = validate(declarations, { safety: options.safety });
	const selected = new Map(declarations.map((policy) => [policy.type, policy]));
	return Object.freeze({
		valid: checked.valid,
		issues: Object.freeze(checked.valid ? [] : checked.issues.map((issue) => issue.code)),
		policies: Object.freeze([...selected.values()].map((policy) => {
			const entries = byType.get(policy.type) ?? [];
			const expectedOwner = owner(policy);
			return Object.freeze({
				type: policy.type,
				stage: stage(policy),
				expectedOwner,
				owners: Object.freeze(entries.map((entry) => entry.id)),
				outcome: entries.length === 0
					? 'missing' as const
					: entries.length > 1
					? 'conflicting' as const
					: entries[0]!.owner !== expectedOwner
					? 'wrong-owner' as const
					: 'claimed' as const,
			});
		})),
	});
}
