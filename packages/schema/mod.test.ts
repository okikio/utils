import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

import { define, is, jsonSchema, parse, prefixIssues, reject, SchemaValidationError, validate } from './mod.ts';

const PositiveInteger = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate(value: unknown) {
			return Number.isInteger(value) && Number(value) > 0
				? { value: value as number }
				: { issues: [{ message: 'Expected a positive integer.' }] };
		},
	},
} as const satisfies StandardSchemaV1<unknown, number>;

describe('schema', () => {
	it('adapts a native reader to synchronous parsing and Standard Schema', async () => {
		const LengthSchema = define((value) => {
			if (typeof value !== 'string') reject('Expected text.');
			return value.length;
		});
		expect(LengthSchema.parse('abc')).toBe(3);
		expect(await parse(LengthSchema, 'abc')).toBe(3);
		expect(() => LengthSchema.parse(4)).toThrow(SchemaValidationError);
		expect((await validate(LengthSchema, 4)).issues).toEqual([{ message: 'Expected text.' }]);
	});

	it('preserves structured issues and lets unexpected reader errors escape', async () => {
		const issues = [{ message: 'Invalid name.', path: ['name'] }];
		const InvalidSchema = define(() => {
			throw new SchemaValidationError(issues);
		});
		expect((await validate(InvalidSchema, null)).issues).toEqual(issues);
		const fault = new Error('Reader defect');
		const BrokenSchema = define(() => {
			throw fault;
		});
		await expect(validate(BrokenSchema, null)).rejects.toBe(fault);
		const typeFault = new TypeError('Unexpected reader defect.');
		const TypeBrokenSchema = define(() => {
			throw typeFault;
		});
		await expect(validate(TypeBrokenSchema, null)).rejects.toBe(typeFault);
	});
	it('recognizes and parses Standard Schema V1 contracts', async () => {
		expect(is(PositiveInteger)).toBe(true);
		expect(await parse(PositiveInteger, 3)).toBe(3);
	});

	it('accepts callable Standard validators and forwards vendor validation options', async () => {
		const options = { libraryOptions: { locale: 'en' } };
		const validator = Object.assign(() => undefined, {
			'~standard': {
				version: 1 as const,
				vendor: 'fixture',
				validate(value: unknown, received?: StandardSchemaV1.Options) {
					expect(received).toBe(options);
					return { value };
				},
			},
		});
		expect(is(validator)).toBe(true);
		expect(await parse(validator, 'text', options)).toBe('text');
		expect(await validate(validator, 3, options)).toEqual({ value: 3 });
	});

	it('converts Standard JSON Schema without demanding a validation method', () => {
		const options = { target: 'draft-07', libraryOptions: { description: true } } as const;
		const converter: StandardJSONSchemaV1<string, number> = {
			'~standard': {
				version: 1,
				vendor: 'fixture',
				jsonSchema: {
					input(received) {
						expect(received).toBe(options);
						return { type: 'string' };
					},
					output(received) {
						expect(received.target).toBe('draft-2020-12');
						return { type: 'number' };
					},
				},
			},
		};
		expect(is(converter)).toBe(false);
		expect(jsonSchema(converter, 'input', options)).toEqual({ type: 'string' });
		expect(jsonSchema(converter)).toEqual({ type: 'number' });
		expect(() => jsonSchema(PositiveInteger)).toThrow('Standard JSON Schema V1');
	});

	it('recognizes structural converter properties on callable values', () => {
		const convert = () => ({ type: 'string' });
		const converter = Object.assign(() => undefined, { input: convert, output: convert });
		const standard = Object.assign(() => undefined, { version: 1 as const, vendor: 'fixture', jsonSchema: converter });
		const definition = Object.assign(() => undefined, { '~standard': standard });
		expect(jsonSchema(definition)).toEqual({ type: 'string' });
		expect(is(definition)).toBe(false);
	});

	it('returns structured issues and throws a typed parse error', async () => {
		const result = await validate(PositiveInteger, 0);
		expect(result.issues?.[0]?.message).toBe('Expected a positive integer.');
		await expect(parse(PositiveInteger, 0)).rejects.toBeInstanceOf(SchemaValidationError);
	});

	it('prefixes nested issue paths without mutating the original issue', () => {
		const issue = { message: 'Invalid value.', path: ['field'] } satisfies StandardSchemaV1.Issue;
		const prefixed = prefixIssues([issue], 'items', 2);
		expect(prefixed[0]?.path).toEqual(['items', 2, 'field']);
		expect(issue.path).toEqual(['field']);
	});
});
