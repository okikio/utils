/**
 * Check unknown input before application code relies on its shape. A schema can reject a negative age or
 * turn configured port text into a checked number.
 *
 * Native builders run synchronously. defineAsync() supports checks that must await work. The codec subpath
 * makes conversion to a wire format explicit.
 *
 * Object schemas reject unknown keys by default. Parsed objects and arrays get fresh containers, while
 * arbitrary leaf values remain borrowed. Standard Schema adapters let other validators provide the
 * checking contract.
 *
 * @example
 * ```ts
 * import * as schema from '@okikio/schema';
 * const PortSchema = schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 });
 * console.log(PortSchema.parse('8787'));
 * ```
 * @module
 */
export {
	assert,
	define,
	defineAsync,
	is,
	jsonSchema,
	parse,
	prefixIssues,
	reject,
	SchemaValidationError,
	validate,
} from './validation.ts';
export type { AsyncReader, JsonReader, Reader, ValidationOptionsType } from './validation.ts';
export * from './author.ts';
export { inspect } from './inspect.ts';
export type { ProjectionType, SchemaInspectionType } from './inspect.ts';
export type { Failure, Input, Output, Schema, Success, ValidationResult } from './types.ts';
export type { StandardJSONSchemaV1, StandardSchemaV1, StandardTypedV1 } from '@standard-schema/spec';
export type { Options as JsonOptions, Value as JsonValue } from '@okikio/collection/record/json';
