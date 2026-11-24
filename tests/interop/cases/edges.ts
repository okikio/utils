/** Limits and odd conditions: huge statements, bad text, big values, session settings, concurrency and cancellation. @module */
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { temporal } from '@okikio/duration/temporal';
import { type ContextType, raw, same } from './check.ts';
import type { CaseType } from './types.ts';

const text = (v: string) => sql.select({ v: sql.value(v, types.text()) });

/** Server connections, to check that a cancelled statement stopped in the database and not only in the client. */
const activity = sql.schema('pg_catalog', { owned: false }).table(
	'pg_stat_activity',
	{
		pid: sql.column(types.integer),
		state: sql.column(types.text()).nullable(),
		query: sql.column(types.text()).nullable(),
	},
);
const position = sql.declare(
	'strpos',
	[types.text(), types.text()],
	types.integer,
);
const backend = sql.declare('pg_backend_pid', [], types.integer);

/** Wait until no other connection runs `pg_sleep`, or fail after two seconds. */
async function stopped(db: sql.Database, label: string): Promise<void> {
	const a = activity.c;
	const sleeping = sql.select({ n: sql.fn.count() }).from(activity).where(
		a.state.eq('active'),
		a.pid.ne(backend()),
		// Other clients may run their own sleep at the same time; each one names its result column after its schema.
		position(sql.coalesce(a.query, ''), `"${label}"`).gt(0),
	);
	const deadline = Date.now() + 2000;
	while ((await sql.one(db, sleeping))?.n) {
		if (Date.now() > deadline) {
			throw new Error(
				'the client gave up, but the statement still runs in the database',
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
const json = (v: unknown) => sql.select({ v: sql.value(v, types.jsonb()) });

export const edges: readonly CaseType[] = [
	{
		name: 'more than 65,535 parameters fail before sending',
		after: ['create schema'],
		run: async ({ db, name }) => {
			const wide = sql.schema(name).table('wide', {
				a: sql.column(types.integer),
				b: sql.column(types.integer),
			});
			await sql.execute(db, sql.createTable(wide));
			const rows = Array.from({ length: 33000 }, (_, i) => ({ a: i, b: i }));
			let refusal: unknown;
			try {
				await sql.execute(db, sql.insert(wide, rows));
			} catch (error) {
				refusal = error;
			}
			same(await sql.one(db, sql.select({ c: sql.fn.count() }).from(wide)), {
				c: 0,
			}, 'nothing written');
			if (
				!(refusal instanceof RangeError) ||
				!/at most 65535/u.test(refusal.message)
			) {
				throw new Error(
					`unclear refusal: ${String((refusal as Error | undefined)?.message).slice(0, 160)}`,
				);
			}
		},
	},
	{
		name: 'NUL and lone surrogates fail before sending',
		run: async ({ db }) => {
			const bad: readonly [string, () => sql.Statement<unknown>][] = [
				['text NUL', () => text('a\u0000b')],
				['text surrogate', () => text('x\uD800y')],
				['json surrogate', () => json({ s: 'x\uD800y' })],
				['json NUL', () => json({ s: 'a\u0000b' })],
			];
			for (const [what, build] of bad) {
				let refused = false;
				try {
					await sql.one(db, build());
				} catch (error) {
					refused = error instanceof TypeError &&
						/NUL or a lone UTF-16 surrogate/u.test(error.message);
					if (!refused) throw new Error(`${what}: ${(error as Error).message}`);
				}
				if (!refused) throw new Error(`${what}: accepted`);
			}
			same(
				await sql.one(
					db,
					json({ s: 'literal \\u0000 and \\ud800 text', pair: '🙂' }),
				),
				{ v: { s: 'literal \\u0000 and \\ud800 text', pair: '🙂' } },
				'escaped text still allowed',
			);
		},
	},
	{
		name: '10 MB of text and jsonb',
		run: async ({ db }) => {
			const big = 'x'.repeat(10 * 1024 * 1024);
			same((await sql.one(db, text(big)))?.v.length, big.length, 'text size');
			same(
				((await sql.one(db, json({ big })))?.v as { big: string }).big.length,
				big.length,
				'json size',
			);
		},
	},
	{
		name: 'timestamps from year 1 BC to 10000',
		run: async ({ db }) => {
			for (
				const iso of [
					'0001-01-01T00:00:00Z',
					'9999-12-31T23:59:59.999999Z',
					'+010000-01-01T00:00:00Z',
					'-000001-06-01T00:00:00Z',
				]
			) {
				const v = temporal.Instant.from(iso);
				same(
					await sql.one(db, sql.select({ v: sql.value(v, types.timestamptz) })),
					{ v },
					iso,
				);
			}
		},
	},
	{
		name: 'session TimeZone, extra_float_digits and IntervalStyle change nothing',
		run: (ctx) =>
			settled(ctx, [
				['TimeZone', 'America/New_York'],
				['extra_float_digits', '-15'],
				['IntervalStyle', 'sql_standard'],
			]),
	},
	{
		name: 'session DateStyle changes nothing',
		run: (ctx) => settled(ctx, [['DateStyle', 'SQL, DMY']]),
	},
	{
		name: '50 concurrent statements',
		run: async ({ db }) => {
			const all = await Promise.all(
				Array.from(
					{ length: 50 },
					(_, i) =>
						sql.one(
							db,
							sql.select({
								v: sql.value(i, types.integer),
								s: sql.value(`s${i}`, types.text()),
							}),
						),
				),
			);
			same(
				all.map((row) => row?.v),
				Array.from({ length: 50 }, (_, i) => i),
				'order',
			);
		},
	},
	{
		name: 'a repeated select after its table changes',
		after: ['create schema'],
		run: async ({ db, name }) => {
			const changing = sql.schema(name).table('changing', {
				id: sql.column(types.integer),
				label: sql.column(types.text()),
			});
			await sql.execute(db, sql.createTable(changing));
			await sql.execute(db, sql.insert(changing, { id: 1, label: 'a' }));
			const query = sql.select({ id: changing.c.id, label: changing.c.label })
				.from(changing);
			for (let i = 0; i < 6; i++) await sql.rows(db, query);
			await db.run(
				raw(`alter table "${name}"."changing" add column extra text`),
			);
			await db.run(
				raw(
					`alter table "${name}"."changing" alter column label type varchar(20)`,
				),
			);
			same(await sql.rows(db, query), [{ id: 1, label: 'a' }], 'after alter');
		},
	},
	{
		name: 'failed statements leave the pool usable',
		run: async ({ db }) => {
			for (let i = 0; i < 10; i++) {
				await sql.one(
					db,
					sql.select({ v: sql.value('not a uuid', types.uuid) }),
				).catch(() => {});
			}
			same(await sql.one(db, text('ok')), { v: 'ok' }, 'after errors');
		},
	},
	{
		name: 'an abort signal cancels a running statement',
		run: async ({ db, name }) => {
			const sleep = sql.declare('pg_sleep', [types.double], types.empty);
			const controller = new AbortController();
			const reason = new Error('stopped');
			const started = Date.now();
			setTimeout(() => controller.abort(reason), 200);
			let caught: unknown;
			try {
				await sql.execute(db, sql.select({ [name]: sleep(5) }), {
					signal: controller.signal,
				});
			} catch (error) {
				caught = error;
			}
			const waited = Date.now() - started;
			if (caught === undefined) {
				throw new Error(
					`signal ignored: the statement finished after ${waited} ms`,
				);
			}
			if (waited > 2500) {
				throw new Error(
					`signal ignored: waited ${waited} ms (${(caught as Error).message})`,
				);
			}
			if (caught !== reason) {
				throw new Error(
					`rejected with ${String((caught as Error).message)}, not the signal's reason`,
				);
			}
			await stopped(db, name);
			same(
				await sql.one(db, text('after')),
				{ v: 'after' },
				'usable after cancel',
			);
		},
	},
];

/** Change session settings inside a transaction, then check values still read back unchanged. */
async function settled(
	{ db, types }: ContextType,
	settings: readonly (readonly [string, string])[],
): Promise<void> {
	const v = temporal.Instant.from('2026-03-08T07:30:00.000001Z');
	const out = await db.begin(async (tx) => {
		for (const [key, value] of settings) {
			await sql.execute(tx, sql.select({ s: sql.fn.setLocal(key, value) }));
		}
		return await sql.one(
			tx,
			sql.select({
				t: sql.value(v, types.timestamptz),
				later: sql.later(sql.value(v, types.timestamptz), 86_400_000),
				d: sql.value(0.1 + 0.2, types.double),
				span: sql.value({ months: 1, days: -1, microseconds: 1n }, types.interval),
			}),
		);
	});
	same(out, {
		t: v,
		later: temporal.Instant.from('2026-03-09T07:30:00.000001Z'),
		d: 0.1 + 0.2,
		span: { months: 1, days: -1, microseconds: 1n },
	}, 'values');
}
