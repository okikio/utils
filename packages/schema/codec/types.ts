import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	ObjectOptions as SchemaObjectOptions,
	ResolveObjectPolicy,
	UnknownInput,
	UnknownKeys,
	UnknownOutput,
} from '../author.ts';

/** Explicit bidirectional contract composed from two independent Standard Schemas. */
export interface Codec<
	EncodedInput = unknown,
	Application = unknown,
	ApplicationInput = Application,
	Encoded = EncodedInput,
> {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'codec';
	/** Decode the external representation according to this contract. */
	readonly decode: StandardSchemaV1<EncodedInput, Application>;
	/** Encode the contract value into its external representation. */
	readonly encode: StandardSchemaV1<ApplicationInput, Encoded>;
}

/** Encoded input accepted by a codec. */
export type DecodeInput<Definition extends Codec> = Definition['decode'] extends StandardSchemaV1<infer Value, unknown>
	? Value
	: never;

/** Application value produced by a codec. */
export type Decoded<Definition extends Codec> = Definition['decode'] extends StandardSchemaV1<unknown, infer Value>
	? Value
	: never;

/** Application input accepted for encoding. */
export type EncodeInput<Definition extends Codec> = Definition['encode'] extends StandardSchemaV1<infer Value, unknown>
	? Value
	: never;

/** Encoded value produced by a codec. */
export type Encoded<Definition extends Codec> = Definition['encode'] extends StandardSchemaV1<unknown, infer Value>
	? Value
	: never;

/** Record of named codecs accepted by {@link object}. */
export type CodecShape = Readonly<Record<string, Codec>>;

/** Fields accepting undefined may be omitted; explicit undefined remains an allowed value. */
export type OptionalFields<Fields> =
	& { readonly [Key in keyof Fields as undefined extends Fields[Key] ? never : Key]: Fields[Key] }
	& { readonly [Key in keyof Fields as undefined extends Fields[Key] ? Key : never]?: Fields[Key] };

/** Object policies are independent because external input and authored output can need different handling. */
export interface ObjectOptions<
	DecodePolicy extends UnknownKeys = UnknownKeys,
	EncodePolicy extends UnknownKeys = UnknownKeys,
> {
	/** Policy for external input; defaults to strip to retain the existing codec behavior. */
	readonly decode?: SchemaObjectOptions<DecodePolicy>;
	/** Policy for application input; defaults to strip independently of decode. */
	readonly encode?: SchemaObjectOptions<EncodePolicy>;
}

/** Resolve one direction, retaining strip whenever its options or policy may be omitted. */
export type ObjectDirectionPolicy<Options, Direction extends 'decode' | 'encode'> = Options extends object
	? Direction extends keyof Options ? ResolveObjectPolicy<Options[Direction], 'strip'> : 'strip'
	: 'strip';

/** Decoded object input represented by a codec shape and its accepted unknown-key policy. */
export type ObjectDecodeInput<Shape extends CodecShape, Policy extends UnknownKeys = 'strip'> = UnknownInput<
	Policy,
	OptionalFields<{ readonly [Key in keyof Shape]: DecodeInput<Shape[Key]> }>
>;

/** Decoded application object represented by a codec shape. */
export type ObjectDecoded<Shape extends CodecShape, Policy extends UnknownKeys = 'strip'> =
	& OptionalFields<{ readonly [Key in keyof Shape]: Decoded<Shape[Key]> }>
	& UnknownOutput<Policy>;

/** Application object accepted by a codec shape's encoder. */
export type ObjectEncodeInput<Shape extends CodecShape, Policy extends UnknownKeys = 'strip'> = UnknownInput<
	Policy,
	OptionalFields<{ readonly [Key in keyof Shape]: EncodeInput<Shape[Key]> }>
>;

/** Encoded object represented by a codec shape. */
export type ObjectEncoded<Shape extends CodecShape, Policy extends UnknownKeys = 'strip'> =
	& OptionalFields<{ readonly [Key in keyof Shape]: Encoded<Shape[Key]> }>
	& UnknownOutput<Policy>;

/** Validation alone or an explicit two-direction conversion accepted by transport consumers. */
export type Contract<Input = unknown, Output = Input, Encoded = Input> =
	| StandardSchemaV1<Input, Output>
	| Codec<Input, Output, Output, Encoded>;

/** Authored external input accepted by a schema or codec contract. */
export type ContractInput<Definition extends Contract> = Definition extends Codec ? DecodeInput<Definition>
	: Definition extends StandardSchemaV1<infer Input, unknown> ? Input
	: never;

/** Validated application output produced by a schema or codec contract. */
export type ContractOutput<Definition extends Contract> = Definition extends Codec ? Decoded<Definition>
	: Definition extends StandardSchemaV1<unknown, infer Output> ? Output
	: never;

/** Canonical encoded output. A schema-only contract needs the owned identity capability before writing. */
export type ContractEncoded<Definition extends Contract> = Definition extends Codec ? Encoded<Definition>
	: Definition extends StandardSchemaV1<unknown, infer Output> ? Output
	: never;
