import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as query from './mod.ts';
import { capabilities, compile, compilePage } from './postgres.ts';

const Search = query.define({
	fields: {
		id: query.field(schema.number(), { sortable: true }),
		name: query.field(schema.string()),
	},
	filters: { id: [query.gte, query.in], name: [query.eq, query.contains] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset({ defaultLimit: 5 }),
});
const mapping = { table: ['public', 'people'], columns: { id: 'person_id', name: 'display_name' } } as const;

describe('PostgreSQL query compilation', () => {
	it('binds values and preserves nested Boolean structure, projection, ordering, and bounds', async () => {
		expect(Search.validateAdapter(capabilities).valid).toBe(true);
		const checked = await Search.create({
			filter: query.any(Search.condition('id', 'gte', 3), query.not(Search.condition('name', 'eq', "Ada' OR true"))),
		});

		const statement = compile(checked, mapping);

		expect(statement.text).toBe(
			'SELECT "person_id" AS "id", "display_name" AS "name" FROM "public"."people" WHERE (("person_id" >= $1) OR (NOT ("display_name" IS NOT DISTINCT FROM $2))) ORDER BY "public"."people"."person_id" ASC NULLS LAST LIMIT $3 OFFSET $4',
		);
		expect(statement.values).toEqual([3, "Ada' OR true", 5, 0]);
		expect(Object.isFrozen(statement.values)).toBe(true);
	});

	it('keeps SQL wildcard characters literal and quotes trusted identifiers', async () => {
		const checked = await Search.create({ filter: Search.condition('name', 'contains', '%_\\') });
		const statement = compile(checked, { table: ['odd"table'], columns: { id: 'id', name: 'name' } });
		expect(statement.text).toContain('FROM "odd""table" WHERE (strpos("name", $1) > 0)');
		expect(statement.values[0]).toBe('%_\\');
	});

	it('rejects unsupported modes and missing column authority before driver execution', async () => {
		const checked = await Search.create();
		expect(() => compile(checked, { table: ['people'], columns: { id: 'id' } })).toThrow('mapped');
		expect(() => compile({ ...checked, pagination: { kind: 'cursor', limit: 2, cursor: 'untrusted' } }, mapping))
			.toThrow('Authenticate');
		expect(() => compile({ ...checked, fields: { kind: 'resource', resources: { people: ['id'] } } }, mapping)).toThrow(
			'simple',
		);
		expect(() =>
			compile({ ...checked, pagination: { kind: 'offset', limit: 1, offset: -1, source: 'offset' } }, mapping)
		).toThrow('safe integers');
	});

	it('rejects cyclic expressions and non-scalar driver coercion before returning SQL', async () => {
		const checked = await Search.create();
		const cyclic: { kind: 'not'; filter?: unknown } = { kind: 'not' };
		cyclic.filter = cyclic;
		expect(() => Reflect.apply(compile, undefined, [{ ...checked, filter: cyclic }, mapping])).toThrow('acyclic');
		expect(() =>
			Reflect.apply(compile, undefined, [{ ...checked, filter: { field: 'id', operator: 'eq', value: {} } }, mapping])
		).toThrow('scalar');
		expect(() =>
			Reflect.apply(compile, undefined, [
				{ ...checked, filter: { field: 'name', operator: 'contains', value: null } },
				mapping,
			])
		).toThrow('string');
		expect(() =>
			Reflect.apply(compile, undefined, [{ ...checked, filter: { field: 'id', operator: 'in', value: [] } }, mapping])
		).toThrow('1 to 1000');
	});
});

describe('PostgreSQL cursor and join contracts', () => {
	it('authenticates opaque cursors before producing a mixed-direction keyset', async () => {
		const checked = await Search.create();
		const value = { ...checked, pagination: { kind: 'cursor' as const, limit: 2, cursor: 'signed' } };
		let decoded = 0;
		const statement = await compilePage(value, mapping, {
			encode: () => 'signed',
			decode: (token) => {
				expect(token).toBe('signed');
				decoded++;
				return [2];
			},
		});
		expect(decoded).toBe(1);
		expect(statement.text).toContain('"person_id" > $1');
		expect(statement.text).not.toContain('"person_id" IS NULL');
		expect(statement.values).toEqual([2, 2]);
		await expect(compilePage(value, mapping, {
			encode: () => '',
			decode: () => {
				throw new Error('forged');
			},
		})).rejects.toThrow('forged');
		expect(() => compile(value, { ...mapping, continuation: { values: [null] } })).toThrow('must not be null');
		expect(() => compile(value, { ...mapping, continuation: { values: [] } })).toThrow('key count');
	});

	it('requires a total key order and explicit backward boundary', async () => {
		const checked = await Search.create();
		const first = { ...checked, pagination: { kind: 'cursor' as const, limit: 2 } };
		expect(() => compile({ ...first, order: [] }, mapping)).toThrow('tiebreaker');
		await expect(compilePage(first, { ...mapping, direction: 'before' }, { encode: () => '', decode: () => [] }))
			.rejects.toThrow('requires a cursor');
		const previous = compile(first, { ...mapping, continuation: { values: [3], direction: 'before' } });
		expect(previous.reversed).toBe(true);
		expect(previous.text).toContain('"person_id" < $1');
		expect(previous.text).toContain('DESC NULLS FIRST');
	});

	it('quotes qualified join columns and rejects cardinality or alias ambiguity', async () => {
		const checked = await Search.create();
		const options = {
			table: ['people'] as const,
			alias: 'p',
			columns: { id: 'id', name: { relation: 'a', column: 'name' } },
			joins: [{
				table: ['accounts'] as const,
				alias: 'a',
				kind: 'left' as const,
				cardinality: 'one' as const,
				on: [{ left: { relation: 'p', column: 'account_id' }, right: { relation: 'a', column: 'id' } }],
			}],
		};
		expect(compile(checked, options).text).toContain('LEFT JOIN "accounts" AS "a" ON ("p"."account_id" = "a"."id")');
		expect(() => compile(checked, { ...options, joins: [...options.joins, ...options.joins] })).toThrow('distinct');
		expect(() =>
			compile(checked, { ...options, columns: { id: 'id', name: { relation: 'hidden', column: 'secret' } } })
		).toThrow('Unknown');
		expect(() =>
			Reflect.apply(compile, undefined, [checked, {
				...options,
				joins: [{ ...options.joins[0], cardinality: 'many' }],
			}])
		).toThrow('cardinality');
	});

	it('bounds cursor prefix expansion and relation graph size', async () => {
		const checked = await Search.create();
		const order = Array.from({ length: 33 }, (_, index) => ({
			field: `key${index}`,
			direction: 'asc' as const,
			tiebreaker: index === 32,
		}));
		expect(() =>
			Reflect.apply(compile, undefined, [{ ...checked, order, pagination: { kind: 'cursor', limit: 2 } }, mapping])
		).toThrow('32 keys');
		const joins = Array.from({ length: 17 }, (_, index) => ({
			table: ['accounts'],
			alias: `a${index}`,
			kind: 'left',
			cardinality: 'one',
			on: [{ left: { relation: 'p', column: 'account_id' }, right: { relation: `a${index}`, column: 'id' } }],
		}));
		expect(() => Reflect.apply(compile, undefined, [checked, { ...mapping, alias: 'p', joins }])).toThrow('sixteen');
	});
});
