/** The workflow store on an `@okikio/sql` database instead of a Postgres.js pool: here, node-postgres. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { expect } from '@std/expect';
import pg from 'pg';
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';
import { database } from '@okikio/sql/postgres/pg';
import * as schema from '@okikio/schema';
import * as storage from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import { identity } from '@okikio/workflow/execution';
import { Engine } from './scenarios/events.ts';
import { Policy, Work } from './scenarios/execution.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Workflow database checks require a disposable PostgreSQL database.');
const pool = new pg.Pool({ connectionString: url, max: 6 });
const db = database(pool);
const space = sql.schema('utils_workflow_database_test');
const notes = space.table('notes', { id: sql.column(types.text()), value: sql.column(types.text()) });
const policy = workflow.PolicySchema.parse({ ...Policy, claims: { ...Policy.claims, leaseMs: 60_000 } });

before(async () => {
	await pool.query('drop schema if exists utils_workflow_database_test cascade');
	await sql.execute(db, sql.createSchema('utils_workflow_database_test'));
	for (const statement of sql.tableStatements(notes)) await sql.execute(db, statement);
	await storage.migrate({ database: db });
});
after(async () => {
	await pool.query('drop schema if exists utils_workflow_database_test cascade');
	await pool.end();
});

/** Admit and claim one job on a store over the node-postgres database. */
async function fixture(test: TestContext) {
	const namespace = crypto.randomUUID();
	const store = storage.open({ database: db, namespace });
	const client = workflow.client({ store, policy });
	const ref = await client.trigger(Work, { value: 7 }, { scope: 'database', key: namespace });
	const host = await store.register('database-test', [identity(Work)], Engine.id, {
		activations: 1,
		activities: 1,
	}, 60_000);
	test.after(async () => {
		await store.leave(host);
		await store[Symbol.asyncDispose]();
	});
	const job = (await store.take(host, [identity(Work)]))!;
	expect(job).toBeDefined();
	return { namespace, store, client, ref, job, options: { key: 'note', input: 7, result: schema.string() } };
}

describe('workflow store on an @okikio/sql database', { concurrency: false, timeout: 30_000 }, () => {
	it('reads the migration state and checks the schema', async () => {
		expect(await storage.migrationStatus({ database: db })).toMatchObject({ state: 'current' });
		const store = storage.open({ database: db, namespace: crypto.randomUUID() });
		await store.check();
		await store[Symbol.asyncDispose]();
	});

	it('refuses notifications, which need LISTEN', () => {
		expect(() => storage.open({ database: db, namespace: 'n', notifications: true })).toThrow('Postgres.js');
	});

	it('commits domain SQL and its receipt together, and rolls both back', async (test) => {
		const { namespace, store, job, options } = await fixture(test);
		await expect(store.transaction(job.claim, options, async (tx, receipt) => {
			await sql.execute(tx, sql.insert(notes, { id: `${namespace}:gone`, value: 'provisional' }));
			await receipt.save('first');
			throw new Error('undo');
		})).rejects.toThrow('undo');
		const saved = await store.transaction(job.claim, options, async (tx, receipt) => {
			await sql.execute(tx, sql.insert(notes, { id: `${namespace}:kept`, value: 'kept' }));
			return await receipt.save('second');
		});
		expect(saved.value).toBe('second');
		const ids = await sql.rows(
			db,
			sql.select({ id: notes.c.id }).from(notes).where(sql.fn.startsWith(notes.c.id, `${namespace}:`)),
		);
		expect(ids).toEqual([{ id: `${namespace}:kept` }]);
		expect(await store.getReceipt(job.claim, options)).toEqual({ value: 'second' });
	});

	it('admits work in the caller transaction opened with begin', async (test) => {
		const { store, client } = await fixture(test);
		const key = crypto.randomUUID();
		const ref = await storage.begin(db, async (tx) => {
			await sql.execute(tx, sql.insert(notes, { id: key, value: 'with job' }));
			return await client.in(tx).submit(Work, { value: 1 }, { scope: 'database', key });
		});
		expect((await client.get(Work, ref)).ref.id).toBe(ref.id);
		await expect(db.begin((tx) => client.in(tx).submit(Work, { value: 2 }, { scope: 'database', key: 'x' })))
			.rejects.toMatchObject({ code: 'transaction_binding' });
		const inspected = await storage.inspector({ database: db, namespace: store.namespace }).inspect(ref);
		expect(inspected.run.ref.id).toBe(ref.id);
	});
});
