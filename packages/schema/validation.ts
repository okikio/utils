import type { StandardJSONSchemaV1, StandardSchemaV1, StandardTypedV1 } from '@standard-schema/spec';

import type { Failure, Schema, Success, ValidationResult } from './types.ts';

/** A synchronous reader rejects Promise results and retains separate authored input and validated output types. */
export interface Reader<Output, Input = unknown> extends StandardSchemaV1<Input, Output> {
	/** Read one value now. Invalid input throws SchemaValidationError. */
	parse(value: unknown): Output;
	/** Synchronous Standard Schema validation plus optional JSON Schema projection. */
	readonly '~standard': Omit<StandardSchemaV1.Props<Input, Output>, 'validate'> & {
		readonly validate: (value: unknown, options?: ValidationOptionsType) => StandardSchemaV1.Result<Output>;
		readonly jsonSchema?: StandardJSONSchemaV1.Converter;
	};
}

/**
 * A synchronous reader that also exposes Standard JSON Schema conversion.
 *
 * Conversion describes an input or output type for another tool. It does not
 * run validation, defaults or transforms, and it can reject a direction or
 * target that cannot preserve the reader's rules. Native builders retain this
 * capability in their types even when a particular conversion must fail.
 */
export interface JsonReader<Output, Input = unknown> extends Reader<Output, Input> {
	/** Independent validation and JSON conversion capabilities share the Standard Typed identity. */
	readonly '~standard': Reader<Output, Input>['~standard'] & StandardJSONSchemaV1.Props<Input, Output>;
}

/** An asynchronous reader always returns a Promise, including when validation rejects. */
export interface AsyncReader<Output, Input = unknown> extends StandardSchemaV1<Input, Output> {
	/** Read and validate one value asynchronously. */
	parse(value: unknown): Promise<Output>;
}

/** Validators authored here whose output can be accepted unchanged as input. No vendor string grants this capability. */
const identitySchemas = new WeakSet<object>();

/** Record the explicit identity contract of one owned validator. @internal */
export function identify<Definition extends Schema>(definition: Definition): Definition {
	identitySchemas.add(definition);
	return definition;
}

/** Test a capability recorded by native authoring, without inspecting a third-party validator. @internal */
export function hasIdentity(definition: Schema): boolean {
	return identitySchemas.has(definition);
}

/**
 * Author a synchronous reader. Expected input rejection must use reject() or
 * SchemaValidationError; other exceptions stay programming/provider defects.
 * A returned thenable is observed and refused; use defineAsync() for async work.
 */
export function define<Read extends (value: unknown) => unknown>(
	read: Read & (Extract<ReturnType<Read>, PromiseLike<unknown>> extends never ? unknown : never),
): Reader<ReturnType<Read>> {
	const parse = (value: unknown): ReturnType<Read> => {
		const output = read(value);
		if (isPromiseLike(output)) {
			void Promise.resolve(output).catch(() => undefined);
			throw new TypeError('A synchronous schema reader returned a Promise; use defineAsync().');
		}
		return output as ReturnType<Read>;
	};
	return Object.freeze({
		parse,
		'~standard': Object.freeze({
			version: 1 as const,
			vendor: 'okikio',
			validate(value: unknown): StandardSchemaV1.Result<ReturnType<Read>> {
				try {
					return { value: parse(value) };
				} catch (error) {
					if (error instanceof SchemaValidationError) return { issues: error.issues };
					throw error;
				}
			},
		}),
	});
}

/** Author asynchronous validation deliberately. Input stays unknown unless a typed adapter supplies a narrower contract. */
export function defineAsync<Output>(
	read: (value: unknown) => Output | PromiseLike<Output>,
): AsyncReader<Awaited<Output>> {
	const parse = async (value: unknown): Promise<Awaited<Output>> => await read(value);
	return Object.freeze({
		parse,
		'~standard': Object.freeze({
			version: 1 as const,
			vendor: 'okikio',
			async validate(value: unknown): Promise<StandardSchemaV1.Result<Awaited<Output>>> {
				try {
					return { value: await parse(value) };
				} catch (error) {
					if (error instanceof SchemaValidationError) return { issues: error.issues };
					throw error;
				}
			},
		}),
	});
}

/** Classify thenables without assuming the current realm's Promise constructor. @internal */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (typeof value === 'object' && value !== null || typeof value === 'function') &&
		typeof (value as { readonly then?: unknown }).then === 'function';
}

/** Reject expected invalid input explicitly so accidental TypeErrors remain programming failures. */
export function reject(message: string, path?: readonly PropertyKey[]): never {
	throw new SchemaValidationError([{ message, ...(path === undefined ? {} : { path }) }]);
}

/**
 * Describe one Standard input or output type as JSON Schema.
 *
 * A converter does not need to validate values. Conversely, a Standard Schema
 * validator does not need to support conversion. The requested target and
 * vendor options reach the converter unchanged; unsupported directions and
 * targets remain its explicit failures. The default describes output using
 * draft 2020-12. Select draft 07 when compiling with Ajv's default class.
 *
 * @example Describe accepted JSON without applying defaults
 * ```ts
 * import * as schema from '@okikio/schema';
 * const SettingsSchema = schema.object({ retries: schema.defaults(schema.number(), () => 3) });
 * const document = schema.jsonSchema(SettingsSchema, 'input', { target: 'draft-07' });
 * ```
 */
