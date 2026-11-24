import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sql from '../mod.ts';
import { types } from '../mod.ts';
import { database, type DrizzleDatabase, type Session } from './run.ts';

/** A Drizzle-shaped database that records each statement and returns rows in the shape `shape` picks. */
function fake(shape: 'rows' | 'array') {
	const log: unknown[] = [];
	const tag = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values });
	const session: Session = {
		execute: (query: never) => {
			log.push(query);
			return Promise.resolve(shape === 'rows' ? { rows: [{ v: 1 }] } : [{ v: 1 }]);
		},
	};
	const db: DrizzleDatabase = {
		...session,
		transaction: async (work, config) => {
			log.push({ config });
			return await work(session);
		},
	};
	return { db, tag, log };
}

describe('Drizzle binding', () => {
	const query = sql.select({ v: sql.value(1, types.integer) });

	it('sends the template through the tag and reads either result shape', async () => {
		for (const shape of ['rows', 'array'] as const) {
			const { db, tag, log } = fake(shape);
			expect(await sql.rows(database(db, tag), query)).toEqual([{ v: 1 }]);
			const sent = log[0] as { strings: string[]; values: unknown[] };
			expect(sent.values).toEqual(['1']);
			expect(sent.strings.length).toBe(2);
		}
	});

	it('passes the isolation level to db.transaction', async () => {
		const { db, tag, log } = fake('rows');
		await database(db, tag).begin((tx) => sql.rows(tx, query), { isolation: 'serializable' });
		expect(log[0]).toEqual({ config: { isolationLevel: 'serializable' } });
	});

	it('checks the signal before sending when no driver can cancel', async () => {
		const { db, tag, log } = fake('rows');
		const reason = new Error('stopped');
		await expect(sql.rows(database(db, tag), query, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
		expect(log).toEqual([]);
	});
});
