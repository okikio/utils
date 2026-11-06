/**
 * Keep reading and writing rules together when external data differs from application values.
 * For example, an HTTP timestamp arrives as text but application code uses a Date.
 * Decoding checks incoming text and creates the Date; encoding checks the Date and
 * returns the outgoing text. Keeping those rules together prevents one direction
 * from retaining an old format after the other changes.
 *
 * Use a codec for an HTTP field, queue payload or stored value. Each direction runs
 * its declared validation and conversion. A round trip need not reproduce the same
 * spelling: converting timestamp text to Date can intentionally normalize it.
 * A codec does not send the value, serialize live resources or make data durable.
 *
 * @example
 * ```ts
 * import * as codec from '@okikio/schema/codec';
 * import { DateSchema } from '@okikio/schema/time';
 * const instant = await codec.decode(DateSchema, '2026-01-01T00:00:00.000Z');
 * console.log(await codec.encode(DateSchema, instant));
 * ```
 *
 * @module
 */
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import * as recordCore from '@okikio/collection/record';
import * as schema from '../mod.ts';
import { hasIdentity } from '../validation.ts';

import type {
	Codec,
	CodecShape,
	Contract,
	ContractEncoded,
	ContractOutput,
	ObjectDecoded,
	ObjectDecodeInput,
	ObjectDirectionPolicy,
	ObjectEncoded,
	ObjectEncodeInput,
	ObjectOptions,
} from './types.ts';

/** Define a codec from explicit decode and encode Standard Schemas. */
export function define<
	DecodeInput,
	Application,
	EncodeInput = Application,
	EncodedValue = DecodeInput,
>(
	input: Readonly<{
		readonly decode: StandardSchemaV1<DecodeInput, Application>;
		readonly encode: StandardSchemaV1<EncodeInput, EncodedValue>;
	}>,
): Codec<DecodeInput, Application, EncodeInput, EncodedValue> {
	recordCore.assert(input, 'codec definition');
	schema.assert(input.decode, 'codec decode schema');
	schema.assert(input.encode, 'codec encode schema');
	return Object.freeze({ kind: 'codec', decode: input.decode, encode: input.encode });
}

/** Return whether a value is a codec definition. */
export function is(value: unknown): value is Codec {
	return typeof value === 'object' && value !== null &&
		(value as { readonly kind?: unknown }).kind === 'codec' &&
		schema.is((value as { readonly decode?: unknown }).decode) &&
		schema.is((value as { readonly encode?: unknown }).encode);
}

/** Decode and validate an external value. */
export async function decode<DecodeInput_, Application, EncodeInput_, EncodedValue>(
	definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>,
	value: unknown,
): Promise<Application> {
	assert(definition);
	return await schema.parse(definition.decode, value);
}

/** Encode and validate an application value. */
export async function encode<DecodeInput_, Application, EncodeInput_, EncodedValue>(
	definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>,
	value: unknown,
): Promise<EncodedValue> {
	assert(definition);
	return await schema.parse(definition.encode, value);
}

/**
 * Declare that a validator accepts its own output unchanged as a canonical wire value.
 *
 * The author owns that promise. Use define({decode, encode}) for transformations with
 * different representations. This explicit declaration is required for third-party
 * validators because Standard Schema does not describe reverse conversion.
 */
export function identity<InputValue, OutputValue extends InputValue>(
	definition: StandardSchemaV1<InputValue, OutputValue>,
): Codec<InputValue, OutputValue, OutputValue, OutputValue> {
	schema.assert(definition);
	const projection = (definition['~standard'] as Partial<StandardJSONSchemaV1.Props>).jsonSchema;
	const encoder: StandardSchemaV1<OutputValue, OutputValue> = {
		'~standard': {
			version: 1,
			vendor: 'okikio/identity',
			validate: (value: unknown) => definition['~standard'].validate(value),
			...(projection === undefined ? {} : {
				jsonSchema: {
					input: (options: StandardJSONSchemaV1.Options) => projection.output(options),
					output: (options: StandardJSONSchemaV1.Options) => projection.output(options),
				},
			}),
		},
	};
	return define({ decode: definition, encode: encoder });
}

/** Read the external representation through its declared validation or decode direction. */
export async function read<Definition extends Contract>(
	definition: Definition,
	value: unknown,
): Promise<ContractOutput<Definition>> {
	const result = is(definition) ? await decode(definition, value) : await schema.parse(definition, value);
	return result as ContractOutput<Definition>;
}

