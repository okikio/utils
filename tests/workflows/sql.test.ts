/** PostgreSQL proves that compiled statements parse, plan, run and round-trip every value type the same way. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import postgres from 'postgres';
import { temporal } from '@okikio/duration/temporal';
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { database as bind, executor } from '@okikio/sql/postgres/postgresjs';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('SQL checks require a disposable PostgreSQL database.');
const client = postgres(url, { max: 2, onnotice() {} });
const db = bind(client);

const space = sql.schema('utils_sql_test');
const notes = space.table('notes', {
	id: sql.column(types.uuid).default(sql.fn.randomUuid()),
	title: sql.column(types.text()),
	state: sql.column(types.text(['open', 'done'])).default('open'),
	body: sql.column(types.jsonb()),
	seen: sql.column(types.timestamptz).nullable(),
	rank: sql.column(types.integer).default(0),
	weight: sql.column(types.double).default(0),
	flag: sql.column(types.boolean).default(false),
	sequence: sql.column(types.bigint).identity(),
}, (c) => ({
	primaryKey: [c.id],
	unique: [[c.title]],
	checks: [c.rank.gte(0), c.state.in(['open', 'done'])],
	indexes: [{ name: 'notes_open', on: [c.rank.desc(), c.sequence], where: c.state.eq('open') }],
}));
const n = notes.c;
const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);
const hash = sql.declare('hashtextextended', [types.text(), types.bigint], types.bigint);

before(async () => {
	await client`drop schema if exists utils_sql_test cascade`;
	await sql.execute(db, sql.createSchema('utils_sql_test'));
	for (const statement of sql.tableStatements(notes)) await sql.execute(db, statement);
});
after(async () => {
	await client`drop schema if exists utils_sql_test cascade`;
	await client.end({ timeout: 2 });
});

describe('typed statements on PostgreSQL', () => {
	it('round-trips JSON null, a JSON string, times, bigint and the defaults', async () => {
		const at = temporal.Instant.fromEpochMilliseconds(1_700_000_000_123);
		const inserted = await sql.rows(
			db,
			sql.insert(notes, [
				{ title: 'null', body: null },
				{ title: 'string', body: 'plain', seen: at, weight: 0.5, flag: true },
			]).returning({
				title: n.title,
				body: n.body,
				seen: n.seen,
				state: n.state,
				sequence: n.sequence,
				weight: n.weight,
				flag: n.flag,
			}),
		);
		expect(inserted).toEqual([
			{ title: 'null', body: null, seen: null, state: 'open', sequence: 1n, weight: 0, flag: false },
			{ title: 'string', body: 'plain', seen: at, state: 'open', sequence: 2n, weight: 0.5, flag: true },
		]);
		const stored = await client`select jsonb_typeof(body) as kind from utils_sql_test.notes order by sequence`;
		expect(stored.map((row) => row.kind)).toEqual(['null', 'string']);
	});

	it('locks, conflicts, updates with SQL time and keyset-pages in byte order', async () => {
		await db.begin(async (tx) => {
			expect(await sql.one(tx, sql.select({ locked: lock(hash('notes', 0n)) }))).toEqual({ locked: undefined });
			const skipped = await sql.rows(
				tx,
				sql.insert(notes, { title: 'null', body: 1 }).onConflict({ target: [n.title], action: 'nothing' }).returning({
					id: n.id,
				}),
			);
			expect(skipped).toEqual([]);
			await sql.execute(
				tx,
				sql.update(notes, { state: 'done', seen: sql.later(sql.fn.clockTimestamp(), 1000), rank: sql.add(n.rank, 2) })
					.where(n.title.eq('null')),
			);
		});
		const page = await sql.rows(
			db,
			sql.select({ title: n.title, rank: n.rank }).from(notes).where(sql.row(sql.collate(n.title, 'C')).gt(['A']))
				.orderBy(
					sql.collate(n.title, 'C'),
				),
		);
		expect(page).toEqual([{ title: 'null', rank: 2 }, { title: 'string', rank: 0 }]);
		const counted = await sql.one(db, sql.select({ open: sql.fn.count() }).from(notes).where(n.state.eq('open')));
		expect(counted).toEqual({ open: 1 });
	});

	it('PostgreSQL describes every statement in a catalog with the declared columns', async () => {
		const catalog: sql.CatalogType = {
			lock: sql.select({ locked: lock(hash('notes', 0n)) }),
			page: sql.select({ title: n.title, seen: n.seen }).from(notes).where(n.state.in(['open'])).limit(5).for({
				skipLocked: true,
			}),
			insert: sql.insert(notes, { title: 't', body: {} }).returning({ id: n.id }),
			update: sql.update(notes, { flag: true }).where(n.id.eq('00000000-0000-0000-0000-000000000000')),
			remove: sql.remove(notes).where(n.state.eq('done')).returning({ sequence: n.sequence }),
			wrong: sql.select({ title: n.title }).from(notes).where(n.rank.eq(1)),
		};
		const problems = await sql.describe(catalog, async (text) => {
			const found = await client.unsafe(text).describe();
			return { parameters: found.types.length, columns: found.columns.map((column) => column.name) };
		});
		expect(problems).toEqual([]);
		const broken = space.table('notes', { titel: sql.column(types.text()) });
		const failed = await sql.describe({ broken: sql.select({ titel: broken.c.titel }).from(broken) }, async (text) => {
			const found = await client.unsafe(text).describe();
			return { parameters: found.types.length, columns: found.columns.map((column) => column.name) };
		});
		expect(failed.map((item) => item.name)).toEqual(['broken']);
	});

	it('runs through a text-only client too', async () => {
		const textOnly: sql.Executor = { run: async (query) => await client.unsafe(query.text, query.values as never[]) };
		expect(
			await sql.rows(textOnly, sql.select({ title: n.title, body: n.body }).from(notes).where(n.title.eq('string'))),
		)
			.toEqual([{ title: 'string', body: 'plain' }]);
		await sql.execute(executor(client), sql.remove(notes).where(n.title.eq('nothing')));
	});
});
