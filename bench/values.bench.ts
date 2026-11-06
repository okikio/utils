/**
 * Import and transport hot paths: bounded value validation, conversion and lookup.
 * Fixtures use independently known cells, identities and timestamps. Native and
 * dependency baselines intentionally omit utility-specific metadata or freezing.
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as catalog from '@okikio/collection/catalog';
import * as codec from '@okikio/schema/codec';
import * as duration from '@okikio/duration';
import * as failure from '@okikio/result/failure';
import * as fault from '@okikio/result/fault';
import * as query from '@okikio/query';
import * as record from '@okikio/collection/record';
import * as result from '@okikio/result';
import * as schema from '@okikio/schema';
import { run } from '#tools/bench/run.ts';
import { DateSchema } from '@okikio/schema/time';

const RowSchema = schema.object({ id: schema.string(), visits: schema.number({ integer: true, minimum: 0 }) });
const rows = Array.from({ length: 100 }, (_, index) => ({ id: `asset-${index}`, visits: index }));
const wire = '2026-01-01T00:00:00.000Z';
const Instant = DateSchema;
const Missing = failure.define({
	id: 'bench.asset.missing',
	description: 'The imported asset does not exist.',
	data: schema.object({ id: schema.string() }),
});
const definitions = Object.fromEntries(rows.map((row) => [row.id, Object.freeze({ id: row.id, kind: 'asset' })]));
const entries = catalog.create('bench.assets', definitions);
const map = new Map(Object.values(definitions).map((entry) => [entry.id, entry]));
const error = new TypeError('Invalid asset');
const Search = query.define({
	fields: { id: query.field(schema.string(), { sortable: true }), name: query.field(schema.string()) },
	filters: { name: [query.eq, query.in] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset(),
});
const input = { filter: { name: { in: ['a,b', '', '雪'] } } };

for (const row of rows) {
	const parsed = await schema.parse(RowSchema, row);
	deepStrictEqual(Object.entries(parsed), Object.entries(row));
	strictEqual(Object.getPrototypeOf(parsed), null);
	strictEqual(catalog.get(entries, row.id), definitions[row.id]);
	strictEqual(map.get(row.id), definitions[row.id]);
	const snapshot = record.snapshot(row);
	deepStrictEqual(Object.entries(snapshot), Object.entries(row));
	strictEqual(Object.getPrototypeOf(snapshot), null);
	strictEqual(result.unwrap(result.ok(row)), row);
}
strictEqual(await codec.encode(Instant, await codec.decode(Instant, wire)), wire);
const encoded = await failure.encode(await failure.create(Missing, { data: { id: 'asset-4' } }));
const restored = await failure.decode(encoded, [Missing]);
strictEqual(restored.definition, Missing);
deepStrictEqual(Object.entries(restored.data), [['id', 'asset-4']]);
strictEqual(Object.getPrototypeOf(restored.data), null);
const projected = fault.encode(error);
if (!fault.isRecord(projected)) throw new Error('Fault projection lost its diagnostic record.');
strictEqual(projected.name, 'TypeError');
strictEqual(projected.message, 'Invalid asset');
strictEqual(duration.elapsed('PT1.5S'), 1500);
const normalized = await Search.parse(input);
deepStrictEqual(query.conjunction((await Search.parse(Search.encode(normalized))).filter)?.[0]?.value, [
	'a,b',
	'',
	'雪',
]);

/** Keep value validation, owned snapshots, result authority and transport conversion in one import cycle. */
async function importRows(): Promise<number> {
	let visits = 0;
	for (const row of rows) {
		const parsed = await schema.parse(RowSchema, row);
		const snapshot = record.snapshot(parsed);
		const value = result.unwrap(result.ok(snapshot));
		strictEqual(catalog.get(entries, row.id)?.id, row.id);
		visits += value.visits;
	}
	const timestamp = await codec.encode(Instant, await codec.decode(Instant, wire));
	strictEqual(timestamp, wire);
	const selected = await Search.parse(input);
	await Search.parse(Search.encode(selected));
	return visits;
}
strictEqual(await importRows(), 4950);
group('100 imported records: validate, snapshot, wrap, lookup and prepare transport', () => {
	bench('complete value import and query/timestamp round trip', async () => do_not_optimize(await importRows()));
});
await run();
