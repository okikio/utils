/** Measure SQL compilation scaling, excluding query schema validation and database execution. */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as schema from '@okikio/schema';
import * as query from './mod.ts';
import { compile } from './postgres.ts';
import { run } from './fixtures/bench.ts';

const Search = query.define({
	fields: { id: query.field(schema.number(), { sortable: true }) },
	filters: { id: [query.eq] },
	maximumFilters: 100,
	pagination: query.offset(),
});
for (const count of [1, 20, 100]) {
	const filters = Array.from({ length: count }, (_, index) => Search.condition('id', 'eq', index));
	const checked = await Search.create({ filter: query.all(filters[0]!, ...filters.slice(1)) });
	const mapping = { table: ['assets'], columns: { id: 'id' } } as const;
	const statement = compile(checked, mapping);
	deepStrictEqual(statement.values.slice(0, count), Array.from({ length: count }, (_, index) => index));
	strictEqual((statement.text.match(/IS NOT DISTINCT FROM/g) ?? []).length, count);
	strictEqual(statement.text.endsWith(`LIMIT $${count + 1} OFFSET $${count + 2}`), true);
	group(`PostgreSQL compilation: ${count} checked equality leaves`, () => {
		bench(
			'quoted SQL and bound values; no connection or query execution',
			() => do_not_optimize(compile(checked, mapping)),
		);
	});
}
// Lexicographic expansion repeats equality prefixes. These scales expose its
// quadratic SQL growth while the fixed 32-key admission cap bounds that cost.
for (const count of [1, 4, 16, 32]) {
	const fields = Object.fromEntries(Array.from({ length: count }, (_, index) => [
		`key${index}`,
		query.field(schema.nullable(schema.number()), { sortable: true }),
	]));
	const Search = query.define({
		fields,
		order: Object.keys(fields).map((field, index) =>
			(index % 2 ? query.desc : query.asc)(field, { tiebreaker: index === count - 1 })
		),
		maximumSorts: 32,
		pagination: query.cursor(),
	});
	const checked = await Search.create();
	const mapping = {
		table: ['assets'] as const,
		alias: 'p',
		columns: Object.fromEntries(Object.keys(fields).map((field) => [field, field])),
		continuation: {
			values: Array.from({ length: count }, (_, index) => index === count - 1 || index % 3 ? index : null),
		},
	};
	const statement = compile(checked, mapping);
	strictEqual(statement.values.length, count + 1);
	strictEqual(statement.text.includes('OFFSET'), false);
	strictEqual(statement.text.includes(`"p"."key${count - 1}"`), true);
	group(`PostgreSQL forward keyset: ${count} ordered keys; ${statement.text.length} SQL characters`, () => {
		bench('trusted decoded boundary and bounded prefix expansion', () => do_not_optimize(compile(checked, mapping)));
	});
}

for (const count of [1, 8, 16]) {
	const checked = await Search.create();
	const mapping = {
		table: ['assets'] as const,
		alias: 'p',
		columns: { id: 'id' },
		joins: Array.from({ length: count }, (_, index) => ({
			table: ['accounts'] as const,
			alias: `a${index}`,
			kind: 'left' as const,
			cardinality: 'one' as const,
			on: [{ left: { relation: 'p', column: `account${index}` }, right: { relation: `a${index}`, column: 'id' } }],
		})),
	};
	strictEqual((compile(checked, mapping).text.match(/LEFT JOIN/g) ?? []).length, count);
	group(`PostgreSQL trusted to-one joins: ${count} unique targets`, () => {
		bench('quote relation graph and preserve base-row pagination', () => do_not_optimize(compile(checked, mapping)));
	});
}
await run();
