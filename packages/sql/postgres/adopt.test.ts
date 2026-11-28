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
				' where "app"."User"."id" = ($1::text)::int4',
		);
		expect(sql.toQuery(sql.select({ seenAt: u.seenAt }).from(users)).text).toBe(
			'select (((("app"."User"."seen_at") at time zone \'UTC\'))::date - date \'1970-01-01\')::text || \' \' || ' +
				'((extract(hour from (("app"."User"."seen_at") at time zone \'UTC\')) * 3600000000 + ' +
				'extract(minute from (("app"."User"."seen_at") at time zone \'UTC\')) * 60000000 + ' +
				'extract(microseconds from (("app"."User"."seen_at") at time zone \'UTC\')))::int8)::text as "seenAt" ' +
				'from "app"."User"',
		);
	});

	it('refuses to change the table or write a column the database computes', () => {
		expect(() => sql.createTable(users)).toThrow('owned elsewhere');
		expect(() => sql.addColumn(users, 'seenAt')).toThrow('owned elsewhere');
		// @ts-expect-error: an unknown column fails to type-check too.
		expect(() => sql.toQuery(sql.insert(users, { nope: 1 }))).toThrow();
		// @ts-expect-error: the same for an update.
		expect(() => sql.toQuery(sql.update(users, { total: '1' }))).toThrow('written by the database');
		// @ts-expect-error: the database writes `total`, so the row type leaves it out.
		expect(() => sql.toQuery(sql.insert(users, { total: '1' }))).toThrow('written by the database');
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

describe('generated module bindings', () => {
	it('preserves custom types whose names match object prototype properties', () => {
		for (const name of ['constructor', '__proto__', 'toString']) {
			for (const kind of ['r', 'd']) {
				const typeName = kind === 'd' ? 'domain_value' : name;
				const info: InspectionType = {
					enums: {},
					tables: [{
						schema: 'app',
						name: 'sample',
						kind: 'table',
						primaryKey: [],
						columns: [{
							name: 'value',
							position: 1,
							declared: `app.${typeName}`,
							typeSchema: 'app',
							typeName,
							typeKind: kind,
							...(kind === 'd' ? { base: name } : {}),
							nullable: false,
							generated: false,
						}],
					}],
				};
				const body = generate(info).replace(/^import .*;\n/gmu, '').replace(/export const /gu, 'const ');
				// Exercise the generated codec through a parameterized insert, including the exact custom SQL type.
				const query: unknown = new Function(
					'sql',
					'types',
					body + '\nreturn sql.toQuery(sql.insert(sample, { value: "[1,2)" }));',
				)(sql, types);
				expect(query).toMatchObject({
					text: `insert into "app"."sample" ("value") values (($1::text)::"app"."${typeName}")`,
					values: ['[1,2)'],
				});
			}
		}
	});

	it('retains a column named __proto__ as an own field in the generated table', () => {
		const info: InspectionType = {
			enums: {},
			tables: [{
				schema: 'app',
				name: 'notes',
				kind: 'table',
				primaryKey: [],
				columns: [{
					name: '__proto__',
					position: 1,
					declared: 'text',
					typeSchema: 'pg_catalog',
					typeName: 'text',
					typeKind: 'b',
					nullable: false,
					generated: false,
				}],
			}],
		};
		const body = generate(info).replace(/^import .*;\n/gmu, '').replace(/export const /gu, 'const ');
		const result: unknown = new Function(
			'sql',
			'types',
			body +
				'\nreturn { columns: Object.keys(notes.columns), query: sql.toQuery(sql.select({ value: notes.c.__proto__ }).from(notes)) };',
		)(sql, types);
		expect(result).toMatchObject({
			columns: ['__proto__'],
			query: {
				text: 'select ("app"."notes"."__proto__")::text as "value" from "app"."notes"',
				values: [],
			},
		});
	});

	it('keeps catalog comments inside comments without changing database identifiers', () => {
		const info: InspectionType = {
			enums: {},
			tables: [{
				schema: 'a*/s',
				name: 'a*/b',
				kind: 'table',
				primaryKey: [],
				columns: [{
					name: 'value',
					position: 1,
					declared: 'text',
					typeSchema: 'pg_catalog',
					typeName: 'text',
					typeKind: 'b',
					nullable: false,
					fallback: "'first\nsecond\rthird\u2028fourth\u2029last'::text",
					generated: false,
				}],
			}],
		};
		const source = generate(info);
		// Execute the emitted declarations, then compile a real query through the generated table.
		const body = source.replace(/^import .*;\n/gmu, '').replace(/export const /gu, 'const ');
		const query: unknown = new Function(
			'sql',
			'types',
			body + '\nreturn sql.toQuery(sql.select({ value: a_b.c.value }).from(a_b));',
		)(sql, types);
		expect(query).toMatchObject({
			text: 'select ("a*/s"."a*/b"."value")::text as "value" from "a*/s"."a*/b"',
			values: [],
		});
	});

	it('executes generated definitions for reserved, imported and colliding names', () => {
		const info: InspectionType = {
			enums: {},
			tables: [
				['app', 'default'],
				['a', 'users'],
				['b', 'users'],
				['app', 'a-b'],
				['app', 'a_b'],
				['app', 'sql'],
				['app', 'types'],
				['app', 'appSchema'],
				['a-b', 'items'],
				['a_b', 'items'],
				['app', 'await'],
			].map(([schema, name]) => ({
				schema: schema!,
				name: name!,
				kind: 'table',
				columns: [],
				primaryKey: [],
			})),
		};
		const source = generate(info);
		// Remove module syntax only; the engine must parse and execute every generated binding and table definition.
		const body = source.replace(/^import .*;\n/gmu, '').replace(/export const /gu, 'const ');
		expect(() => new Function('sql', 'types', body)(sql, types)).not.toThrow();
		expect(generate(info)).toBe(source);
		for (const table of info.tables) expect(source).toContain('.table(' + JSON.stringify(table.name));
	});
});