export function jsonSchema(
	definition: StandardTypedV1,
	io: 'input' | 'output' = 'output',
	options: StandardJSONSchemaV1.Options = { target: 'draft-2020-12' },
): Record<string, unknown> {
	if (io !== 'input' && io !== 'output') throw new TypeError('JSON Schema direction must be input or output.');
	const standard = properties(definition);
	const converter = (standard as Partial<StandardJSONSchemaV1.Props> | undefined)?.jsonSchema;
	if (
		(typeof converter !== 'object' || converter === null) && typeof converter !== 'function' ||
		typeof converter.input !== 'function' || typeof converter.output !== 'function'
	) throw new TypeError('This value does not provide Standard JSON Schema V1 conversion.');
	return converter[io](options);
}

/** Error raised when a value does not satisfy a Standard Schema contract. */
export class SchemaValidationError extends TypeError {
	/** Structured rejection details; branch on their codes or paths rather than explanation wording. */
	readonly issues: readonly StandardSchemaV1.Issue[];

	/** Retain copied issue/path arrays and render their messages without discarding structured evidence. */
	constructor(issues: readonly StandardSchemaV1.Issue[], message?: string) {
		const details = issues.map((issue) => issue.message).filter((value) => value.length > 0).join('; ');
		super(
			message ??
				(details.length === 0
					? 'Value does not satisfy the required schema.'
					: `Value does not satisfy the required schema: ${details}`),
		);
		this.name = 'SchemaValidationError';
		this.issues = Object.freeze(issues.map((issue) =>
			Object.freeze({
				...issue,
				...(issue.path === undefined ? {} : { path: Object.freeze([...issue.path]) }),
			})
		));
	}
}

/** Return whether an object or callable value supplies the Standard Schema V1 validation capability. */
export function is(value: unknown): value is Schema {
	return typeof (properties(value) as Partial<StandardSchemaV1.Props> | undefined)?.validate === 'function';
}

/**
 * Validate with any Standard Schema implementation and await its result.
 *
 * Vendor options are passed through without interpretation. Expected invalid
 * input becomes an issue result; exceptions from the validator remain exceptions
 * so configuration, transport and programming failures are not mislabeled as
 * invalid data. The returned wrapper is immutable and its value remains borrowed.
 */
export async function validate<Input, Output>(
	definition: Schema<Input, Output>,
	value: unknown,
	options?: ValidationOptionsType,
): Promise<ValidationResult<Output>> {
	assert(definition);
	for (const key of ['maximumIssues', 'maximumPathLength'] as const) {
		const value = options?.[key];
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
			throw new TypeError(`${key} must be a positive safe integer.`);
		}
	}
	const result = await definition['~standard'].validate(value, options);
	if (result.issues !== undefined) {
		const maximum = options?.maximumIssues ?? result.issues.length;
		let truncated = result.issues.length > maximum || (result as { readonly truncated?: boolean }).truncated === true;
		const issues = result.issues.slice(0, maximum).map((issue) => {
			const path = issue.path;
			if (path === undefined || path.length <= (options?.maximumPathLength ?? path.length)) return issue;
			truncated = true;
			return Object.freeze({ ...issue, path: Object.freeze(path.slice(0, options!.maximumPathLength)) });
		});
		return Object.freeze({ ...failure(issues), ...(truncated ? { truncated: true as const } : {}) });
	}
	return success(result.value);
}

/** Validate an unknown value or throw {@link SchemaValidationError}. */
export async function parse<Input, Output>(
	definition: Schema<Input, Output>,
	value: unknown,
	options?: ValidationOptionsType,
): Promise<Output> {
	const result = await validate(definition, value, options);
	if (result.issues !== undefined) throw new SchemaValidationError(result.issues);
	return result.value;
}

/** Check the shared protocol identity without requiring either optional capability. */
function properties(value: unknown): StandardTypedV1.Props | undefined {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined;
	const standard = (value as { readonly '~standard'?: unknown })['~standard'];
	if (
		(typeof standard !== 'object' || standard === null) && typeof standard !== 'function' ||
		(standard as { readonly version?: unknown }).version !== 1 ||
		typeof (standard as { readonly vendor?: unknown }).vendor !== 'string'
	) return undefined;
	return standard as StandardTypedV1.Props;
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
			path: Object.freeze([...path, ...(issue.path ?? [])]),
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
 * Copy and freeze list membership; issue objects and nested vendor fields remain borrowed.
 *
 * @internal
 */
function failure(issues: readonly StandardSchemaV1.Issue[]): Failure {
	return Object.freeze({ issues: Object.freeze([...issues]) });
}

export type { Failure, Input, Output, Schema, Success, ValidationResult } from './types.ts';

/** Bound returned issue evidence. Vendor validation work and allocations remain owned by the vendor. */
export interface ValidationOptionsType extends StandardSchemaV1.Options {
	/** Positive maximum returned issue count; omitted retains the vendor report. */
	readonly maximumIssues?: number;
	/** Positive maximum returned path length; omitted retains full paths. Truncation is reported explicitly. */
	readonly maximumPathLength?: number;
}
