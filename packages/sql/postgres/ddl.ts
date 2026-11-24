/**
 * PostgreSQL schema statements built from table definitions.
 *
 * PostgreSQL does not accept parameters in DDL, so these statements write their constants as literals. Only constants
 * from table definitions reach them; see `literal` in `dialect.ts` for the rules.
 *
 * Every statement is idempotent (`if not exists`), so a migration can run the same list again after a partial failure.
 *
 * @module
 */
import { Column, type Expr, isExpr } from '../expr.ts';
import { type Fragment, group, identifier, join, keyword, qualified } from '../fragment.ts';
import type { IsolationType } from '../run.ts';
import { type Ddl, ddl as wrap, isDdl, toDdlQuery } from '../statement.ts';
import { type ColumnDef, type Columns, fallback, type IndexType, type Table } from '../table.ts';
import { dialect } from './dialect.ts';

/** A PostgreSQL schema statement. */
function ddl(fragment: Fragment, routine = false): Ddl {
	return wrap(dialect, fragment, routine);
}

export { type Ddl, isDdl, toDdlQuery };

/** `create schema if not exists`. */
export function createSchema(name: string): Ddl {
	return ddl(join([keyword('create schema if not exists '), identifier(name)]));
}

/** One column's definition: name, type, NULL rule, default or identity. */
function columnSql(name: string, def: ColumnDef<unknown>): Fragment {
	if ((def.generated || def.sequenced) && def.type.name !== 'bigint') {
		throw new TypeError(`Column ${name} must be a bigint to be an identity or bigserial.`);
	}
	const parts: Fragment[] = [identifier(name), keyword(` ${def.sequenced ? 'bigserial' : def.type.name}`)];
	if (def.generated) parts.push(keyword(' generated always as identity'));
	if (!def.allowsNull) parts.push(keyword(' not null'));
	const value = fallback(def);
	if (value) parts.push(keyword(' default '), value.operand);
	return join(parts);
}

function names(columns: readonly Column<unknown>[]): Fragment {
	return group(join(columns.map((item) => identifier(item.name)), ', '));
}

/** `create table if not exists` with every column and table constraint. */
export function createTable(table: Table<Columns>): Ddl {
	const items: Fragment[] = Object.entries(table.columns).map(([name, def]) => columnSql(name, def));
	const constraints = table.constraints;
	if (constraints.primaryKey?.length) items.push(join([keyword('primary key '), names(constraints.primaryKey)]));
	for (const unique of constraints.unique ?? []) items.push(join([keyword('unique '), names(unique)]));
	for (const check of constraints.checks ?? []) items.push(join([keyword('check '), group(check.fragment)]));
	for (const key of constraints.foreignKeys ?? []) {
		const parts: Fragment[] = [
			keyword('foreign key '),
			names(key.columns),
			keyword(' references '),
			qualified(key.references.schema, key.references.name),
			keyword(' '),
			names(key.to),
		];
		if (key.onDelete) parts.push(keyword(` on delete ${key.onDelete}`));
		items.push(join(parts));
	}
	return ddl(join([
		keyword('create table if not exists '),
		qualified(table.schema, table.name),
		keyword(' ('),
		join(items, ', '),
		keyword(')'),
	]));
}

/** One `create index if not exists`. */
export function createIndex(table: Table<Columns>, index: IndexType): Ddl {
	const items = index.on.map((item) => {
		if (item instanceof Column) return identifier(item.name);
		if (isExpr(item)) return group((item as Expr<unknown>).fragment);
		return item.fragment;
	});
	const parts: Fragment[] = [
		keyword(index.unique ? 'create unique index if not exists ' : 'create index if not exists '),
		identifier(index.name),
		keyword(' on '),
		qualified(table.schema, table.name),
		keyword(index.method ? ` using ${index.method} ` : ' '),
		group(join(items, ', ')),
	];
	if (index.where) parts.push(keyword(' where '), index.where.fragment);
	return ddl(join(parts));
}

/** How {@link addColumn} adds a column. */
export interface AddColumnOptions {
	/**
	 * Add a `not null` column without `not null`, so an update can fill the existing rows first. Call
	 * {@link setNotNull} after that update.
	 */
	readonly backfill?: boolean;
}

/** Add a column to an existing table, for an upgrade from an older revision. */
export function addColumn(table: Table<Columns>, name: string, options: AddColumnOptions = {}): Ddl {
	const def = table.columns[name];
	if (!def) throw new TypeError(`Unknown column ${name} of ${table.schema}.${table.name}.`);
	return ddl(join([
		keyword('alter table '),
		qualified(table.schema, table.name),
		keyword(' add column if not exists '),
		columnSql(name, options.backfill ? { ...def, allowsNull: true } : def),
	]));
}

/** Require a value in a column that an older revision allowed to be NULL. Backfill the column first. */
export function setNotNull(table: Table<Columns>, name: string): Ddl {
	if (!table.columns[name]) throw new TypeError(`Unknown column ${name} of ${table.schema}.${table.name}.`);
	return ddl(join([
		keyword('alter table '),
		qualified(table.schema, table.name),
		keyword(' alter column '),
		identifier(name),
		keyword(' set not null'),
	]));
}

/**
 * Replace a named check, for an upgrade that widens or narrows it. PostgreSQL names an unnamed one-column check
 * `<table>_<column>_check`, so an upgrade can replace a check a table definition created.
 */
export function replaceCheck<K extends string>(
	table: Table<Columns, K>,
	name: string,
	check: Expr<boolean, NoInfer<K>>,
): readonly Ddl[] {
	for (const item of check.owners) {
		if (item !== table.key) throw new TypeError(`Check ${name} of ${table.key} reads ${item}, which is another table.`);
	}
	const owner = qualified(table.schema, table.name);
	return [
		ddl(join([keyword('alter table '), owner, keyword(' drop constraint if exists '), identifier(name)])),
		ddl(join([
			keyword('alter table '),
			owner,
			keyword(' add constraint '),
			identifier(name),
			keyword(' check '),
			group(check.fragment),
		])),
	];
}

/** Every statement that creates a table and its indexes. */
export function tableStatements(table: Table<Columns>): readonly Ddl[] {
	return [createTable(table), ...(table.constraints.indexes ?? []).map((index) => createIndex(table, index))];
}

/** `begin`, for a client that controls a reserved connection itself. */
export function begin(isolation?: IsolationType): Ddl {
	return ddl(keyword(isolation ? `begin isolation level ${isolation}` : 'begin'));
}

/** `commit`. */
export function commit(): Ddl {
	return ddl(keyword('commit'));
}

/** `rollback`. */
export function rollback(): Ddl {
	return ddl(keyword('rollback'));
}