/**
 * Write a canonical representation through an explicit encoder or an owned identity validator.
 * A generic Standard Schema or transform has no inferred inverse and rejects here.
 */
export async function write<Definition extends Contract>(
	definition: Definition,
	value: unknown,
): Promise<ContractEncoded<Definition>> {
	if (is(definition)) return await encode(definition, value) as ContractEncoded<Definition>;
	schema.assert(definition);
	if (!hasIdentity(definition)) {
		throw new TypeError(
			'This schema needs an explicit codec encoder. Use codec.define() or declare an unchanged representation with codec.identity().',
		);
	}
	return await schema.parse(definition, value) as ContractEncoded<Definition>;
}

/** Return the Standard Schema that validates an incoming contract value. */
export function input<Definition extends Contract>(
	definition: Definition,
): Definition extends Codec ? Definition['decode'] : Definition {
	if (is(definition)) return definition.decode as Definition extends Codec ? Definition['decode'] : Definition;
	schema.assert(definition);
	return definition as Definition extends Codec ? Definition['decode'] : Definition;
}

/** Return the explicitly supported application-to-wire schema, rejecting absent inverse semantics. */
export function output<Definition extends Contract>(
	definition: Definition,
): Definition extends Codec ? Definition['encode'] : Definition {
	if (is(definition)) return definition.encode as Definition extends Codec ? Definition['encode'] : Definition;
	schema.assert(definition);
	if (!hasIdentity(definition)) throw new TypeError('This schema has no declared application-to-wire direction.');
	return definition as Definition extends Codec ? Definition['encode'] : Definition;
}

/**
 * Compose codecs while choosing how each direction handles undeclared fields.
 *
 * Both directions strip extras by default. Preserve external fields when a
 * provider can add data independently; select reject for authored outgoing
 * records that should expose misspellings. Declared codecs still validate in
 * either policy, and absent optional fields remain absent.
 */
export function object<const Shape extends CodecShape>(
	shape: Shape,
): Codec<ObjectDecodeInput<Shape>, ObjectDecoded<Shape>, ObjectEncodeInput<Shape>, ObjectEncoded<Shape>>;
/** Explicit direction settings remain precise; optional settings retain the direction's strip default. */
export function object<const Shape extends CodecShape, const Options extends ObjectOptions | undefined>(
	shape: Shape,
	options: Options,
): Codec<
	ObjectDecodeInput<Shape, ObjectDirectionPolicy<Options, 'decode'>>,
	ObjectDecoded<Shape, ObjectDirectionPolicy<Options, 'decode'>>,
	ObjectEncodeInput<Shape, ObjectDirectionPolicy<Options, 'encode'>>,
	ObjectEncoded<Shape, ObjectDirectionPolicy<Options, 'encode'>>
>;
export function object<const Shape extends CodecShape>(
	shape: Shape,
	options: ObjectOptions = {},
): Codec<
	ObjectDecodeInput<Shape, schema.UnknownKeys>,
	ObjectDecoded<Shape, schema.UnknownKeys>,
	ObjectEncodeInput<Shape, schema.UnknownKeys>,
	ObjectEncoded<Shape, schema.UnknownKeys>
> {
	recordCore.assert(shape, 'codec shape');
	recordCore.assert(options, 'codec object options');
	recordCore.assert(options.decode ?? {}, 'codec decode options');
	recordCore.assert(options.encode ?? {}, 'codec encode options');
	const decodePolicy = options.decode?.unknownKeys ?? 'strip';
	const encodePolicy = options.encode?.unknownKeys ?? 'strip';
	for (const policy of [decodePolicy, encodePolicy]) {
		if (!['reject', 'strip', 'preserve'].includes(policy)) throw new TypeError('Invalid unknown-key policy.');
	}
	const entries = Object.entries(shape);
	for (const [key, definition] of entries) {
		if (key.length === 0) throw new TypeError('Codec object keys must not be empty.');
		assert(definition, `codec object property ${JSON.stringify(key)}`);
	}
	const frozenShape = freezeRecord(shape);
	return define({
		decode: objectSchema<Shape, schema.UnknownKeys>(frozenShape, 'decode', decodePolicy),
		encode: objectSchema<Shape, schema.UnknownKeys>(frozenShape, 'encode', encodePolicy),
	});
}

/** Allow a codec value to be omitted as `undefined` in both directions. */
export function optional<DecodeInput_, Application, EncodeInput_, EncodedValue>(
	definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>,
): Codec<DecodeInput_ | undefined, Application | undefined, EncodeInput_ | undefined, EncodedValue | undefined> {
	assert(definition);
	return define({
		decode: optionalSchema(definition.decode),
		encode: optionalSchema(definition.encode),
	});
}

