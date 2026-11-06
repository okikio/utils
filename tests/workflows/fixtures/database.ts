/** Owned application tables inside a borrowed PostgreSQL database. @module */
import '@okikio/dispose/polyfill';
import postgres from 'postgres';

/**
 * Each suite owns one schema. Its URL carries the search path into fresh processes,
 * threads and reconnected pools; tested production adapter schemas stay shared.
 * Register this resource before running migrations or application setup so teardown
 * also runs when a before hook fails. The database itself is always borrowed.
 */
export async function ownSchema(url: string, max: number) {
	const schema = `utils_fixture_${crypto.randomUUID().replaceAll('-', '')}`;
	const selected = new URL(url);
	selected.searchParams.set('search_path', schema);
	const database = postgres(selected.href, { max, onnotice() {} });
	await using pending = new AsyncDisposableStack();
	pending.defer(() => database.end({ timeout: 2 }));
	await database`create schema ${database(schema)}`;
	pending.defer(async () => {
		await database.begin(async (transaction) => {
			await transaction`set local lock_timeout = '5s'`;
			await transaction`set local statement_timeout = '10s'`;
			await transaction`drop schema ${transaction(schema)} cascade`;
		});
	});
	const owned = pending.move();
	return {
		schema,
		url: selected.href,
		database,
		[Symbol.asyncDispose]: () => owned.disposeAsync(),
	};
}
