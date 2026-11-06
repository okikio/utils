import type { StandardSchemaV1, StandardTypedV1 } from '@standard-schema/spec';

/** Standard Schema contract accepted by reusable utility packages. */
export type Schema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** Authored input advertised by a Standard validator or JSON Schema converter. No validation capability is implied. */
export type Input<Definition extends StandardTypedV1> = StandardTypedV1.InferInput<Definition>;

/** Output advertised by a Standard validator or JSON Schema converter. Conversion describes this type without producing it. */
export type Output<Definition extends StandardTypedV1> = StandardTypedV1.InferOutput<Definition>;

/** Successful Standard Schema validation result. */
export type Success<Value> = Readonly<{ readonly value: Value; readonly issues?: undefined }>;

/** Failed Standard Schema validation result. */
export type Failure = Readonly<{ readonly issues: readonly StandardSchemaV1.Issue[]; readonly truncated?: true }>;

/** Validation result normalized by this package. */
export type ValidationResult<Value> = Success<Value> | Failure;