/** Allow a codec value to be `null` in both directions. */
export function nullable<DecodeInput_, Application, EncodeInput_, EncodedValue>(
	definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>,
): Codec<DecodeInput_ | null, Application | null, EncodeInput_ | null, EncodedValue | null> {
	assert(definition);
	return define({
		decode: nullableSchema(definition.decode),
		encode: nullableSchema(definition.encode),
	});
}

/** Compose a codec for arrays of another codec. */
export function array<DecodeInput_, Application, EncodeInput_, EncodedValue>(
	definition: Codec<DecodeInput_, Application, EncodeInput_, EncodedValue>,
): Codec<readonly DecodeInput_[], readonly Application[], readonly EncodeInput_[], readonly EncodedValue[]> {
	assert(definition);
	return define({
		decode: arraySchema(definition.decode),
		encode: arraySchema(definition.encode),
	});
}

/** Assert that a value is a codec definition. */
export function assert(value: unknown, name = 'codec'): asserts value is Codec {
	if (!is(value)) throw new TypeError(`${name} must contain Standard Schema decode and encode contracts.`);
}

/**
 * Builds the object schema used to validate data entering bidirectional codec composition.
 *
 * @internal
 */
function objectSchema<Shape extends CodecShape, Policy extends schema.UnknownKeys>(
	shape: Shape,
	direction: 'decode',
	policy: Policy,
): StandardSchemaV1<ObjectDecodeInput<Shape, Policy>, ObjectDecoded<Shape, Policy>>;
/**
 * Builds the object schema used to validate data entering bidirectional codec composition.
 *
 * @internal
 */
function objectSchema<Shape extends CodecShape, Policy extends schema.UnknownKeys>(
	shape: Shape,
	direction: 'encode',
	policy: Policy,
): StandardSchemaV1<ObjectEncodeInput<Shape, Policy>, ObjectEncoded<Shape, Policy>>;
/**
 * Build one direction from the same captured shape. Validate declared fields
 * sequentially, prefix child issues with their property, and keep omission
 * distinct from an explicitly present undefined value.
 *
 * @internal
 */
function objectSchema<Shape extends CodecShape>(
	shape: Shape,
	direction: 'decode' | 'encode',
	policy: schema.UnknownKeys,
): StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> {
	const entries = Object.entries(shape);
	const names = new Set(entries.map(([key]) => key));
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/schema/codec',
			/**
			 * Apply the selected unknown-key policy and collect declared-field issues
			 * without publishing a partial record.
			 *
			 * @internal
			 */
			async validate(value: unknown) {
				if (!recordCore.is(value)) return { issues: [{ message: 'Expected an ordinary data object.' }] };
				const output: Record<string, unknown> = Object.create(null);
				const issues: StandardSchemaV1.Issue[] = [];
				for (const key of Object.keys(value)) {
					if (names.has(key)) continue;
					if (policy === 'reject') issues.push({ message: 'Unknown object property.', path: [key] });
					else if (policy === 'preserve') output[key] = value[key];
				}
				for (const [key, definition] of entries) {
					const present = Object.hasOwn(value, key);
					const child = await definition[direction]['~standard'].validate(present ? value[key] : undefined);
					if (child.issues !== undefined) issues.push(...schema.prefixIssues(child.issues, key));
					else if (present || child.value !== undefined) output[key] = child.value;
				}
				return issues.length > 0 ? { issues: Object.freeze(issues) } : { value: Object.freeze(output) };
			},
		},
	};
}

/**
 * Short-circuit undefined; every other input retains the child direction's
 * synchronous or asynchronous validation result.
 *
 * @internal
 */
function optionalSchema<Input, Output>(
	definition: StandardSchemaV1<Input, Output>,
): StandardSchemaV1<Input | undefined, Output | undefined> {
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/schema/codec',
			/**
			 * Accept undefined without calling the child validator.
			 *
			 * @internal
			 */
			validate(value: unknown) {
				return value === undefined ? { value: undefined } : definition['~standard'].validate(value);
			},
		},
	};
}

/**
 * Short-circuit null without treating missing/undefined as null.
 *
 * @internal
 */
function nullableSchema<Input, Output>(
	definition: StandardSchemaV1<Input, Output>,
): StandardSchemaV1<Input | null, Output | null> {
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/schema/codec',
			/**
			 * Accept null without calling the child validator.
			 *
			 * @internal
			 */
			validate(value: unknown) {
				return value === null ? { value: null } : definition['~standard'].validate(value);
			},
		},
	};
}

