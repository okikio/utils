import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as query from './mod.ts';

const StringSchema: StandardSchemaV1<unknown, string> = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate(value) {
			return typeof value === 'string' && value.length > 0
				? { value }
				: { issues: [{ message: 'Expected a string.' }] };
		},
	},
};
const NumberSchema: StandardSchemaV1<unknown, number> = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate(value) {
			const number = typeof value === 'number' ? value : Number(value);
			return Number.isFinite(number) ? { value: number } : { issues: [{ message: 'Expected a number.' }] };
		},
	},
};

const Definition = query.define({
	fields: {
		id: query.field(StringSchema, { sortable: true }),
		name: query.field(StringSchema, { sortable: true }),
		score: query.field(NumberSchema, { sortable: true }),
		deletedAt: query.field(StringSchema),
		secret: query.field(StringSchema, { selectable: false }),
	},
	filters: {
		name: [query.eq, query.icontains, query.in],
		score: [query.gte, query.between],
		deletedAt: [query.isNull, query.isNotNull],
	},
	order: [query.desc('id', { tiebreaker: true })],
	pagination: query.pagination({
		default: 'cursor',
		cursor: query.cursor({ defaultLimit: 25, maximumLimit: 100 }),
		offset: query.offset({ defaultLimit: 20, maximumLimit: 100 }),
	}),
	fieldsets: {
		widgets: ['id', 'name', 'score'],
		owners: ['id', 'name'],
	},
	defaultFields: ['id', 'name', 'score'],
});

