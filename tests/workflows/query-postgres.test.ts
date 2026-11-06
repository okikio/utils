/** Execute compiled queries against PostgreSQL, including NULL and literal text semantics. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import postgres from 'postgres';
import * as schema from '@okikio/schema';
import * as query from '../../packages/query/mod.ts';
import { compile, compilePage } from '../../packages/query/postgres.ts';
import * as cursors from '@okikio/query/cursor';
import * as hmac from '@okikio/hash/hmac';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('PostgreSQL query verification requires a disposable database.');
const database = postgres(url, { max: 1, onnotice() {} });
const table = `query_${crypto.randomUUID().replaceAll('-', '')}`;
const cursorTable = `${table}_cursor`;
const accountTable = `${table}_accounts`;
const Search = query.define({
	fields: {
		id: query.field(schema.number(), { sortable: true }),
		name: query.field(schema.nullable(schema.string())),
	},
	filters: {
		id: [query.eq, query.ne, query.gt, query.gte, query.lt, query.lte, query.between, query.in, query.nin],
		name: [
			query.eq,
			query.ne,
			query.in,
			query.nin,
			query.contains,
			query.icontains,
			query.startsWith,
			query.endsWith,
			query.isNull,
			query.isNotNull,
		],
	},
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset({ defaultLimit: 10 }),
});
before(async () => {
	await database`create table ${database(table)} (id integer primary key, name text)`;
	await database`insert into ${database(table)} values (1, 'Ada'), (2, 'Lin'), (3, '%_\\'), (4, null)`;
	await database`create table ${database(accountTable)} (id integer primary key, name text not null)`;
	await database`create table ${
		database(cursorTable)
	} (id integer primary key, rank integer, name text, account_id integer references ${database(accountTable)}(id))`;
	await database`insert into ${database(accountTable)} values (1,'Team A'),(2,'Team B')`;
	await database`insert into ${database(cursorTable)} values
		(1,2,'b',1),(2,2,'a',1),(3,1,'b',2),(4,1,'a',null),
		(5,null,null,2),(6,null,'a',null),(7,2,'a',1),(8,null,'a',1)`;
});
after(async () => {
	try {
		await database`drop table if exists ${database(cursorTable)}`;
		await database`drop table if exists ${database(accountTable)}`;
		await database`drop table if exists ${database(table)}`;
	} finally {
		await database.end({ timeout: 2 });
	}
});

const CursorSearch = query.define({
	fields: {
		id: query.field(schema.number(), { sortable: true }),
		rank: query.field(schema.nullable(schema.number()), { sortable: true }),
		name: query.field(schema.nullable(schema.string()), { sortable: true }),
		account: query.field(schema.nullable(schema.string())),
	},
	order: [query.desc('rank'), query.asc('name'), query.asc('id', { tiebreaker: true })],
	pagination: query.cursor({ defaultLimit: 2 }),
});
const joined = {
	table: [cursorTable] as const,
	alias: 'p',
	columns: { id: 'id', rank: 'rank', name: 'name', account: { relation: 'a', column: 'name' } },
	joins: [{
		table: [accountTable] as const,
		alias: 'a',
		kind: 'left' as const,
		cardinality: 'one' as const,
		on: [{ left: { relation: 'p', column: 'account_id' }, right: { relation: 'a', column: 'id' } }],
	}],
};

describe('PostgreSQL keysets through cardinality-preserving joins', () => {
	it('authenticates a signed continuation before executing a joined page', async () => {
		const signer = await hmac.create('sha256', crypto.getRandomValues(new Uint8Array(32)));
		const definition = {
			contract: 'joined-people.v1',
			order: CursorSearch.order,
			semantics: 'postgres;nulls-last;unique-non-null-id',
			context: 'authorized-scope-a',
			values: schema.tuple([schema.nullable(schema.number()), schema.nullable(schema.string()), schema.number()]),
		};
		const policy = {
			keys: [{ id: 'current', signer }],
			activeKey: 'current',
			maximumKeys: 1,
			maximumTokenBytes: 4096,
			expiresIn: 60_000,
			now: () => 1000,
		};
		const cursor = cursors.create(definition, policy);
		const token = await cursor.encode([2, 'a', 7]);
		const checked = await CursorSearch.create({ pagination: { kind: 'cursor', cursor: token, limit: 2 } });
		const statement = await compilePage(checked, joined, cursor);
		const rows = await database.unsafe(statement.text, [...statement.values] as postgres.ParameterOrJSON<never>[]);
		expect(rows.map((row) => row.id)).toEqual([1, 4]);
		expect(rows.map((row) => row.account)).toEqual(['Team A', null]);

		// Valid signatures do not permit reuse under a different authorized query scope.
		const otherScope = cursors.create({ ...definition, context: 'authorized-scope-b' }, policy);
		await expect(compilePage(checked, joined, otherScope)).rejects.toThrow('Cursor is invalid');
	});
	it('matches native PostgreSQL ordering for every three-key direction combination', async () => {
		for (const rank of ['asc', 'desc'] as const) {
			for (const name of ['asc', 'desc'] as const) {
				for (const id of ['asc', 'desc'] as const) {
					const checked = await CursorSearch.create({
						order: [{ field: 'rank', direction: rank }, { field: 'name', direction: name }, {
							field: 'id',
							direction: id,
						}],
					});
					// Independent native SQL is the oracle. Directions are the finite constants
					// above, not input or the compiler's predicate/order implementation.
					const native = await database.unsafe(
						`SELECT id, rank, name FROM "${cursorTable}" ORDER BY rank ${rank} NULLS LAST, name ${name} NULLS LAST, id ${id} NULLS LAST`,
					);
					const expected = native.map((row) => row.id);
					for (const direction of ['after', 'before'] as const) {
						const found: unknown[] = [];
						const last = native.at(-1)!;
						let boundary: readonly unknown[] | undefined = direction === 'before'
							? [last.rank, last.name, last.id]
							: undefined;
						for (let page = 0; page < 6; page++) {
							const statement = compile(checked, {
								...joined,
								...(boundary ? { continuation: { values: boundary, direction } } : {}),
							});
							const rows = await database.unsafe(
								statement.text,
								[...statement.values] as postgres.ParameterOrJSON<never>[],
							);
							if (rows.length === 0) {
								break;
							}
							found.push(...rows.map((row) => row.id));
							const end = rows.at(-1)!;
							boundary = [end.rank, end.name, end.id];
						}
						expect(direction === 'before' ? found.reverse() : found).toEqual(
							direction === 'before' ? expected.slice(0, -1) : expected,
						);
					}
				}
			}
		}
	});

	it('visits each row once across tied mixed-direction and NULL keys', async () => {
		const checked = await CursorSearch.create();
		const collected: number[] = [];
		let boundary: readonly unknown[] | undefined;
		for (let page = 0; page < 6; page++) {
			const statement = compile(checked, { ...joined, ...(boundary ? { continuation: { values: boundary } } : {}) });
			const rows = await database.unsafe(statement.text, [...statement.values] as postgres.ParameterOrJSON<never>[]);
			if (rows.length === 0) break;
			collected.push(...rows.map((row) => row.id as number));
			const last = rows.at(-1)!;
			boundary = [last.rank, last.name, last.id];
		}
		expect(collected).toEqual([2, 7, 1, 4, 3, 6, 8, 5]);
		expect(new Set(collected).size).toBe(8);
	});

	it('traverses backward across NULL boundaries and restores canonical ordering', async () => {
		const checked = await CursorSearch.create();
		const collected: number[] = [];
		// A deleted final row may leave a valid boundary; it need not still exist.
		let boundary: readonly unknown[] = [null, null, 1000];
		for (let page = 0; page < 6; page++) {
			const statement = compile(checked, { ...joined, continuation: { values: boundary, direction: 'before' } });
			expect(statement.reversed).toBe(true);
			const rows = await database.unsafe(statement.text, [...statement.values] as postgres.ParameterOrJSON<never>[]);
			if (rows.length === 0) break;
			collected.push(...rows.map((row) => row.id as number));
			const last = rows.at(-1)!;
			boundary = [last.rank, last.name, last.id];
		}
		expect(collected.reverse()).toEqual([2, 7, 1, 4, 3, 6, 8, 5]);
	});

	it('preserves base-row paging with shared unique targets and explicit LEFT/INNER behavior', async () => {
		const checked = await CursorSearch.create({ pagination: { kind: 'cursor', limit: 20 } });
		const left = compile(checked, joined);
		const rows = await database.unsafe(left.text, [...left.values] as postgres.ParameterOrJSON<never>[]);
		expect(rows).toHaveLength(8);
		expect(rows.find((row) => row.id === 2)?.account).toBe('Team A');
		expect(rows.find((row) => row.id === 4)?.account).toBeNull();
		const inner = compile(checked, {
			...joined,
			joins: joined.joins.map((join) => ({ ...join, kind: 'inner' as const })),
		});
		const matched = await database.unsafe(inner.text, [...inner.values] as postgres.ParameterOrJSON<never>[]);
		expect(matched.map((row) => row.id)).toEqual([2, 7, 1, 3, 8, 5]);
	});
});

/** Execute on the suite-owned pool, then compare the actual ordered row identities. */
async function ids(filter: NonNullable<Parameters<typeof Search.create>[0]>['filter']): Promise<readonly number[]> {
	const checked = await Search.create({ filter, fields: ['id'] });
	const statement = compile(checked, { table: [table], columns: { id: 'id', name: 'name' } });
	const rows = await database.unsafe(statement.text, [...statement.values] as postgres.ParameterOrJSON<never>[]);
	return rows.map((row) => row.id as number);
}