/**
 * Validate items sequentially in one direction and prefix every child issue
 * with its original numeric index. Freeze the output only after all items pass.
 *
 * @internal
 */
function arraySchema<Input, Output>(
	definition: StandardSchemaV1<Input, Output>,
): StandardSchemaV1<readonly Input[], readonly Output[]> {
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/schema/codec',
			/**
			 * Await each item before moving on; vendor exceptions propagate, while
			 * expected issues accumulate with the source index.
			 *
			 * @internal
			 */
			async validate(value: unknown) {
				if (!Array.isArray(value)) return { issues: [{ message: 'Expected an array.' }] };
				const output: Output[] = [];
				const issues: StandardSchemaV1.Issue[] = [];
				for (let index = 0; index < value.length; index += 1) {
					const child = await definition['~standard'].validate(value[index]);
					if (child.issues !== undefined) issues.push(...schema.prefixIssues(child.issues, index));
					else output.push(child.value);
				}
				return issues.length > 0 ? { issues: Object.freeze(issues) } : { value: Object.freeze(output) };
			},
		},
	};
}

/** Snapshot a validated codec record without dropping data properties. @internal */
function freezeRecord<Value extends Readonly<Record<string, unknown>>>(value: Value): Readonly<Value> {
	return recordCore.snapshot(value, 'codec record');
}

export type {
	Codec,
	CodecShape,
	Contract,
	ContractEncoded,
	ContractInput,
	ContractOutput,
	Decoded,
	DecodeInput,
	Encoded,
	EncodeInput,
	ObjectDecoded,
	ObjectDecodeInput,
	ObjectDirectionPolicy,
	ObjectEncoded,
	ObjectEncodeInput,
	ObjectOptions,
	OptionalFields,
} from './types.ts';
export type { StandardSchemaV1, StandardTypedV1 } from '@standard-schema/spec';

/** Direction-specific tuple representation; input and output may differ at every position. */
type TupleType<
	Definitions extends readonly Codec[],
	Direction extends 'decode' | 'encode',
	Side extends 'input' | 'output',
> = {
	readonly [Key in keyof Definitions]: Side extends 'input' ? schema.Input<Definitions[Key][Direction]>
		: schema.Output<Definitions[Key][Direction]>;
};

/**
 * Compose fixed-length codecs without guessing inverse transforms. Each direction validates in position order.
 * Sparse/accessor arrays reject before child validation. Only the first invalid child is reported, with its exact index.
 */
export function tuple<const Definitions extends readonly Codec[]>(
	definitions: Definitions,
): Codec<
	TupleType<Definitions, 'decode', 'input'>,
	TupleType<Definitions, 'decode', 'output'>,
	TupleType<Definitions, 'encode', 'input'>,
	TupleType<Definitions, 'encode', 'output'>
> {
	const owned = Object.freeze([...definitions]);
	for (const definition of owned) assert(definition);
	/** Build the selected conversion independently; encoding must never run a decoder as a guessed inverse. */
	const direction = (selected: 'decode' | 'encode') =>
		schema.defineAsync(async (value: unknown) => {
			if (!Array.isArray(value) || value.length !== owned.length) {
				schema.reject('Expected the exact codec tuple length.');
			}
			const descriptors = Object.getOwnPropertyDescriptors(value);
			if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== value.length + 1) {
				schema.reject('Expected a dense tuple with no extra properties.');
			}
			for (let index = 0; index < value.length; index++) {
				const descriptor = descriptors[String(index)];
				if (!descriptor?.enumerable || !('value' in descriptor)) {
					schema.reject('Expected own tuple data elements.', [index]);
				}
			}
			const output: unknown[] = [];
			for (let index = 0; index < owned.length; index++) {
				const result = await schema.validate(owned[index]![selected], descriptors[String(index)]!.value);
				if (result.issues !== undefined) {
					throw new schema.SchemaValidationError(schema.prefixIssues(result.issues, index));
				}
				output.push(result.value);
			}
			return Object.freeze(output);
		});
	return define({ decode: direction('decode'), encode: direction('encode') }) as Codec<
		TupleType<Definitions, 'decode', 'input'>,
		TupleType<Definitions, 'decode', 'output'>,
		TupleType<Definitions, 'encode', 'input'>,
		TupleType<Definitions, 'encode', 'output'>
	>;
}

