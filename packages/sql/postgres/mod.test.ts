import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { temporal } from '@okikio/duration/temporal';
import * as sql from './mod.ts';
import { types } from './mod.ts';
import { executor, isClient } from './postgresjs.ts';

const app = sql.schema('app');
const notes = app.table('notes', {
	id: sql.column(types.uuid),
	title: sql.column(types.text()),
	state: sql.column(types.text(['open', 'done'])).default('open'),
	body: sql.column(types.jsonb<{ readonly words: number }>()),
	seen: sql.column(types.timestamptz).nullable(),
	rank: sql.column(types.integer).default(0),
	sequence: sql.column(types.bigint).identity(),
}, (c) => ({
	primaryKey: [c.id],
	unique: [[c.title, c.state]],
	checks: [c.rank.gte(0)],
	indexes: [{ name: 'notes_open', on: [c.rank.desc(), c.sequence], where: c.state.eq('open') }],
}));
const tags = app.table('tags', { note: sql.column(types.uuid), tag: sql.column(types.text()) }, (c) => ({
	primaryKey: [c.note, c.tag],
	foreignKeys: [{ columns: [c.note], references: notes, to: [notes.c.id], onDelete: 'cascade' }],
}));
const n = notes.c;

/** An executor that returns fixed rows and records each statement. */
function fixed(found: readonly sql.RawRow[]) {
	const seen: sql.CompiledType[] = [];
	return { seen, run: (query: sql.CompiledType) => (seen.push(query), Promise.resolve(found)) };
}

