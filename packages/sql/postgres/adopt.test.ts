import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sql from './mod.ts';
import { types } from './mod.ts';
import { generate, type InspectionType } from './adopt.ts';

const space = sql.schema('app', { owned: false });
const users = space.table('User', {
	id: sql.column(types.integer).filled(),
	seenAt: sql.column(types.timestamptz).nullable().named('seen_at'),
	createdAt: sql.column(types.timestamp).onInsert(() => sql.fn.now()),
	updatedAt: sql.column(types.timestamp).onInsert(() => sql.fn.now()).onUpdate(() => sql.fn.now()),
	total: sql.column(types.numeric).computed(),
});
const u = users.c;

describe('tables made elsewhere', () => {
	it('writes the column name, and the values the application owns', () => {
		expect(sql.toQuery(sql.insert(users, { seenAt: null })).text).toBe(
			'insert into "app"."User" ("seen_at", "createdAt", "updatedAt") values (cast(null as timestamptz), now(), now())',
		);
		expect(sql.toQuery(sql.update(users, { seenAt: null }).where(u.id.eq(1))).text).toBe(
			'update "app"."User" set "seen_at" = cast(null as timestamptz), "updatedAt" = now()' +
				' where "app"."User"."id" = ($1::text)::integer',
		);
		expect(sql.toQuery(sql.select({ seenAt: u.seenAt }).from(users)).text).toBe(
			'select (extract(epoch from "app"."User"."seen_at"))::text as "seenAt" from "app"."User"',
		);
	});

	it('refuses to change the table or write a column the database computes', () => {
		expect(() => sql.createTable(users)).toThrow('owned elsewhere');
		expect(() => sql.addColumn(users, 'seenAt')).toThrow('owned elsewhere');
		expect(() => sql.toQuery(sql.update(users, { total: '1' } as never))).toThrow('written by the database');
		const reading = sql.schema('app').table('t', { v: sql.column(types.integer).onInsert(() => u.id as never) });
		expect(() => sql.insert(reading, {})).toThrow('may not read a table');
	});
});

describe('generate', () => {
	it('writes definitions for an inspected schema', () => {
		const info: InspectionType = {
			enums: { 'app.mood': ['sad', 'ok'] },
			tables: [{
				schema: 'app',
				name: 'User',
				kind: 'table',
				primaryKey: ['id'],
				columns: [
					{
						name: 'id',
						position: 1,
						declared: 'integer',
						typeSchema: 'pg_catalog',
						typeName: 'int4',
						typeKind: 'b',
						nullable: false,
						identity: 'always',
						generated: false,
					},
					{
						name: 'full name',
						position: 2,
						declared: 'character varying(20)',
						typeSchema: 'pg_catalog',
						typeName: 'varchar',
						typeKind: 'b',
						nullable: true,
						generated: false,
					},
					{
						name: 'mood',
						position: 3,
						declared: 'app.mood',
						typeSchema: 'app',
						typeName: 'mood',
						typeKind: 'e',
						nullable: false,
						fallback: "'ok'::app.mood",
						generated: false,
					},
					{
						name: 'tags',
						position: 4,
						declared: 'text[]',
						typeSchema: 'pg_catalog',
						typeName: '_text',
						typeKind: 'b',
						element: { schema: 'pg_catalog', name: 'text', kind: 'b' },
						nullable: true,
						generated: false,
					},
					{
						name: 'ip',
						position: 5,
						declared: 'inet',
						typeSchema: 'pg_catalog',
						typeName: 'inet',
						typeKind: 'b',
						nullable: true,
						generated: false,
					},
				],
			}],
		};
		expect(generate(info)).toBe([
			'// Generated from the PostgreSQL catalog. The tables belong to another tool; run `drift` to keep this in step.',
			'import * as sql from "@okikio/sql/postgres";',
			'import { types } from "@okikio/sql/postgres";',
			'',
			'export const appSchema = sql.schema("app", { owned: false });',
			'',
			'/** Table "app"."User". */',
			'export const User = appSchema.table("User", {',
			'\tid: sql.column(types.integer).computed(), // integer, identity always',
			'\t"full name": sql.column(types.text()).nullable(), // character varying(20)',
			'\tmood: sql.column(types.enumerated(["app", "mood"], ["sad", "ok"])).filled(), // app.mood, default \'ok\'::app.mood',
			'\ttags: sql.column(types.array(types.nullable(types.text()))).nullable(), // text[]',
			'\tip: sql.column(types.custom(["pg_catalog", "inet"])).nullable(), // inet',
			'}, (c) => ({ primaryKey: [c["id"]] }));',
			'',
		].join('\n'));
	});
});