describe('PostgreSQL query adapter execution', () => {
	it('orders physical columns even when selected public aliases collide with source names', async () => {
		const Renamed = query.define({
			fields: {
				id: query.field(schema.nullable(schema.string()), { sortable: true }),
				name: query.field(schema.number()),
			},
			order: [query.asc('id')],
			pagination: query.offset({ defaultLimit: 10 }),
		});
		const statement = compile(await Renamed.create(), { table: [table], columns: { id: 'name', name: 'id' } });
		const rows = await database.unsafe(statement.text, [...statement.values] as postgres.ParameterOrJSON<never>[]);
		expect(rows.map((row) => row.name)).toEqual([3, 1, 2, 4]);
	});

	it('applies projection, descending order, offset, and limit in the database', async () => {
		const checked = await Search.create({
			fields: ['name'],
			order: [{ field: 'id', direction: 'desc' }],
			pagination: { kind: 'offset', limit: 2, offset: 1 },
		});
		const statement = compile(checked, { table: [table], columns: { id: 'id', name: 'name' } });
		const rows = await database.unsafe(statement.text, [...statement.values] as postgres.ParameterOrJSON<never>[]);
		expect(rows.map((row) => ({ ...row }))).toEqual([{ name: '%_\\' }, { name: 'Lin' }]);
	});

	it('executes equality, ordered comparisons, ranges, and membership', async () => {
		expect(await ids(Search.condition('id', 'eq', 2))).toEqual([2]);
		expect(await ids(Search.condition('id', 'ne', 2))).toEqual([1, 3, 4]);
		expect(await ids(Search.condition('id', 'gt', 2))).toEqual([3, 4]);
		expect(await ids(Search.condition('id', 'gte', 2))).toEqual([2, 3, 4]);
		expect(await ids(Search.condition('id', 'lt', 2))).toEqual([1]);
		expect(await ids(Search.condition('id', 'lte', 2))).toEqual([1, 2]);
		expect(await ids(Search.condition('id', 'between', [2, 3]))).toEqual([2, 3]);
		expect(await ids(Search.condition('id', 'in', [1, 3]))).toEqual([1, 3]);
		expect(await ids(Search.condition('id', 'nin', [1, 3]))).toEqual([2, 4]);
	});

	it('treats wildcard punctuation as text and applies PostgreSQL case conversion', async () => {
		expect(await ids(Search.condition('name', 'contains', '%_\\'))).toEqual([3]);
		expect(await ids(Search.condition('name', 'icontains', 'ADA'))).toEqual([1]);
		expect(await ids(Search.condition('name', 'startsWith', 'Ad'))).toEqual([1]);
		expect(await ids(Search.condition('name', 'endsWith', 'in'))).toEqual([2]);
	});

	it('keeps null-safe equality and membership coherent under Boolean negation', async () => {
		expect(await ids(Search.condition('name', 'eq', null))).toEqual([4]);
		expect(await ids(Search.condition('name', 'ne', null))).toEqual([1, 2, 3]);
		expect(await ids(Search.condition('name', 'in', [null, 'Ada']))).toEqual([1, 4]);
		expect(await ids(Search.condition('name', 'nin', [null, 'Ada']))).toEqual([2, 3]);
		expect(await ids(Search.condition('name', 'isNull'))).toEqual([4]);
		expect(await ids(Search.condition('name', 'isNotNull'))).toEqual([1, 2, 3]);
		expect(
			await ids(
				query.all(
					query.any(Search.condition('id', 'eq', 1), Search.condition('id', 'eq', 2)),
					query.not(Search.condition('id', 'eq', 2)),
				),
			),
		).toEqual([1]);
	});
});
