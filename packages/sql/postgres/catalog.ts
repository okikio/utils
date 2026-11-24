/**
 * Read the structure of existing tables from PostgreSQL's catalog.
 *
 * {@link inspect} lists the tables, views and composite types of some schemas with every column's type, NULL rule,
 * default, identity and generated status, plus enum labels and primary keys. `drift` compares table definitions with
 * it, and `generate` writes table definitions from it, so a schema made by Prisma, Drizzle, a migration tool or plain
 * SQL can be adopted without writing every column by hand.
 *
 * The catalog queries are built with this package, against `pg_catalog` declared as a schema made elsewhere.
 *
 * @module
 */
import type { Executor } from '../run.ts';
import { rows } from '../run.ts';
import { declare } from '../functions.ts';
import { and, not } from '../logic.ts';
import { column, schema } from '../table.ts';
import { dialect } from './dialect.ts';
import { select } from './select.ts';
import * as types from './types/mod.ts';

/** One column as the catalog reports it. */
export interface ColumnInfoType {
	readonly name: string;
	/** Position, from 1. */
	readonly position: number;
	/** `format_type`, such as `character varying(255)` or `timestamp(3) without time zone`. */
	readonly declared: string;
	/** The type's schema and name, such as `pg_catalog` and `varchar`, or `app` and `mood`. */
	readonly typeSchema: string;
	readonly typeName: string;
	/** `b` base, `e` enum, `c` composite, `d` domain, `r` range, `m` multirange, `p` pseudo. */
	readonly typeKind: string;
	/** For an array, the element type's schema, name and kind. */
	readonly element?: { readonly schema: string; readonly name: string; readonly kind: string };
	/** For a domain, the base type's name. */
	readonly base?: string;
	readonly nullable: boolean;
	/** The default expression's SQL, if any. */
	readonly fallback?: string;
	/** `always` or `by default` for an identity column. */
	readonly identity?: 'always' | 'by default';
	/** A `generated always as (…) stored` column. */
	readonly generated: boolean;
}

/** A table, view or composite type and its columns. */
export interface TableInfoType {
	readonly schema: string;
	readonly name: string;
	/** `table`, `partitioned`, `view`, `materialized`, `foreign` or `composite`. */
	readonly kind: 'table' | 'partitioned' | 'view' | 'materialized' | 'foreign' | 'composite';
	readonly columns: readonly ColumnInfoType[];
	/** Primary key column names, in key order. */
	readonly primaryKey: readonly string[];
}

/** What {@link inspect} returns: the tables of the schemas asked for, and the labels of every enum they use. */
export interface InspectionType {
	readonly tables: readonly TableInfoType[];
	/** Enum labels in order, by `schema.type`. */
	readonly enums: Readonly<Record<string, readonly string[]>>;
}

const pg = schema(dialect, 'pg_catalog', { owned: false });
const namespaces = pg.table('pg_namespace', { oid: column(types.long), nspname: column(types.text()) });
const classes = pg.table('pg_class', {
	oid: column(types.long),
	relname: column(types.text()),
	relnamespace: column(types.long),
	relkind: column(types.text()),
});
const attributes = pg.table('pg_attribute', {
	attrelid: column(types.long),
	attname: column(types.text()),
	attnum: column(types.integer),
	atttypid: column(types.long),
	atttypmod: column(types.integer),
	attnotnull: column(types.boolean),
	attisdropped: column(types.boolean),
	attidentity: column(types.text()),
	attgenerated: column(types.text()),
});
const typesTable = pg.table('pg_type', {
	oid: column(types.long),
	typname: column(types.text()),
	typnamespace: column(types.long),
	typtype: column(types.text()),
	typelem: column(types.long),
	typbasetype: column(types.long),
	typcategory: column(types.text()),
});
const defaults = pg.table('pg_attrdef', {
	adrelid: column(types.long),
	adnum: column(types.integer),
	adbin: column(types.text()),
});

// The same catalogs with nullable columns, for left joins, whose columns are NULL when nothing matches.
const maybeTypes = pg.table('pg_type', {
	oid: column(types.long).nullable(),
	typname: column(types.text()).nullable(),
	typnamespace: column(types.long).nullable(),
	typtype: column(types.text()).nullable(),
});
const maybeNamespaces = pg.table('pg_namespace', {
	oid: column(types.long).nullable(),
	nspname: column(types.text()).nullable(),
});
const enumLabels = pg.table('pg_enum', {
	enumtypid: column(types.long),
	enumlabel: column(types.text()),
	enumsortorder: column(types.real),
});
const indexes = pg.table('pg_index', {
	indrelid: column(types.long),
	indisprimary: column(types.boolean),
	indkey: column(types.array(types.smallint)),
});

const formatType = declare('format_type', [types.long, types.integer], types.text());
const nodeSql = declare('pg_get_expr', [types.text(), types.long], types.nullable(types.text()));
const keyPosition = declare(
	'array_position',
	[types.array(types.smallint), types.smallint],
	types.nullable(types.integer),
);

const kinds: Readonly<Record<string, TableInfoType['kind']>> = {
	r: 'table',
	p: 'partitioned',
	v: 'view',
	m: 'materialized',
	f: 'foreign',
	c: 'composite',
};