/** Compose string key conversion and value conversion with explicit record admission and collision rejection. */
export function record<Key extends Codec<string, string, string, string>, Value extends Codec>(
	keys: Key,
	values: Value,
	options: Readonly<{ readonly maximumEntries: number }>,
): Codec<
	Readonly<Record<string, schema.Input<Value['decode']>>>,
	Readonly<Record<string, schema.Output<Value['decode']>>>,
	Readonly<Record<string, schema.Input<Value['encode']>>>,
	Readonly<Record<string, schema.Output<Value['encode']>>>
> {
	assert(keys);
	assert(values);
	const maximum = options.maximumEntries;
	if (!Number.isSafeInteger(maximum) || maximum < 0) {
		throw new TypeError('maximumEntries must be a non-negative safe integer.');
	}
	/** Build the selected conversion independently; encoding must never run a decoder as a guessed inverse. */
	const direction = (selected: 'decode' | 'encode') =>
		schema.defineAsync(async (input: unknown) => {
			if (!recordCore.is(input)) schema.reject('Expected an own-data record.');
			const entries = recordCore.entries(input);
			if (entries.length > maximum) schema.reject('Record exceeds maximumEntries.');
			const output: Record<string, unknown> = Object.create(null);
			for (const [key, value] of entries) {
				const mapped = await schema.validate(keys[selected], key);
				if (mapped.issues !== undefined) {
					throw new schema.SchemaValidationError(schema.prefixIssues(mapped.issues, key));
				}
				// Two different input keys may normalize to the same key. Reject that
				// collision rather than silently replacing an earlier converted value.
				if (typeof mapped.value !== 'string' || Object.hasOwn(output, mapped.value)) {
					schema.reject('Record key conversion must produce distinct strings.', [key]);
				}
				const result = await schema.validate(values[selected], value);
				if (result.issues !== undefined) {
					throw new schema.SchemaValidationError(schema.prefixIssues(result.issues, key));
				}
				output[mapped.value] = result.value;
			}
			return Object.freeze(output);
		});
	return define({ decode: direction('decode'), encode: direction('encode') }) as Codec<
		Readonly<Record<string, schema.Input<Value['decode']>>>,
		Readonly<Record<string, schema.Output<Value['decode']>>>,
		Readonly<Record<string, schema.Input<Value['encode']>>>,
		Readonly<Record<string, schema.Output<Value['encode']>>>
	>;
}

/** Select exactly one codec per direction; transformed discriminants require explicit separate selectors. */
export function discriminated<const Variants extends Readonly<Record<string, Codec>>>(
	key: string,
	variants: Variants,
	selectors?: Readonly<
		{
			readonly decode: (value: unknown) => keyof Variants & string;
			readonly encode: (value: unknown) => keyof Variants & string;
		}
	>,
): Codec<
	schema.Input<Variants[keyof Variants]['decode']>,
	schema.Output<Variants[keyof Variants]['decode']>,
	schema.Input<Variants[keyof Variants]['encode']>,
	schema.Output<Variants[keyof Variants]['encode']>
> {
	if (typeof key !== 'string' || !key.length) throw new TypeError('A discriminant field is required.');
	const owned = recordCore.snapshot(variants);
	for (const definition of Object.values(owned)) assert(definition);
	if (selectors !== undefined && (typeof selectors.decode !== 'function' || typeof selectors.encode !== 'function')) {
		throw new TypeError('Both direction selectors are required.');
	}
	const select = (value: unknown): string => {
		if (!recordCore.is(value) || !Object.hasOwn(value, key) || typeof value[key] !== 'string') {
			schema.reject('Expected an own string discriminant.', [key]);
		}
		return value[key] as string;
	};
	/** Build the selected conversion independently; encoding must never run a decoder as a guessed inverse. */
	const direction = (selected: 'decode' | 'encode') => {
		const selector = selectors?.[selected] ?? select;
		return schema.defineAsync(async (value: unknown) => {
			const name = selector(value);
			if (typeof name !== 'string' || !Object.hasOwn(owned, name)) schema.reject('Unknown codec variant.', [key]);
			return await schema.parse(owned[name]![selected], value);
		});
	};
	return define({ decode: direction('decode'), encode: direction('encode') }) as Codec<
		schema.Input<Variants[keyof Variants]['decode']>,
		schema.Output<Variants[keyof Variants]['decode']>,
		schema.Input<Variants[keyof Variants]['encode']>,
		schema.Output<Variants[keyof Variants]['encode']>
	>;
}
