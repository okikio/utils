/** The less common types: dates, times of day, intervals, bytes, small numbers, arrays and composites. @module */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { temporal } from '@okikio/duration/temporal';
import { same } from './check.ts';
import type { CaseType } from './types.ts';

const first = {
	id: 1,
	day: temporal.PlainDate.from('2026-02-28'),
	span: { months: 14, days: -3, microseconds: 3_723_000_004n },
} as const;

const rows = [
	{
		...first,
		clock: temporal.PlainTime.from('23:59:59.999999'),
		bytes: new Uint8Array([0, 1, 127, 128, 255]),
		tiny: -32768,
		single: 0.5,
		list: [1, null, -2147483648],
		words: ['a', null, 'quote " and \\ back', '{', ''],
		both: { label: 'x, y', n: 7 },
	},
	{
		id: 2,
		day: temporal.PlainDate.from('-000001-01-01'),
		clock: temporal.PlainTime.from('00:00'),
		span: { months: 0, days: 0, microseconds: -1n },
		bytes: new Uint8Array([]),
		tiny: 32767,
		single: Number.NEGATIVE_INFINITY,
		list: [],
		words: [],
		both: { label: null, n: null },
	},
	{
		id: 3,
		day: null,
		clock: null,
		span: null,
		bytes: null,
		tiny: null,
		single: null,
		list: null,
		words: null,
		both: null,
	},
];

export const values: readonly CaseType[] = [
	{
		name: 'dates, intervals, bytes, arrays and composites round-trip',
		after: [
			'create table with dates, intervals, bytes, arrays and a composite',
		],
		run: async ({ db, t }) => {
			const c = t.typed.c;
			await sql.execute(db, sql.insert(t.typed, rows));
			const out = await sql.rows(
				db,
				sql.select({
					id: c.id,
					day: c.day,
					clock: c.clock,
					span: c.span,
					bytes: c.bytes,
					tiny: c.tiny,
					single: c.single,
					list: c.list,
					words: c.words,
					both: c.both,
				}).from(t.typed).orderBy(c.id),
			);
			same(out, rows, 'rows');
			const found = await sql.rows(
				db,
				sql.select({ id: c.id }).from(t.typed).where(
					c.day.eq(first.day),
					c.span.eq(first.span),
				),
			);
			same(found, [{ id: 1 }], 'compare by date and interval');
		},
	},
	{
		name: 'values outside a table: arrays of text and a bare interval',
		run: async ({ db }) => {
			const words = sql.value(
				['α', 'β', null],
				types.array(types.nullable(types.text())),
			);
			const span = sql.value(
				{ months: 1, days: 2, microseconds: 3n },
				types.interval,
			);
			same(await sql.one(db, sql.select({ words, span })), {
				words: ['α', 'β', null],
				span: { months: 1, days: 2, microseconds: 3n },
			}, 'values');
		},
	},
];