describe('statements', () => {
	it('selects typed values with every value a cast parameter', () => {
		const query = sql.toQuery(
			sql.select({ id: n.id, title: n.title }).from(notes).where(n.state.eq('open'), n.rank.gt(2)).orderBy(
				n.rank.desc(),
				n.id,
			)
				.limit(10).for({ skipLocked: true }),
		);
		expect(query.text).toBe(
			'select ("app"."notes"."id")::text as "id", ("app"."notes"."title")::text as "title" from "app"."notes"' +
				' where ("app"."notes"."state" = $1::text) and ("app"."notes"."rank" > ($2::text)::int4)' +
				' order by "app"."notes"."rank" desc, "app"."notes"."id" asc limit $3::bigint for update skip locked',
		);
		expect(query.values).toEqual(['open', '2', 10]);
		expect([...query.strings]).toEqual([
			query.text.slice(0, query.text.indexOf('$1')),
			'::text) and ("app"."notes"."rank" > (',
			'::text)::int4) order by "app"."notes"."rank" desc, "app"."notes"."id" asc limit ',
			'::bigint for update skip locked',
		]);
	});

	it('inserts only listed columns, sends JSON as text and returns typed values', () => {
		const query = sql.toQuery(
			sql.insert(notes, { id: 'a', title: 'Read later', body: { words: 2 } }).onConflict({
				target: [n.id],
				action: 'nothing',
			})
				.returning({ sequence: n.sequence }),
		);
		expect(query.text).toBe(
			'insert into "app"."notes" ("id", "title", "body") values (($1::text)::uuid, $2::text, ($3::text)::jsonb)' +
				' on conflict ("id") do nothing returning ("app"."notes"."sequence")::text as "sequence"',
		);
		expect(query.values).toEqual(['a', 'Read later', '{"words":2}']);
	});

	it('updates with expressions, moves time in SQL, and deletes with conditions', () => {
		const later = sql.later(sql.fn.clockTimestamp(), 1500);
		const changed = sql.toQuery(
			sql.update(notes, { state: 'done', seen: later, rank: sql.add(n.rank, 1) }).where(n.id.eq('a')),
		);
		expect(changed.text).toBe(
			'update "app"."notes" set "state" = $1::text, "seen" = clock_timestamp() + ($2::text)::double precision * interval \'1 millisecond\',' +
				' "rank" = cast("app"."notes"."rank" + ($3::text)::int4 as int4) where "app"."notes"."id" = ($4::text)::uuid',
		);
		const removed = sql.toQuery(sql.remove(notes).where(n.state.eq('done')).returning({ id: n.id }));
		expect(removed.text).toBe(
			'delete from "app"."notes" where "app"."notes"."state" = $1::text returning ("app"."notes"."id")::text as "id"',
		);
	});

	it('composes conditions, subqueries, row comparisons, collations and declared functions', () => {
		const t = tags.c;
		const tagged = sql.select({ note: t.note }).from(tags).where(t.tag.eq('work'));
		const lock = sql.declare('pg_advisory_xact_lock', [types.bigint], types.empty);
		const hash = sql.declare('hashtextextended', [types.text(), types.bigint], types.bigint);
		const query = sql.toQuery(
			sql.select({ id: n.id, locked: lock(hash('app:notes', 0n)) }).from(notes).where(
				sql.or(n.id.in(tagged), sql.exists(tagged), n.seen.isNull()),
				sql.row(sql.collate(n.title, 'C'), n.id).gt(['b', 'c']),
				n.state.in([]),
			),
		);
		expect(query.text).toContain('"hashtextextended"(\$');
		expect(query.text).toContain('("app"."notes"."id" in (select "app"."tags"."note" as "note" from "app"."tags"');
		expect(query.text).toContain('(("app"."notes"."title" collate "C"), "app"."notes"."id") > ($');
		expect(query.text).toContain(' and false');
		expect(query.values).toEqual(['app:notes', '0', 'work', 'work', 'b', 'c']);
	});

	it('updates a conflicting row from the proposed one, and reads JSON members', () => {
		const upsert = sql.toQuery(
			sql.insert(notes, { id: 'a', title: 't', body: { words: 1 } }).onConflict({
				target: [n.id],
				action: 'update',
				set: { body: sql.excluded(notes).c.body, rank: sql.add(n.rank, 1) },
				where: n.rank.between(0, 10),
			}),
		);
		expect(upsert.text).toContain(
			'on conflict ("id") do update set "body" = "excluded"."body", "rank" = cast("app"."notes"."rank" + ($4::text)::int4 as int4)' +
				' where "app"."notes"."rank" between ($5::text)::int4 and ($6::text)::int4',
		);
		const members = sql.toQuery(
			sql.select({ kind: sql.json.kind(n.body), words: sql.json.text(n.body, 'words') }).from(notes).where(
				sql.json.hasAll(n.body, ['words']),
				sql.json.get(n.body, 'words').eq(3),
			),
		);
		expect(members.text).toBe(
			'select (jsonb_typeof("app"."notes"."body"))::text as "kind", ("app"."notes"."body" ->> $1::text)::text as "words"' +
				' from "app"."notes" where ("app"."notes"."body" ?& array[$2::text]) and (("app"."notes"."body" -> $3::text) = ($4::text)::jsonb)',
		);
		expect(members.values).toEqual(['words', 'words', 'words', '3']);
	});

	it('refuses a generated column, an unknown column and an invalid name', () => {
		expect(() => sql.toQuery(sql.insert(notes, { id: 'a', title: 't', body: { words: 0 }, sequence: 1n } as never)))
			.toThrow(TypeError);
		expect(() => sql.toQuery(sql.update(notes, { nope: 1 } as never))).toThrow(TypeError);
		for (const name of ['', 'x'.repeat(64), 'a\u0000b', 'a\uD800b']) expect(() => sql.schema(name)).toThrow(TypeError);
		expect(() => app.table('é'.repeat(32), {})).toThrow(TypeError);
	});

	it('quotes any other name exactly, so schemas made elsewhere keep their spelling', () => {
		expect(sql.toDdlQuery(sql.createSchema('My "App"')).text).toBe(
			String.raw`create schema if not exists "My ""App"""`,
		);
		const users = sql.schema('prisma_app').table('User', {
			createdAt: sql.column(types.timestamptz),
			'full name': sql.column(types.text()),
		});
		expect(sql.toQuery(sql.select({ 'a b': users.c['full name'] }).from(users)).text).toBe(
			'select ("prisma_app"."User"."full name")::text as "a b" from "prisma_app"."User"',
		);
	});
});

describe('schema statements', () => {
	it('creates a table, its indexes and foreign keys from the definition, with constants as literals', () => {
		const [table, index] = sql.tableStatements(notes).map((item) => sql.toDdlQuery(item));
		expect(table!.text).toBe(
			'create table if not exists "app"."notes" ("id" uuid not null, "title" text not null,' +
				' "state" text not null default \'open\'::text, "body" jsonb not null, "seen" timestamptz,' +
				' "rank" int4 not null default (\'0\'::text)::int4, "sequence" bigint generated always as identity not null,' +
				' primary key ("id"), unique ("title", "state"), check ("rank" >= (\'0\'::text)::int4))',
		);
		expect(index!.text).toBe(
			'create index if not exists "notes_open" on "app"."notes" ("rank" desc, "sequence") where "state" = \'open\'::text',
		);
		expect(sql.toDdlQuery(sql.createTable(tags)).text).toContain(
			'foreign key ("note") references "app"."notes" ("id") on delete cascade',
		);
		expect(sql.toDdlQuery(sql.addColumn(notes, 'seen')).text).toBe(
			'alter table "app"."notes" add column if not exists "seen" timestamptz',
		);
	});

	it('writes transaction control and table checks as fixed text', () => {
		expect(sql.toDdlQuery(sql.begin('read committed')).text).toBe('begin isolation level read committed');
		expect(sql.toDdlQuery(sql.commit()).text).toBe('commit');
		expect(sql.toDdlQuery(sql.rollback()).text).toBe('rollback');
		expect(sql.toQuery(sql.select({ present: sql.fn.tableExists('app', 'notes') })).text).toBe(
			'select (to_regclass($1::text) is not null)::boolean as "present"',
		);
	});

	it('refuses a DDL constant that could change meaning', () => {
		const bad = app.table('bad', { a: sql.column(types.text()).default("x\\'y") });
		expect(() => sql.toDdlQuery(sql.createTable(bad))).toThrow(TypeError);
	});
});

