import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from './mod.ts';
import * as codec from './codec/mod.ts';

describe('native schema authoring', () => {
	it('composes primitives, arrays, tuples, literal unions and optional fields', () => {
		const ProfileSchema = schema.object({
			id: schema.string({ minLength: 1 }),
			age: schema.optional(schema.number({ integer: true, minimum: 0 })),
			roles: schema.array(schema.oneOf(['reader', 'writer'])),
			location: schema.tuple([schema.number(), schema.number()]),
			status: schema.union([schema.literal('active'), schema.literal(null)]),
		});
		expect(ProfileSchema.parse({ id: 'a', roles: ['reader'], location: [1, 2], status: null })).toEqual({
			id: 'a',
			roles: ['reader'],
			location: [1, 2],
			status: null,
		});
		expect(() => ProfileSchema.parse({ id: 'a', roles: [], location: [1], status: null })).toThrow();
		expect(() => ProfileSchema.parse({ id: 'a', roles: [], location: [1, 2], status: 'active', typo: 1 })).toThrow();
	});

	it('copies schema shapes and keeps overwrite types aligned with runtime extension', () => {
		const fields = { value: schema.string() };
		const OriginalSchema = schema.object(fields);
		fields.value = schema.string({ minLength: 5 });
		expect(OriginalSchema.parse({ value: 'a' }).value).toBe('a');
		const ExtendedSchema = schema.extend({ value: schema.string() }, { value: schema.number() });
		expect(ExtendedSchema.parse({ value: 3 }).value).toBe(3);
		expect(() => ExtendedSchema.parse({ value: 'a' })).toThrow();
	});

	it('keeps null, omitted properties and explicit undefined distinct', () => {
		const OptionalSchema = schema.object({ value: schema.optional(schema.nullable(schema.string())) });
		expect(Object.hasOwn(OptionalSchema.parse({}), 'value')).toBe(false);
		expect(Object.hasOwn(OptionalSchema.parse({ value: undefined }), 'value')).toBe(true);
		expect(OptionalSchema.parse({ value: null }).value).toBe(null);
	});

	it('validates defaults every time and returns fresh parsed containers', () => {
		const PositiveSchema = schema.number({ exclusiveMinimum: 0 });
		expect(() => schema.defaults(PositiveSchema, () => 0).parse(undefined)).toThrow();
		const borrowed = { names: ['a'] };
		const DefaultsSchema = schema.defaults(schema.object({ names: schema.array(schema.string()) }), () => borrowed);
		const first = DefaultsSchema.parse(undefined);
		first.names.push('b');
		expect(DefaultsSchema.parse(undefined).names).toEqual(['a']);
		expect(borrowed.names).toEqual(['a']);
	});

	it('resets regex state without changing the original expression', () => {
		const expression = /a/g;
		expression.lastIndex = 7;
		const TextSchema = schema.string({ pattern: expression });
		for (let count = 0; count < 5; count++) expect(TextSchema.parse('a')).toBe('a');
		expect(expression.lastIndex).toBe(7);
	});

	it('copies issue paths and never retains a previous rejected input', () => {
		const issues = [{ message: 'Child rejected.', path: ['leaf'] }];
		const ChildSchema = schema.define(() => {
			throw new schema.SchemaValidationError(issues);
		});
		const ParentSchema = schema.object({ rows: schema.array(ChildSchema) });
		for (let index = 0; index < 2; index++) {
			const result = ParentSchema['~standard'].validate({ rows: [0] });
			expect(result.issues?.[0]?.path).toEqual(['rows', 0, 'leaf']);
		}
		expect(issues[0]?.path).toEqual(['leaf']);
		const LiteralSchema = schema.literal('yes');
		expect(LiteralSchema['~standard'].validate(1).issues?.[0]?.message).toContain('number');
		expect(LiteralSchema['~standard'].validate(false).issues?.[0]?.message).toContain('boolean');
	});

	it('rejects object and array accessors without invoking them', () => {
		let reads = 0;
		const input = Object.defineProperty({}, 'name', {
			enumerable: true,
			get() {
				reads++;
				return 'a';
			},
		});
		expect(() => schema.object({ name: schema.string() }).parse(input)).toThrow();
		const values = Object.defineProperty([], 0, {
			enumerable: true,
			get() {
				reads++;
				return 'a';
			},
		});
		expect(() => schema.array(schema.string()).parse(values)).toThrow();
		expect(reads).toBe(0);
	});

	it('supports strict, stripping and preserving object policies explicitly', () => {
		const fields = { id: schema.number() };
		expect(schema.object(fields, { unknownKeys: 'strip' }).parse({ id: 1, extra: true })).toEqual({ id: 1 });
		expect(schema.object(fields, { unknownKeys: 'preserve' }).parse({ id: 1, extra: true })).toEqual({
			id: 1,
			extra: true,
		});
	});

	it('uses the actual default or inherited policy when a typed optional setting is absent', () => {
		const fields = { id: schema.string() };
		const optional: schema.ObjectOptions<'preserve'> = {};
		expect(() => schema.object(fields, optional).parse({ id: 'a', future: true })).toThrow(
			schema.SchemaValidationError,
		);
		const Base = schema.object(fields, { unknownKeys: 'preserve' });
		const replacement: schema.ObjectOptions<'strip'> = {};
		expect(schema.extend(Base, {}, replacement).parse({ id: 'a', future: true })).toEqual({ id: 'a', future: true });
		expect(() => schema.object(fields, undefined).parse({ id: 'a', future: true })).toThrow(
			schema.SchemaValidationError,
		);
	});

	it('keeps external record growth compatible after extending a preserving schema', () => {
		const ExternalSchema = schema.object({ id: schema.string() }, { unknownKeys: 'preserve' });
		const ExtendedSchema = schema.extend(ExternalSchema, { label: schema.string() });
		const incoming = { id: 'a', label: 'Ada', providerVersion: 2 };
		expect(ExtendedSchema.parse(incoming)).toEqual(incoming);
		expect(() => ExtendedSchema.parse({ ...incoming, id: 4 })).toThrow();
	});

	it('keeps stripping through extension unless the caller explicitly selects another policy', () => {
		const ExternalSchema = schema.object({ id: schema.string() }, { unknownKeys: 'strip' });
		const input = { id: 'a', label: 'Ada', future: true };
		expect(schema.extend(ExternalSchema, { label: schema.string() }).parse(input)).toEqual({ id: 'a', label: 'Ada' });
		expect(() => schema.extend(ExternalSchema, {}, { unknownKeys: 'reject' }).parse(input)).toThrow();
		expect(schema.extend(ExternalSchema, {}, { unknownKeys: 'preserve' }).parse(input)).toEqual(input);
	});

	it('projects stripping as permissive input and closed output', () => {
		const ExternalSchema = schema.object({ id: schema.string() }, { unknownKeys: 'strip' });
		expect(schema.jsonSchema(ExternalSchema, 'input')).toMatchObject({ additionalProperties: true });
		expect(schema.jsonSchema(ExternalSchema, 'output')).toMatchObject({ additionalProperties: false });
	});

	it('applies unknown-key policy at each object without loosening nested required fields', () => {
		const ExternalSchema = schema.object({
			profile: schema.object({ name: schema.string() }, { unknownKeys: 'preserve' }),
		}, { unknownKeys: 'strip' });
		expect(ExternalSchema.parse({ profile: { name: 'Ada', future: true }, transport: 2 })).toEqual({
			profile: { name: 'Ada', future: true },
		});
		expect(() => ExternalSchema.parse({ profile: { future: true } })).toThrow();
	});

	it('provides deliberate coercion without object conversion or truthiness', () => {
		expect(schema.coerce.number({ integer: true, minimum: 1 }).parse(' 12 ')).toBe(12);
		expect(schema.coerce.boolean().parse('false')).toBe(false);
		for (const input of ['', 'NaN', '0x10', {}, null]) expect(() => schema.coerce.number().parse(input)).toThrow();
		expect(() => schema.coerce.boolean().parse('yes')).toThrow();
	});

	it('has explicit asynchronous authoring and rejects thenables from synchronous readers', async () => {
		const LengthSchema = schema.defineAsync(async (value) => {
			if (typeof value !== 'string') schema.reject('Expected text.');
			return value.length;
		});
		expect(await LengthSchema.parse('abc')).toBe(3);
		await expect(LengthSchema.parse(1)).rejects.toThrow(schema.SchemaValidationError);
		const untyped = schema.define((() => Promise.resolve(1)) as unknown as (value: unknown) => number);
		expect(() => untyped.parse(null)).toThrow('defineAsync');
	});

	it('writes identity values and requires explicit inverses for transforms', async () => {
		const IdentitySchema = schema.object({ count: schema.number() });
		expect(await codec.write(IdentitySchema, { count: 2 })).toEqual({ count: 2 });
		const ConvertedSchema = schema.transform(schema.string(), (value) => value.length);
		expect(await codec.read(ConvertedSchema, 'abc')).toBe(3);
		await expect(codec.write(ConvertedSchema, 3)).rejects.toThrow('explicit codec encoder');
		const ExplicitCodec = codec.define({
			decode: schema.transform(schema.string(), Number),
			encode: schema.transform(schema.number(), String),
		});
		expect(await codec.write(ExplicitCodec, await codec.read(ExplicitCodec, '12'))).toBe('12');
	});

	it('projects supported Standard JSON Schema directions without executing defaults', () => {
		let defaults = 0;
		const ProjectSchema = schema.object({
			id: schema.string(),
			count: schema.defaults(schema.number(), () => {
				defaults++;
				return 1;
			}),
		});
		expect(schema.jsonSchema(ProjectSchema, 'input')).toMatchObject({ required: ['id'], additionalProperties: false });
		expect(schema.jsonSchema(ProjectSchema, 'output')).toMatchObject({ required: ['id', 'count'] });
		expect(defaults).toBe(0);
		const IdentityCodec = codec.identity(ProjectSchema);
		expect(schema.jsonSchema(codec.output(IdentityCodec))).toMatchObject({ required: ['id', 'count'] });
		const NestedOptionalSchema = schema.object({ name: schema.nullable(schema.optional(schema.string())) });
		expect(schema.jsonSchema(NestedOptionalSchema)).toMatchObject({ required: [] });
		expect(() => schema.jsonSchema(schema.refine(schema.string(), (value) => value.startsWith('a'), 'Expected a.')))
			.toThrow();
		expect(() => schema.jsonSchema(schema.string(), 'output', { target: 'openapi-3.0' })).toThrow();
	});

	it('keeps finite-key dictionaries partial and rejects transformed key collisions', () => {
		const DictionarySchema = schema.record(schema.oneOf(['a', 'b']), schema.number());
		expect(DictionarySchema.parse({})).toEqual({});
		expect(() => DictionarySchema.parse({ c: 1 })).toThrow();
		const KeysSchema = schema.transform(schema.string(), (value) => value.toLowerCase());
		expect(() => schema.record(KeysSchema, schema.number()).parse({ A: 1, a: 2 })).toThrow('collide');
	});
});

describe('native callback failures', () => {
	it('preserves programming exceptions from transforms, refinements and nested readers', async () => {
		const bug = new TypeError('Callback bug.');
		const readers: schema.Schema[] = [
			schema.transform(schema.string(), () => {
				throw bug;
			}),
			schema.refine(schema.string(), () => {
				throw bug;
			}, 'Not allowed.'),
			schema.object({
				value: schema.define(() => {
					throw bug;
				}),
			}),
		];
		for (const reader of readers) {
			await expect(schema.parse(reader, reader === readers[2] ? { value: 'x' } : 'x')).rejects.toBe(bug);
		}
		expect(schema.string()['~standard'].validate(3).issues?.[0]?.message).toBe('Expected a string.');
		expect(schema.refine(schema.string(), () => false, 'Not allowed.')['~standard'].validate('x').issues?.[0]?.message)
			.toBe('Not allowed.');
	});
});
