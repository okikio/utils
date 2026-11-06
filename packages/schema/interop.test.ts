import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { Ajv, ValidationError } from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import Type from 'typebox';
import { Compile } from 'typebox/compile';
import * as TypeBoxSchema from 'typebox/schema';
import { Type as LegacyType } from '@sinclair/typebox';
import { TypeCompiler as LegacyCompiler } from '@sinclair/typebox/compiler';
import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import * as schema from './mod.ts';

/** Decode JSON Pointer segments as strings; a numeric property name is not necessarily an array index. */
function path(pointer: string): readonly string[] {
	return pointer === ''
		? []
		: pointer.slice(1).split('/').map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** Snapshot Ajv errors immediately because another call reuses the validator's errors property. */
function issues(
	errors: readonly Partial<ErrorObject>[] | null | undefined,
): readonly schema.SchemaValidationError['issues'][number][] {
	return (errors ?? []).map((error) => {
		const property = error.keyword === 'required'
			? error.params?.missingProperty
			: error.keyword === 'additionalProperties'
			? error.params?.additionalProperty
			: undefined;
		return {
			message: error.message ?? `Invalid ${error.keyword ?? 'value'}.`,
			path: [...path(error.instancePath ?? ''), ...(typeof property === 'string' ? [property] : [])],
		};
	});
}

/** The caller owns Ajv configuration; this fixture deliberately adapts only a synchronous, nonmutating validator. */
function fromAjv<Value>(check: ValidateFunction<Value>): schema.Schema<unknown, Value> {
	return {
		'~standard': {
			version: 1,
			vendor: 'ajv-fixture',
			validate(value) {
				return check(value) ? { value } : { issues: issues(check.errors) };
			},
		},
	};
}

describe('optional validator interoperability', () => {
	it('adapts Ajv with precise issue paths and keeps errors independent between calls', async () => {
		const engine = new Ajv2020({ strict: true, allErrors: true });
		const check = engine.compile<{ 'a/b': { '~key': number } }>({
			type: 'object',
			properties: {
				'a/b': {
					type: 'object',
					properties: { '~key': { type: 'number' } },
					required: ['~key'],
					additionalProperties: false,
				},
			},
			required: ['a/b'],
			additionalProperties: false,
		});
		const Adapted = fromAjv(check);
		const input = { 'a/b': { '~key': 3 } };
		expect(await schema.parse(Adapted, input)).toBe(input);
		const invalid = await schema.validate(Adapted, { 'a/b': { '~key': '3' } });
		expect(invalid.issues?.[0]?.path).toEqual(['a/b', '~key']);
		expect((await schema.validate(Adapted, { 'a/b': {} })).issues?.[0]?.path).toEqual(['a/b', '~key']);
		expect(invalid.issues?.[0]?.path).toEqual(['a/b', '~key']);
		expect(() => schema.jsonSchema(Adapted)).toThrow('Standard JSON Schema V1');
	});

	it('round trips external JSON resources without changing refs, unions or their declared dialect', async () => {
		const document = JSON.parse(JSON.stringify({
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			$id: 'https://example.test/contracts/search',
			$defs: { id: { type: 'string', minLength: 1 } },
			type: 'object',
			properties: {
				id: { $ref: '#/$defs/id' },
				value: { anyOf: [{ type: 'number' }, { type: 'string', minLength: 2 }] },
			},
			required: ['id', 'value'],
			additionalProperties: false,
		}));
		const check = new Ajv2020({ strict: true }).compile<{ id: string; value: number | string }>(document);
		const Adapted = fromAjv(check);
		const convert: StandardJSONSchemaV1.Converter['input'] = (options) => {
			if (options.target !== 'draft-2020-12') {
				throw new TypeError('This external document only supplies draft 2020-12.');
			}
			return structuredClone(document);
		};
		const Contract = {
			'~standard': { ...Adapted['~standard'], jsonSchema: { input: convert, output: convert } },
		};
		const exported = schema.jsonSchema(Contract);
		expect(exported).toEqual(document);
		expect(exported).not.toBe(document);
		for (const value of [{ id: 'a', value: 3 }, { id: 'b', value: 'ok' }]) {
			expect(await schema.parse(Contract, value)).toBe(value);
			expect(TypeBoxSchema.Check(exported, value)).toBe(true);
		}
		for (const value of [{ id: '', value: 3 }, { id: 'b', value: 'x' }, { id: 'a', value: 1, extra: true }]) {
			expect((await schema.validate(Contract, value)).issues).toBeDefined();
			expect(TypeBoxSchema.Check(exported, value)).toBe(false);
		}
		expect(() => schema.jsonSchema(Contract, 'input', { target: 'draft-07' })).toThrow('only supplies draft 2020-12');
		expect(() => new Ajv({ strict: true }).compile(exported)).toThrow();
	});

	it('treats formats and mutation as explicit engine choices', async () => {
		const document = { type: 'string', format: 'email' };
		expect(() => new Ajv2020({ strict: true }).compile(document)).toThrow('unknown format');
		const engine = new Ajv2020({ strict: true });
		engine.addFormat('email', fullFormats.email);
		const Email = fromAjv(engine.compile<string>(document));
		expect(await schema.parse(Email, 'person@example.test')).toBe('person@example.test');
		await expect(schema.parse(Email, 'missing-at')).rejects.toThrow(schema.SchemaValidationError);

		const settings = {
			type: 'object',
			properties: { retries: { type: 'integer', default: 3 } },
			additionalProperties: false,
		};
		const pure = engine.compile(settings);
		const input: Record<string, unknown> = {};
		expect(pure(input)).toBe(true);
		expect(input).toEqual({});
		const mutating = new Ajv2020({ strict: true, useDefaults: true, removeAdditional: true, coerceTypes: true });
		const check = mutating.compile(settings);
		const changed: Record<string, unknown> = { extra: true };
		expect(check(changed)).toBe(true);
		expect(changed).toEqual({ retries: 3 });
		const coerced = { retries: '4' };
		expect(check(coerced)).toBe(true);
		expect(coerced).toEqual({ retries: 4 });
		// A scalar argument cannot be replaced in its caller. A Standard adapter
		// must not claim that a mutating Ajv check returns a coerced root value.
		const scalar = mutating.compile({ type: 'integer' });
		const original = '4';
		expect(scalar(original)).toBe(true);
		expect(original).toBe('4');
	});

	it('adapts asynchronous Ajv validation without swallowing operational failures', async () => {
		const fault = new Error('Lookup unavailable.');
		const engine = new Ajv2020({ strict: true });
		engine.addKeyword({
			keyword: 'available',
			async: true,
			type: 'string',
			schemaType: 'boolean',
			validate: async (_enabled: boolean, value: string) => {
				if (value === 'fault') throw fault;
				return value === 'ready';
			},
		});
		const check = engine.compile<string>({ $async: true, type: 'string', available: true });
		const Adapted = schema.defineAsync(async (value) => {
			try {
				return await check(value);
			} catch (error) {
				if (!(error instanceof ValidationError)) throw error;
				throw new schema.SchemaValidationError(issues(error.errors));
			}
		});
		expect(await schema.parse(Adapted, 'ready')).toBe('ready');
		expect((await schema.validate(Adapted, 'taken')).issues?.length).toBeGreaterThan(0);
		await expect(schema.validate(Adapted, 'fault')).rejects.toBe(fault);
		expect(() => schema.jsonSchema(Adapted)).toThrow('Standard JSON Schema V1');
	});

	it('uses the published current TypeBox Check API without silently decoding codecs', async () => {
		const Document = Type.Object({ count: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
		const validator = Compile(Document);
		const Adapted = schema.define((value) => {
			if (validator.Check(value)) return value;
			throw new schema.SchemaValidationError(
				validator.Errors(value).map((error) => ({
					message: error.message,
					path: path(error.instancePath),
				})),
			);
		});
		expect(schema.is(Document)).toBe(false);
		expect(schema.is(validator)).toBe(false);
		expect(await schema.parse(Adapted, { count: 1 })).toEqual({ count: 1 });
		expect((await schema.validate(Adapted, { count: -1 })).issues?.[0]?.path).toEqual(['count']);
		const ajv = new Ajv2020({ strict: true }).compile(JSON.parse(JSON.stringify(Document)));
		expect(ajv({ count: 1 })).toBe(true);
		expect(ajv({ count: 1, extra: true })).toBe(false);

		const Converted = Compile(Type.Codec(Type.String({ pattern: '^\\d+$' })).Decode(Number).Encode(String));
		const checked = schema.define((value) => {
			if (!Converted.Check(value)) schema.reject('Expected decimal text.');
			return value;
		});
		expect(checked.parse('12')).toBe('12');
		expect(Converted.Decode('12')).toBe(12);
		expect(Converted.Encode(12)).toBe('12');
		expect(() => schema.jsonSchema(checked)).toThrow('Standard JSON Schema V1');
	});

	it('keeps legacy TypeBox authoring and its draft 07 tuple representation explicit', async () => {
		const Document = LegacyType.Object({
			point: LegacyType.Tuple([LegacyType.Number(), LegacyType.Number()]),
		}, { additionalProperties: false });
		const compiled = LegacyCompiler.Compile(Document);
		const Adapted = schema.define((value) => {
			if (compiled.Check(value)) return value;
			throw new schema.SchemaValidationError([...compiled.Errors(value)].map((error) => ({
				message: error.message,
				path: path(error.path),
			})));
		});
		expect(schema.is(Document)).toBe(false);
		expect(await schema.parse(Adapted, { point: [1, 2] })).toEqual({ point: [1, 2] });
		expect((await schema.validate(Adapted, { point: [1, '2'] })).issues?.[0]?.path).toEqual(['point', '1']);
		const transported = JSON.parse(JSON.stringify(Document));
		const check = new Ajv({ strict: true }).compile(transported);
		expect(check({ point: [1, 2] })).toBe(true);
		expect(check({ point: [1, 2, 3] })).toBe(false);
		expect(() => new Ajv2020({ strict: true }).compile(transported)).toThrow();
	});
});
