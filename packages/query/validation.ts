import type { QueryIssue, QueryParseResult } from './types.ts';

const parameterNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Error thrown by `QueryDefinition.parse()`. */
export class QueryValidationError extends Error {
	/** Structured rejection details; branch on their codes or paths rather than explanation wording. */
	readonly issues: readonly QueryIssue[];

	/** Retain a stable issue list while joining human-readable messages for an ordinary thrown Error. */
	constructor(issues: readonly QueryIssue[]) {
		super(issues.map((entry) => entry.message).join('; '));
		this.name = 'QueryValidationError';
		this.issues = Object.freeze([...issues]);
	}
}

/**
 * Create one immutable query-validation issue with an optional source path.
 *
 * @internal
 */
export function issue(code: QueryIssue['code'], message: string, path: readonly PropertyKey[]): QueryIssue {
	return Object.freeze({ code, message, ...(path.length > 0 ? { path } : {}) });
}

/**
 * Snapshot accumulated issues into the nonthrowing parse result; no partial query value escapes.
 *
 * @internal
 */
export function failure(issues: readonly QueryIssue[]): QueryParseResult<never> {
	return Object.freeze({ success: false, issues: Object.freeze([...issues]) });
}

/**
 * Require integral nonnegative or positive policy counts; this helper does not enforce safe-integer magnitude.
 *
 * @internal
 */
export function assertPositiveInteger(value: number, name: string, allowZero = false): void {
	if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
		throw new TypeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer.`);
	}
}

/**
 * Reject parameter names that could collide with bracket syntax in the public URL grammar.
 *
 * @internal
 */
export function assertParameterName(value: string): void {
	if (!parameterNamePattern.test(value)) throw new TypeError(`Invalid query parameter name ${JSON.stringify(value)}.`);
}
