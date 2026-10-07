import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as query from './mod.ts';

type Scalar = string | number | boolean | null | bigint | Date;
function schema<T>(validate: (input: unknown) => T): StandardSchemaV1<unknown, T> {
	return {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate(input) {
				try {
					return { value: validate(input) };
				} catch {
					return { issues: [{ message: 'Invalid field value.' }] };
				}
			},
		},
	};
}
const string = schema((input) => {
	if (typeof input !== 'string') throw new Error();
	return input;
});
const scalar = schema<Scalar>((input) => {
	if (
		input === null || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'bigint' ||
		(typeof input === 'number' && Number.isFinite(input)) || (input instanceof Date && Number.isFinite(input.getTime()))
	) return input;
	throw new Error();
});
const fields = { id: query.field(string, { sortable: true }), value: query.field(scalar), name: query.field(string) };
const definition = query.define({
	fields,
	filters: { id: [query.eq], value: [query.eq, query.in, query.nin], name: [query.eq, query.contains] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset({ defaultStyle: 'page', defaultLimit: 25 }),
});

describe('collection Boolean URLs', () => {
	it('parses the shared AST and retains authored group order', async () => {
		const value = await definition.parse({
			filter: { $any: [{ name: 'second' }, { $not: { name: 'first' } }] },
			page: 2,
			per_page: 25,
		});
		expect(value.filter).toEqual({
			kind: 'any',
			filters: [
				{ field: 'name', operator: 'eq', value: 'second' },
				{ kind: 'not', filter: { field: 'name', operator: 'eq', value: 'first' } },
			],
		});
		expect(() => value.filters).toThrow(TypeError);
		expect(definition.inspect(value).filter).toBe(value.filter);
		expect(definition.inspect(value).expression).toEqual({ maximumDepth: 3, leafCount: 2, maximumSiblings: 2 });
		expect(JSON.parse(JSON.stringify(value)).filter.kind).toBe('any');
		const reparsed = await definition.parse(definition.encode(value));
		expect(reparsed.filter).toEqual(value.filter);
	});
	it('roundtrips nested authored conjunctions and repeated keys with mixed value types', async () => {
		for (
			const filter of [
				{ $all: [{ $all: [{ name: 'a' }, { id: 'b' }] }, { name: 'c' }] },
				{ $all: [{ value: { eq: 0 } }, { value: { eq: 'text' } }] },
				{ $all: [{ value: { eq: '~json:literal' } }, { value: { eq: 'text' } }] },
			]
		) {
			const value = await definition.parse({ filter });
			expect((await definition.parse(definition.encode(value))).filter).toEqual(value.filter);
			expect(definition.stringify(await definition.parse(definition.encode(value)))).toBe(definition.stringify(value));
		}
	});

	it('canonicalizes equivalent conjunctions, disjunctions, sets and page/offset forms', async () => {
		const first = await definition.parse({
			filter: { $all: [{ name: 'b' }, { $any: [{ value: { in: [false, 0, false, '0'] } }, { id: 'a' }] }] },
			page: 2,
			per_page: 25,
		});
		const second = await definition.parse({
			filter: { $all: [{ $any: [{ id: 'a' }, { value: { in: ['0', false, 0] } }] }, { name: 'b' }, { name: 'b' }] },
			offset: 25,
			limit: 25,
		});
		expect(definition.stringify(first)).toBe(definition.stringify(second));
		expect(query.stringify(definition, first)).toBe(definition.stringify(first));
		expect(definition.stringify(await definition.parse(new URLSearchParams(definition.stringify(first))))).toBe(
			definition.stringify(first),
		);
		expect(definition.inspect(first).filter).toBe(first.filter);
		expect(definition.inspect(first).normalized.filter).not.toEqual(first.filter);
	});
	it('eliminates double NOT without conflating differently typed scalar values', async () => {
		const positive = await definition.parse({ filter: { value: { eq: false } } });
		const double = await definition.parse({ filter: { $not: { $not: { value: { eq: false } } } } });
		expect(definition.stringify(positive)).toBe(definition.stringify(double));
		const values = await Promise.all(
			[false, 'false', 0, '0', null, 'null', 0n, ''].map((value) =>
				definition.parse({ filter: { value: { eq: value } } })
			),
		);
		expect(new Set(values.map((value) => definition.stringify(value))).size).toBe(values.length);
	});
	it('keeps all-only consumers and adapter validation fail-closed', async () => {
		const flat = query.define({
			fields,
			filters: { name: [query.eq] },
			order: [query.asc('id', { tiebreaker: true })],
			pagination: query.offset(),
		});
		expect((await flat.parse(new URLSearchParams('filter[name]=one&filter[name]=two'))).filters).toEqual([
			{ field: 'name', operator: 'eq', value: 'one' },
			{ field: 'name', operator: 'eq', value: 'two' },
		]);
		const unsupported = await flat.safeParse(new URLSearchParams('filter[$any][0][name]=one'));
		expect(unsupported.success).toBe(false);
		if (!unsupported.success) expect(unsupported.issues[0]!.code).toBe('unsupported-expression');
		expect(flat.validateAdapter({ operators: 'all', pagination: ['offset'], fieldSelection: ['simple'] }).valid).toBe(
			true,
		);
		const capability = definition.validateAdapter({
			operators: 'all',
			pagination: ['offset'],
			fieldSelection: ['simple'],
		});
		expect(capability.valid).toBe(false);
		if (!capability.valid) {
			expect(capability.issues.map((issue) => issue.code)).toEqual([
				'unsupported-expression',
				'unsupported-expression',
			]);
		}
		expect(
			definition.validateAdapter({
				operators: 'all',
				expressions: ['all', 'any', 'not'],
				pagination: ['offset'],
				fieldSelection: ['simple'],
			}).valid,
		).toBe(true);
	});
});

describe('collection projection and documentation', () => {
	it('uses canonical field sets while preserving authored projections and sort priority', async () => {
		const first = await definition.parse({ fields: 'name,id', offset: 0, limit: 25 });
		const second = await definition.parse({ fields: 'id,name', page: 1, per_page: 25 });
		expect(first.fields).toEqual({ kind: 'simple', fields: ['name', 'id'] });
		expect(definition.stringify(first)).toBe(definition.stringify(second));
		const resource = query.define({
			fields,
			filters: {},
			pagination: query.offset(),
			fieldsets: { accounts: ['id', 'name'], people: ['name'] },
		});
		const a = await resource.parse({ fields: { people: ['name'], accounts: ['name', 'id'] } });
		const b = await resource.parse({ fields: { accounts: ['id', 'name'], people: ['name'] } });
		expect(resource.stringify(a)).toBe(resource.stringify(b));
	});
	it('describes the actual canonical Boolean URL keys and configured budgets', async () => {
		const value = await definition.parse({ filter: { $any: [{ name: 'a' }, { $not: { value: { eq: false } } }] } });
		const description = definition['~standard-json-schema'].jsonSchema() as {
			properties: Record<string, unknown>;
			patternProperties: Record<string, unknown>;
			'x-query': Record<string, unknown>;
		};
		const patterns = Object.keys(description.patternProperties).map((pattern) => new RegExp(pattern));
		for (const key of new URLSearchParams(definition.stringify(value)).keys()) {
			expect(Object.hasOwn(description.properties, key) || patterns.some((pattern) => pattern.test(key))).toBe(true);
		}
		expect(patterns.some((pattern) => pattern.test('filter[$any][0][unknown][eq]'))).toBe(false);
		expect(description['x-query']).toMatchObject({
			expressions: ['all', 'any', 'not'],
			maximumDepth: 8,
			maximumSiblings: 100,
			maximumFilters: 20,
		});
	});
});

describe('lossless collection URL values', () => {
	it('roundtrips empty/Unicode/comma strings, typed scalars, Date and bigint', async () => {
		for (
			const literal of [
				'',
				'a,b',
				' snow 雪 ',
				'\uD800',
				'null',
				'not_null',
				'~json:raw',
				'~json:"quoted"',
				false,
				0,
				-0,
				null,
				12345678901234567890n,
				new Date('2026-10-02T12:34:56.000Z'),
			]
		) {
			const value = await definition.parse({ filter: { value: { eq: literal } } });
			const roundtrip = await definition.parse(new URLSearchParams(definition.stringify(value)));
			expect(roundtrip.filters[0]!.value).toEqual(literal);
			expect(definition.stringify(roundtrip)).toBe(definition.stringify(value));
			expect((await definition.parse(definition.encode(value))).filters[0]!.value).toEqual(literal);
		}
	});
	it('preserves list members that cannot use comma serialization', async () => {
		const literals = ['a,b', '', ' 雪 ', '~json:literal', null, false, 0, 1n];
		const value = await definition.parse({ filter: { value: { in: literals } } });
		expect(value.filters[0]!.value).toEqual(literals);
		expect((await definition.parse(definition.encode(value))).filters[0]!.value).toEqual(literals);
		const typed = await definition.parse(new URLSearchParams('filter[value][eq]=~json:"null"'));
		expect(typed.filters[0]).toEqual({ field: 'value', operator: 'eq', value: 'null' });
	});
	it('rejects malformed tags, mixed raw/tagged repeats and decoded schema violations', async () => {
		for (
			const raw of [
				'~json:no',
				'~json:[]',
				'~json:{"x":1}',
				'~json:{"$date":"2020"}',
				'~json:{"$bigint":"01"}',
				'~json:[[1]]',
				'~json:1e999',
			]
		) {
			expect((await definition.safeParse(new URLSearchParams([['filter[value][eq]', raw]]))).success).toBe(false);
		}
		expect(
			(await definition.safeParse(new URLSearchParams('filter[value][eq]=raw&filter[value][eq]=~json:"typed"')))
				.success,
		).toBe(false);
		expect((await definition.safeParse(new URLSearchParams('filter[name][eq]=~json:false'))).success).toBe(false);
	});
});

describe('bounded adversarial collection inputs', () => {
	it('rejects malformed, sparse, empty and unsupported Boolean grammar', async () => {
		for (
			const raw of [
				'filter=x',
				'filter[name][eq][more]=x',
				'filter[$xor][0][name]=x',
				'filter[$any][1][name]=x',
				'filter[$any][00][name]=x',
				'filter[$not]=x',
				'filter[name=bad',
			]
		) {
			expect((await definition.safeParse(new URLSearchParams(raw))).success).toBe(false);
		}
		for (const filter of [{ $all: [] }, { $any: [] }, { $not: {} }, { name: {} }]) {
			expect((await definition.safeParse({ filter })).success).toBe(false);
		}
	});
	it('enforces depth, sibling, repeated parameter, leaf and decoded value budgets', async () => {
		const bounded = query.define({
			fields,
			filters: { name: [query.eq, query.in] },
			expressions: ['all', 'any', 'not'],
			pagination: query.offset(),
			maximumDepth: 2,
			maximumSiblings: 2,
			maximumFilters: 3,
			maximumParameters: 4,
			maximumValueLength: 3,
			maximumValuesPerFilter: 2,
		});
		for (
			const input of [
				{ filter: { $not: { $not: { name: 'x' } } } },
				{ filter: { $any: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } },
				new URLSearchParams('filter[name]=a&filter[name]=b&filter[name]=c&filter[name]=d'),
				new URLSearchParams('other=1&other=2&other=3&other=4&other=5'),
				new URLSearchParams('filter[name]=~json:"long"'),
				new URLSearchParams('filter[name][in]=~json:["a","b","c"]'),
			]
		) expect((await bounded.safeParse(input)).success).toBe(false);
	});
	it('rejects nested accessors and inherited/sparse array elements without invoking them', async () => {
		let calls = 0;
		const child = Object.defineProperty({}, 'name', {
			enumerable: true,
			get() {
				calls++;
				return 'x';
			},
		});
		const children = Object.defineProperty([], '0', {
			enumerable: true,
			get() {
				calls++;
				return { name: 'x' };
			},
		});
		const inherited = Object.create({ name: 'x' });
		for (const filter of [{ $any: [child] }, { $any: children }, inherited, { $any: new Array(1) }]) {
			expect((await definition.safeParse({ filter })).success).toBe(false);
		}
		expect(calls).toBe(0);
	});
});
