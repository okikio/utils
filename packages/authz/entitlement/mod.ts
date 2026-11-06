/** Evaluate feature requirements through application-owned policy. @module */
import { decisions as parseDecisions } from '../decisions.ts';
import { is } from './definition.ts';
import { check } from '@okikio/context';
import type { Context } from '@okikio/context';
import type { EntitlementChecker, EntitlementDefinition, EntitlementRequirement } from './types.ts';
/** Error raised when a runtime checker explicitly denies one or more required entitlements. */
export class EntitlementDeniedError extends Error {
	/** Exact definitions denied by application policy, without duplicates. */
	readonly denied: readonly EntitlementDefinition[];

	/** Describe the denied definitions without replacing their identity. */
	constructor(denied: readonly EntitlementDefinition[]) {
		const ids = [...new Set(denied.map((definition) => definition.id))];
		super(
			ids.length === 0
				? 'Entitlement was denied.'
				: `Entitlement was denied for ${ids.map((id) => JSON.stringify(id)).join(', ')}.`,
		);
		this.name = 'EntitlementDeniedError';
		this.denied = Object.freeze([...new Set(denied)]);
	}
}

/** Error raised when one entitlement checker returns a malformed result batch. */
export class EntitlementDecisionError extends Error {
	/** Describe the malformed checker result. */
	constructor(message: string) {
		super(message);
		this.name = 'EntitlementDecisionError';
	}
}

/** Error raised when an entitlement admission batch exceeds the checker's explicit limit. */
export class EntitlementCheckLimitError extends RangeError {
	/** Number of feature checks in the rejected batch. */
	readonly count: number;
	/** Largest batch accepted by this checker. */
	readonly maximum: number;

	/** Record the attempted count and configured limit. */
	constructor(count: number, maximum: number) {
		super(`Entitlement check batch contains ${count} checks; the configured maximum is ${maximum}.`);
		this.name = 'EntitlementCheckLimitError';
		this.count = count;
		this.maximum = maximum;
	}
}

/** Redacted authored-order evidence; provider errors never appear in this report. */
export interface ExplanationEntryType {
	/** Exact canonical entitlement, rather than a reconstructed identity. */
	readonly definition: EntitlementDefinition;
	/** Fault remains distinct from an explicit policy denial. */
	readonly status: 'allowed' | 'denied' | 'fault';
	/** Optional provider reason, truncated to the explicit UTF-16 code-unit limit. */
	readonly reason?: string;
}

/** Bounded explanation policy; no validity duration or caching is inferred. */
export interface ExplanationOptionsType {
	/** Largest authored requirement batch. */
	readonly maximumChecks: number;
	/** Maximum retained reason length in UTF-16 code units; zero redacts all text. */
	readonly maximumReasonLength: number;
	/** Opt in to bounded provider reasons; defaults to false. */
	readonly details?: boolean;
}

/** One logical checker call with bounded, immutable, ordered evidence. */
export interface ExplanationType {
	/** Fault takes priority over denial; every requirement must allow for allowed. */
	readonly status: 'allowed' | 'denied' | 'fault';
	/** Per-requirement evidence, including repeated authored requirements. */
	readonly entries: readonly ExplanationEntryType[];
}

/**
 * Explain one current admission decision without throwing provider faults or
 * exposing arbitrary errors. Malformed checker responses remain typed contract
 * errors. Context cancellation propagates before and after the provider call;
 * the provider remains responsible for observing cancellation during its work.
 */
