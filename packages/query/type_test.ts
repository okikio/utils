import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as query from './mod.ts';

const StringSchema: StandardSchemaV1<unknown, string> = {
	'~standard': {
		version: 1,
		vendor: 'type-test',
		validate(value) {
			return typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string.' }] };
		},
	},
};
const NumberSchema: StandardSchemaV1<unknown, number> = {
	'~standard': {
		version: 1,
		vendor: 'type-test',
		validate(value) {
			return typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number.' }] };
		},
	},
};

const Definition = query.define({
	fields: {
		id: query.field(StringSchema, { sortable: true }),
		score: query.field(NumberSchema),
	},
	filters: { score: [query.gte] },
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.cursor(),
	defaultFields: ['id', 'score'],
});

const value = await Definition.parse(new URLSearchParams({ 'filter[score][gte]': '10' }));
const field: 'id' | 'score' = value.order[0]!.field;
void field;

// Unknown filter fields are rejected at the authoring site.
query.define({
	fields: { id: query.field(StringSchema, { sortable: true }) },
	// @ts-expect-error `missing` is not a public query field.
	filters: { missing: [query.eq] },
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.cursor(),
});

query.define({
	fields: { id: query.field(StringSchema, { sortable: true }) },
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.cursor(),
	// @ts-expect-error default fields must come from the definition's public fields.
	defaultFields: ['missing'],
});
