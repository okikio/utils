import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import * as schema from '@okikio/schema';
import * as query from './mod.ts';

describe('Standard JSON Schema query directions', () => {
	it('documents URL input explicitly and projects the parsed structural type', async () => {
		const definition = query.define({
			fields: {
				id: query.field(schema.string(), { sortable: true }),
				score: query.field(schema.coerce.number(), { sortable: true, jsonSchema: { type: ['string', 'number'] } }),
			},
			filters: { score: [query.gte] },
			expressions: ['all', 'any', 'not'],
			order: [query.asc('id', { tiebreaker: true })],
			pagination: query.cursor(),
			maximumSorts: 1,
		});
		const protocol: StandardJSONSchemaV1 = definition;
		const input = definition.wireSchema();
		expect(() => protocol['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toThrow('field "score"');
		const output = protocol['~standard'].jsonSchema.output({ target: 'draft-2020-12' });
		expect(input).toMatchObject({ properties: { 'filter[score][gte]': {} } });
		expect(output).toMatchObject({
			properties: {
				filter: { $ref: '#/$defs/expression' },
				order: { maxItems: 2 },
				pagination: { anyOf: [{ properties: { kind: { const: 'cursor' } } }] },
			},
			$defs: {
				field_score: { type: 'number' },
				condition: { anyOf: [{ properties: { field: { const: 'score' }, value: { $ref: '#/$defs/field_score' } } }] },
			},
		});
		const value = await definition.parse({ 'filter[score][gte]': '10', sort: 'score:desc' });
		expect(query.conjunction(value.filter)![0]!.value).toBe(10);
		expect(value.order).toHaveLength(2);
		const oldDraft = protocol['~standard'].jsonSchema.output({ target: 'draft-07' });
		expect(oldDraft).toMatchObject({
			properties: { filter: { $ref: '#/definitions/expression' } },
			definitions: { expression: {} },
		});
		expect(() => protocol['~standard'].jsonSchema.output({ target: 'openapi-3.0' })).toThrow(TypeError);
	});

	it('requires an output projection for opaque validators instead of reusing input metadata', () => {
		const opaque = schema.define((value) => value instanceof Date ? value : schema.reject('Expected a Date.'));
		const fields = { at: query.field(opaque, { jsonSchema: { type: 'string' } }) };
		const definition = query.define({ fields, filters: { at: [query.eq] }, pagination: query.offset() });
		expect(() => schema.jsonSchema(definition, 'output')).toThrow(TypeError);
	});
});
