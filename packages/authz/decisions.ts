/** Shared inert provider decisions for permission and entitlement policies. @module */
import * as record from '@okikio/collection/record';

/** A policy explicitly allows, explicitly denies, or reports an evaluator failure. */
export type Decision =
	| Readonly<{ readonly allowed: true; readonly reason?: string }>
	| Readonly<{ readonly allowed: false; readonly reason?: string }>
	| Readonly<{ readonly error: unknown }>;

/**
 * Check one provider answer for every requested access decision, in the same order.
 * Accept only data stored directly on each record. A getter could run application
 * code or return a different decision on the next read; inherited properties
 * could accidentally grant access. Copy the admitted answer before evaluating it.
 */
export function decisions(input: unknown, expected: number, invalid: (message: string) => Error): readonly Decision[] {
	if (!Array.isArray(input) || input.length !== expected) {
		throw invalid('Checker must return one decision per request.');
	}
	const output: Decision[] = [];
	for (let index = 0; index < expected; index += 1) {
		// A sparse slot or accessor must not supply an answer through prototype lookup or user code.
		const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
		const value: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
		if (!record.is(value)) throw invalid('Provider decisions must be inert own-property records.');
		if (Object.hasOwn(value, 'error')) {
			if (Object.keys(value).length !== 1) throw invalid('An error decision cannot also allow or deny access.');
			output.push(Object.freeze({ error: value.error }));
			continue;
		}
		const allowed = value.allowed;
		const reason = value.reason;
		if (
			typeof allowed !== 'boolean' || (reason !== undefined && typeof reason !== 'string') ||
			Object.keys(value).some((key) => key !== 'allowed' && key !== 'reason')
		) {
			throw invalid('Provider decisions require a boolean allowed value and optional text reason.');
		}
		output.push(Object.freeze({ allowed, ...(reason === undefined ? {} : { reason }) }));
	}
	return Object.freeze(output);
}
