import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sql from './mod.ts';
import { types } from './mod.ts';
import { database, type KyselyDatabase, type Tag } from './kysely.ts';

/** A Kysely-shaped instance whose statements record their options and wait for `hold` to settle. */
function fake(hold?: () => Promise<never>) {
	const log: unknown[] = [];
	const tag: Tag = () => ({
		execute: (session, options) => {
			log.push({ session, options });
			return hold?.() ?? Promise.resolve({ rows: [{ v: 1 }] });
		},
	});
	const builder = {
		setIsolationLevel(level: string) {
			log.push({ level });
			return builder;
		},
		execute: <T>(work: (trx: object) => Promise<T>) => work({ trx: true }),
	};
	const db: KyselyDatabase = { transaction: () => builder };
	return { db, tag, log };
}

describe('Kysely binding', () => {
	const query = sql.select({ v: sql.value(1, types.integer) });

	it('runs on the instance, and in a transaction on its trx at the isolation level', async () => {
		const { db, tag, log } = fake();
		expect(await sql.rows(database(db, tag), query)).toEqual([{ v: 1 }]);
		await database(db, tag).begin((tx) => sql.rows(tx, query), { isolation: 'repeatable read' });
		expect(log).toEqual([
			{ session: db, options: undefined },
			{ level: 'repeatable read' },
			{ session: { trx: true }, options: undefined },
		]);
	});

	it('asks Kysely to cancel in the database and rejects with the signal reason', async () => {
		const live = new AbortController();
		const { db, tag, log } = fake(() =>
			new Promise((_, reject) => live.signal.addEventListener('abort', () => reject(new Error('aborted by Kysely'))))
		);
		const controller = new AbortController();
		const reason = new Error('stopped');
		controller.abort(reason);
		await expect(sql.rows(database(db, tag), query, { signal: controller.signal })).rejects.toBe(reason);
		expect(log).toEqual([]);
		const pending = sql.rows(database(db, tag), query, { signal: live.signal });
		live.abort(reason);
		await expect(pending).rejects.toBe(reason);
		expect(log).toEqual([{
			session: db,
			options: { signal: live.signal, inflightQueryAbortStrategy: 'cancel query' },
		}]);
	});
});
