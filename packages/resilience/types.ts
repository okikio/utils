/** HTTP method safety class used when validating retry policy. */
export type ResilienceOperationSafety = 'safe' | 'idempotent' | 'unsafe';

/** Absolute request timeout policy. */
export interface TimeoutPolicy {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'resilience';
	/** Protocol or representation variant selected by this value. */
	readonly type: 'timeout';
	/** Lease or operation duration interpreted with the owning clock. */
	readonly duration: Temporal.Duration;
}

/** Request idempotency protocol. */
export interface IdempotencyPolicy {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'resilience';
	/** Protocol or representation variant selected by this value. */
	readonly type: 'idempotency';
	/** HTTP header used to carry the caller-controlled idempotency key. */
	readonly header: string;
	/** Whether the runtime must reject a request that omits the configured idempotency header. */
	readonly required: boolean;
	/** Maximum UTF-8 bytes accepted for a caller-controlled idempotency key. */
	readonly maximumKeyBytes: number;
	/** Optional lifetime selected by the caller. */
	readonly ttl?: Temporal.Duration;
}

/** Bounded automatic retry policy. */
export interface RetryPolicy {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'resilience';
	/** Protocol or representation variant selected by this value. */
	readonly type: 'retry';
	/** Total attempt budget, including the initial attempt. */
	readonly maximumAttempts: number;
	/** Initial retry delay before growth, jitter and maximum bounds are applied. */
	readonly initialDelay: Temporal.Duration;
	/** Upper bound for the retry delay after applying the selected policy. */
	readonly maximumDelay: Temporal.Duration;
	/** Growth factor applied to retry delays before the maximum delay bound. */
	readonly multiplier: number;
	/** Randomized delay policy; tests can provide deterministic randomness. */
	readonly jitter: boolean;
	/** Optional stable failure codes that the runtime may retry; this list is not a callback. */
	readonly retryOn?: readonly string[];
}

/** Circuit-breaker policy around a provider/resource capability. */
export interface CircuitBreakerPolicy {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'resilience';
	/** Protocol or representation variant selected by this value. */
	readonly type: 'circuit-breaker';
	/** Failure count that opens the circuit under this policy. */
	readonly failureThreshold: number;
	/** Time before an open circuit admits a half-open trial. */
	readonly resetAfter: Temporal.Duration;
	/** Maximum trial calls admitted while the circuit is half-open. */
	readonly halfOpenPermits: number;
}

/** Concurrency-admission policy. */
export interface BulkheadPolicy {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'resilience';
	/** Protocol or representation variant selected by this value. */
	readonly type: 'bulkhead';
	/** Maximum concurrent operations admitted by the bulkhead owner. */
	readonly concurrency: number;
	/** Maximum operations that may wait when bulkhead concurrency is exhausted. */
	readonly queue: number;
}

/** Request-rate admission policy. */
export interface RateLimitPolicy {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'resilience';
	/** Protocol or representation variant selected by this value. */
	readonly type: 'rate-limit';
	/** Explicit caller-selected upper bound for this operation. */
	readonly limit: number;
	/** Rate-limit accounting interval enforced by the designated runtime adapter. */
	readonly window: Temporal.Duration;
	/** Stable lookup or correlation key within the owning contract. */
	readonly key?: string;
}

/** Maximum accepted request-body size. */
export interface BodyLimitPolicy {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'resilience';
	/** Protocol or representation variant selected by this value. */
	readonly type: 'body-limit';
	/** Maximum request-body size in bytes. */
	readonly bytes: number;
}

/** Runtime owner responsible for executing one resilience policy. */
export type ResilienceOwner = 'server' | 'adapter';

/** Request lifecycle stage where one resilience policy takes effect. */
export type ResilienceStage = 'request' | 'admission' | 'operation';

/** Any static resiliency policy. */
export type ResiliencePolicy =
	| TimeoutPolicy
	| IdempotencyPolicy
	| RetryPolicy
	| CircuitBreakerPolicy
	| BulkheadPolicy
	| RateLimitPolicy
	| BodyLimitPolicy;

/** Recursive authoring input accepted by resiliency fields. */
export type ResilienceInput = ResiliencePolicy | readonly ResilienceInput[];

/** Deterministic validation issue. */
export interface ResilienceValidationIssue {
	/** Stable machine-readable reason that callers can inspect without matching message text. */
	readonly code:
		| 'invalid-policy'
		| 'duplicate-policy'
		| 'conflicting-policy'
		| 'unsafe-retry';
	/** Human-readable explanation; use the stable code or discriminant for program decisions. */
	readonly message: string;
	/** Explicit caller-selected policy; generic mechanics do not choose product decisions. */
	readonly policy?: ResiliencePolicy;
}

/** Validation result for one composed resiliency plan. */
export type ResilienceValidationResult =
	| Readonly<{ readonly valid: true; readonly policies: readonly ResiliencePolicy[] }>
	| Readonly<{ readonly valid: false; readonly issues: readonly ResilienceValidationIssue[] }>;

/** JSON-safe policy documentation. */
export interface ResilienceDocument {
	/** Protocol or representation variant selected by this value. */
	readonly type: ResiliencePolicy['type'];
	/** Runtime owner responsible for executing the policy. */
	readonly owner: ResilienceOwner;
	/** Request lifecycle stage where the policy takes effect. */
	readonly stage: ResilienceStage;
	/** JSON-safe policy settings projected for documentation; projection does not enforce them. */
	readonly configuration: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}