describe('running and decoding', () => {
	it('decodes each column with its type and rejects missing, extra and mistyped columns', async () => {
		const query = sql.select({ id: n.id, body: n.body, seen: n.seen, sequence: n.sequence }).from(notes);
		const raw = { id: 'a', body: '{"words":3}', seen: '19675 80000123456', sequence: '9007199254740993' };
		expect(await sql.rows(fixed([raw]), query)).toEqual([
			{
				id: 'a',
				body: { words: 3 },
				seen: temporal.Instant.from('2023-11-14T22:13:20.123456Z'),
				sequence: 9007199254740993n,
			},
		]);
		for (
			const row of [{ ...raw, extra: 1 }, { id: 'a' }, { ...raw, body: { words: 3 } }, { ...raw, seen: 'Infinity' }, {
				...raw,
				seen: '2026-01-01',
			}]
		) {
			await expect(sql.rows(fixed([row]), query)).rejects.toThrow(TypeError);
		}
		expect(await sql.rows(fixed([{ ...raw, seen: null }]), query).then((found) => found[0]!.seen)).toBeNull();
		await expect(sql.one(fixed([raw, raw]), query)).rejects.toThrow(TypeError);
	});

	it('reads epoch milliseconds as whole microseconds, so no float read or session setting rounds them', async () => {
		const query = sql.select({ ms: sql.fn.epochMilliseconds(sql.fn.clockTimestamp()) });
		expect(sql.toQuery(query).text).toBe(
			'select (((extract(epoch from clock_timestamp()) * 1000)::double precision) * 1000)::int8::text as "ms"',
		);
		expect(await sql.rows(fixed([{ ms: '1700000000123456' }]), query)).toEqual([{ ms: 1700000000123.456 }]);
		await expect(sql.rows(fixed([{ ms: '1.7e15' }]), query)).rejects.toThrow(TypeError);
	});

	it('runs through a Postgres.js-shaped client with the template form', async () => {
		const calls: unknown[][] = [];
		const client = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
			calls.push([[...strings], values]);
			return Promise.resolve([]);
		}, { unsafe: () => [] });
		expect(isClient(client)).toBe(true);
		await sql.execute(executor(client), sql.update(notes, { rank: 1 }).where(n.id.eq('a')));
		expect(calls).toEqual([[
			['update "app"."notes" set "rank" = (', '::text)::int4 where "app"."notes"."id" = (', '::text)::uuid'],
			['1', 'a'],
		]]);
	});

	it('renders a catalog as stable SQL text', () => {
		const text = sql.render({ b: sql.remove(tags), a: sql.createSchema('app') });
		expect(text).toBe('-- a\ncreate schema if not exists "app";\n\n-- b\ndelete from "app"."tags";\n');
	});
});

describe('all-default inserts', () => {
	const defaults = app.table('defaults', { id: sql.column(types.bigint).identity() });
	it('uses DEFAULT VALUES for one row, including an omitted undefined value', () => {
		expect(sql.toQuery(sql.insert(defaults, {})).text).toBe('insert into "app"."defaults" default values');
		const optional = app.table('optional', { id: sql.column(types.integer).default(1) });
		expect(sql.toQuery(sql.insert(optional, { id: undefined })).text).toBe(
			'insert into "app"."optional" default values',
		);
	});
	it('keeps every default row and returning/conflict clauses in one statement', () => {
		expect(
			sql.toQuery(sql.insert(defaults, [{}, {}]).onConflict({ action: 'nothing' }).returning({ id: defaults.c.id }))
				.text,
		)
			.toBe(
				'insert into "app"."defaults" ("id") values (default), (default) on conflict do nothing returning ("app"."defaults"."id")::text as "id"',
			);
		expect(() => sql.toQuery(sql.insert(defaults, []))).toThrow('at least one row');
	});
	it('keeps batches for a table without columns', () => {
		const empty = app.table('empty', {});
		expect(sql.toQuery(sql.insert(empty, [{}, {}])).text).toBe(
			'insert into "app"."empty" select from generate_series(1, 2)',
		);
	});
});
