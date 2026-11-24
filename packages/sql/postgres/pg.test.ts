import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sql from './mod.ts';
import { types } from './mod.ts';
import { database, executor, type Pool, type PoolClient, type ResultType } from './pg.ts';

/** A pg-shaped pool that records every query and lets a test hold one open. */
function fake(options: { readonly hold?: string } = {}) {
	const log: string[] = [];
	const released: unknown[] = [];
	let stop: ((error: Error) => void) | undefined;
	const query = (text: string, values?: readonly unknown[]): Promise<ResultType> => {
		log.push(values?.length ? `${text} ${JSON.stringify(values)}` : text);
		if (options.hold && text.includes(options.hold)) {
			return new Promise((_, reject) => {
				stop = reject;
			});
		}
		if (text.startsWith('select pg_cancel_backend')) {
			stop?.(Object.assign(new Error('canceling statement due to user request'), { code: '57014' }));
		}
		return Promise.resolve({ rows: [{ v: 'ok' }] });
	};
	const pool: Pool = {
		query,
		connect: () => Promise.resolve({ query, processID: 42, release: (error) => released.push(error) } as PoolClient),
	};
	return { pool, log, released };
}

const one = sql.select({ v: sql.value('x', types.text()) });

describe('pg binding', () => {
	it('runs on the pool, or on a checked-out client when the run can be cancelled', async () => {
		const { pool, log, released } = fake();
		const db = database(pool);
		expect(await sql.rows(db, one)).toEqual([{ v: 'ok' }]);
		await sql.rows(db, one, { signal: new AbortController().signal });
		expect(log).toEqual(['select ($1::text)::text as "v" ["x"]', 'select ($1::text)::text as "v" ["x"]']);
		expect(released).toEqual([undefined]);
	});

	it('cancels a running statement through another connection and rejects with the reason', async () => {
		const { pool, log } = fake({ hold: 'pg_sleep' });
		const sleep = sql.declare('pg_sleep', [types.double], types.empty);
		const controller = new AbortController();
		const run = sql.execute(database(pool), sql.select({ s: sleep(10) }), { signal: controller.signal });
		await new Promise((resolve) => setTimeout(resolve, 5));
		controller.abort(new Error('stopped'));
		await expect(run).rejects.toThrow('stopped');
		expect(log.at(-1)).toBe('select pg_cancel_backend($1::integer) [42]');
	});

	it('opens a transaction at an isolation level, commits, and rolls back on error', async () => {
		const { pool, log, released } = fake();
		const db = database(pool);
		await db.begin((tx) => sql.rows(tx, one), { isolation: 'serializable' });
		await expect(db.begin(() => Promise.reject(new Error('stop')))).rejects.toThrow('stop');
		expect(log.filter((line) => !line.startsWith('select'))).toEqual([
			'begin isolation level serializable',
			'commit',
			'begin',
			'rollback',
		]);
		expect(released).toEqual([undefined, undefined]);
	});

	it('checks the signal before sending on a client without a pool', async () => {
		const { pool } = fake();
		const client = await pool.connect();
		await expect(sql.rows(executor(client), one, { signal: AbortSignal.abort(new Error('early')) })).rejects.toThrow(
			'early',
		);
	});
});
