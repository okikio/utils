// @benchmark optional
/**
 * Compare a deep offset with an equivalent keyset page, with and without one
 * unique-key join. The 20,000-row corpus, connections and statistics are prepared
 * outside timing. Each sample executes SQL and returns twenty actual rows.
 * This is a local database workload, not a production latency threshold.
 * @module
 */
import '@okikio/dispose/polyfill';
import process from 'node:process';
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import postgres from 'postgres';
import * as query from '@okikio/query';
import * as schema from '@okikio/schema';
import * as pg from '@okikio/query/postgres';
import type { Statement } from '@okikio/query/postgres';
import { run } from '#tools/bench/run.ts';

const url = process.env.UTILS_BENCH_DATABASE_URL;
if (!url) throw new Error('Select an explicitly disposable database with UTILS_BENCH_DATABASE_URL.');
const database = postgres(url, { max: 1, onnotice() {} });
await using owners = new AsyncDisposableStack();
owners.defer(() => database.end({ timeout: 2 }));
const suffix = crypto.randomUUID().replaceAll('-', '');
const records = `query_records_${suffix}`;
const groups = `query_groups_${suffix}`;
owners.defer(async () => {
	await database`drop table if exists ${database(records)}`;
	await database`drop table if exists ${database(groups)}`;
});
await database`create table ${database(groups)} (id integer primary key, label text not null)`;
await database`create table ${database(records)} (id integer primary key, owner integer not null references ${
	database(groups)
}(id))`;
await database`insert into ${database(groups)} select value,'group-'||value::text from generate_series(0,99) as value`;
await database`insert into ${database(records)} select value,value%100 from generate_series(1,20000) as value`;
await database`analyze ${database(groups)}`;
await database`analyze ${database(records)}`;

/** The final primary key orders output rows uniquely, including through the many-to-one join. */
const Fields = {
	id: query.field(schema.number(), { sortable: true }),
	label: query.field(schema.string()),
};
const order = [query.asc('id', { tiebreaker: true })];
const Offset = query.define({ fields: Fields, order, pagination: query.offset({ defaultLimit: 20 }) });
const Cursor = query.define({ fields: Fields, order, pagination: query.cursor({ defaultLimit: 20 }) });
const offset = await Offset.create({ fields: ['id'], pagination: { kind: 'offset', limit: 20, offset: 18000 } });
const cursor = await Cursor.create({ fields: ['id'] });

/** Driver binding remains separate from SQL syntax. Fixture operands are finite PostgreSQL scalars. */
async function execute(statement: Statement): Promise<readonly number[]> {
	const rows = await database.unsafe(statement.text, [...statement.values] as postgres.ParameterOrJSON<never>[]);
	const ids = rows.map((row) => Number(row.id));
	do_not_optimize(rows);
	return ids;
}

for (const joined of [false, true]) {
	const options = {
		table: [records] as const,
		alias: 'records',
		columns: {
			id: { relation: 'records', column: 'id' },
			...(joined ? { label: { relation: 'groups', column: 'label' } } : {}),
		},
		...(joined
			? {
				joins: [{
					table: [groups] as const,
					alias: 'groups',
					kind: 'inner' as const,
					cardinality: 'one' as const,
					on: [{ left: { relation: 'records', column: 'owner' }, right: { relation: 'groups', column: 'id' } }],
				}],
			}
			: {}),
	};
	const offsetStatement = pg.compile(offset, options);
	const seekStatement = pg.compile(cursor, { ...options, continuation: { values: [18000] } });
	const expected = Array.from({ length: 20 }, (_, index) => 18001 + index);
	deepStrictEqual(await execute(offsetStatement), expected);
	deepStrictEqual(await execute(seekStatement), expected);
	if (process.argv.includes('--explain')) {
		// Plans are observations, not brittle assertions about the optimizer.
		// ANALYZE executes each statement; BUFFERS exposes work hidden by wall time.
		for (const [name, statement] of [['offset', offsetStatement], ['keyset', seekStatement]] as const) {
			const plan = await database.unsafe(
				`explain (analyze, buffers, format json) ${statement.text}`,
				[...statement.values] as postgres.ParameterOrJSON<never>[],
			);
			console.log(JSON.stringify({ joined, name, plan: plan[0]?.['QUERY PLAN'] }));
		}
	}
	group(`20 rows after 18000 of 20000; ${joined ? 'unique-key inner join' : 'base relation'}`, () => {
		bench('offset page', async () => do_not_optimize(await execute(offsetStatement)));
		bench('keyset page', async () => do_not_optimize(await execute(seekStatement)));
	});
}
if (!process.argv.includes('--explain')) await run();
