/** Create each client's schema in steps, so a server that lacks one feature still runs the cases that do not need it. @module */
import * as sql from '@okikio/sql/postgres';
import { run } from './check.ts';
import type { CaseType } from './types.ts';
import { typeStatements } from './schema.ts';

export const setup: readonly CaseType[] = [
	{
		name: 'create schema',
		run: async ({ db, name }) => {
			await sql.execute(db, sql.createSchema(name));
		},
	},
	{
		name: 'create enum type',
		after: ['create schema'],
		run: async ({ db, name }) => {
			await run(db, typeStatements(name)[0]!);
		},
	},
	{
		name: 'create composite type',
		after: ['create schema'],
		run: async ({ db, name }) => {
			await run(db, typeStatements(name)[1]!);
		},
	},
	{
		name: 'create tables with identity, serial and checks',
		after: ['create schema'],
		run: async ({ db, t }) => {
			for (const table of [t.kinds, t.nodes, t.history]) {
				await sql.execute(db, sql.createTable(table));
			}
		},
	},
	{
		name: 'create table with an enum column',
		after: ['create enum type'],
		run: async ({ db, t }) => {
			await sql.execute(db, sql.createTable(t.extras));
		},
	},
	{
		name: 'create table with dates, intervals, bytes, arrays and a composite',
		after: ['create composite type'],
		run: async ({ db, t }) => {
			await sql.execute(db, sql.createTable(t.typed));
		},
	},
	{
		name: 'create partial index',
		after: ['create tables with identity, serial and checks'],
		run: async ({ db, t }) => {
			await sql.execute(
				db,
				sql.createIndex(t.nodes, t.nodes.constraints.indexes![0]!),
			);
		},
	},
	{
		name: 'create gin index on jsonb',
		after: ['create tables with identity, serial and checks'],
		run: async ({ db, t }) => {
			await sql.execute(
				db,
				sql.createIndex(t.nodes, t.nodes.constraints.indexes![1]!),
			);
		},
	},
	{
		name: 'create trigger from typed steps',
		after: ['create tables with identity, serial and checks'],
		run: async ({ db, t }) => {
			for (const statement of t.triggers) await sql.execute(db, statement);
		},
	},
];
