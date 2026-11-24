import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sql from './mod.ts';
import { json, trigger, types } from './mod.ts';

const app = sql.schema('app');
const notes = app.table('notes', {
	id: sql.column(types.uuid),
	owner: sql.column(types.uuid),
	title: sql.column(types.text()),
});
const people = app.table('people', {
	id: sql.column(types.uuid),
	name: sql.column(types.text()),
});
const n = notes.c;
const p = people.c;

describe('scope', () => {
	it('rejects a column of a table the statement does not read, in types and when built', () => {
		const stray = sql.select({ id: n.id }).from(notes).where(p.name.eq('a'));
		// @ts-expect-error: `app.people` is not in the select's scope.
		const statement: sql.Statement<{ id: string }> = stray;
		expect(() => sql.toQuery(statement)).toThrow('reads app.people');
		// @ts-expect-error: an update reads only its table and its from list.
		expect(() => sql.toQuery(sql.update(notes, { title: p.name }))).toThrow('reads app.people');
		// @ts-expect-error: a delete reads only its table and its using list.
		expect(() => sql.toQuery(sql.remove(notes).where(p.id.eq(n.owner)))).toThrow('reads app.people');
	});

	it('accepts a column once a join, from or using brings its table in', () => {
		const joined = sql.select({ title: n.title, name: p.name }).from(notes).join(people, p.id.eq(n.owner));
		const statement: sql.Statement<{ title: string; name: string }> = joined;
		expect(sql.toQuery(statement).text).toContain('join "app"."people"');
		const moved: sql.Statement<unknown> = sql.update(notes, { title: p.name }).from(people).where(p.id.eq(n.owner));
		expect(() => sql.toQuery(moved)).not.toThrow();
		const removed: sql.Statement<unknown> = sql.remove(notes).using(people).where(p.id.eq(n.owner));
		expect(() => sql.toQuery(removed)).not.toThrow();
	});

	it("passes a correlated subquery's outer columns to the statement that embeds it", () => {
		const inner = sql.select({}).from(people).where(p.id.eq(n.owner));
		expect(() => sql.toQuery(inner as never)).toThrow('reads app.notes');
		const owned = sql.exists(inner);
		const outer: sql.Statement<{ id: string }> = sql.select({ id: n.id }).from(notes).where(owned);
		expect(sql.toQuery(outer).text).toContain('exists (select 1 as "_" from "app"."people"');
		// @ts-expect-error: the subquery reads `app.notes`, which this select does not define.
		const lost: sql.Statement<{ id: string }> = sql.select({ id: p.id }).from(people).where(owned);
		expect(() => sql.toQuery(lost)).toThrow('reads app.notes');
	});

	it("lets a row function read an outer column, and counts it as the outer statement's", () => {
		const ids = json.elements(json.get(n.title as sql.Expr<unknown, typeof notes.key>, 'ids'), 'i');
		const outer = sql.select({ id: n.id }).from(notes).where(
			sql.exists(sql.select({}).from(ids).where(json.text(ids.c.value, 'id').eq(n.title))),
		);
		// The column is named, because CockroachDB names a lone column after the alias.
		expect(sql.toQuery(outer).text).toContain(') as "i"("value")');
		const alone = sql.select({ value: ids.c.value }).from(ids);
		expect(() => sql.toQuery(alone as never)).toThrow('reads app.notes');
	});

	it('requires a named subquery and a union to read only their own sources', () => {
		const correlated = sql.select({ id: p.id }).from(people).where(p.id.eq(n.owner));
		expect(() => sql.cte('c', correlated as never)).toThrow('reads app.notes');
		expect(() => sql.unionAll(correlated as never)).toThrow('reads app.notes');
	});

	it('keeps an alias apart from its table', () => {
		const other = notes.as('other');
		const aliased = sql.select({ id: other.c.id }).from(other).where(n.id.eq(other.c.id));
		expect(() => sql.toQuery(aliased as never)).toThrow('reads app.notes');
	});

	it('refuses a constraint or check that reads another table', () => {
		expect(() => app.table('bad', { id: sql.column(types.uuid) }, () => ({ checks: [p.name.eq('a')] as never })))
			.toThrow('reads app.people');
		// @ts-expect-error: a check of `app.notes` cannot read `app.people`.
		expect(() => sql.replaceCheck(notes, 'notes_owner', p.name.eq('a'))).toThrow('another table');
	});

	it('lets a trigger read only the changed rows and the operation', () => {
		const fresh = trigger.changed(notes, 'new').c;
		const ok = sql.insert(people, { id: fresh.owner, name: fresh.title });
		expect(() => trigger.run(ok)).not.toThrow();
		const stray = sql.insert(people, { id: fresh.owner, name: n.title });
		// @ts-expect-error: a trigger statement cannot read `app.notes` directly.
		expect(() => trigger.run(stray)).toThrow('reads app.notes');
		// @ts-expect-error: a step cannot read a table column outside a statement.
		expect(() => trigger.perform(n.title)).toThrow('reads app.notes');
	});
});

describe('dialects', () => {
	const other: sql.Dialect = Object.freeze({
		...sql.dialect,
		name: 'other',
		get boolean() {
			return { ...types.boolean, dialect: other };
		},
	});
	const text: sql.SqlType<string> = { ...types.text(), dialect: other };

	it('refuses to mix two dialects in one expression, table or statement', () => {
		const foreign = sql.value('a', text);
		expect(() => n.title.eq(foreign)).toThrow('Cannot combine postgres and other SQL');
		expect(() => sql.select({ title: foreign })).toThrow('Cannot combine');
		expect(() => app.table('mixed', { title: sql.column(text) })).toThrow('Cannot combine');
		expect(() => sql.coalesce(n.title, foreign)).toThrow('Cannot combine');
	});
});
