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

// The parse result's static type is checked without performing an asynchronous query.
// deno-lint-ignore no-constant-condition
if (false) {
	const value = await Definition.parse(new URLSearchParams({ 'filter[score][gte]': '10' }));
	const field: 'id' | 'score' = value.order[0]!.field;
	void field;
}

// Unknown filter fields are rejected at the authoring site.
// deno-lint-ignore no-constant-condition
if (false) {
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
}

// Composition vocabulary and field value types remain domain-owned and static.
// deno-lint-ignore no-constant-condition
if (false) {
	query.define({
		fields: Definition.fields,
		pagination: query.offset(),
		// @ts-expect-error Boolean vocabulary is limited to the shared AST.
		expressions: ['all', 'xor'],
	});
	const accepted: query.QueryExpression<query.QueryFilter<typeof Definition.fields>> = {
		kind: 'any',
		filters: [{ field: 'score', operator: 'gte', value: 10 }],
	};
	void accepted;
	// @ts-expect-error score filters retain the field schema's numeric output.
	const rejected: query.QueryFilter<typeof Definition.fields> = {
		field: 'score',
		operator: 'gte',
		value: '10',
	};
	void rejected;
}
