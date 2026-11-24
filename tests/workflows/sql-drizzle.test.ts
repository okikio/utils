/** Drizzle tables become table definitions, and statements run through Drizzle, in its transactions too. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import pg from 'pg';
import postgresjs from 'postgres';
import { sql as drizzleTag } from 'drizzle-orm';
import { drizzle as nodePostgres } from 'drizzle-orm/node-postgres';
import { drizzle as postgresJs } from 'drizzle-orm/postgres-js';
import { bigint, getTableConfig, integer, numeric, pgSchema, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { drift } from '@okikio/sql/postgres/adopt';
import * as bridge from '@okikio/sql/postgres/drizzle';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Bridge checks require a disposable PostgreSQL database.');
const pool = new pg.Pool({ connectionString: url, max: 4 });
const client = postgresjs(url, { max: 2, onnotice: () => {} });

const space = pgSchema('utils_sql_drizzle_test');
const mood = space.enum('mood', ['sad', 'ok']);
const drizzleAccounts = space.table('accounts', {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	displayName: varchar('display_name', { length: 40 }).notNull(),
	mood: mood().notNull().default('ok'),
	tags: text().array(),
	cents: bigint({ mode: 'bigint' }).notNull(),
	total: numeric().generatedAlwaysAs(drizzleTag`cents / 100.0`),
	made: timestamp({ withTimezone: true }).notNull().$defaultFn(() => new Date('2026-01-02T03:04:05.678Z')),
	changed: timestamp().$onUpdateFn(() => new Date('2026-02-03T04:05:06Z')),
});
const accounts = bridge.table(drizzleAccounts, getTableConfig);
const a = accounts.c;
const sleep = sql.declare('pg_sleep', [types.double], types.empty);

const orm = nodePostgres({ client: pool });
const ormJs = postgresJs({ client });

before(async () => {
	await pool.query('drop schema if exists utils_sql_drizzle_test cascade');
	await pool.query('create schema utils_sql_drizzle_test');
	await pool.query(`create type utils_sql_drizzle_test.mood as enum ('sad', 'ok')`);
	await pool.query(`create table utils_sql_drizzle_test.accounts (
		id integer primary key generated always as identity,
		display_name varchar(40) not null,
		mood utils_sql_drizzle_test.mood not null default 'ok',
		tags text[],
		cents bigint not null,
		total numeric generated always as (cents / 100.0) stored,
		made timestamptz not null,
		changed timestamp
	)`);
});
after(async () => {
	await pool.query('drop schema if exists utils_sql_drizzle_test cascade');
	await client.end();
	await pool.end();
});

describe('Drizzle tables', () => {
	it('match the live table, keys and all', async () => {
		expect(accounts.key).toBe('utils_sql_drizzle_test.accounts');
		expect(Object.keys(accounts.columns)).toEqual(
			['id', 'displayName', 'mood', 'tags', 'cents', 'total', 'made', 'changed'],
		);
		expect(accounts.constraints.primaryKey?.map((item) => item.name)).toEqual(['id']);
		const found = await drift(bridge.executor(orm, drizzleTag), [accounts]);
		expect(found.filter((item) => item.severity === 'error')).toEqual([]);
	});

	it('write and read through Drizzle with Drizzle defaults applied', async () => {
		const db = bridge.database(orm, drizzleTag);
		const row = await sql.one(
			db,
			sql.insert(accounts, { displayName: 'Ada', cents: 1234n, tags: ['x', null] }).returning({
				id: a.id,
				mood: a.mood,
				total: a.total,
				made: a.made,
				tags: a.tags,
			}),
		);
		if (!row) throw new Error('The insert returned no row.');
		expect(row).toMatchObject({ mood: 'ok', total: '12.3400000000000000', tags: ['x', null] });
		expect(row.made.toString()).toBe('2026-01-02T03:04:05.678Z');
		await sql.execute(db, sql.update(accounts, { displayName: 'Ada L' }).where(a.id.eq(row.id)));
		const [read] = await orm.select().from(drizzleAccounts);
		expect(read).toMatchObject({ displayName: 'Ada L', cents: 1234n });
		expect(read!.changed?.toISOString()).toBe('2026-02-03T04:05:06.000Z');
		// @ts-expect-error: the database writes `id`, so a row may not name it.
		expect(() => sql.toQuery(sql.insert(accounts, { id: 1, displayName: 'no', cents: 1n }))).toThrow();
	});

	it('run inside a Drizzle transaction and roll back with it', async () => {
		await expect(orm.transaction(async (tx) => {
			await sql.execute(bridge.executor(tx, drizzleTag), sql.insert(accounts, { displayName: 'gone', cents: 1n }));
			await tx.insert(drizzleAccounts).values({ displayName: 'also gone', cents: 2n });
			throw new Error('undo');
		})).rejects.toThrow('undo');
		const db = bridge.database(orm, drizzleTag);
		const level = await db.begin(async (tx) => {
			const current = sql.declare('current_setting', [types.text()], types.text());
			return await sql.one(tx, sql.select({ v: current('transaction_isolation') }));
		}, { isolation: 'serializable' });
		expect(level).toEqual({ v: 'serializable' });
		const names = await sql.rows(db, sql.select({ name: a.displayName }).from(accounts));
		expect(names).toEqual([{ name: 'Ada L' }]);
	});

	it('cancel by signal through the client Drizzle sits on', async () => {
		for (const db of [bridge.database(orm, drizzleTag), bridge.database(ormJs, drizzleTag)]) {
			const started = Date.now();
			await expect(sql.execute(db, sql.select({ s: sleep(10) }), { signal: AbortSignal.timeout(200) })).rejects
				.toThrow();
			expect(Date.now() - started).toBeLessThan(3_000);
			expect(await sql.rows(db, sql.select({ n: sql.value(1, types.integer) }))).toEqual([{ n: 1 }]);
		}
	});
});
