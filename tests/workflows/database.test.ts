/** Fixture ownership against the same real database used by the workflow suites. @module */
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import postgres from 'postgres';
import { ownSchema } from './fixtures/database.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;

describe('borrowed PostgreSQL fixture ownership', { skip: url === undefined }, () => {
	it('isolates equal table names and carries the scope into a newly connected pool', async () => {
		await using first = await ownSchema(url!, 2);
		await using second = await ownSchema(url!, 2);
		await first.database`create table fixture_writes (value text not null)`;
		await second.database`create table fixture_writes (value text not null)`;
		await first.database`insert into fixture_writes values ('first')`;
		await second.database`insert into fixture_writes values ('second')`;
		const reconnected = postgres(first.url, { max: 1, connection: { statement_timeout: 2000 } });
		try {
			expect((await reconnected`select value from fixture_writes`)[0]!.value).toBe('first');
			expect((await second.database`select value from fixture_writes`)[0]!.value).toBe('second');
		} finally {
			await reconnected.end({ timeout: 2 });
		}
		await first[Symbol.asyncDispose]();
		expect((await second.database`select to_regnamespace(${first.schema}) as schema`)[0]!.schema).toBeNull();
		expect((await second.database`select value from fixture_writes`)[0]!.value).toBe('second');
	});

	it('removes partially initialized tables when setup fails without removing another owner', async () => {
		await using observer = await ownSchema(url!, 1);
		await observer.database`create table fixture_writes (value text not null)`;
		await observer.database`insert into fixture_writes values ('preserved')`;
		let failedSchema = '';
		await expect((async () => {
			await using cleanup = new AsyncDisposableStack();
			const failing = cleanup.use(await ownSchema(url!, 1));
			failedSchema = failing.schema;
			await failing.database`create table fixture_writes (value text not null)`;
			await failing.database`create table fixture_writes (value text not null)`;
		})()).rejects.toMatchObject({ code: '42P07' });
		expect(failedSchema).not.toBe('');
		expect((await observer.database`select to_regnamespace(${failedSchema}) as schema`)[0]!.schema).toBeNull();
		expect((await observer.database`select value from fixture_writes`)[0]!.value).toBe('preserved');
	});

	it('still removes its schema when an earlier resource cleanup throws', async () => {
		await using observer = await ownSchema(url!, 1);
		await using cleanup = new AsyncDisposableStack();
		const failing = cleanup.use(await ownSchema(url!, 1));
		await failing.database`create table fixture_writes (value text not null)`;
		cleanup.defer(() => {
			throw new Error('Earlier resource cleanup failed.');
		});
		await expect(cleanup.disposeAsync()).rejects.toThrow('Earlier resource cleanup failed.');
		expect((await observer.database`select to_regnamespace(${failing.schema}) as schema`)[0]!.schema).toBeNull();
	});
});
