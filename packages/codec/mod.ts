/**
 * Bidirectional data conversion built from independent Standard Schema contracts.
 *
 * Use this module when decoding and encoding have different validated shapes.
 *
 * @module
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as recordCore from '@okikio/record';
import * as schema from '@okikio/schema';

import type {
	Codec,
	CodecShape,
	ObjectDecoded,
	ObjectDecodeInput,
	ObjectEncoded,
	ObjectEncodeInput,
} from './types.ts';

/** Define a codec from explicit decode and encode Standard Schemas. */
export function define<
	DecodeInput,
	Application,
	EncodeInput = Application,
	EncodedValue = DecodeInput,
>(input: Readonly<{
	readonly decode: StandardSchemaV1<DecodeInput, Application>;
	readonly encode: StandardSchemaV1<EncodeInput, EncodedValue>;
}>): Codec<DecodeInput, Application, EncodeInput, EncodedValue> {
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

/** Compose named codecs into one structurally validated object codec. */
export function object<const Shape extends CodecShape>(
	shape: Shape,
): Codec<ObjectDecodeInput<Shape>, ObjectDecoded<Shape>, ObjectEncodeInput<Shape>, ObjectEncoded<Shape>> {
	recordCore.assert(shape, 'codec shape');
	const entries = Object.entries(shape);
	for (const [key, definition] of entries) {
		if (key.length === 0) throw new TypeError('Codec object keys must not be empty.');
		assert(definition, `codec object property ${JSON.stringify(key)}`);
	}
	const frozenShape = freezeRecord(shape);
	return define({
		decode: objectSchema(frozenShape, 'decode'),
		encode: objectSchema(frozenShape, 'encode'),
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
function objectSchema<Shape extends CodecShape>(
	shape: Shape,
	direction: 'decode',
): StandardSchemaV1<ObjectDecodeInput<Shape>, ObjectDecoded<Shape>>;
/**
 * Builds the object schema used to validate data entering bidirectional codec composition.
 *
 * @internal
 */
function objectSchema<Shape extends CodecShape>(
	shape: Shape,
	direction: 'encode',
): StandardSchemaV1<ObjectEncodeInput<Shape>, ObjectEncoded<Shape>>;
/**
 * Builds the object schema used to validate data entering bidirectional codec composition.
 *
 * Codec internals keep wire values and application values separate while preserving Standard Schema validation paths.
 *
 * @internal
 */
function objectSchema<Shape extends CodecShape>(
	shape: Shape,
	direction: 'decode' | 'encode',
): StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> {
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/codec',
			/**
			 * Checks state and preserves the deterministic issues needed by callers.
			 *
			 * It keeps encoded and application shapes explicit while preserving Standard Schema issue paths through composition.
			 *
			 * @internal
			 */
			async validate(value: unknown) {
				if (!recordCore.is(value)) return { issues: [{ message: 'Expected an ordinary data object.' }] };
				const output: Record<string, unknown> = Object.create(null);
				const issues: StandardSchemaV1.Issue[] = [];
				for (const [key, definition] of Object.entries(shape)) {
					const child = await definition[direction]['~standard'].validate(value[key]);
					if (child.issues !== undefined) issues.push(...schema.prefixIssues(child.issues, key));
					else output[key] = child.value;
				}
				return issues.length > 0
					? { issues: Object.freeze(issues) }
					: { value: Object.freeze(output) };
			},
		},
	};
}

/**
 * Builds the optional schema used to validate data entering bidirectional codec composition.
 *
 * Codec internals keep wire values and application values separate while preserving Standard Schema validation paths.
 *
 * @internal
 */
function optionalSchema<Input, Output>(definition: StandardSchemaV1<Input, Output>): StandardSchemaV1<Input | undefined, Output | undefined> {
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/codec',
			/**
			 * Checks state and preserves the deterministic issues needed by callers.
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
 * Builds the nullable schema used to validate data entering bidirectional codec composition.
 *
 * Codec internals keep wire values and application values separate while preserving Standard Schema validation paths.
 *
 * @internal
 */
function nullableSchema<Input, Output>(definition: StandardSchemaV1<Input, Output>): StandardSchemaV1<Input | null, Output | null> {
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/codec',
			/**
			 * Checks state and preserves the deterministic issues needed by callers.
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
 * Builds the array schema used to validate data entering bidirectional codec composition.
 *
 * Codec internals keep wire values and application values separate while preserving Standard Schema validation paths.
 *
 * @internal
 */
function arraySchema<Input, Output>(definition: StandardSchemaV1<Input, Output>): StandardSchemaV1<readonly Input[], readonly Output[]> {
	return {
		'~standard': {
			version: 1,
			vendor: '@okikio/codec',
			/**
			 * Checks state and preserves the deterministic issues needed by callers.
			 *
			 * It keeps encoded and application shapes explicit while preserving Standard Schema issue paths through composition.
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
				return issues.length > 0
					? { issues: Object.freeze(issues) }
					: { value: Object.freeze(output) };
			},
		},
	};
}

/** Snapshot a validated codec record without dropping data properties. @internal */
function freezeRecord<Value extends Readonly<Record<string, unknown>>>(value: Value): Value {
	return recordCore.snapshot(value, 'codec record');
}

export type {
	Codec,
	DecodeInput,
	Decoded,
	EncodeInput,
	Encoded,
	CodecShape,
	ObjectDecodeInput,
	ObjectDecoded,
	ObjectEncodeInput,
	ObjectEncoded,
} from './types.ts';