export async function explain(
	ctx: Context,
	checker: EntitlementChecker,
	requirements: readonly EntitlementRequirement[],
	options: ExplanationOptionsType,
): Promise<ExplanationType> {
	assertChecker(checker);
	check(ctx);
	const { maximumChecks, maximumReasonLength, details = false } = options;
	if (
		!Number.isSafeInteger(maximumChecks) || maximumChecks < 1 || !Number.isSafeInteger(maximumReasonLength) ||
		maximumReasonLength < 0
	) throw new RangeError('Invalid entitlement explanation bounds.');
	const maximum = Math.min(maximumChecks, checker.maximumChecks ?? maximumChecks);
	if (requirements.length > maximum) throw new EntitlementCheckLimitError(requirements.length, maximum);
	const definitions = definitionsOf(requirements);
	let answers: unknown;
	try {
		answers = definitions.length === 0 ? [] : await checker.check(ctx, definitions);
	} catch {
		// Cancellation is still terminal. Other provider faults become redacted explanation data.
		check(ctx);
		return Object.freeze({
			status: 'fault',
			entries: Object.freeze(definitions.map((definition) => Object.freeze({ definition, status: 'fault' as const }))),
		});
	}
	check(ctx);
	const normalized = parseDecisions(answers, definitions.length, (message) => new EntitlementDecisionError(message));
	const entries = Object.freeze(normalized.map((decision, index): ExplanationEntryType =>
		Object.freeze({
			definition: definitions[index]!,
			status: 'error' in decision ? 'fault' : decision.allowed ? 'allowed' : 'denied',
			...(!('error' in decision) && details && maximumReasonLength > 0 && decision.reason !== undefined
				? { reason: decision.reason.slice(0, maximumReasonLength) }
				: {}),
		})
	));
	return Object.freeze({
		status: entries.some((entry) => entry.status === 'fault')
			? 'fault'
			: entries.some((entry) => entry.status === 'denied')
			? 'denied'
			: 'allowed',
		entries,
	});
}

/**
 * Adapt one provider-neutral entitlement checker to the generic requirement runtime.
 *
 * The checker owns product policy and persistence. This utility only validates
 * the requirement family, preserves authored order, batches one admission
 * decision, and converts explicit denials into a stable error.
 */
export function interpreter(
	checker: EntitlementChecker,
): import('@okikio/capability/requirement').RequirementInterpreter<EntitlementRequirement> {
	assertChecker(checker);
	return Object.freeze({
		/** Enforce every feature as one ordered batch; a provider fault must never look like an explicit plan denial. */
		async apply(ctx: import('@okikio/context').Context, requirements: readonly EntitlementRequirement[]) {
			const definitions = definitionsOf(requirements);
			if (definitions.length === 0) return;
			if (checker.maximumChecks !== undefined && definitions.length > checker.maximumChecks) {
				throw new EntitlementCheckLimitError(definitions.length, checker.maximumChecks);
			}
			const decisions = parseDecisions(
				await checker.check(ctx, definitions),
				definitions.length,
				(message) => new EntitlementDecisionError(message),
			);
			const denied: EntitlementDefinition[] = [];
			for (const [index, decision] of decisions.entries()) {
				if ('error' in decision) throw decision.error;
				if (!decision.allowed) denied.push(definitions[index]!);
			}
			if (denied.length > 0) throw new EntitlementDeniedError(denied);
		},
	});
}

/** Validate and extract entitlement definitions from generic requirement entries. */
function definitionsOf(requirements: readonly EntitlementRequirement[]): readonly EntitlementDefinition[] {
	return Object.freeze(requirements.map((entry) => {
		if (entry.family !== 'entitlement' || entry.action !== 'require' || !is(entry.definition)) {
			throw new TypeError(`Invalid entitlement requirement ${JSON.stringify(entry.id)}.`);
		}
		return entry.definition;
	}));
}

/** Reject malformed checker contracts before they become runtime policy. */
function assertChecker(checker: EntitlementChecker): void {
	if (!checker || typeof checker !== 'object' || typeof checker.check !== 'function') {
		throw new TypeError('Entitlement interpreter requires a checker.');
	}
	if (checker.maximumChecks !== undefined && (!Number.isInteger(checker.maximumChecks) || checker.maximumChecks < 1)) {
		throw new TypeError('Entitlement checker maximumChecks must be a positive integer.');
	}
}

export * from './definition.ts';
export type * from './types.ts';
