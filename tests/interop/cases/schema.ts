/** The tables every client creates in its own schema, and the values it writes. @module */
import * as sql from '@okikio/sql/postgres';
import { trigger, types as postgresTypes } from '@okikio/sql/postgres';
import { temporal } from '@okikio/duration/temporal';

/** The types module a target needs: PostgreSQL's, or CockroachDB's, which reads floats as text. */
export type TypesType = typeof postgresTypes;

/**
 * Build the tables of one schema. Every name is derived from `name`, so clients never share a table. `types` is the
 * module the target needs; only its float types differ.
 */
export function tables(name: string, types: TypesType = postgresTypes) {
	const app = sql.schema(name);
	const kinds = app.table('kinds', {
		id: sql.column(types.integer),
		label: sql.column(types.text()).nullable(),
		small: sql.column(types.integer).nullable(),
		big: sql.column(types.bigint).nullable(),
		count: sql.column(types.long).nullable(),
		ratio: sql.column(types.double).nullable(),
		flag: sql.column(types.boolean).nullable(),
		ref: sql.column(types.uuid).nullable(),
		data: sql.column(types.jsonb()).nullable(),
		at: sql.column(types.timestamptz).nullable(),
	}, (c) => ({ primaryKey: [c.id] }));
	const nodes = app.table('nodes', {
		id: sql.column(types.integer),
		parent: sql.column(types.integer).nullable(),
		label: sql.column(types.text()),
		tags: sql.column(types.jsonb()).default([]),
		state: sql.column(types.text(['open', 'done'])).default('open'),
		seq: sql.column(types.bigint).identity(),
	}, (c) => ({
		primaryKey: [c.id],
		indexes: [
			{ name: `${name}_nodes_open`, on: [c.label], where: c.state.eq('open') },
			{ name: `${name}_nodes_tags`, on: [c.tags], method: 'gin' },
		],
		checks: [c.label.ne('')],
	}));
	const history = app.table('history', {
		id: sql.column(types.bigint).serial(),
		node: sql.column(types.integer),
		label: sql.column(types.text()),
		op: sql.column(types.text()),
	}, (c) => ({ primaryKey: [c.id] }));
	const mood = types.enumerated([name, 'mood'], ['sad', 'ok', 'happy']);
	const extras = app.table('Extras', {
		id: sql.column(types.integer),
		amount: sql.column(types.numeric).nullable(),
		wall: sql.column(types.timestamp).nullable(),
		mood: sql.column(mood).default('ok'),
		'Mixed Case "Name"': sql.column(types.text()).nullable(),
	}, (c) => ({ primaryKey: [c.id] }));
	const pair = types.composite([name, 'pair'], {
		label: types.nullable(types.text()),
		n: types.nullable(types.integer),
	});
	const typed = app.table('typed', {
		id: sql.column(types.integer),
		day: sql.column(types.date).nullable(),
		clock: sql.column(types.time).nullable(),
		span: sql.column(types.interval).nullable(),
		bytes: sql.column(types.bytea).nullable(),
		tiny: sql.column(types.smallint).nullable(),
		single: sql.column(types.real).nullable(),
		list: sql.column(types.array(types.nullable(types.integer))).nullable(),
		words: sql.column(types.array(types.nullable(types.text()))).nullable(),
		both: sql.column(pair).nullable(),
	}, (c) => ({ primaryKey: [c.id] }));
	const fresh = trigger.changed(nodes, 'new').c;
	const record = trigger.routine(name, 'record', [
		trigger.run(
			sql.insert(history, {
				node: fresh.id,
				label: fresh.label,
				op: trigger.operation,
			}),
		),
		trigger.result('null'),
	]);
	const triggers = [
		record.ddl,
		...trigger.create({
			name: `${name}_record`,
			table: nodes,
			timing: 'after',
			events: ['insert', { update: [nodes.c.label] }],
			routine: record,
		}),
	];
	return { kinds, nodes, history, extras, typed, mood, pair, triggers, types };
}

export type TablesType = ReturnType<typeof tables>;

export const t1 = temporal.Instant.from('2026-01-02T03:04:05.123456Z');
const t0 = temporal.Instant.from('1969-12-31T23:59:59.999999Z');

/** Rows that reach the edges of each type: extreme integers, -0, NaN, quotes, placeholders and Unicode. */
export const kindsRows = [
	{
		id: 1,
		label: 'plain',
		small: 2147483647,
		big: 9223372036854775807n,
		count: Number.MAX_SAFE_INTEGER,
		ratio: 1.5,
		flag: true,
		ref: '00000000-0000-4000-8000-000000000001',
		data: { a: [1, 'two', null], b: { c: true } },
		at: t1,
	},
	{
		id: 2,
		label: 'quote \' " back\\slash $1 ? :name ?& -- /* */ ;',
		small: -2147483648,
		big: -9223372036854775808n,
		count: -Number.MAX_SAFE_INTEGER,
		ratio: -0,
		flag: false,
		ref: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
		data: 'just a string',
		at: t0,
	},
	{
		id: 3,
		label: 'unicode é 漢字 🙂  ',
		small: 0,
		big: 0n,
		count: 0,
		ratio: 5e-324,
		flag: null,
		ref: null,
		data: null,
		at: null,
	},
	{
		id: 4,
		label: null,
		small: null,
		big: null,
		count: null,
		ratio: 1.7976931348623157e308,
		flag: null,
		ref: null,
		data: [],
		at: null,
	},
	{
		id: 5,
		label: '',
		small: 1,
		big: 1n,
		count: 1,
		ratio: Number.NaN,
		flag: true,
		ref: null,
		data: 12345678901234567890,
		at: null,
	},
	{
		id: 6,
		label: 'inf',
		small: 1,
		big: 1n,
		count: 1,
		ratio: Number.POSITIVE_INFINITY,
		flag: true,
		ref: null,
		data: { deep: { x: '漢字', y: 1e21 } },
		at: null,
	},
] as const;

/** Set-up the package cannot express: the enum and composite types the tables use. */
export function typeStatements(name: string): readonly string[] {
	return [
		`create type "${name}".mood as enum ('sad', 'ok', 'happy')`,
		`create type "${name}".pair as (label text, n integer)`,
	];
}
