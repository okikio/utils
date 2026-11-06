import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as TypeBoxSchema from 'typebox/schema';
import * as schema from './mod.ts';

/** Validate emitted JSON independently from the owned reader, after transport has removed object identity. */
function compare(definition: schema.JsonReader<unknown>, values: readonly unknown[]): void {
	for (const target of ['draft-07', 'draft-2020-12'] as const) {
		const engine = target === 'draft-07' ? new Ajv({ strict: true }) : new Ajv2020({ strict: true });
		for (const direction of ['input', 'output'] as const) {
			const document = JSON.parse(JSON.stringify(schema.jsonSchema(definition, direction, { target })));
			const check = engine.compile(document);
			for (const value of values) {
				const accepted = definition['~standard'].validate(value).issues === undefined;
				expect(check(value)).toBe(accepted);
				// The current TypeBox engine consumes 2020-12. Draft 07 positional
				// arrays are checked by the engine that explicitly supports that draft.
				if (target === 'draft-2020-12') expect(TypeBoxSchema.Check(document, value)).toBe(accepted);
			}
		}
	}
}

describe('native JSON Schema consumer conformance', () => {
	it('counts Unicode code points and retains compatible regex matching', () => {
		compare(schema.string({ minLength: 1, maxLength: 1 }), ['', 'a', '😀', '\uD800', 'e\u0301', 'ab', 1]);
		for (const pattern of [/^.$/u, /^.$/gu, /^.$/du]) {
			compare(schema.string({ pattern }), ['a', '😀', '\n', '', 'ab']);
		}
		for (const pattern of [/^.$/, /^a$/iu, /^a$/mu, /^.$/su, /a/yu, /^.$/v]) {
			const Text = schema.string({ pattern });
			expect(Text.parse('a')).toBe('a');
			expect(() => schema.jsonSchema(Text)).toThrow('Unicode u mode');
		}
	});

	it('does not widen safe integers and emits valid empty tuples and distinct enums', () => {
		compare(schema.number({ integer: true, minimum: -1e20, maximum: 1e20 }), [
			Number.MIN_SAFE_INTEGER - 1,
			Number.MIN_SAFE_INTEGER,
			0,
			1.5,
			Number.MAX_SAFE_INTEGER,
			Number.MAX_SAFE_INTEGER + 1,
		]);
		compare(schema.number({ minimum: -2, maximum: 2, exclusiveMinimum: -1, exclusiveMaximum: 1 }), [-2, -1, 0, 1, 2]);
		compare(schema.tuple([]), [[], [1], {}, null]);
		compare(schema.oneOf(['same', 'same', null, 0, -0]), ['same', 'other', null, 0, false]);
	});

	it('preserves nested arrays, record keys and overlapping unions in both drafts', () => {
		const Row = schema.object({
			name: schema.string({ minLength: 1 }),
			position: schema.tuple([schema.number(), schema.boolean()]),
			tags: schema.array(schema.string(), { minLength: 1, maxLength: 2 }),
			scores: schema.record(schema.oneOf(['a', 'b']), schema.number()),
			value: schema.union([schema.number(), schema.number({ integer: true })]),
		});
		const valid = { name: 'a', position: [1, true], tags: ['x'], scores: { a: 2 }, value: 2 };
		compare(Row, [
			valid,
			{ ...valid, tags: [] },
			{ ...valid, position: [1, true, 'extra'] },
			{ ...valid, scores: { c: 2 } },
			{ ...valid, value: '2' },
			{ ...valid, extra: true },
		]);
	});

	it('distinguishes accepted JSON input from defaulted and stripped output without running callbacks', () => {
		for (const target of ['draft-07', 'draft-2020-12'] as const) {
			let supplied = 0;
			const Settings = schema.object({
				label: schema.optional(schema.string()),
				retries: schema.defaults(schema.number({ integer: true, minimum: 0 }), () => ++supplied),
			}, { unknownKeys: 'strip' });
			const engine = target === 'draft-07' ? new Ajv({ strict: true }) : new Ajv2020({ strict: true });
			const input = engine.compile(schema.jsonSchema(Settings, 'input', { target }));
			const output = engine.compile(schema.jsonSchema(Settings, 'output', { target }));
			expect(supplied).toBe(0);
			const incoming = { extension: true };
			expect(input(incoming)).toBe(true);
			expect(incoming).toEqual({ extension: true });
			expect(output(incoming)).toBe(false);
			const parsed = Settings.parse(incoming);
			expect(parsed).toEqual({ retries: 1 });
			expect(output(parsed)).toBe(true);
			expect(input({ retries: -1 })).toBe(false);
			expect(output({ retries: 1, extension: true })).toBe(false);
		}
		compare(schema.object({ id: schema.string() }, { unknownKeys: 'preserve' }), [
			{ id: 'a', extension: { next: true } },
			{},
			{ id: 1 },
		]);
	});

	it('keeps transform input omission and refuses to invent output predicates or coercion rules', () => {
		let conversions = 0;
		const Label = schema.object({
			name: schema.transform(schema.optional(schema.string()), (value) => {
				conversions++;
				return value ?? 'default';
			}),
		});
		const input = new Ajv2020({ strict: true }).compile(schema.jsonSchema(Label, 'input'));
		expect(conversions).toBe(0);
		expect(input({})).toBe(true);
		expect(input({ name: 1 })).toBe(false);
		expect(Label.parse({})).toEqual({ name: 'default' });
		expect(() => schema.jsonSchema(Label, 'output')).toThrow('transformed output');
		const Rejected = schema.transform(schema.string(), () => {
			conversions++;
			return schema.reject('Callback rejected this otherwise valid string.');
		});
		const before = conversions;
		const source = new Ajv2020({ strict: true }).compile(schema.jsonSchema(Rejected, 'input'));
		expect(conversions).toBe(before);
		expect(source('text')).toBe(true);
		expect(Rejected['~standard'].validate('text').issues).toBeDefined();
		for (
			const definition of [
				schema.date(),
				schema.literal(undefined),
				schema.guard((value): value is bigint => typeof value === 'bigint'),
				schema.refine(schema.string(), (value) => value.startsWith('a'), 'Expected a prefix.'),
			]
		) {
			expect(() => schema.jsonSchema(definition)).toThrow(TypeError);
		}
		for (const definition of [schema.coerce.number({ minimum: 1 }), schema.coerce.string({ maxLength: 3 })]) {
			expect(() => schema.jsonSchema(definition, 'input')).toThrow('coercion');
			const output = new Ajv2020({ strict: true }).compile(schema.jsonSchema(definition, 'output'));
			expect(output(definition.parse(12))).toBe(true);
		}
		const booleanInput = new Ajv2020({ strict: true }).compile(schema.jsonSchema(schema.coerce.boolean(), 'input'));
		for (const value of [true, false, 'true', 'false']) expect(booleanInput(value)).toBe(true);
		for (const value of [1, 'TRUE', null]) expect(booleanInput(value)).toBe(false);
	});

	it('produces independent documents and fails unsupported target negotiation explicitly', () => {
		const Definition = schema.object({ value: schema.string() });
		const first = schema.jsonSchema(Definition);
		(first.properties as Record<string, unknown>).value = { type: 'number' };
		expect(schema.jsonSchema(Definition)).toMatchObject({ properties: { value: { type: 'string' } } });
		expect(Definition.parse({ value: 'a' })).toEqual({ value: 'a' });
		for (const target of ['openapi-3.0', 'draft-2019-09', 'future-draft']) {
			expect(() => schema.jsonSchema(Definition, 'input', { target })).toThrow('Unsupported JSON Schema target');
		}
	});
});