/** The column statement: every live column of the tables, views and composite types of some schemas. */
function columnQuery(names: readonly string[]) {
	const a = attributes.c, c = classes.c, n = namespaces.c, t = typesTable.c;
	const tn = namespaces.as('tn'), et = maybeTypes.as('et'), en = maybeNamespaces.as('en'), bt = maybeTypes.as('bt');
	const d = defaults.c;
	return select({
		schema: n.nspname,
		table: c.relname,
		kind: c.relkind,
		name: a.attname,
		position: a.attnum,
		declared: formatType(a.atttypid, a.atttypmod),
		typeSchema: tn.c.nspname,
		typeName: t.typname,
		typeKind: t.typtype,
		category: t.typcategory,
		elementSchema: en.c.nspname,
		elementName: et.c.typname,
		elementKind: et.c.typtype,
		base: bt.c.typname,
		notNull: a.attnotnull,
		fallback: nodeSql(d.adbin, d.adrelid),
		identity: a.attidentity,
		generated: a.attgenerated,
	})
		.from(attributes)
		.join(classes, c.oid.eq(a.attrelid))
		.join(namespaces, n.oid.eq(c.relnamespace))
		.join(typesTable, t.oid.eq(a.atttypid))
		.join(tn, tn.c.oid.eq(t.typnamespace))
		.leftJoin(et, and(et.c.oid.eq(t.typelem), t.typcategory.eq('A')))
		.leftJoin(en, en.c.oid.eq(et.c.typnamespace))
		.leftJoin(bt, and(bt.c.oid.eq(t.typbasetype), t.typtype.eq('d')))
		.leftJoin(defaults, and(d.adrelid.eq(a.attrelid), d.adnum.eq(a.attnum)))
		.where(
			a.attnum.gt(0),
			not(a.attisdropped),
			c.relkind.in(['r', 'p', 'v', 'm', 'f', 'c']),
			n.nspname.in(names),
		)
		.orderBy(n.nspname, c.relname, a.attnum);
}

/** Primary key columns of the tables of some schemas, in key order. */
function keyQuery(names: readonly string[]) {
	const a = attributes.c, c = classes.c, n = namespaces.c, i = indexes.c;
	// `indkey` is an `int2vector`; as `smallint[]` its element order is the key order.
	const position = keyPosition(i.indkey.cast(types.array(types.smallint)), a.attnum);
	return select({ schema: n.nspname, table: c.relname, name: a.attname, position })
		.from(indexes)
		.join(classes, c.oid.eq(i.indrelid))
		.join(namespaces, n.oid.eq(c.relnamespace))
		.join(attributes, a.attrelid.eq(i.indrelid))
		.where(i.indisprimary, n.nspname.in(names), position.isNotNull())
		.orderBy(n.nspname, c.relname, position);
}

/** Labels of the enum types in some schemas. */
function enumQuery(names: readonly string[]) {
	const e = enumLabels.c, t = typesTable.c, n = namespaces.c;
	return select({ schema: n.nspname, type: t.typname, label: e.enumlabel })
		.from(enumLabels)
		.join(typesTable, t.oid.eq(e.enumtypid))
		.join(namespaces, n.oid.eq(t.typnamespace))
		.where(n.nspname.in(names))
		.orderBy(n.nspname, t.typname, e.enumsortorder);
}

/** Read the tables, views and composite types of some schemas, with the labels of the enums they use. */
export async function inspect(executor: Executor, names: readonly string[]): Promise<InspectionType> {
	if (!names.length) return { tables: [], enums: {} };
	const found = await rows(executor, columnQuery(names));
	const keys = await rows(executor, keyQuery(names));
	const typeSchemas = [...new Set(found.flatMap((row) => [row.typeSchema, row.elementSchema ?? row.typeSchema]))];
	const labels = await rows(executor, enumQuery(typeSchemas));
	const enums: Record<string, string[]> = {};
	for (const row of labels) (enums[`${row.schema}.${row.type}`] ??= []).push(row.label);
	const tables = new Map<
		string,
		{ schema: string; name: string; kind: TableInfoType['kind']; columns: ColumnInfoType[] }
	>();
	for (const row of found) {
		const id = `${row.schema}.${row.table}`;
		let table = tables.get(id);
		if (!table) tables.set(id, table = { schema: row.schema, name: row.table, kind: kinds[row.kind]!, columns: [] });
		table.columns.push(Object.freeze({
			name: row.name,
			position: row.position,
			declared: row.declared,
			typeSchema: row.typeSchema,
			typeName: row.typeName,
			typeKind: row.typeKind,
			...(row.elementName
				? { element: { schema: row.elementSchema!, name: row.elementName, kind: row.elementKind! } }
				: {}),
			...(row.base ? { base: row.base } : {}),
			nullable: !row.notNull,
			...(row.fallback ? { fallback: row.fallback } : {}),
			...(row.identity === 'a'
				? { identity: 'always' as const }
				: row.identity === 'd'
				? { identity: 'by default' as const }
				: {}),
			generated: row.generated === 's',
		}));
	}
	return Object.freeze({
		tables: Object.freeze([...tables.values()].map((table) =>
			Object.freeze({
				...table,
				columns: Object.freeze(table.columns),
				primaryKey: Object.freeze(
					keys.filter((key) => key.schema === table.schema && key.table === table.name).map((key) => key.name),
				),
			})
		)),
		enums: Object.freeze(enums),
	});
}
