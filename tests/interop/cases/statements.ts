/** Statements: writes, reads, triggers, upserts, CTEs, JSON, keysets, functions and transactions. @module */
import * as sql from '@okikio/sql/postgres';
import { json, types } from '@okikio/sql/postgres';
import { temporal } from '@okikio/duration/temporal';
import { same } from './check.ts';
import { kindsRows, t1 } from './schema.ts';
import type { CaseType } from './types.ts';

const tables = 'create tables with identity, serial and checks';

export const statements: readonly CaseType[] = [
	{
		name: 'values round-trip',
		after: [tables],
		run: async ({ db, t }) => {
			const k = t.kinds.c;
			await sql.execute(db, sql.insert(t.kinds, kindsRows));
			const out = await sql.rows(
				db,
				sql.select({
					id: k.id,
					label: k.label,
					small: k.small,
					big: k.big,
					count: k.count,
					ratio: k.ratio,
					flag: k.flag,
					ref: k.ref,
					data: k.data,
					at: k.at,
				}).from(t.kinds).orderBy(k.id),
			);
			// JSON numbers beyond double precision come back as doubles.
			same(
				out,
				kindsRows.map((row) => row.id === 5 ? { ...row, data: Number(12345678901234567890n) } : row),
				'rows',
			);
		},
	},
	{
		name: 'parameters equal stored values',
		after: ['values round-trip'],
		run: async ({ db, t }) => {
			const k = t.kinds.c;
			for (const row of kindsRows) {
				const found = await sql.rows(
					db,
					sql.select({ id: k.id }).from(t.kinds).where(
						row.label === null ? k.label.isNull() : k.label.eq(row.label),
						row.big === null ? k.big.isNull() : k.big.eq(row.big),
						row.at === null ? k.at.isNull() : k.at.eq(row.at),
					),
				);
				same(found.map((item) => item.id), [row.id], `match ${row.id}`);
			}
		},
	},
	{
		name: 'insert returning identity',
		after: [tables],
		run: async ({ db, t }) => {
			const n = t.nodes.c;
			const out = await sql.rows(
				db,
				sql.insert(t.nodes, [
					{ id: 1, parent: null, label: 'root', tags: ['a', 'b'] },
					{ id: 2, parent: 1, label: 'child', tags: ['b'] },
					{ id: 3, parent: 2, label: 'leaf', tags: [] },
					{ id: 4, parent: null, label: 'other', tags: ['c'], state: 'done' },
				]).returning({ id: n.id, seq: n.seq, state: n.state }),
			);
			same(out.map((row) => [row.id, typeof row.seq, row.state]), [
				[1, 'bigint', 'open'],
				[2, 'bigint', 'open'],
				[3, 'bigint', 'open'],
				[4, 'bigint', 'done'],
			], 'returned');
		},
	},
	{
		name: 'update one column',
		after: ['insert returning identity'],
		run: async ({ db, t }) => {
			const n = t.nodes.c;
			await sql.execute(
				db,
				sql.update(t.nodes, { label: 'root2' }).where(n.id.eq(1)),
			);
			same(
				await sql.one(
					db,
					sql.select({ label: n.label }).from(t.nodes).where(n.id.eq(1)),
				),
				{ label: 'root2' },
				'label',
			);
		},
	},
	{
		name: 'trigger wrote history with tg_op',
		after: ['create trigger from typed steps', 'update one column'],
		run: async ({ db, t }) => {
			const h = t.history.c;
			const out = await sql.rows(
				db,
				sql.select({ node: h.node, op: h.op }).from(t.history).orderBy(h.id),
			);
			same(out.map((row) => `${row.node}:${row.op}`), [
				'1:INSERT',
				'2:INSERT',
				'3:INSERT',
				'4:INSERT',
				'1:UPDATE',
			], 'history');
		},
	},
	{
		name: 'upsert with excluded and do nothing',
		after: ['insert returning identity'],
		run: async ({ db, t }) => {
			const n = t.nodes.c;
			const x = sql.excluded(t.nodes).c;
			await sql.execute(
				db,
				sql.insert(t.nodes, { id: 4, parent: null, label: 'other2' })
					.onConflict({
						target: [n.id],
						action: 'update',
						set: { label: x.label },
					}),
			);
			await sql.execute(
				db,
				sql.insert(t.nodes, { id: 4, parent: null, label: 'ignored' })
					.onConflict({ action: 'nothing' }),
			);
			same(
				await sql.one(
					db,
					sql.select({ label: n.label }).from(t.nodes).where(n.id.eq(4)),
				),
				{ label: 'other2' },
				'upserted',
			);
		},
	},
	{
		name: 'recursive walk',
		after: ['insert returning identity'],
		run: async ({ db, t }) => {
			const n = t.nodes.c;
			const tree = sql.recursive('tree', {
				id: types.integer,
				depth: types.integer,
			}, (self) =>
				sql.unionAll(
					sql.select({ id: n.id, depth: sql.value(0, types.integer) }).from(
						t.nodes,
					).where(n.parent.isNull(), n.id.eq(1)),
					sql.select({ id: n.id, depth: sql.add(self.c.depth, 1) }).from(
						t.nodes,
					).join(self, n.parent.eq(self.c.id)),
				));
			const out = await sql.rows(
				db,
				sql.select({ id: tree.c.id, depth: tree.c.depth }).with(tree).from(tree)
					.orderBy(tree.c.depth),
			);
			same(
				out,
				[{ id: 1, depth: 0 }, { id: 2, depth: 1 }, { id: 3, depth: 2 }],
				'tree',
			);
		},
	},
	{
		name: 'keyset with row comparison and collate "C"',
		after: ['update one column', 'upsert with excluded and do nothing'],
		run: async ({ db, t }) => {
			const n = t.nodes.c;
			const out = await sql.rows(
				db,
				sql.select({ id: n.id }).from(t.nodes).where(
					sql.row(sql.collate(n.label, 'C'), n.id).gt(['child', 2]),
				)
					.orderBy(sql.collate(n.label, 'C'), n.id),
			);
			same(out.map((row) => row.id), [3, 4, 1], 'keyset');
		},
	},
	{
		name: 'materialized cte, update from and skip locked',
		after: ['keyset with row comparison and collate "C"'],
		run: async ({ db, t }) => {
			const n = t.nodes.c;
			const due = sql.cte(
				'due',
				sql.select({ id: n.id }).from(t.nodes).where(n.state.eq('open'))
					.orderBy(n.id).limit(2).for({ skipLocked: true }),
				{ materialized: true },
			);
			const out = await sql.rows(
				db,
				sql.update(t.nodes, { state: 'done' }).with(due).from(due).where(
					n.id.eq(due.c.id),
				).returning({ id: n.id }),
			);
			same(out.map((row) => row.id).sort(), [1, 2], 'claimed');
			const counts = await sql.one(
				db,
				sql.select({
					all: sql.fn.count(),
					done: sql.fn.count(n.state.eq('done')),
				}).from(t.nodes),
			);
			same(counts, { all: 4, done: 3 }, 'count filter');
		},
	},
	{
		name: 'delete using another table',
		// It writes its own rows, so a server without the trigger still runs it.
		after: ['update one column'],
		run: async ({ db, t }) => {
			const h = t.history.c;
			await sql.execute(
				db,
				sql.insert(t.history, [
					{ node: 3, label: 'leaf', op: 'manual' },
					{ node: 1, label: 'root', op: 'manual' },
				]),
			);
			const other = t.nodes.as('o');
			const out = await sql.rows(
				db,
				sql.remove(t.history).using(other).where(
					h.node.eq(other.c.id),
					other.c.label.eq('leaf'),
					h.op.eq('manual'),
				).returning({ node: h.node }),
			);
			same(out.map((row) => row.node), [3], 'deleted');
		},
	},
	{
		name: 'jsonb operators and elements',
		after: ['values round-trip', 'insert returning identity'],
		run: async ({ db, t }) => {
			const n = t.nodes.c, k = t.kinds.c;
			const tagged = await sql.rows(
				db,
				sql.select({ id: n.id }).from(t.nodes).where(
					json.contains(n.tags, ['b']),
				).orderBy(n.id),
			);
			same(tagged.map((row) => row.id), [1, 2], 'contains');
			const keys = await sql.rows(
				db,
				sql.select({ id: k.id }).from(t.kinds).where(
					json.hasAll(k.data, ['a', 'b']),
				),
			);
			same(keys.map((row) => row.id), [1], 'hasAll ?&');
			const e = json.elements(n.tags, 'e');
			const withA = await sql.rows(
				db,
				sql.select({ id: n.id }).from(t.nodes).where(
					sql.exists(
						sql.select({}).from(e).where(
							e.c.value.eq(sql.value('a', types.jsonb())),
						),
					),
				),
			);
			same(withA.map((row) => row.id), [1], 'elements');
			const texts = await sql.rows(
				db,
				sql.select({
					v: json.text(k.data, 'b'),
					kind: json.kind(k.data),
					len: json.length(sql.value([1, 2, 3], types.jsonb())),
				}).from(t.kinds).where(k.id.eq(1)),
			);
			same(
				texts,
				[{ v: '{"c": true}', kind: 'object', len: 3 }],
				'text, kind and length',
			);
		},
	},
	{
		name: 'in lists, subqueries, between, case and coalesce',
		after: ['values round-trip', 'insert returning identity'],
		run: async ({ db, t }) => {
			const n = t.nodes.c, k = t.kinds.c;
			same(
				await sql.rows(
					db,
					sql.select({ id: n.id }).from(t.nodes).where(n.id.in([])),
				),
				[],
				'empty in',
			);
			const some = await sql.rows(
				db,
				sql.select({ id: n.id }).from(t.nodes).where(
					n.id.in(sql.select({ id: k.id }).from(t.kinds)),
					n.id.between(1, 3),
				)
					.orderBy(n.id),
			);
			same(some.map((row) => row.id), [1, 2, 3], 'in subquery');
			const chosen = await sql.rows(
				db,
				sql.select({
					id: k.id,
					label: sql.coalesce(k.label, 'none'),
					sign: sql.choose(
						k.small.gt(0),
						sql.value('pos', types.text()),
						'other',
					),
				}).from(t.kinds).where(k.id.in([3, 4])).orderBy(k.id),
			);
			same(chosen, [{ id: 3, label: 'unicode é 漢字 🙂  ', sign: 'other' }, {
				id: 4,
				label: 'none',
				sign: 'other',
			}], 'case');
		},
	},
	{
		name: 'time functions and a scalar subquery',
		after: ['insert returning identity'],
		run: async ({ db, t }) => {
			const n = t.nodes.c;
			const out = await sql.one(
				db,
				sql.select({
					later: sql.later(sql.value(t1, types.timestamptz), 1500),
					ms: sql.fn.epochMilliseconds(sql.value(t1, types.timestamptz)),
					max: sql.scalar(sql.select({ m: sql.fn.max(n.id) }).from(t.nodes)),
				}),
			);
			if (!out || Math.abs(out.ms - (t1.epochMilliseconds + 0.456)) > 0.001) {
				throw new Error(`epoch ms ${out?.ms}`);
			}
			same({ later: out.later, max: out.max }, {
				later: t1.add({ milliseconds: 1500 }),
				max: 4,
			}, 'time');
		},
	},
	{
		name: 'sum, min and max over bigint and timestamps',
		after: ['values round-trip'],
		run: async ({ db, t }) => {
			const k = t.kinds.c;
			const out = await sql.one(
				db,
				sql.select({
					s: sql.fn.sum(k.small),
					lo: sql.fn.min(k.big),
					hi: sql.fn.max(k.at),
				}).from(t.kinds)
					.where(k.id.in([1, 2, 3])),
			);
			same(out, { s: -1, lo: -9223372036854775808n, hi: t1 }, 'aggregates');
		},
	},
	{
		name: 'one statement repeated with new values',
		run: async ({ db }) => {
			for (let i = 0; i < 25; i++) {
				const row = await sql.one(
					db,
					sql.select({
						v: sql.value(`x${i}`, types.text()),
						n: sql.value(i, types.integer),
						b: sql.value(BigInt(i) << 40n, types.bigint),
					}),
				);
				same(row, { v: `x${i}`, n: i, b: BigInt(i) << 40n }, `iteration ${i}`);
			}
		},
	},
	{
		name: 'insert 5,000 rows in one statement',
		after: ['values round-trip'],
		run: async ({ db, t }) => {
			const many = Array.from({ length: 5000 }, (_, i) => ({
				id: 1000 + i,
				label: `r${i}`,
				small: i,
				big: BigInt(i),
				count: i,
				ratio: i / 3,
				flag: i % 2 === 0,
				ref: null,
				data: { i },
				at: null,
			}));
			await sql.execute(db, sql.insert(t.kinds, many));
			same(
				await sql.one(
					db,
					sql.select({ c: sql.fn.count() }).from(t.kinds).where(
						t.kinds.c.id.gte(1000),
					),
				),
				{ c: 5000 },
				'count',
			);
		},
	},
	{
		name: 'numeric, timestamp, enum and quoted names',
		after: ['create table with an enum column'],
		run: async ({ db, t }) => {
			const x = t.extras.c;
			const wall = temporal.Instant.from('2026-03-29T01:30:00.000001Z');
			const rows = [
				{
					id: 1,
					amount: '12345678901234567890.123456789',
					wall,
					mood: 'happy',
					'Mixed Case "Name"': 'quoted',
				},
				{
					id: 2,
					amount: '-0.000000001',
					wall: temporal.Instant.from('0001-01-01T00:00:00Z'),
					mood: 'sad',
					'Mixed Case "Name"': null,
				},
				{
					id: 3,
					amount: '0',
					wall: null,
					mood: 'ok',
					'Mixed Case "Name"': null,
				},
			] as const;
			await db.begin(async (tx) => {
				await sql.execute(
					tx,
					sql.select({ s: sql.fn.setLocal('TimeZone', 'Europe/London') }),
				);
				await sql.execute(tx, sql.insert(t.extras, rows));
			});
			const out = await sql.rows(
				db,
				sql.select({
					id: x.id,
					amount: x.amount,
					wall: x.wall,
					mood: x.mood,
					odd: x['Mixed Case "Name"'],
				}).from(t.extras)
					.where(x.mood.in(['happy', 'sad', 'ok'])).orderBy(x.id),
			);
			same(
				out,
				rows.map((r) => ({
					id: r.id,
					amount: r.amount,
					wall: r.wall,
					mood: r.mood,
					odd: r['Mixed Case "Name"'],
				})),
				'rows',
			);
			const hit = await sql.rows(
				db,
				sql.select({ id: x.id }).from(t.extras).where(
					x.wall.eq(wall),
					x.amount.gt('1'),
				),
			);
			same(hit.map((r) => r.id), [1], 'compare');
		},
	},
	{
		name: 'numeric NaN is stored and read back',
		// It runs after the case above, which reads every row of the table.
		after: ['create table with an enum column'],
		run: async ({ db, t }) => {
			const x = t.extras.c;
			await sql.execute(db, sql.insert(t.extras, { id: 9, amount: 'NaN', wall: null, mood: 'ok' }));
			const out = await sql.one(db, sql.select({ amount: x.amount }).from(t.extras).where(x.id.eq(9)));
			same(out, { amount: 'NaN' }, 'NaN');
		},
	},
	{
		name: 'replace a check constraint',
		after: ['insert returning identity'],
		run: async ({ db, name, t }) => {
			const n = t.nodes.c;
			for (
				const item of sql.replaceCheck(
					t.nodes,
					`${name}_label_check`,
					n.label.ne('forbidden'),
				)
			) {
				await sql.execute(db, item);
			}
			let failed = false;
			try {
				await sql.execute(
					db,
					sql.insert(t.nodes, { id: 9, parent: null, label: 'forbidden' }),
				);
			} catch {
				failed = true;
			}
			same(failed, true, 'check rejected');
		},
	},
	{
		name: 'transactions roll back and take an isolation level',
		after: [tables],
		run: async ({ db, t }) => {
			const k = t.kinds.c;
			await db.begin(async (tx) => {
				await sql.execute(
					tx,
					sql.insert(t.kinds, { id: 900, label: 'rolled back' }),
				);
				throw new Error('stop');
			}).catch((error: Error) => {
				if (error.message !== 'stop') throw error;
			});
			same(
				await sql.rows(
					db,
					sql.select({ id: k.id }).from(t.kinds).where(k.id.eq(900)),
				),
				[],
				'rolled back',
			);
			const setting = sql.declare(
				'current_setting',
				[types.text()],
				types.text(),
			);
			const level = await db.begin(async (tx) => {
				await sql.execute(
					tx,
					// `application_name` reads back as written everywhere; CockroachDB drops the unit from `statement_timeout`.
					sql.select({ v: sql.fn.setLocal('application_name', 'interop tx') }),
				);
				const isolation = await sql.one(
					tx,
					sql.select({ v: setting('transaction_isolation') }),
				);
				const name = await sql.one(
					tx,
					sql.select({ v: setting('application_name') }),
				);
				return [isolation?.v, name?.v];
			}, { isolation: 'serializable' });
			same(level, ['serializable', 'interop tx'], 'isolation and set_config');
		},
	},
];
