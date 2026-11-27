/** Every PostgreSQL type round-trips exactly, alone, in arrays and in composite values, under an unusual session. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import postgres from 'postgres';
import { Temporal, temporal } from '@okikio/duration/temporal';
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { database } from '@okikio/sql/postgres/postgresjs';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('SQL type checks require a disposable PostgreSQL database.');
const client = postgres(url, { max: 2, onnotice() {} });
const db = database(client);

const point = types.composite(['utils_sql_types', 'point'], {
	x: types.double,
	at: types.nullable(types.timestamptz),
	label: types.nullable(types.text()),
});
const space = sql.schema('utils_sql_types');
const all = space.table('all', {
	id: sql.column(types.integer),
	small: sql.column(types.smallint).nullable(),
	ratio: sql.column(types.real).nullable(),
	day: sql.column(types.date).nullable(),
	clock: sql.column(types.time).nullable(),
	span: sql.column(types.interval).nullable(),
	bytes: sql.column(types.bytea).nullable(),
	tags: sql.column(types.array(types.text())).nullable(),
	scores: sql.column(types.array(types.nullable(types.integer))).nullable(),
	moments: sql.column(types.array(types.timestamptz)).nullable(),
	flags: sql.column(types.array(types.boolean)).nullable(),
	docs: sql.column(types.array(types.jsonb())).nullable(),
	spot: sql.column(point).nullable(),
});
const a = all.c;

before(async () => {
	await client`drop schema if exists utils_sql_types cascade`;
	await client`create schema utils_sql_types`;
	await client`create type utils_sql_types.point as (x double precision, at timestamptz, label text)`;
	await sql.execute(db, sql.createTable(all));
});
after(async () => {
	await client`drop schema if exists utils_sql_types cascade`;
	await client.end({ timeout: 2 });
});

const values = [
	{
		id: 1,
		small: -32768,
		ratio: 0.5,
		day: temporal.PlainDate.from('2026-02-28'),
		clock: temporal.PlainTime.from('23:59:59.999999'),
		span: { months: 14, days: -3, microseconds: 14_706_789_012n },
		bytes: new Uint8Array([0, 1, 127, 128, 255]),
		tags: ['a', 'b\'"\\', 'é 漢字 🙂', ''],
		scores: [1, null, -2147483648],
		moments: [temporal.Instant.from('0001-01-01T00:00:00Z'), temporal.Instant.from('2026-03-29T01:30:00.000001Z')],
		flags: [true, false],
		docs: [{ a: [1, null] }, 'text', null, 12.5],
		spot: { x: -0.25, at: temporal.Instant.from('2026-01-02T03:04:05.123456Z'), label: 'p, "q"' },
	},
	{
		id: 2,
		small: 32767,
		ratio: Number.NEGATIVE_INFINITY,
		day: temporal.PlainDate.from('-000001-06-01'),
		clock: temporal.PlainTime.from('00:00'),
		span: { months: -1, days: 30, microseconds: -1n },
		bytes: new Uint8Array(),
		tags: [],
		scores: [],
		moments: [],
		flags: [],
		docs: [],
		spot: { x: 0, at: null, label: null },
	},
	{
		id: 3,
		small: null,
		ratio: null,
		day: null,
		clock: null,
		span: null,
		bytes: null,
		tags: null,
		scores: null,
		moments: null,
		flags: null,
		docs: null,
		spot: null,
	},
] as const;

const plain = (row: Record<string, unknown>) =>
	JSON.parse(JSON.stringify(row, (_key, value) => {
		if (typeof value === 'bigint') return `${value}n`;
		if (value instanceof Uint8Array) return [...value];
		if (value && typeof value === 'object' && 'toString' in value && value.constructor?.name?.startsWith?.('Plain')) {
			return String(value);
		}
		return value;
	}));

describe('PostgreSQL types', () => {
	it('round-trips every type, alone, in arrays and in a composite value, under an unusual session', async () => {
		const back = await db.begin(async (tx) => {
			for (
				const [name, value] of [
					['TimeZone', 'Pacific/Chatham'],
					['DateStyle', 'SQL, DMY'],
					['IntervalStyle', 'sql_standard'],
					['extra_float_digits', '3'],
					['bytea_output', 'escape'],
				] as const
			) {
				await sql.execute(tx, sql.select({ s: sql.fn.setLocal(name, value) }));
			}
			await sql.execute(tx, sql.insert(all, values as never));
			return await sql.rows(
				tx,
				sql.select({
					id: a.id,
					small: a.small,
					ratio: a.ratio,
					day: a.day,
					clock: a.clock,
					span: a.span,
					bytes: a.bytes,
					tags: a.tags,
					scores: a.scores,
					moments: a.moments,
					flags: a.flags,
					docs: a.docs,
					spot: a.spot,
				}).from(all).orderBy(a.id),
			);
		});
		expect(back.map(plain)).toEqual(values.map(plain));
		expect(back[1]!.day!.equals(temporal.PlainDate.from('-000001-06-01'))).toBe(true);
	});

	it('stores the values in their PostgreSQL forms', async () => {
		const [row] = await client`
			select small::text, day::text, span::text, encode(bytes, 'hex') as bytes, scores::text, tags[3] as tag,
				(spot).label as label
			from utils_sql_types."all" where id = 1`;
		expect(row).toEqual({
			small: '-32768',
			day: '2026-02-28',
			span: '1 year 2 mons -3 days +04:05:06.789012',
			bytes: '00017f80ff',
			scores: '{1,NULL,-2147483648}',
			tag: 'é 漢字 🙂',
			label: 'p, "q"',
		});
	});

	it('refuses values outside a type before sending', () => {
		expect(() => sql.toQuery(sql.insert(all, { id: 9, small: 40_000 }))).toThrow(RangeError);
		expect(() => sql.toQuery(sql.insert(all, { id: 9, tags: ['a\u0000'] }))).toThrow(TypeError);
		expect(() => types.array(types.empty)).toThrow('has no text form');
	});
});

describe('both Duration Temporal exports on PostgreSQL', () => {
	it('round-trips ponyfill values through the selected host implementation', async () => {
		const row = await sql.one(
			db,
			sql.select({
				at: sql.value(Temporal.Instant.from('2026-01-02T03:04:05Z'), types.timestamptz),
				day: sql.value(Temporal.PlainDate.from('2026-01-02'), types.date),
				time: sql.value(Temporal.PlainTime.from('03:04:05'), types.time),
			}),
		);
		expect(row?.at.epochNanoseconds).toBe(1767323045000000000n);
		expect(row?.day.toString()).toBe('2026-01-02');
		expect(row?.time.toString()).toBe('03:04:05');
	});
});
