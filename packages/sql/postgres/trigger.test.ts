import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sql from './mod.ts';
import { trigger, types } from './mod.ts';

const app = sql.schema('app');
const items = app.table('items', {
	id: sql.column(types.integer),
	state: sql.column(types.text(['a', 'b'])),
	root: sql.column(types.integer).filled(),
	changed: sql.column(types.timestamptz).nullable(),
});
const fresh = trigger.changed(items, 'new').c;
const prior = trigger.changed(items, 'old').c;

describe('trigger functions', () => {
	it('writes typed steps as PL/pgSQL with literals and qualified new and old columns', () => {
		const touch = trigger.routine('app', 'touch', [
			trigger.branch(trigger.operation.eq('INSERT'), [trigger.assign(fresh.root, sql.coalesce(fresh.root, fresh.id))], [
				trigger.branch(sql.row(prior.state).distinct(sql.row(fresh.state)), [
					trigger.assign(fresh.changed, sql.fn.clockTimestamp()),
				]),
			]),
			trigger.result('new'),
		]);
		expect(sql.toDdlQuery(touch.ddl).text).toBe(
			'create or replace function "app"."touch"() returns trigger language plpgsql as $body$ begin' +
				` if tg_op = 'INSERT'::text then "new"."root" = coalesce("new"."root", "new"."id");` +
				' else if row("old"."state") is distinct from row("new"."state")' +
				' then "new"."changed" = clock_timestamp(); end if; end if; return new; end; $body$',
		);
	});

	it('drops and creates a trigger with update columns and a condition on the changed row', () => {
		const wake = trigger.routine('app', 'wake', [trigger.result('null')]);
		const statements = trigger.create({
			name: 'items_change',
			table: items,
			timing: 'after',
			events: ['insert', { update: [items.c.state] }],
			condition: prior.state.distinct(fresh.state),
			routine: wake,
		}).map((item) => sql.toDdlQuery(item).text);
		expect(statements).toEqual([
			'drop trigger if exists "items_change" on "app"."items"',
			'create trigger "items_change" after insert or update of "state" on "app"."items" for each row' +
			' when ("old"."state" is distinct from "new"."state") execute function "app"."wake"()',
		]);
	});

	it('refuses steps that PostgreSQL would reject or that could end the body early', () => {
		// @ts-expect-error: only a column of the new row can be assigned.
		expect(() => trigger.assign(prior.state, 'a')).toThrow('only a column of the new row');
		expect(() => trigger.routine('app', 'open', [trigger.perform(sql.fn.clockTimestamp())])).toThrow('result()');
		const wake = trigger.routine('app', 'wake', [trigger.result('null')]);
		expect(() =>
			trigger.create({
				name: 'items_any',
				table: items,
				timing: 'after',
				events: ['insert'],
				// @ts-expect-error: a condition cannot read the operation.
				condition: trigger.operation.eq('INSERT'),
				routine: wake,
			})
		).toThrow('reads tg_op');
		const quoted = trigger.routine('app', 'quoted', [trigger.ensure('cost $5'), trigger.result('null')]);
		expect(() => sql.toDdlQuery(quoted.ddl)).toThrow('DDL constant');
	});

	it('adds a not-null column for a backfill, then requires it, and replaces a named check', () => {
		expect(sql.toDdlQuery(sql.addColumn(items, 'root', { backfill: true })).text).toBe(
			'alter table "app"."items" add column if not exists "root" int4',
		);
		expect(sql.toDdlQuery(sql.setNotNull(items, 'root')).text).toBe(
			'alter table "app"."items" alter column "root" set not null',
		);
		expect(
			sql.replaceCheck(items, 'items_state_check', items.c.state.in(['a', 'b'])).map((item) =>
				sql.toDdlQuery(item).text
			),
		).toEqual([
			'alter table "app"."items" drop constraint if exists "items_state_check"',
			`alter table "app"."items" add constraint "items_state_check" check ("state" in ('a'::text, 'b'::text))`,
		]);
	});
});
