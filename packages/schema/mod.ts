/**
 * Use one Standard Schema validation call across validator libraries. Reading a validator-specific result shape in every utility otherwise forces consumers to use the same schema engine.
 *
 * Start with parse() when invalid input should throw, then use result-oriented validation where a caller needs structured issues. Keep coercion in the schema that owns the meaning. JSON Schema projection is a separate capability and can fail for values that have no faithful wire representation. Import a validator adapter explicitly; the generic validation core does not silently choose one.
 *
 * @example
 * ```ts
 * import * as schema from '@okikio/schema';
 * import { z } from 'zod';
 * const PortSchema = z.coerce.number().int().min(1).max(65535);
 * console.log(await schema.parse(PortSchema, '8787'));
 * ```
 *
 * @module
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { Failure, Schema, Success, ValidationResult } from './types.ts';

/** Error raised when a value does not satisfy a Standard Schema contract. */
export class SchemaValidationError extends TypeError {
	/** Structured rejection details; branch on their codes or paths rather than explanation wording. */
	readonly issues: readonly StandardSchemaV1.Issue[];

	/** Create this SchemaValidationError from the explicit contract values supplied by its caller. */
	constructor(issues: readonly StandardSchemaV1.Issue[], message?: string) {
		const details = issues.map((issue) => issue.message).filter((value) => value.length > 0).join('; ');
		super(
			message ??
				(details.length === 0
					? 'Value does not satisfy the required schema.'
					: `Value does not satisfy the required schema: ${details}`),
		);
		this.name = 'SchemaValidationError';
		this.issues = Object.freeze([...issues]);
	}
}

/** Return whether a value implements Standard Schema V1. */
export function is(value: unknown): value is Schema {
	if (typeof value !== 'object' || value === null) return false;
	const standard = (value as { readonly '~standard'?: unknown })['~standard'];
	return typeof standard === 'object' && standard !== null &&
		(standard as { readonly version?: unknown }).version === 1 &&
		typeof (standard as { readonly vendor?: unknown }).vendor === 'string' &&
		typeof (standard as { readonly validate?: unknown }).validate === 'function';
}

/** Validate an unknown value and normalize the Standard Schema result. */
export async function validate<Input, Output>(
	definition: Schema<Input, Output>,
	value: unknown,
): Promise<ValidationResult<Output>> {
	assert(definition);
	const result = await definition['~standard'].validate(value);
	if (result.issues !== undefined) return failure(result.issues);
	return success(result.value);
}

/** Validate an unknown value or throw {@link SchemaValidationError}. */
export async function parse<Input, Output>(
	definition: Schema<Input, Output>,
	value: unknown,
): Promise<Output> {
	const result = await validate(definition, value);
	if (result.issues !== undefined) throw new SchemaValidationError(result.issues);
	return result.value;
}

/** Assert that a value implements Standard Schema V1. */
export function assert(value: unknown, name = 'schema'): asserts value is Schema {
	if (!is(value)) throw new TypeError(`${name} must implement Standard Schema V1.`);
}

/** Prefix validation issue paths while preserving vendor-specific issue fields. */
export function prefixIssues(
	issues: readonly StandardSchemaV1.Issue[],
	...path: readonly PropertyKey[]
): readonly StandardSchemaV1.Issue[] {
	return Object.freeze(issues.map((issue) =>
		Object.freeze({
			...issue,
			path: [...path, ...(issue.path ?? [])],
		})
	));
}

/**
 * Freeze the validated value wrapper while leaving ownership of the value with its caller.
 *
 * @internal
 */
function success<Value>(value: Value): Success<Value> {
	return Object.freeze({ value });
}

/**
 * Copy and freeze the issue list so a validator cannot later rewrite the reported failure.
 *
 * @internal
 */
function failure(issues: readonly StandardSchemaV1.Issue[]): Failure {
	return Object.freeze({ issues: Object.freeze([...issues]) });
}

export type { Failure, Input, Output, Schema, Success, ValidationResult } from './types.ts';