describe('query definitions', () => {
	it('roundtrips the requested-sort limit with its stable field for offset and cursor consumers', async () => {
		const Limited = query.define({
			fields: {
				id: query.field(StringSchema, { sortable: true }),
				name: query.field(StringSchema, { sortable: true }),
				priority: query.field(NumberSchema, { sortable: true }),
				seniority: query.field(NumberSchema, { sortable: true }),
				domain: query.field(StringSchema, { sortable: true }),
				hidden: query.field(StringSchema),
			},
			order: [query.asc('id', { tiebreaker: true })],
			pagination: query.pagination({ default: 'cursor', cursor: query.cursor(), offset: query.offset() }),
			maximumSorts: 3,
		});
		for (const pagination of [{ offset: '25' }, { cursor: 'opaque' }]) {
			const value = await Limited.parse({ sort: 'priority:asc,seniority:desc,name:asc', ...pagination });
			expect(value.order).toHaveLength(4);
			expect((await Limited.parse(Limited.encode(value))).order).toEqual(value.order);
			expect((await Limited.parse(new URLSearchParams(Limited.stringify(value)))).pagination).toEqual(value.pagination);
			const reversed = await Limited.parse({ sort: 'priority:asc,seniority:desc,name:asc,id:desc', ...pagination });
			expect(reversed.order.at(-1)).toEqual({ field: 'id', direction: 'desc', tiebreaker: true });
			expect((await Limited.parse(Limited.encode(reversed))).order).toEqual(reversed.order);
		}
		for (
			const [sort, code] of [
				['priority:asc,seniority:desc,name:asc,domain:asc,id:asc', 'too-many-sorts'],
				['priority:asc,id:asc,id:desc', 'duplicate-sort'],
				['priority:sideways,id:asc', 'invalid-sort'],
				['missing:asc,id:asc', 'unknown-field'],
				['hidden:asc,id:asc', 'sorting-disabled'],
			] as const
		) {
			const parsed = await Limited.safeParse({ sort });
			expect(parsed.success).toBe(false);
			if (!parsed.success) expect(parsed.issues.map((entry) => entry.code)).toContain(code);
		}
	});

	it('is strict inside the reserved query grammar without claiming unrelated parameters', async () => {
		const unknownField = await Definition.safeParse(new URLSearchParams({ 'filter[missing]': 'x' }));
		expect(unknownField.success).toBe(false);
		if (!unknownField.success) expect(unknownField.issues[0]?.code).toBe('unknown-field');

		const unknownOperator = await Definition.safeParse(new URLSearchParams({ 'filter[name][explode]': 'x' }));
		expect(unknownOperator.success).toBe(false);
		if (!unknownOperator.success) expect(unknownOperator.issues[0]?.code).toBe('unknown-operator');

		const malformedPagination = await Definition.safeParse(new URLSearchParams({ offset: '-1', limit: 'none' }));
		expect(malformedPagination.success).toBe(false);
		if (!malformedPagination.success) {
			expect(malformedPagination.issues.map((entry) => entry.code)).toContain('invalid-limit');
			expect(malformedPagination.issues.map((entry) => entry.code)).toContain('invalid-offset');
		}

		const unrelated = await Definition.parse(new URLSearchParams({ someOtherMiddlewareParameter: 'value' }));
		expect(unrelated.filters).toEqual([]);
		expect(unrelated.pagination.limit).toBe(
			Definition.pagination.kind === 'query-pagination-modes'
				? Definition.pagination.cursor?.defaultLimit ?? Definition.pagination.offset?.defaultLimit
				: Definition.pagination.defaultLimit,
		);
	});

	it('validates operator cardinality, value length, and filter limits', async () => {
		const pair = await Definition.safeParse(new URLSearchParams({ 'filter[score][between]': '10' }));
		expect(pair.success).toBe(false);
		if (!pair.success) expect(pair.issues[0]?.code).toBe('invalid-value');

		const many = await Definition.safeParse(new URLSearchParams({ 'filter[name][in]': 'a,b,c' }));
		expect(many.success).toBe(true);
		if (many.success) expect(many.value.filters[0]?.value).toEqual(['a', 'b', 'c']);

		const Limited = query.define({
			fields: { id: query.field(StringSchema, { sortable: true }), name: query.field(StringSchema) },
			filters: { name: [query.eq, query.in] },
			order: [query.asc('id', { tiebreaker: true })],
			pagination: query.cursor(),
			maximumFilters: 1,
			maximumValuesPerFilter: 2,
			maximumValueLength: 3,
		});
		for (
			const [parameters, code] of [
				[{ 'filter[name]': 'long' }, 'value-too-long'],
				[{ 'filter[name][in]': 'a,b,c' }, 'too-many-filter-values'],
				[{ 'filter[name]': 'a', 'filter[name][in]': 'b' }, 'too-many-filters'],
			] as const
		) {
			const limits = await Limited.safeParse(new URLSearchParams(parameters));
			expect(limits.success).toBe(false);
			if (!limits.success) expect(limits.issues.map((entry) => entry.code)).toContain(code);
		}
	});

	it('accepts the flat plain record produced by HTTP query parsing', async () => {
		const value = await Definition.parse({
			'filter[name][icontains]': 'example',
			sort: 'score:desc,id:asc',
			fields: 'id,name',
			page: '2',
			per_page: '10',
		});
		expect(value.filters).toEqual([{ field: 'name', operator: 'icontains', value: 'example' }]);
		expect(value.order).toEqual([
			{ field: 'score', direction: 'desc', tiebreaker: false },
			{ field: 'id', direction: 'asc', tiebreaker: true },
		]);
		expect(value.fields).toEqual({ kind: 'simple', fields: ['id', 'name'] });
		expect(value.pagination).toEqual({ kind: 'offset', source: 'page', page: 2, offset: 10, limit: 10 });

		const repeatedFields = await Definition.parse({ fields: ['id', 'name'] });
		expect(repeatedFields.fields).toEqual({ kind: 'simple', fields: ['id', 'name'] });

		const invalidFields = await Definition.safeParse({ fields: new Date(0) });
		expect(invalidFields.success).toBe(false);
		if (!invalidFields.success) {
			expect(invalidFields.issues[0]).toMatchObject({
				code: 'invalid-input',
				path: ['fields'],
			});
		}
	});

	it('documents the exact wire grammar and provider requirements', () => {
		const document = Definition.document();
		expect(document.wire).toEqual({
			filter: 'filter[field]=value / filter[field][operator]=value',
			expression:
				'filter[$all][index][field][operator]=value / filter[$any][index][field][operator]=value / filter[$not][field][operator]=value',
			value: 'raw scalar or comma list / ~json: typed scalar or list',
			sort: 'sort=field:direction,field:direction',
			fields: 'fields=a,b / fields[resource]=a,b',
			pagination: ['cursor=opaque&limit=50', 'offset=40&limit=20', 'page=3&per_page=20'],
		});
		expect(Definition.requirements()).toMatchObject({
			pagination: ['cursor', 'offset'],
			fieldSelection: ['simple', 'resource'],
			stableTiebreaker: 'id',
		});
	});

	it('projects the actual flat URL parameters for OpenAPI rather than a fictitious pagination object', async () => {
		const schema = await Definition['~standard-json-schema'].jsonSchema() as {
			readonly properties: Readonly<Record<string, unknown>>;
		};
		expect(Object.keys(schema.properties)).toEqual([
			'filter[name]',
			'filter[name][eq]',
			'filter[name][icontains]',
			'filter[name][in]',
			'filter[score][gte]',
			'filter[score][between]',
			'filter[deletedAt]',
			'filter[deletedAt][is_null]',
			'filter[deletedAt][is_not_null]',
			'sort',
			'fields',
			'fields[widgets]',
			'fields[owners]',
			'cursor',
			'limit',
			'offset',
			'page',
			'per_page',
		]);
		expect(schema.properties.pagination).toBeUndefined();
		for (const name of ['limit', 'offset', 'page', 'per_page'] as const) {
			expect(schema.properties[name]).not.toHaveProperty('default');
		}
	});

	it('keeps runtime pagination defaults even though OpenAPI does not prefill mutually exclusive forms', async () => {
		const value = await Definition.parse(new URLSearchParams());
		expect(value.pagination).toEqual({ kind: 'cursor', limit: 25 });
	});
});
