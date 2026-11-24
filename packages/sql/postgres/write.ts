/**
 * What the PostgreSQL builders that change rows share: row types, value checks, clauses and the scope check.
 *
 * `insert.ts`, `update.ts` and `delete.ts` hold the builders. Every value is sent with its column's type, so a wrong
 * value fails to type-check instead of failing in the database.
 *
 * Scope: a write may read its own table, the sources of its `from` or `using`, and `excluded` inside an upsert. A write
 * that reads anything else does not type-check as a statement and throws when built, except inside a trigger, where
 * `new`, `old` and the operation may stay free for the trigger to check.
 *
 * @module
 */
import type { Dialect } from '../dialect.ts';
import { type Column, type Expr, type Input, lift, type OwnersOf } from '../expr.ts';
import { type Fragment, identifier, join, keyword } from '../fragment.ts';
import { and } from '../logic.ts';
import {
	brand,
	closed,
	type CteType,
	list,
	type RowOfShape,
	type Shape,
	type Source,
	source,
	type TypesOf,
	typesOf,
} from '../statement.ts';
import { applied, type ColumnDef, columnName, type Columns, type Table } from '../table.ts';
import type { SqlType } from '../type.ts';
import { dialect } from './dialect.ts';

/**
 * Values an insert takes: required columns must be present, optional ones may be omitted. `O` limits what an expression
 * value may read; pass `never` for a row of plain values, such as a function parameter.
 */
export type InsertRow<C extends Columns, O extends string = string> =
	& {
		[K in keyof C as C[K] extends ColumnDef<unknown, true> ? never : K]: C[K] extends ColumnDef<infer T> ? Input<T, O>
			: never;
	}
	& {
		[K in keyof C as C[K] extends ColumnDef<unknown, true> ? K : never]?: C[K] extends ColumnDef<infer T> ? Input<T, O>
			: never;
	};

/** Values an update may set. `O` limits what an expression value may read, as for {@link InsertRow}. */
export type UpdateRow<C extends Columns, O extends string = string> = {
	[K in keyof C]?: C[K] extends ColumnDef<infer T> ? Input<T, O> : never;
};

/** The owners the values of a row or rows read. */
export type OwnersOfRow<R> = R extends readonly (infer E)[] ? OwnersOfRow<E>
	: { [K in keyof R]-?: OwnersOf<R[K]> }[keyof R];

/** A select whose columns are named after the table's columns and have the same types, for `insert … select`. */
export interface InsertSelect<C extends Columns> {
	readonly [brand]: true;
	readonly dialect: typeof dialect;
	/** The select's SQL, with raw values. */
	readonly fragment: Fragment;
	readonly free: ReadonlySet<string>;
	readonly shape: { readonly [K in keyof C]?: C[K] extends ColumnDef<infer T> ? SqlType<T> : never };
}

/** What an insert does when a row with the same key exists. `excluded(table)` names the proposed row. */
export type ConflictType<C extends Columns> =
	| { readonly target?: readonly Column<unknown>[]; readonly action: 'nothing' }
	| {
		readonly target: readonly Column<unknown>[];
		readonly action: 'update';
		readonly set: UpdateRow<C>;
		readonly where?: Expr<boolean, string>;
	};

/** The owners a conflict clause reads. */
export type OwnersOfConflict<X> = X extends { readonly set: infer S } ?
		| OwnersOfRow<S>
		| (X extends { readonly where?: infer W } ? OwnersOf<W> : never)
	: never;

/** The definition of a writable column, or an error naming the problem. */
export function writable(table: Table<Columns>, name: string): ColumnDef<unknown> {
	const def = table.columns[name];
	if (!def) throw new TypeError(`Unknown column ${name} of ${table.schema}.${table.name}.`);
	if (def.generated) throw new TypeError(`Column ${name} is written by the database and cannot be written.`);
	return def;
}

/** Each listed value sent as its column's type, as `[name, value]`. */
export function values<C extends Columns>(table: Table<C>, row: UpdateRow<C>): [string, Expr<unknown, string>][] {
	return Object.entries(row).filter(([, value]) => value !== undefined).map(([key, value]) => [
		key,
		lift(value as Input<unknown>, writable(table, key).type),
	]);
}

/** A row with the values the application writes for columns an insert omits; see `ColumnBuilder.onInsert`. */
export function withInsertValues<C extends Columns, R>(table: Table<C>, row: R): R {
	let out: Record<string, unknown> | undefined;
	for (const [key, def] of Object.entries(table.columns)) {
		if (def.insertValue && (row as Record<string, unknown>)[key] === undefined) {
			out ??= { ...(row as Record<string, unknown>) };
			out[key] = applied(def.insertValue, `${table.name}.${key}`);
		}
	}
	return (out ?? row) as R;
}

/** Update values with the values the application writes on every update; see `ColumnBuilder.onUpdate`. */
export function withUpdateValues<C extends Columns, R>(table: Table<C>, row: R): R {
	let out: Record<string, unknown> | undefined;
	for (const [key, def] of Object.entries(table.columns)) {
		if (def.updateValue && (row as Record<string, unknown>)[key] === undefined) {
			out ??= { ...(row as Record<string, unknown>) };
			out[key] = applied(def.updateValue, `${table.name}.${key}`);
		}
	}
	return (out ?? row) as R;
}

/** `name = value` for each listed column. */
export function assignments(set: readonly [string, Expr<unknown, string>][], table: Table<Columns>): Fragment {
	if (set.length === 0) throw new TypeError(`An update of ${table.schema}.${table.name} needs at least one column.`);
	return join(
		set.map(([key, value]) => join([identifier(columnName(table, key)), keyword(' = '), value.fragment])),
		', ',
	);
}

/** A where clause, or nothing. */
export function where(conditions: readonly Expr<boolean, string>[]): Fragment {
	return conditions.length ? join([keyword(' where '), and(...conditions as [Expr<boolean, string>]).fragment]) : [];
}

/** A `from` or `using` list, or nothing. */
export function sources(word: string, items: readonly Source[]): Fragment {
	return items.length ? join([keyword(` ${word} `), join(items.map(source), ', ')]) : [];
}

/** `returning` with values converted for reading, or nothing for an empty shape. */
export function returning(shape: Shape | undefined): Fragment {
	return shape && Object.keys(shape).length ? join([keyword(' returning '), list(shape, true)]) : [];
}

/** What every write tracks. */
export interface WriteState<C extends Columns> {
	readonly table: Table<C>;
	readonly with: readonly CteType<unknown>[];
	readonly where: readonly Expr<boolean, string>[];
	readonly returning?: Shape;
}

/** Shared parts of the write builders: dialect, scope check and SQL forms. */
export abstract class Write<S extends Shape> {
	declare readonly [brand]: true;
	constructor() {
		Object.defineProperty(this, brand, { value: true });
	}
	/** The dialect: PostgreSQL. */
	get dialect(): Dialect {
		return dialect;
	}
	/** The owners this write reads but does not define. A trigger may leave `new` and `old` here. */
	abstract get free(): ReadonlySet<string>;
	/** The SQL without the scope check, for a trigger body. */
	abstract get fragment(): Fragment;
	/** The SQL sent to the database. It throws when the write reads an owner outside its scope. */
	get query(): Fragment {
		closed(this.free, 'write');
		return this.fragment;
	}
	protected abstract returned(): Shape | undefined;
	/** The value type of each returned column. */
	get shape(): TypesOf<RowOfShape<S>> {
		return typesOf<RowOfShape<S>>(this.returned() ?? {});
	}
}
