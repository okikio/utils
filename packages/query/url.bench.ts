/** Query transport must preserve repeated values and embedded commas; raw URL encoding omits validation. */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as query from './mod.ts';
import * as schema from '@okikio/schema';
const Search = query.define({
	fields: { id: query.field(schema.string(), { sortable: true }), name: query.field(schema.string()) },
	filters: { name: [query.eq, query.in] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset(),
});
for (const count of [1, 32, 100]) {
	const values = Array.from({ length: count }, (_, index) => `value,${index}:雪`);
	const input = { filter: { name: { in: values } } };
	const parsed = await Search.parse(input);
	const restored = await Search.parse(Search.encode(parsed));
	strictEqual(JSON.stringify(query.conjunction(restored.filter)?.[0]?.value), JSON.stringify(values));
	group(`query ${count} repeated values containing comma and Unicode`, () => {
		bench('validated query parse/URL/parse round trip', async () => {
			const value = await Search.parse(input);
			do_not_optimize(await Search.parse(Search.encode(value)));
		});
		bench(
			'native URL encoding only: no query contract',
			() => do_not_optimize(new URLSearchParams(values.map((value) => ['name', value])).toString()),
		);
	});
}
const oversized = { filter: { name: { in: Array.from({ length: 101 }, (_, index) => `value${index}`) } } };
async function rejectOversized(): Promise<void> {
	try {
		await Search.parse(oversized);
	} catch (error) {
		if (error instanceof query.QueryValidationError) return;
		throw error;
	}
	throw new Error('A query above the default 100-value limit must be rejected.');
}
await rejectOversized();
group('query admission boundary', () => {
	bench('reject 101 values at the default 100-value limit', rejectOversized);
});
await run();
