/**
 * Import and transport hot paths: bounded value validation, conversion and lookup.
 * Fixtures use independently known cells, identities and timestamps. Native and
 * dependency baselines intentionally omit utility-specific metadata or freezing.
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { z } from 'zod';
import * as catalog from '@okikio/catalog';
import * as codec from '@okikio/codec';
import * as duration from '@okikio/duration';
import * as email from '@okikio/email';
import * as failure from '@okikio/failure';
import * as fault from '@okikio/fault';
import * as query from '@okikio/query';
import * as record from '@okikio/record';
import * as result from '@okikio/result';
import * as schema from '@okikio/schema';
import * as version from '@okikio/version';
import { parse as parseSemver } from '@std/semver';
import { run } from './run.ts';

const RowSchema = z.object({ id: z.string(), visits: z.number().int().nonnegative() });
const rows = Array.from({ length: 100 }, (_, index) => ({ id: `asset-${index}`, visits: index }));
const wire = '2026-01-01T00:00:00.000Z';
const Instant = codec.define({
	decode: z.string().datetime().transform((value) => new Date(value)),
	encode: z.date().transform((value) => value.toISOString()),
});
const Missing = failure.define({
	id: 'bench.asset.missing',
	description: 'The imported asset does not exist.',
	data: z.object({ id: z.string() }),
});
const definitions = Object.fromEntries(rows.map((row) => [row.id, Object.freeze({ id: row.id, kind: 'asset' })]));
const entries = catalog.create('bench.assets', definitions);
const map = new Map(Object.values(definitions).map((entry) => [entry.id, entry]));
const error = new TypeError('Invalid asset');
const Search = query.define({
	fields: { id: query.field(z.string(), { sortable: true }), name: query.field(z.string()) },
	filters: { name: [query.eq, query.in] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset(),
});
const input = { filter: { name: { in: ['a,b', '', '雪'] } } };
const names = ['Example.COM', 'Northstar.example', 'Team.Example.COM'];
const versions = Array.from({ length: 100 }, (_, index) => `2.${index}.1`);

for (const row of rows) {
	deepStrictEqual(await schema.parse(RowSchema, row), row);
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
deepStrictEqual(restored.data, { id: 'asset-4' });
const projected = fault.encode(error);
if (!fault.isRecord(projected)) throw new Error('Fault projection lost its diagnostic record.');
strictEqual(projected.name, 'TypeError');
strictEqual(projected.message, 'Invalid asset');
strictEqual(duration.milliseconds('PT1.5S'), 1500);
deepStrictEqual(names.map(email.normalizeDomain), ['example.com', 'northstar.example', 'team.example.com']);
for (let index = 0; index < versions.length; index++) {
	const text = versions[index]!;
	deepStrictEqual(version.semanticVersionScheme.parse(text)?.release, [2, index, 1]);
	const parsed = parseSemver(text);
	deepStrictEqual([parsed.major, parsed.minor, parsed.patch], [2, index, 1]);
}
const normalized = await Search.parse(input);
deepStrictEqual((await Search.parse(Search.encode(normalized))).filters[0]?.value, ['a,b', '', '雪']);

group('Validated imported records: 100 independent values', () => {
	bench('Standard Schema facade + Zod', async () => {
		for (const row of rows) do_not_optimize(await schema.parse(RowSchema, row));
	});
	bench('Zod direct parse: same output, native errors', () => {
		for (const row of rows) do_not_optimize(RowSchema.parse(row));
	});
	bench('owned shallow record snapshots', () => {
		for (const row of rows) do_not_optimize(record.snapshot(row));
	});
	bench('native shallow copies: no utility record guard', () => {
		for (const row of rows) do_not_optimize({ ...row });
	});
	bench('frozen success wrapper and unwrap', () => {
		for (const row of rows) do_not_optimize(result.unwrap(result.ok(row)));
	});
	bench('frozen tagged record reference', () => {
		for (const row of rows) do_not_optimize(Object.freeze({ ok: true, value: row }).value);
	});
});
group('Transport conversion and diagnostics', () => {
	bench('validated timestamp codec round trip', async () => {
		do_not_optimize(await codec.encode(Instant, await codec.decode(Instant, wire)));
	});
	bench('Date reference: no schema rejection or directional contract', () => {
		do_not_optimize(new Date(wire).toISOString());
	});
	bench('expected failure creation, encoding and trusted reconstruction', async () => {
		const value = await failure.create(Missing, { data: { id: 'asset-4' } });
		do_not_optimize(await failure.decode(await failure.encode(value), [Missing]));
	});
	bench('bounded native error diagnostics', () => do_not_optimize(fault.encode(error)));
	bench('lossless list query parse and URL round trip', async () => {
		const value = await Search.parse(input);
		do_not_optimize(await Search.parse(Search.encode(value)));
	});
});
group('Repeated domain, version and exact contract lookup', () => {
	bench('catalog exact-ID lookup: 100 entries', () => {
		for (const row of rows) do_not_optimize(catalog.get(entries, row.id));
	});
	bench('Map exact-ID lookup: no definition conflict guard', () => {
		for (const row of rows) do_not_optimize(map.get(row.id));
	});
	bench('email hostname validation and normalization', () => {
		for (const name of names) do_not_optimize(email.normalizeDomain(name));
	});
	bench('Temporal duration to milliseconds', () => do_not_optimize(duration.milliseconds('PT1.5S')));
	bench('version evidence projection: 100 exact releases', () => {
		for (const value of versions) do_not_optimize(version.semanticVersionScheme.parse(value));
	});
	bench('@std/semver parse: 100 exact releases, no evidence projection', () => {
		for (const value of versions) do_not_optimize(parseSemver(value));
	});
});
await run();
