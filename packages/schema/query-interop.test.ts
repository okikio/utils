import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as query from '@okikio/query';
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';
import * as response from '@okikio/http/response';
import * as hono from '@okikio/hono';
import { Hono } from 'hono';
import * as schema from './mod.ts';

const Search = query.define({
	fields: {
		id: query.field(schema.string()),
		score: query.field(schema.coerce.number({ minimum: 0, maximum: 100 }), {
			sortable: true,
			jsonSchema: { anyOf: [{ type: 'string' }, { type: 'number', minimum: 0, maximum: 100 }] },
		}),
		name: query.field(schema.string({ minLength: 2 })),
		hidden: query.field(schema.string(), { selectable: false }),
	},
	filters: { score: [query.gte, query.between, query.inArray], name: [query.eq] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	fieldsets: { people: ['id', 'name'], scores: ['score'] },
	pagination: query.pagination({ cursor: query.cursor(), offset: query.offset() }),
	maximumDepth: 3,
	maximumSiblings: 2,
	maximumFilters: 3,
	maximumValuesPerFilter: 2,
	maximumSorts: 1,
	maximumSelectedFields: 2,
});

describe('Query JSON representation consumers', () => {
	it('checks actual parsed and authored output against both strict Ajv dialects', async () => {
		const values = [
			await Search.parse({}),
			await Search.parse({
				filter: { $any: [{ score: { gte: '12' } }, { $not: { name: { eq: 'ok' } } }] },
				sort: 'score:desc',
			}),
			await Search.parse({ 'filter[score][between]': '~json:[10,20]', fields: 'id,name', offset: '10', limit: '5' }),
			await Search.parse({ fields: { people: ['id', 'name'] }, page: '2', per_page: '10' }),
			await Search.create({
				filter: Search.condition('score', 'gte', '20'),
				pagination: { kind: 'page', page: 2, limit: 10 },
			}),
		];
		for (const target of ['draft-07', 'draft-2020-12'] as const) {
			const engine = target === 'draft-07' ? new Ajv({ strict: true }) : new Ajv2020({ strict: true });
			const check = engine.compile(JSON.parse(JSON.stringify(schema.jsonSchema(Search, 'output', { target }))));
			for (const value of values) expect(check(value)).toBe(true);
			const base = values[0]!;
			for (
				const invalid of [
					{ ...base, fields: { kind: 'simple', fields: ['hidden'] } },
					{ ...base, fields: { kind: 'simple', fields: ['name', 'name'] } },
					{ ...base, fields: { kind: 'resource', resources: {} } },
					{ ...base, fields: { kind: 'resource', resources: { people: ['hidden'] } } },
					{ ...base, order: [{ field: 'hidden', direction: 'asc', tiebreaker: true }] },
					{ ...base, order: [{ field: 'id', direction: 'asc', tiebreaker: false }] },
					{ ...base, order: [] },
					{ ...base, filter: { field: 'score', operator: 'gte', value: -1 } },
					{ ...base, filter: { field: 'score', operator: 'between', value: [1] } },
					{ ...base, filter: { field: 'score', operator: 'in', value: [1, 2, 3] } },
					{ ...base, pagination: { kind: 'cursor', limit: 10, cursor: '' } },
					{ ...base, pagination: { kind: 'offset', limit: 10, offset: 0, source: 'page' } },
					{ ...base, pagination: { kind: 'offset', limit: 10, offset: 0, source: 'offset', page: 1 } },
					{ ...base, filter: query.not(query.not(query.not(Search.condition('name', 'eq', 'ok')))) },
					{ ...base, extra: true },
				]
			) expect(check(invalid)).toBe(false);
		}
	});

	it('does not claim structural JSON validation replaces parser work budgets or page normalization', async () => {
		const check = new Ajv2020({ strict: true }).compile(schema.jsonSchema(Search));
		const leaf = Search.condition('name', 'eq', 'ok');
		const filter = query.all(query.all(leaf, leaf), query.all(leaf, leaf));
		const base = await Search.parse({});
		// Every branch has a valid shape and immediate child count, but together
		// they exceed the parser's total filter budget of three leaves.
		expect(check({ ...base, filter })).toBe(true);
		const result = await Search.safeCreate({ filter });
		expect(result.success).toBe(false);
		if (!result.success) expect(result.issues.some((issue) => issue.code === 'too-many-filters')).toBe(true);
		const inconsistent = { kind: 'offset', limit: 10, offset: 0, source: 'page', page: 2 };
		expect(check({ ...base, pagination: inconsistent })).toBe(true);
		expect((await Search.create({ pagination: { kind: 'page', limit: 10, page: 2 } })).pagination).toEqual({
			...inconsistent,
			offset: 10,
		});
	});

	it('keeps tagged input validation usable while input conversion names its unsupported representation', async () => {
		expect(() => schema.jsonSchema(Search, 'input')).toThrow('~json: encoded operands for field "score"');
		expect(() => schema.jsonSchema(Search, 'input')).toThrow('wireSchema()');
		expect(Search.wireSchema()).toMatchObject({
			properties: { 'filter[score][gte]': {} },
			'x-query': { valueCodec: '~json:' },
		});
		expect((await schema.validate(Search, { 'filter[score][gte]': '~json:12' })).issues).toBeUndefined();
		expect((await schema.validate(Search, { 'filter[score][gte]': '~json:broken' })).issues).toBeDefined();
		expect((await schema.validate(Search, { 'filter[score][gte]': '~json:-1' })).issues).toBeDefined();
	});

	it('supports empty permission sets and preserves an explicitly authored duplicate default', async () => {
		const none = query.define({
			fields: { hidden: query.field(schema.string(), { selectable: false }) },
			pagination: query.offset(),
		});
		const duplicates = query.define({
			fields: { name: query.field(schema.string()) },
			pagination: query.offset(),
			defaultFields: ['name', 'name'],
		});
		for (const target of ['draft-07', 'draft-2020-12'] as const) {
			const engine = target === 'draft-07' ? new Ajv({ strict: true }) : new Ajv2020({ strict: true });
			for (const definition of [none, duplicates]) {
				const check = engine.compile(schema.jsonSchema(definition, 'output', { target }));
				expect(check(await definition.parse({}))).toBe(true);
			}
		}
	});

	it('requires a stable resource ID when embedding an external field schema with local references', () => {
		const make = (outputJsonSchema: unknown) =>
			query.define({
				fields: { code: query.field(schema.string(), { outputJsonSchema }) },
				filters: { code: [query.eq, query.inArray] },
				pagination: query.offset(),
			});
		const local = { $defs: { code: { type: 'string', minLength: 2 } }, allOf: [{ $ref: '#/$defs/code' }] };
		expect(() => schema.jsonSchema(make(local))).toThrow('field "code"');
		try {
			schema.jsonSchema(make(local));
		} catch (error) {
			expect((error as Error).cause).toBeInstanceOf(TypeError);
			expect(String((error as Error).cause)).toContain('absolute $id');
		}
		const scoped = make({ ...local, $id: 'https://example.test/query/code' });
		const check = new Ajv2020({ strict: true }).compile(JSON.parse(JSON.stringify(schema.jsonSchema(scoped))));
		const base = {
			order: [],
			fields: { kind: 'simple', fields: ['code'] },
			pagination: { kind: 'offset', limit: 50, offset: 0, source: 'offset' },
		};
		expect(check({ ...base, filter: { field: 'code', operator: 'eq', value: 'ok' } })).toBe(true);
		expect(check({ ...base, filter: { field: 'code', operator: 'eq', value: 'x' } })).toBe(false);
		const resource = { ...local, $id: 'https://example.test/query/shared-code' };
		const shared = (second: unknown) =>
			query.define({
				fields: {
					first: query.field(schema.string(), { outputJsonSchema: resource }),
					second: query.field(schema.string(), { outputJsonSchema: second }),
				},
				filters: { first: [query.eq], second: [query.eq] },
				pagination: query.offset(),
			});
		const identical = shared(structuredClone(resource));
		expect(() => new Ajv2020({ strict: true }).compile(schema.jsonSchema(identical))).not.toThrow();
		const conflict = shared({ ...resource, $defs: { code: { type: 'number' } } });
		expect(() => schema.jsonSchema(conflict)).toThrow('field "second" reuses JSON Schema $id');
	});

	it('declares nested resources once across operators and rejects collisions across different field documents', async () => {
		const identifier = 'https://example.test/query/nested-code';
		const scalar = { anyOf: [{ $id: identifier, type: 'string', minLength: 2 }, { type: 'number' }] };
		const Code = schema.union([schema.string({ minLength: 2 }), schema.number()]);
		const make = (second?: unknown) =>
			query.define({
				fields: {
					code: query.field(Code, { outputJsonSchema: scalar }),
					...(second === undefined ? {} : { other: query.field(Code, { outputJsonSchema: second }) }),
				},
				filters: { code: [query.eq, query.inArray], ...(second === undefined ? {} : { other: [query.eq] }) },
				pagination: query.offset(),
			});
		for (const target of ['draft-07', 'draft-2020-12'] as const) {
			for (const definition of [make(), make(structuredClone(scalar))]) {
				const engine = target === 'draft-07' ? new Ajv({ strict: true }) : new Ajv2020({ strict: true });
				const check = engine.compile(JSON.parse(JSON.stringify(schema.jsonSchema(definition, 'output', { target }))));
				for (const wire of [{ 'filter[code]': 'ok' }, { 'filter[code][in]': '~json:["ok",12]' }]) {
					const value = await definition.parse(wire);
					expect(check(value)).toBe(true);
					expect(check({ ...value, filter: { field: 'code', operator: 'eq', value: 'x' } })).toBe(false);
				}
			}
		}
		expect(() => schema.jsonSchema(make({ allOf: [{ $id: identifier, type: 'number' }] }))).toThrow(
			'field "other" reuses JSON Schema $id',
		);
		const relative = query.define({
			fields: {
				first: query.field(Code, {
					outputJsonSchema: {
						$id: 'https://example.test/query/',
						anyOf: [{ $id: 'nested-code', type: 'string' }],
					},
				}),
				second: query.field(Code, { outputJsonSchema: scalar }),
			},
			filters: { first: [query.eq], second: [query.eq] },
			pagination: query.offset(),
		});
		expect(() => schema.jsonSchema(relative)).toThrow('field "second" reuses JSON Schema $id');
	});

	it('requires inline wire metadata when parameter extraction cannot preserve resource scope', () => {
		const make = (jsonSchema: unknown) =>
			query.define({
				fields: { code: query.field(schema.string({ minLength: 2 }), { jsonSchema }) },
				filters: { code: [query.eq] },
				pagination: query.offset(),
			});
		for (
			const document of [
				{ $id: 'https://example.test/query/wire-code', type: 'string', minLength: 2 },
				{ anyOf: [{ $id: 'https://example.test/query/wire-inner', type: 'string' }] },
				{ $ref: 'https://example.test/query/external-code' },
				{ $defs: { code: { type: 'string' } }, $ref: '#/$defs/code' },
			]
		) {
			expect(() => make(document).wireSchema()).toThrow('field "code"');
			expect(() => make(document).wireSchema()).toThrow('inline jsonSchema metadata');
		}
		const inline = make({ type: 'string', minLength: 2 }).wireSchema();
		const check = new Ajv2020({ strict: false }).compile(JSON.parse(JSON.stringify(inline)));
		expect(check({ 'filter[code]': 'ok', 'filter[code][eq]': 'ok' })).toBe(true);
		expect(check({ 'filter[code]': 'x' })).toBe(false);
		// These keys are literal JSON data, not declarations or references.
		expect(() => make({ const: { $id: 'relative', $ref: '#literal' } }).wireSchema()).not.toThrow();
	});

	it('fails field-specific JavaScript-only output projection while preserving validation', async () => {
		const definition = query.define({
			fields: { at: query.field(schema.date(), { jsonSchema: { type: 'string' } }) },
			filters: { at: [query.eq] },
			pagination: query.offset(),
		});
		expect(() => schema.jsonSchema(definition, 'output')).toThrow('field "at" has no usable output');
		expect((await definition.safeCreate({ filter: definition.condition('at', 'eq', new Date(0)) })).success).toBe(true);
	});
});

describe('Query documentation through Server and Hono', () => {
	it('requires the explicit wire document and keeps HTTP runtime validation active', async () => {
		const Search = query.define({
			fields: { name: query.field(schema.string({ minLength: 2 })) },
			filters: { name: [query.eq] },
			pagination: query.offset(),
		});
		const Result = response.ok(schema.object({ count: schema.number() }), {
			id: 'search-result',
			description: 'Search result.',
		});
		const bare = endpoint.get({ id: 'search.bare', path: '/bare', query: Search, responses: [Result] });
		await expect(endpoint.openapi([bare], { title: 'Search', version: '1' })).rejects.toThrow('could not be projected');
		const route = endpoint.get({
			id: 'search.documented',
			path: '/search',
			query: endpoint.input(Search, { jsonSchema: Search.wireSchema() }),
			responses: [Result],
		});
		const document = await endpoint.openapi([route], { title: 'Search', version: '1' });
		expect(document.paths['/search']!.get).toMatchObject({
			parameters: [
				{ in: 'query', name: 'filter[name]' },
				{ in: 'query', name: 'filter[name][eq]' },
				{},
				{},
				{},
				{},
				{},
			],
		});
		const definition = service.define({ id: 'schema-query-interop', path: '/', endpoints: [route] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [
					endpoint.handler(
						route,
						({ input }) => response.create(Result, { count: input.query.filter === undefined ? 0 : 1 }),
					),
				],
			})),
			{ host: {} },
		);
		const app = hono.mount(new Hono(), runtime);
		for (const path of ['/search?filter%5Bname%5D=ok', '/search?filter%5Bname%5D=x']) {
			const native = await runtime.fetch(new Request(`https://example.test${path}`));
			const mounted = await app.request(`https://example.test${path}`);
			expect(mounted.status).toBe(native.status);
			expect(await mounted.json()).toEqual(await native.json());
			expect(native.status).toBe(path.endsWith('=ok') ? 200 : 400);
		}
	});
});
