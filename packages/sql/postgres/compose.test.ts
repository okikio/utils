import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sql from './mod.ts';
import { types } from './mod.ts';
import { database, executor } from './postgresjs.ts';

const app = sql.schema('app');
const jobs = app.table('jobs', {
	id: sql.column(types.uuid),
	state: sql.column(types.text(['queued', 'running', 'done'])),
	priority: sql.column(types.long).default(0),
	finished: sql.column(types.timestamptz).nullable(),
	copied_from: sql.column(types.uuid).nullable(),
});
const j = jobs.c;

describe('composed statements', () => {
	it('claims through a named, locked subquery and update … from', () => {
		const due = sql.cte(
			'due',
			sql.select({ id: j.id }).from(jobs).where(j.state.eq('queued')).orderBy(j.priority.desc()).limit(5)
				.for({ of: [jobs], skipLocked: true }),
		);
		const query = sql.toQuery(
			sql.update(jobs, { state: 'running' }).with(due).from(due).where(j.id.eq(due.c.id)).returning({ id: j.id }),
		);
		expect(query.text).toBe(
			'with "due" as (select "app"."jobs"."id" as "id" from "app"."jobs" where "app"."jobs"."state" = $1::text' +
				' order by "app"."jobs"."priority" desc limit $2::bigint for update of "jobs" skip locked)' +
				' update "app"."jobs" set "state" = $3::text from "due" where "app"."jobs"."id" = "due"."id"' +
				' returning ("app"."jobs"."id")::text as "id"',
		);
		expect(query.values).toEqual(['queued', 5, 'running']);
	});

	it('ranks rows with a window function and deletes through using', () => {
		const ranked = sql.cte(
			'ranked',
			sql.select({ id: j.id, position: sql.fn.rowNumber(j.finished.desc()) }).from(jobs).where(j.finished.isNotNull()),
		);
		const query = sql.toQuery(
			sql.remove(jobs).with(ranked).using(ranked).where(j.id.eq(ranked.c.id), ranked.c.position.gt(10)),
		);
		expect(query.text).toBe(
			'with "ranked" as (select "app"."jobs"."id" as "id", (row_number() over (order by "app"."jobs"."finished" desc))' +
				'::int4 as "position" from "app"."jobs" where "app"."jobs"."finished" is not null)' +
				' delete from "app"."jobs" using "ranked" where ("app"."jobs"."id" = "ranked"."id")' +
				' and ("ranked"."position" > ($1::text)::int4)',
		);
	});

	it('inserts the rows a select returns, named after their columns', () => {
		const query = sql.toQuery(
			sql.insert(
				jobs,
				sql.select({
					id: sql.value('b', types.uuid),
					state: sql.value('queued', jobs.columns.state.type),
					priority: j.priority,
					copied_from: j.id,
				}).from(jobs).where(j.id.eq('a')),
			),
		);
		expect(query.text).toBe(
			'insert into "app"."jobs" ("id", "state", "priority", "copied_from") select ($1::text)::uuid as "id",' +
				' $2::text as "state", "app"."jobs"."priority" as "priority", "app"."jobs"."id" as "copied_from"' +
				' from "app"."jobs" where "app"."jobs"."id" = ($3::text)::uuid',
		);
		expect(() => sql.toQuery(sql.insert(jobs, sql.select({ other: j.id }).from(jobs) as never))).toThrow(
			'Unknown column other',
		);
	});

	it('counts filtered rows and reads a 64-bit count as a safe number', () => {
		const query = sql.toQuery(sql.select({ queued: sql.fn.count(j.state.eq('queued')) }).from(jobs));
		expect(query.text).toBe(
			'select ((count(*) filter (where "app"."jobs"."state" = $1::text))::int4)::int4 as "queued"' +
				' from "app"."jobs"',
		);
		expect(types.long.decode('42')).toBe(42);
		expect(() => types.long.decode('9007199254740993')).toThrow(RangeError);
		expect(() => types.long.send(1.5)).toThrow(TypeError);
	});
});

describe('running with options', () => {
	/** A Postgres.js-shaped client whose query waits until cancelled, then fails as PostgreSQL does. */
	function stalled() {
		const calls: string[] = [];
		const client = Object.assign(
			(() => {
				let reject!: (error: unknown) => void;
				const pending = new Promise<never>((_, fail) => (reject = fail)) as Promise<never> & { cancel(): void };
				pending.cancel = () => {
					calls.push('cancel');
					reject(Object.assign(new Error('canceling statement due to user request'), { code: '57014' }));
				};
				return pending;
			}) as never,
			{ unsafe() {} },
		);
		return { client, calls };
	}

	it('cancels a running query on abort and rejects with the abort reason', async () => {
		const { client, calls } = stalled();
		const controller = new AbortController();
		const running = executor(client).run(sql.toQuery(sql.select({ one: sql.value(1, types.integer) })), {
			signal: controller.signal,
		});
		controller.abort(new Error('stopped'));
		await expect(running).rejects.toThrow('stopped');
		expect(calls).toEqual(['cancel']);
	});

	it('opens a transaction at the requested isolation level', async () => {
		const options: unknown[] = [];
		const pool = Object.assign(() => Promise.resolve([]), {
			unsafe() {},
			begin(...args: unknown[]) {
				options.push(args.length === 2 ? args[0] : undefined);
				const work = args.at(-1) as (tx: unknown) => Promise<unknown>;
				return work(pool);
			},
		});
		await database(pool as never).begin(() => Promise.resolve(), { isolation: 'read committed' });
		await database(pool as never).begin(() => Promise.resolve());
		expect(options).toEqual(['isolation level read committed', undefined]);
	});
});
