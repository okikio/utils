/** node-postgres runs compiled statements, cancels them by signal and keeps its pool usable afterwards. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import pg from 'pg';
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { database } from '@okikio/sql/postgres/pg';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('pg checks require a disposable PostgreSQL database.');
const pool = new pg.Pool({ connectionString: url, max: 3 });
const db = database(pool);
const space = sql.schema('utils_sql_pg_test');
const notes = space.table('notes', { id: sql.column(types.integer), title: sql.column(types.text()) });
const sleep = sql.declare('pg_sleep', [types.double], types.empty);

before(async () => {
	await pool.query('drop schema if exists utils_sql_pg_test cascade');
	await sql.execute(db, sql.createSchema('utils_sql_pg_test'));
	for (const statement of sql.tableStatements(notes)) await sql.execute(db, statement);
});
after(async () => {
	await pool.query('drop schema if exists utils_sql_pg_test cascade');
	await pool.end();
});

describe('node-postgres binding', () => {
	it('cancels a running statement by signal and leaves the pool usable', async () => {
		const started = Date.now();
		await expect(
			sql.execute(db, sql.select({ s: sleep(10) }), { signal: AbortSignal.timeout(200) }),
		).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(3_000);
		for (let i = 0; i < 5; i++) {
			expect(await sql.one(db, sql.select({ v: sql.value(i, types.integer) }))).toEqual({ v: i });
		}
	});

	it('cancels inside a transaction, which then rolls back', async () => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(new Error('stopped')), 200);
		await expect(db.begin(async (tx) => {
			await sql.execute(tx, sql.insert(notes, { id: 1, title: 'kept?' }));
			await sql.execute(tx, sql.select({ s: sleep(10) }), { signal: controller.signal });
		})).rejects.toThrow('stopped');
		expect(await sql.rows(db, sql.select({ id: notes.c.id }).from(notes))).toEqual([]);
	});

	it('commits at an isolation level', async () => {
		const level = await db.begin(async (tx) => {
			await sql.execute(tx, sql.insert(notes, { id: 2, title: 'committed' }));
			const current = sql.declare('current_setting', [types.text()], types.text());
			return await sql.one(tx, sql.select({ v: current('transaction_isolation') }));
		}, { isolation: 'repeatable read' });
		expect(level).toEqual({ v: 'repeatable read' });
		expect(await sql.rows(db, sql.select({ title: notes.c.title }).from(notes))).toEqual([{ title: 'committed' }]);
	});
});
