/** Statements run through Kysely, in its transactions too, and cancel by signal. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import pg from 'pg';
import { Kysely, PostgresDialect, sql as kyselyTag } from 'kysely';
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import * as kysely from '@okikio/sql/postgres/kysely';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Kysely checks require a disposable PostgreSQL database.');
const pool = new pg.Pool({ connectionString: url, max: 4 });
const kyselyOrm = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool }) });
const space = sql.schema('utils_sql_kysely_test');
const notes = space.table('notes', { id: sql.column(types.integer), title: sql.column(types.text()) });
const n = notes.c;
const sleep = sql.declare('pg_sleep', [types.double], types.empty);

before(async () => {
	await pool.query('drop schema if exists utils_sql_kysely_test cascade');
	await pool.query('create schema utils_sql_kysely_test');
	for (const statement of sql.tableStatements(notes)) {
		await sql.execute(kysely.database(kyselyOrm, kyselyTag), statement);
	}
});
after(async () => {
	await pool.query('drop schema if exists utils_sql_kysely_test cascade');
	await kyselyOrm.destroy();
});

describe('Kysely', () => {
	const db = kysely.database(kyselyOrm, kyselyTag);

	it('runs statements and transactions', async () => {
		await expect(
			kyselyOrm.transaction().execute(async (trx) => {
				await sql.execute(kysely.executor(trx, kyselyTag), sql.insert(notes, { id: 1, title: 'gone' }));
				throw new Error('undo');
			}),
		).rejects.toThrow('undo');
		const level = await db.begin(async (tx) => {
			const current = sql.declare('current_setting', [types.text()], types.text());
			return await sql.one(tx, sql.select({ v: current('transaction_isolation') }));
		}, { isolation: 'repeatable read' });
		expect(level).toEqual({ v: 'repeatable read' });
		await sql.execute(db, sql.insert(notes, { id: 2, title: 'kept' }));
		expect(await sql.rows(db, sql.select({ title: n.title }).from(notes))).toEqual([{ title: 'kept' }]);
	});

	it('cancels by signal', async () => {
		const reason = new Error('stopped');
		const controller = new AbortController();
		setTimeout(() => controller.abort(reason), 200);
		const started = Date.now();
		await expect(sql.execute(db, sql.select({ s: sleep(10) }), { signal: controller.signal })).rejects.toBe(reason);
		expect(Date.now() - started).toBeLessThan(3_000);
		expect(await sql.rows(db, sql.select({ n: sql.value(1, types.integer) }))).toEqual([{ n: 1 }]);
	});
});
